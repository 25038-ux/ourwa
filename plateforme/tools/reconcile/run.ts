import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bulletinsCheck } from './checks/bulletins.js';
import { debtsCheck } from './checks/debts.js';
import { financeCheck } from './checks/finance.js';
import { gradesCheck } from './checks/grades.js';
import { payrollCheck } from './checks/payroll.js';
import { studentsCheck } from './checks/students.js';
import type { Check, CheckResult } from './types.js';

/**
 * LA RÉCONCILIATION — l'épine dorsale du projet.
 *
 * « El Ourwa contient des années de justesse accumulée ; le seul étalon
 * défendable est que le nouveau système produise des nombres identiques à partir
 * de données identiques. »
 *
 * ```bash
 * pnpm reconcile                       # tout
 * pnpm reconcile --only bulletins
 * pnpm reconcile --verbose             # imprime les lignes divergentes
 * ```
 *
 * Sort en code 1 à la moindre divergence, pour qu'une chaîne d'intégration
 * puisse en faire une barrière (règle 23 : jamais de bascule sur une
 * réconciliation en échec).
 *
 * ⚠ LE RAPPORT NE PORTE QUE DES AGRÉGATS. `reference/` est ignoré par git parce
 * qu'il contient les dossiers réels de 1 372 familles ; un rapport versionné ne
 * doit donc jamais citer un nom, un identifiant ou un montant individuel. Les
 * lignes divergentes s'impriment à l'écran avec `--verbose`, elles ne sont pas
 * écrites sur le disque.
 */

const ici = dirname(fileURLToPath(import.meta.url));

// Les identifiants des deux bases vivent dans le `.env` de la racine. Sans eux,
// « effectifs » se rabattrait sur des valeurs par défaut et échouerait à se
// connecter — ou lirait une autre base que celle qu'on croit vérifier.
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
  } catch {
    // Pas de `.env` : on continue avec l'environnement tel qu'il est.
  }
}

const args = process.argv.slice(2);
const seulement = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const verbeux = args.includes('--verbose');
const donnees =
  args.includes('--data') ? args[args.indexOf('--data') + 1]! : join(ici, 'data', 'bulletins.jsonl');

const branche = args.includes('--school') ? args[args.indexOf('--school') + 1]! : 'elourwa';

const dossierDonnees = join(ici, 'data');
const checks: Check[] = [
  bulletinsCheck(donnees),
  debtsCheck(join(dossierDonnees, 'dettes-elourwa.jsonl'), join(dossierDonnees, 'dettes-nous.jsonl')),
  studentsCheck(branche),
  gradesCheck(branche),
  financeCheck(branche),
  payrollCheck(branche),
];

const lancer = checks.filter((c) => !seulement || c.group === seulement);
if (lancer.length === 0) {
  console.error(`Aucune vérification pour « ${seulement} ».`);
  process.exit(2);
}

let echecs = 0;
const lignes: string[] = [];

/**
 * ⚠ UNE EMPREINTE NE TIENT PAS DANS UNE CELLULE. « lieux de naissance » fait
 * plus de mille caractères : imprimée entière, elle noyait la sortie et le
 * rapport, et une ligne qu'on ne lit plus ne protège plus de rien. On montre le
 * début ; le détail utile est dans la colonne « Écart », qui nomme les clés
 * fautives et elles seules.
 */
function court(v: string): string {
  return v.length <= 44 ? v : `${v.slice(0, 41)}… (${v.length} car.)`;
}

/**
 * ⚠ ET UN « | » DANS UNE EMPREINTE COUPE LA CELLULE EN DEUX. Le séparateur des
 * empreintes est aussi celui des tableaux Markdown : « F=436|M=1717 » s'affichait
 * en deux colonnes et décalait toute la ligne. Il s'échappe pour le rapport, pas
 * pour la console, qui n'a pas de colonnes à décaler.
 */
function cellule(v: string): string {
  return court(v).replaceAll('|', '\\|');
}

async function principal() {
for (const check of lancer) {
  let resultats: CheckResult[];
  try {
    resultats = await check.run();
  } catch (e) {
    console.error(`✗ ${check.name} : ${(e as Error).message}`);
    process.exit(2);
  }

  for (const r of resultats) {
    const ok = r.match;
    if (!ok) echecs += 1;
    const marque = ok ? '✓' : '✗';
    // El Ourwa d'abord, nous ensuite — dans cet ordre parce que c'est lui la
    // référence tant que le contraire n'est pas démontré (règle 26).
    console.log(
      `${marque} ${check.name} · ${r.name} — ${court(r.legacy)} → ${court(r.current)}` +
        (r.delta ? `  (${r.delta})` : ''),
    );
    lignes.push(
      `| ${check.name} | ${r.name} | ${cellule(r.legacy)} | ${cellule(r.current)} | ` +
        `${ok ? '✓' : '✗'} | ${r.delta ?? ''} |`,
    );

    if (!ok && verbeux && r.sample) {
      for (const s of r.sample) console.log('   ', JSON.stringify(s));
    }
  }
}

// ── Le rapport, daté, sans donnée personnelle ─────────────────────────────
const jour = new Date().toISOString().slice(0, 10);
const dossier = join(ici, '..', '..', 'docs', 'reconciliation');
mkdirSync(dossier, { recursive: true });
writeFileSync(
  join(dossier, `${jour}.md`),
  `# Réconciliation — ${jour}\n\n` +
    `Chaque mesure est posée des deux côtés et comparée **en chaînes** (règle 25).\n\n` +
    `- **bulletins** — El Ourwa calcule lui-même ses moyennes ; nous rejouons les\n` +
    `  mêmes entrées à travers \`@elourwa/shared\`.\n` +
    `- **effectifs** — un agrégat de chaque côté, sur ce que \`tools/import\` a repris.\n\n` +
    `| Vérification | Mesure | El Ourwa | Nous | | Écart |\n` +
    `|---|---|---|---|---|---|\n${lignes.join('\n')}\n\n` +
    (echecs === 0
      ? `**Aucune divergence.**\n`
      : `⚠ **${echecs} mesure(s) en divergence — défaut bloquant (règle 25).**\n`) +
    `\nAgrégats seulement : aucun nom, aucun identifiant, aucun montant individuel.\n`,
  'utf8',
);

console.log(`\nRapport : docs/reconciliation/${jour}.md`);
process.exit(echecs === 0 ? 0 : 1);
}

void principal();
