import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { migrate } from './migrate.js';

/**
 * A real Postgres for integration tests, shared by every package that needs one.
 *
 * RLS cannot be tested against a mock — the policy lives in the database, so a
 * fake only proves the fake agrees with itself. Neither can refresh-token reuse
 * detection, which depends on a unique constraint and a transaction.
 *
 * Tries, in order:
 *   1. An already-running Postgres at DATABASE_ADMIN_URL (CI, `pnpm infra:up`,
 *      or `pnpm db:dev`).
 *   2. An ephemeral embedded Postgres, downloaded on first use — so the suite
 *      runs on a machine without Docker. A build gate nobody can run locally
 *      stops being a gate.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embedded: any;
let dataDir: string | undefined;

/**
 * May this suite drop and recreate the schema of that database?
 *
 * Yes when its name says it is a test database, or when someone has explicitly
 * said so in a variable whose value is hard to set by accident.
 */
function isDisposable(url: string): boolean {
  if (process.env.ELOURWA_TEST_DB_RESET === 'i-know-this-wipes-it') return true;
  try {
    const name = new URL(url).pathname.replace(/^\//, '');
    return /(^test|[_-]test)$/i.test(name);
  } catch {
    return false;
  }
}

/** Never print a connection string with its password in it. */
function redact(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username ? `${u.username}@` : ''}${u.host}${u.pathname}`;
  } catch {
    return '(unparseable connection string)';
  }
}

async function reachable(url: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

export interface TestPostgres {
  /** Owner connection — runs migrations, inspects catalogs. */
  adminUrl: string;
  /** What the API connects as: subject to RLS, no BYPASSRLS. */
  appUrl: string;
}

/**
 * ⚠ WINDOWS RESERVES PORT RANGES, AND THEY MOVE AFTER EVERY REBOOT.
 *
 * Hyper-V / WinNAT hold blocks of ~100 ports for their own use, and a `bind()`
 * inside one fails with "Permission denied" — not "address in use". The block
 * that held 54261–54360 on one boot was not there the day before. So one fixed
 * default is a coin toss: the API suite read `TEST_PG_PORT` and this one did
 * not, and `pnpm test` reported "No test files found" for a reason that had
 * nothing to do with tests.
 *
 * `netsh interface ipv4 show excludedportrange protocol=tcp` lists the ranges;
 * rather than ask a person to run it, the candidates below are spread a
 * thousand apart, and the first that binds wins. `TEST_PG_PORT` still forces one.
 */
function candidatePorts(preferred?: number): number[] {
  const env = Number(process.env.TEST_PG_PORT);
  const first = preferred ?? (Number.isFinite(env) && env > 0 ? env : 54329);
  return [first, 55429, 56529, 57629, 58729, 59829, 60929];
}

export async function startTestPostgres(
  opts: { port?: number; reset?: boolean } = {},
): Promise<TestPostgres> {
  let port = candidatePorts(opts.port)[0]!;
  const configured = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  let adminUrl: string;

  // ⚠ THIS FUNCTION DROPS THE SCHEMA OF WHATEVER DATABASE IT ADOPTS.
  //
  // It used to adopt any reachable `DATABASE_ADMIN_URL` and reset it. Exporting
  // that variable for a migration and then running the suite in the same shell
  // therefore destroyed the development database — 600 seeded students replaced
  // by test fixtures — and the only symptom was a login that stopped working.
  //
  // Now an external database must SAY it is disposable, by being named like a
  // test database or by an explicit opt-in. Anything else is left untouched and
  // the suite starts its own throwaway Postgres instead. Being slower to run is
  // a much smaller cost than being destructive by default in a system that
  // holds fee records.
  const disposable = configured ? isDisposable(configured) : false;

  if (configured && disposable && (await reachable(configured))) {
    console.log('[db] using configured Postgres (declared disposable)');
    adminUrl = configured;
  } else {
    if (configured && !disposable) {
      console.warn(
        `[db] REFUSING to run tests against ${redact(configured)} — this suite ` +
          'resets the schema and that database is not marked disposable. Name it ' +
          '*_test, or set ELOURWA_TEST_DB_RESET=i-know-this-wipes-it. Starting an ' +
          'embedded Postgres instead.',
      );
    }
    console.log('[db] starting embedded Postgres');
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    dataDir = mkdtempSync(join(tmpdir(), 'elourwa-pg-'));
    let started = false;
    let lastError: unknown;
    for (const candidate of candidatePorts(opts.port)) {
      port = candidate;
      embedded = new EmbeddedPostgres({
        databaseDir: dataDir,
        user: 'postgres',
        password: 'postgres',
        port,
        persistent: false,
        // UTF-8 is not optional: the school's data is French AND Arabic. initdb on
        // Windows defaults to WIN1252, which cannot represent Arabic at all.
        // `--locale=C` keeps ordering deterministic across machines.
        initdbFlags: ['--encoding=UTF8', '--locale=C'],
      });
      try {
        if (lastError === undefined) await embedded.initialise();
        await embedded.start();
        started = true;
        break;
      } catch (e) {
        // embedded-postgres rejects with `undefined` on a bind failure, so the
        // reason is only in pg_ctl's log; say which port, and move on.
        const why = e instanceof Error ? e.message.split('\n')[0] : 'pg_ctl refused to start';
        lastError = new Error(`embedded Postgres could not bind port ${port}: ${why}`);
        console.warn(`[db] port ${port} refused; trying the next`);
      }
    }
    if (!started) throw lastError;
    if (port !== candidatePorts(opts.port)[0]) console.log(`[db] embedded Postgres on port ${port}`);
    await embedded.createDatabase('elourwa');
    adminUrl = `postgres://postgres:postgres@localhost:${port}/elourwa`;
  }

  await migrate(adminUrl, { reset: opts.reset ?? true });

  const app = new URL(adminUrl);
  app.username = 'app_user';
  app.password = 'devpassword';
  const appUrl = app.toString();

  process.env.DATABASE_ADMIN_URL = adminUrl;
  process.env.DATABASE_URL ??= adminUrl;
  process.env.DATABASE_APP_URL = appUrl;
  console.log('[db] migrations applied');

  return { adminUrl, appUrl };
}

export async function stopTestPostgres(): Promise<void> {
  if (embedded) await embedded.stop().catch(() => undefined);
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  embedded = undefined;
  dataDir = undefined;
}
