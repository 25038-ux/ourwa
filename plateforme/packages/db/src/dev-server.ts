import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import { migrate } from './migrate.js';

/**
 * A development Postgres that does not need Docker.
 *
 * `infra/docker-compose.dev.yml` is the documented path and what CI uses. This
 * exists because Docker Desktop is a heavyweight install that not every machine
 * has, and "you cannot run the project until you install Docker" is a bad first
 * five minutes. Same major version, same encoding, same port — so DATABASE_URL
 * is identical either way.
 *
 * Data persists in .devdata/ between runs. `pnpm db:reset` clears the schema.
 */

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(here, '..', '.devdata');
const PORT = Number(process.env.PGPORT ?? 5432);

/**
 * Is a Postgres already listening on our port?
 *
 * `pnpm dev` runs this alongside the API and web. Without this check, starting it
 * twice fails on the postmaster lock file — and because turbo treats one failed
 * task as a failed run, it takes the API and web down with it. Attaching to what
 * is already there is what the developer meant either way.
 */
async function alreadyRunning(url: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const adminUrlEarly = `postgres://postgres:postgres@localhost:${PORT}/elourwa`;
  if (await alreadyRunning(adminUrlEarly)) {
    console.log(`[db] Postgres already listening on ${PORT} — attaching.`);
    await migrate(adminUrlEarly);
    console.log('[db] migrations up to date. Ctrl-C to stop watching.');
    await new Promise(() => undefined);
    return;
  }

  const firstRun = !existsSync(DATA_DIR);
  if (firstRun) mkdirSync(DATA_DIR, { recursive: true });

  const server = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'postgres',
    password: 'postgres',
    port: PORT,
    persistent: true,
    // Must match docker-compose: UTF-8 for Arabic, C locale for deterministic
    // ordering of French and Arabic names across machines.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  if (firstRun) {
    console.log('[db] first run — initialising cluster…');
    await server.initialise();
  }

  await server.start();
  if (firstRun) {
    await server.createDatabase('elourwa');
  }

  const adminUrl = `postgres://postgres:postgres@localhost:${PORT}/elourwa`;
  await migrate(adminUrl);

  console.log(`[db] ready on port ${PORT}`);
  console.log(`[db] DATABASE_URL=postgres://app_user:devpassword@localhost:${PORT}/elourwa`);
  console.log('[db] Ctrl-C to stop.');

  const stop = async () => {
    console.log('\n[db] stopping…');
    await server.stop().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  // Hold the process open.
  await new Promise(() => undefined);
}

main().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
