import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  assertNumericParserIsSafe,
  withTenant,
  withoutTenant,
  type Queryable,
} from '../src/client.js';

/**
 * THE ISOLATION SUITE.
 *
 * If any test in this file fails, the build fails and all other work stops.
 * These run against the `app_user` role — the same role the API uses, which
 * is NOT the table owner and has no BYPASSRLS. Running them as the owner would
 * pass even with a broken policy.
 */

let appPool: pg.Pool;
let ownerPool: pg.Pool;
let schoolA: string;
let schoolB: string;

const SHARED_NAME = { first: 'Ahmed', last: 'Ould Mohamed' };

async function seedStudent(schoolId: string, first: string, last: string, tag: string) {
  return withTenant(
    schoolId,
    async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO students (school_id, rim, national_id, first_name, last_name, sex)
         VALUES ($1, $2, $3, $4, $5, 'M') RETURNING id`,
        [schoolId, `RIM-${tag}`, `NID-${tag}`, first, last],
      );
      return rows[0]!.id;
    },
    appPool,
  );
}

beforeAll(async () => {
  ownerPool = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  appPool = new pg.Pool({ connectionString: process.env.DATABASE_APP_URL });

  const { rows } = await ownerPool.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES
       ('school-a', 'School A', 'AAA'),
       ('school-b', 'School B', 'BBB')
     RETURNING id`,
  );
  schoolA = rows[0]!.id;
  schoolB = rows[1]!.id;

  await seedStudent(schoolA, SHARED_NAME.first, SHARED_NAME.last, 'A1');
  await seedStudent(schoolB, SHARED_NAME.first, SHARED_NAME.last, 'B1');
  await seedStudent(schoolB, 'Fatimetou', 'Mint Sidi', 'B2');
});

afterAll(async () => {
  await appPool?.end();
  await ownerPool?.end();
});

describe('tenant isolation', () => {
  it('blocks cross-tenant reads even without a WHERE clause', async () => {
    const rows = await withTenant(
      schoolA,
      async (tx) => (await tx.query<{ id: string; school_id: string }>('SELECT * FROM students')).rows,
      appPool,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.school_id).toBe(schoolA);
  });

  it('returns exactly one "Ahmed Ould Mohamed" per school, not three', async () => {
    const count = async (schoolId: string) =>
      withTenant(
        schoolId,
        async (tx) => {
          const { rows } = await tx.query<{ n: string }>(
            'SELECT count(*)::text AS n FROM students WHERE first_name = $1 AND last_name = $2',
            [SHARED_NAME.first, SHARED_NAME.last],
          );
          return Number(rows[0]!.n);
        },
        appPool,
      );

    expect(await count(schoolA)).toBe(1);
    expect(await count(schoolB)).toBe(1);
  });

  it('sees nothing when no tenant context is set — fails closed, not open', async () => {
    const rows = await withoutTenant(
      async (tx) => (await tx.query('SELECT * FROM students')).rows,
      appPool,
    );
    expect(rows).toHaveLength(0);
  });

  it('refuses to write a row belonging to another tenant', async () => {
    await expect(
      withTenant(
        schoolA,
        (tx) =>
          tx.query(
            `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
             VALUES ($1, 'RIM-X', 'NID-X', 'Smuggled', 'Row')`,
            [schoolB],
          ),
        appPool,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot update another tenant\'s row by targeting its id directly', async () => {
    const victim = await withTenant(
      schoolB,
      async (tx) => (await tx.query<{ id: string }>('SELECT id FROM students LIMIT 1')).rows[0]!.id,
      appPool,
    );

    const affected = await withTenant(
      schoolA,
      async (tx) => {
        const result = await tx.query('UPDATE students SET last_name = $1 WHERE id = $2', [
          'Tampered',
          victim,
        ]);
        return result.rowCount;
      },
      appPool,
    );

    expect(affected).toBe(0);
  });

  it('cannot delete another tenant\'s row', async () => {
    const victim = await withTenant(
      schoolB,
      async (tx) => (await tx.query<{ id: string }>('SELECT id FROM students LIMIT 1')).rows[0]!.id,
      appPool,
    );

    const affected = await withTenant(
      schoolA,
      async (tx) => (await tx.query('DELETE FROM students WHERE id = $1', [victim])).rowCount,
      appPool,
    );

    expect(affected).toBe(0);
  });

  it('does not leak tenant context to the next user of a pooled connection', async () => {
    // The failure this guards against: a bare `SET` persists on the pooled
    // connection, so the NEXT request — possibly another school's — inherits it.
    // Standing rule 2. We force reuse by running through a single-connection pool.
    const single = new pg.Pool({ connectionString: process.env.DATABASE_APP_URL, max: 1 });
    try {
      await withTenant(schoolB, async (tx) => tx.query('SELECT 1'), single);

      const leaked = await withoutTenant(
        async (tx) => (await tx.query('SELECT * FROM students')).rows,
        single,
      );
      expect(leaked).toHaveLength(0);
    } finally {
      await single.end();
    }
  });

  /**
   * Three PLATFORM tables carry `school_id` but are deliberately not
   * tenant-scoped (ARCHITECTURE.md §6). They are listed explicitly rather than
   * excluded by a pattern, so that adding a genuine tenant table and forgetting
   * its policy still fails this test.
   *
   *   school_domains    — host -> school resolution runs BEFORE a tenant exists
   *   user_school_roles — the mapping that decides which schools a user may enter
   *   audit_log         — spans schools; impersonation events belong to no single one
   *   refresh_tokens    — a session belongs to a globally-scoped user; its
   *                       school_id records which branch the session is FOR.
   *                       Rotation runs with no tenant context (the caller has
   *                       not been placed in a school yet), so an RLS policy here
   *                       would make every refresh fail closed.
   */
  /**
   * ⚠ EVERY ENTRY HERE IS A TABLE THAT CARRIES `school_id` AND IS NOT PROTECTED
   * BY RLS. Each one needs a reason, written down, or it is a hole.
   *
   * The test below fails when a table appears that is not on this list, which
   * is the point: absorbing a new one silently is how tenant isolation stops
   * being true.
   */
  const PLATFORM_TABLES_WITH_SCHOOL_ID = [
    // The mapping FROM a hostname TO a school. Read before any tenant is known.
    'school_domains',
    // Which schools a user belongs to. Read while deciding that very question.
    'user_school_roles',
    // Written from every tenant and read by the platform console.
    'audit_log',
    // Looked up by token hash during refresh, before a tenant context exists.
    'refresh_tokens',
    // The outbound queue (0012). A worker runs outside any request and must be
    // able to claim ANY school's pending mail; a policy here would leave it
    // unable to see the queue at all. It reads only `recipient`, `subject` and
    // `body` — composed and stored earlier INSIDE a tenant context — so no
    // tenant data is derived from this table. `school_id` is carried as data,
    // for the index and for reporting, not as an access decision.
    'outbound_mail',
    // The push queue (0030): the same shape and the same reason. The worker
    // claims any school's row, then reads that family's device tokens INSIDE
    // `withTenant(row.school_id)` — the tenant-scoped part stays scoped. The row
    // itself carries only a rendered title and body, never a mark or an amount.
    'outbound_push',
  ];

  it('applies RLS to every tenant table, with FORCE enabled', async () => {
    const { rows } = await ownerPool.query<{
      tablename: string;
      rowsecurity: boolean;
      forced: boolean;
      policies: string;
    }>(`
      SELECT c.relname AS tablename,
             c.relrowsecurity AS rowsecurity,
             c.relforcerowsecurity AS forced,
             (SELECT count(*)::text FROM pg_policies p
               WHERE p.tablename = c.relname) AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
         AND EXISTS (
           SELECT 1 FROM information_schema.columns col
            WHERE col.table_name = c.relname AND col.column_name = 'school_id'
         )
    `);

    const tenantTables = rows.filter(
      (t) => !PLATFORM_TABLES_WITH_SCHOOL_ID.includes(t.tablename),
    );

    expect(tenantTables.length).toBeGreaterThan(14);
    for (const t of tenantTables) {
      expect(t.rowsecurity, `${t.tablename}: RLS not enabled`).toBe(true);
      expect(t.forced, `${t.tablename}: RLS not FORCED`).toBe(true);
      expect(Number(t.policies), `${t.tablename}: no policy`).toBeGreaterThan(0);
    }
  });

  it('has exactly the expected set of unprotected platform tables', async () => {
    // If a new table appears here, someone added a tenant table without RLS and
    // it must be justified or fixed — never silently absorbed.
    const { rows } = await ownerPool.query<{ tablename: string }>(`
      SELECT c.relname AS tablename
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND NOT c.relrowsecurity
         AND EXISTS (
           SELECT 1 FROM information_schema.columns col
            WHERE col.table_name = c.relname AND col.column_name = 'school_id'
         )
       ORDER BY 1
    `);
    expect(rows.map((r) => r.tablename)).toEqual(
      [...PLATFORM_TABLES_WITH_SCHOOL_ID].sort(),
    );
  });

  it('gives the application role no way to bypass RLS', async () => {
    const { rows } = await ownerPool.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      'SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1',
      ['app_user'],
    );
    expect(rows[0]!.rolbypassrls).toBe(false);
    expect(rows[0]!.rolsuper).toBe(false);
  });

  it('confines BYPASSRLS to the reporting role alone', async () => {
    const { rows } = await ownerPool.query<{ rolname: string }>(
      "SELECT rolname FROM pg_roles WHERE rolbypassrls AND NOT rolsuper",
    );
    expect(rows.map((r) => r.rolname)).toEqual(['app_reporter']);
  });
});

describe('money precision', () => {
  it('hands NUMERIC to the application as a string, never a float', async () => {
    const client = await appPool.connect();
    try {
      await assertNumericParserIsSafe(client as unknown as Queryable);
    } finally {
      client.release();
    }
  });

  it('keeps every money column at NUMERIC(14,2) or narrower', async () => {
    const { rows } = await ownerPool.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      numeric_scale: number;
    }>(`
      SELECT table_name, column_name, data_type, numeric_scale
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (column_name LIKE '%amount%' OR column_name LIKE '%fee%'
              OR column_name LIKE '%rate%' OR column_name LIKE '%salary%')
    `);

    expect(rows.length).toBeGreaterThan(0);
    for (const c of rows) {
      expect(c.data_type, `${c.table_name}.${c.column_name} is ${c.data_type}`).toBe('numeric');
      expect(c.numeric_scale, `${c.table_name}.${c.column_name}`).toBe(2);
    }
  });
});

describe('database encoding', () => {
  it('stores the database as UTF-8, so Arabic and French coexist', async () => {
    const { rows } = await ownerPool.query<{ encoding: string }>(
      `SELECT pg_encoding_to_char(encoding) AS encoding
         FROM pg_database WHERE datname = current_database()`,
    );
    expect(rows[0]!.encoding).toBe('UTF8');
  });

  it('round-trips Arabic text without loss', async () => {
    const arabic = 'مدرسة العروة';
    await ownerPool.query('UPDATE schools SET name_ar = $1 WHERE slug = $2', [
      arabic,
      'school-a',
    ]);
    const { rows } = await ownerPool.query<{ name_ar: string }>(
      'SELECT name_ar FROM schools WHERE slug = $1',
      ['school-a'],
    );
    expect(rows[0]!.name_ar).toBe(arabic);
  });
});

describe('connection pooling', () => {
  /**
   * THE TEST THAT CATCHES THE POOLING BUG (PHASES.md session 0.4).
   *
   * A bare `SET app.current_school_id` persists on the connection after the
   * request ends. The next request to borrow that connection inherits the
   * previous tenant. It works perfectly in development with one school and leaks
   * in production.
   *
   * Interleaving 100 alternating-tenant operations across a deliberately small
   * pool forces connection reuse, which is the only way the bug shows itself.
   */
  it('never leaks tenant context across 100 interleaved pooled operations', async () => {
    const shared = new pg.Pool({ connectionString: process.env.DATABASE_APP_URL, max: 4 });
    try {
      const results = await Promise.all(
        Array.from({ length: 100 }, (_, i) => {
          const school = i % 2 ? schoolA : schoolB;
          return withTenant(
            school,
            async (tx) => {
              const { rows } = await tx.query<{ school_id: string }>('SELECT * FROM students');
              return { school, rows };
            },
            shared,
          );
        }),
      );

      for (const { school, rows } of results) {
        expect(rows.length).toBeGreaterThan(0);
        expect(
          rows.every((r) => r.school_id === school),
          'a pooled connection returned another school\'s rows',
        ).toBe(true);
      }
    } finally {
      await shared.end();
    }
  });

  it('leaves no residual tenant setting on a connection after the transaction', async () => {
    const single = new pg.Pool({ connectionString: process.env.DATABASE_APP_URL, max: 1 });
    try {
      await withTenant(schoolA, async (tx) => tx.query('SELECT 1'), single);
      const setting = await withoutTenant(
        async (tx) =>
          (
            await tx.query<{ v: string | null }>(
              "SELECT current_setting('app.current_school_id', true) AS v",
            )
          ).rows[0]!.v,
        single,
      );
      expect(setting === null || setting === '').toBe(true);
    } finally {
      await single.end();
    }
  });
});
