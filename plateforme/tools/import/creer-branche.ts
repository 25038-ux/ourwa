import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * CRÉE LA BRANCHE VIERGE QUI VA RECEVOIR LA REPRISE.
 *
 * ```bash
 * npx tsx tools/import/creer-branche.ts elourwa "El Ourwa" ELOU
 * ```
 *
 * `run.ts` refuse d'écrire dans une branche qui contient déjà des données qui ne
 * viennent pas d'El Ourwa. Il faut donc une branche à elle, et c'est ce que fait
 * ce script — rien de plus : ni année, ni niveau, ni compte. Tout le reste
 * arrive par l'import, ce qui est la seule façon d'avoir des totaux
 * réconciliables.
 *
 * ⚠ EN `postgres`, pas en `app_user` : `schools` est une table de plate-forme,
 * hors RLS, et `app_user` n'a pas à pouvoir créer des écoles depuis le chemin
 * d'une requête. Créer une branche est un geste d'administration.
 */
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
  } catch {
    // Pas de `.env` : on continue avec l'environnement tel qu'il est.
  }
}

const [slug, nom, prefixe] = process.argv.slice(2);
if (!slug || !nom || !prefixe) {
  console.error('Usage : creer-branche.ts <slug> <nom> <préfixe de reçu>');
  process.exit(2);
}

/**
 * ⚠ Enveloppé : la sortie CJS de tsx n’accepte pas d’`await` de premier niveau.
 */
async function principal() {
  const pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/elourwa',
  });

  const { rows } = await pool.query<{ id: string; cree: boolean }>(
    `INSERT INTO schools (slug, name, receipt_prefix)
     VALUES ($1, $2, $3)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, (xmax = 0) AS cree`,
    [slug, nom, prefixe],
  );
  await pool.query(
    `INSERT INTO school_domains (school_id, hostname, is_primary)
     VALUES ($1, $2, true) ON CONFLICT (hostname) DO NOTHING`,
    [rows[0]!.id, `${slug}.localhost`],
  );

  console.log(
    `${rows[0]!.cree ? 'Créée' : 'Déjà là'} : « ${nom} » (${slug}) — ${rows[0]!.id}\n` +
      `  ${slug}.localhost\n`,
  );
  await pool.end();
}

void principal();
