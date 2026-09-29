import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { Decimal } from 'decimal.js';
import { AppModule } from '../app.module.js';
import { runInTenant } from '../tenant/tenant.context.js';
import { DebtService } from './debt.service.js';

/**
 * NOUS CALCULONS NOS PROPRES DETTES, ET LES ÉCRIVONS EN JSON — le pendant de
 * `tools/reconcile/extraire-dettes.php`.
 *
 * ```bash
 * pnpm --filter @elourwa/api extraire-dettes elourwa
 * ```
 *
 * ⚠ C'EST `DebtService.detailAcrossYears()` QUI PRODUIT LE CHIFFRE — la même
 * fonction que lisent l'écran de caisse, la porte des examens et la
 * réinscription. Pas une requête écrite pour l'occasion : une vérification qui
 * recalculerait la dette à sa façon vérifierait sa façon, pas l'écran.
 *
 * ⚠ ET IL VIT ICI, PAS DANS `tools/`. Le service est un service Nest, avec ses
 * dépendances ; l'amorcer demande le module entier. `tools/reconcile` reste un
 * comparateur de deux fichiers, symétrique des deux côtés, comme pour les
 * bulletins.
 *
 * Sortie : une ligne JSON par correspondant, clé par TÉLÉPHONE (le seul
 * identifiant commun aux deux bases), tout en chaînes (règle 25). Écrite dans
 * `tools/reconcile/data/`, qui est ignoré par git : elle porte la dette de
 * 1 372 familles, nommément.
 */
// Le même `.env` que `main.ts` : sans lui, ni la base ni les clés JWT.
loadEnv({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

async function principal() {
  const slug = process.argv[2] ?? 'elourwa';
  const sortie = fileURLToPath(
    new URL('../../../../tools/reconcile/data/dettes-nous.jsonl', import.meta.url),
  );

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const dettes = app.get(DebtService);

  // Le registre — pas le locataire — pour trouver l'école et ses correspondants.
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const { rows: ecoles } = await pool.query<{ id: string }>(
    'SELECT id FROM schools WHERE slug = $1',
    [slug],
  );
  const ecole = ecoles[0]?.id;
  if (!ecole) throw new Error(`Aucune branche « ${slug} »`);

  const { rows: parents } = await pool.query<{ id: string; phone: string }>(
    `SELECT DISTINCT u.id, u.phone FROM users u
       JOIN user_school_roles usr ON usr.user_id = u.id
       JOIN roles r ON r.id = usr.role_id
      WHERE usr.school_id = $1 AND r.code = 'parent' AND u.phone IS NOT NULL
      ORDER BY u.phone`,
    [ecole],
  );
  await pool.end();

  const lignes: string[] = [];
  await runInTenant({ schoolId: ecole, slug }, async () => {
    for (const p of parents) {
      const d = await dettes.detailAcrossYears(p.id);
      const somme = (xs: { outstanding: string }[]) =>
        xs.reduce((a, x) => a.plus(x.outstanding), new Decimal(0));
      lignes.push(
        JSON.stringify({
          telephone: p.phone,
          total: d.total.toFixed(2),
          avant_remise: d.beforeWriteOffs,
          remise: d.writtenOff,
          scolarite: somme(d.tuition).toFixed(2),
          // El Ourwa range les dettes constatées et les frais annuels sous un
          // même « diverses » ; on additionne pour comparer la même chose.
          diverses: somme(d.misc).plus(somme(d.annualFees)).toFixed(2),
          // École « services » (ADR-0073, §6) : ses échéances de service, que
          // `total` comprend. Toujours 0.00 pour une école « famille » — et
          // `tools/reconcile` ne compare que les champs qu'il nomme.
          services: somme(d.services).toFixed(2),
          mois: d.tuition.length,
        }),
      );
    }
  });

  writeFileSync(sortie, lignes.join('\n') + '\n', 'utf8');
  console.log(`${lignes.length} correspondants → ${sortie}`);
  await app.close();
}

void principal().catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
});
