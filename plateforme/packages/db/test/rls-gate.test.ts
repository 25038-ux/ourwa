import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

/**
 * Proves the isolation gate can actually FAIL.
 *
 * Every other test in this suite asserts that isolation holds. None of them
 * would notice if RLS stopped doing anything at all — a policy that is never
 * exercised and a policy that is silently absent look identical from the
 * outside when the data happens to line up.
 *
 * So this test builds a throwaway table following the tenant convention, shows
 * that rows leak with the policy off, and that they stop leaking with it on. It
 * is the control experiment for the whole suite.
 */

let owner: pg.Pool;
let app: pg.Pool;
const SCHOOL_X = '11111111-1111-1111-1111-111111111111';
const SCHOOL_Y = '22222222-2222-2222-2222-222222222222';

async function readCanaryAs(schoolId: string): Promise<number> {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_school_id', $1, true)", [schoolId]);
    const { rows } = await client.query('SELECT * FROM rls_canary');
    await client.query('COMMIT');
    return rows.length;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  app = new pg.Pool({ connectionString: process.env.DATABASE_APP_URL });

  await owner.query(`
    CREATE TABLE rls_canary (
      id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL,
      note      text NOT NULL
    );
    INSERT INTO rls_canary (school_id, note) VALUES
      ('${SCHOOL_X}', 'belongs to X'),
      ('${SCHOOL_Y}', 'belongs to Y');
    GRANT SELECT, INSERT, UPDATE, DELETE ON rls_canary TO app_user;
  `);
});

afterAll(async () => {
  await owner.query('DROP TABLE IF EXISTS rls_canary');
  await app?.end();
  await owner?.end();
});

describe('the isolation gate is real', () => {
  it('leaks every tenant\'s rows while the policy is absent', async () => {
    // This is the bug we are protecting against, reproduced deliberately.
    expect(await readCanaryAs(SCHOOL_X)).toBe(2);
  });

  it('stops leaking the moment the tenant policy is applied', async () => {
    await owner.query(`
      ALTER TABLE rls_canary ENABLE ROW LEVEL SECURITY;
      ALTER TABLE rls_canary FORCE  ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON rls_canary
        USING      (school_id = current_school_id())
        WITH CHECK (school_id = current_school_id());
    `);

    expect(await readCanaryAs(SCHOOL_X)).toBe(1);
    expect(await readCanaryAs(SCHOOL_Y)).toBe(1);
  });

  it('leaks again if someone disables the policy — so the suite would catch it', async () => {
    await owner.query('ALTER TABLE rls_canary DISABLE ROW LEVEL SECURITY');
    expect(await readCanaryAs(SCHOOL_X)).toBe(2);

    // Leave it as we found it.
    await owner.query('ALTER TABLE rls_canary ENABLE ROW LEVEL SECURITY');
    expect(await readCanaryAs(SCHOOL_X)).toBe(1);
  });
});
