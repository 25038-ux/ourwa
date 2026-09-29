import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(here, '..', 'migrations');

/**
 * Les identifiants vivent dans le `.env` de la racine. Sans cela, `pnpm
 * db:migrate` échoue sur « DATABASE_ADMIN_URL must be set » alors que la valeur
 * est juste là — et on finit par l'exporter à la main à chaque fois.
 */
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
  } catch {
    // Pas de `.env` : on continue avec l'environnement tel qu'il est.
  }
}

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * Apply every migration, in order, against an ADMIN connection.
 *
 * Migrations run as the owner because they create roles and toggle RLS. The API
 * never connects with this URL — see standing rule 3.
 */
export async function migrate(adminUrl: string, opts: { reset?: boolean } = {}): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    if (opts.reset) {
      // Roles are cluster-wide and survive a schema drop, so they are dropped
      // explicitly. Otherwise a second reset fails on "role already exists"
      // while the grants inside it point at tables that no longer exist.
      await client.query('DROP SCHEMA IF EXISTS public CASCADE');
      await client.query('CREATE SCHEMA public');
      // ⚠ Les rôles peuvent tenir des droits dans une AUTRE base du même
      // serveur (une base d'essai, un autre projet) : DROP ROLE échoue alors et
      // laissait la base VIDE, schéma supprimé, migration jamais relancée. Un
      // rôle qui reste n'empêche rien — 0001 ne le recrée pas s'il existe, et
      // son mot de passe se repose ensuite (entrypoint, APP_USER_PASSWORD).
      try {
        await client.query(`
          DO $$
          BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
              DROP OWNED BY app_user; DROP ROLE app_user;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_reporter') THEN
              DROP OWNED BY app_reporter; DROP ROLE app_reporter;
            END IF;
          END $$;
        `);
      } catch (e) {
        console.warn(`Rôles conservés (${(e as Error).message}) : le schéma est refait, les rôles restent.`);
      }
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations',
    );
    const applied = new Set(rows.map((r) => r.filename));

    for (const file of migrationFiles()) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      // Each migration is one transaction: a half-applied migration that leaves
      // RLS enabled without its policy would expose nothing, but a half-applied
      // one that creates tables without RLS would expose everything.
      await client.query('BEGIN');
      try {
        // Les mots de passe des rôles, pour 0001 (un Postgres géré refuse
        // « devpassword ») — set_config local à la transaction, jamais un SET nu.
        await client.query("SELECT set_config('app.user_password', $1, true), set_config('app.reporter_password', $2, true)", [
          process.env.APP_USER_PASSWORD ?? '',
          process.env.APP_REPORTER_PASSWORD ?? process.env.APP_USER_PASSWORD ?? '',
        ]);
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  applied ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_ADMIN_URL (or DATABASE_URL) must be set');
    process.exit(1);
  }
  const reset = process.argv.includes('--reset');
  console.log(reset ? 'Resetting and migrating…' : 'Migrating…');
  migrate(url, { reset })
    .then(() => console.log('Done.'))
    .catch((error: Error) => {
      console.error(error.message);
      process.exit(1);
    });
}
