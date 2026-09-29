import pg from 'pg';

const { Pool, types } = pg;

// ── Money must never become a float ─────────────────────────────────────────
// Standing rule 5. NUMERIC is returned as a STRING and parsed with decimal.js
// at the point of use — never by the driver, and never into a JS `number`.
//
// This is set explicitly rather than relied upon. `pg`'s default for NUMERIC has
// varied across versions, and a silent change here would lose precision on every
// amount in the system without any test failing. `assertNumericParserIsSafe()`
// below turns that assumption into something the test suite checks.
types.setTypeParser(types.builtins.NUMERIC, (value: string) => value);
types.setTypeParser(types.builtins.INT8, (value: string) => value);

export type Queryable = Pick<pg.PoolClient, 'query'>;

let pool: pg.Pool | undefined;

export function getPool(connectionString = process.env.DATABASE_URL): pg.Pool {
  if (!pool) {
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    pool = new Pool({ connectionString, max: 10 });
  }
  return pool;
}

export function setPool(p: pg.Pool): void {
  pool = p;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/**
 * Run work inside a transaction scoped to one school.
 * ARCHITECTURE.md §3. This is the ONLY supported way to reach tenant data.
 *
 * The tenant is set with `set_config(..., true)` — the third argument makes it
 * LOCAL to this transaction. A bare `SET` would persist on the pooled connection
 * and leak the next request into the previous school's data. That is the single
 * most dangerous bug available in this codebase (standing rule 2), which is why
 * this is the only supported way to reach tenant data.
 */
export async function withTenant<T>(
  schoolId: string,
  fn: (tx: Queryable) => Promise<T>,
  poolOverride?: pg.Pool,
): Promise<T> {
  const client = await (poolOverride ?? getPool()).connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_school_id', $1, true)", [schoolId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * A transaction with NO tenant set. Every policy fails closed, so this sees
 * nothing in any tenant table. Used by tests to prove that a missing context is
 * an empty result rather than a full one.
 */
export async function withoutTenant<T>(
  fn: (tx: Queryable) => Promise<T>,
  poolOverride?: pg.Pool,
): Promise<T> {
  const client = await (poolOverride ?? getPool()).connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Proves the driver hands us NUMERIC as a string. Called by the test suite. */
export async function assertNumericParserIsSafe(db: Queryable): Promise<void> {
  const { rows } = await db.query<{ v: unknown }>(
    "SELECT '12345678901.23'::numeric(14,2) AS v",
  );
  const value = rows[0]?.v;
  if (typeof value !== 'string') {
    throw new Error(
      `NUMERIC arrived as ${typeof value}, not string. Money precision is not safe.`,
    );
  }
  if (value !== '12345678901.23') {
    throw new Error(`NUMERIC round-trip changed the value: got ${value}`);
  }
}
