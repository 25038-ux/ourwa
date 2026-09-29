import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';

/**
 * CE QUE TOUTES LES VÉRIFICATIONS PARTAGENT.
 *
 * Trois outils et une configuration. Les garder en un seul endroit n'est pas
 * qu'une question de répétition : `sou()` décide comment deux montants se
 * comparent, et `empreinte()` décide ce qu'on considère comme « la même
 * répartition ». Deux copies qui divergeraient d'un cheveu feraient passer une
 * vérification et pas l'autre, sans que rien ne le signale.
 */

export const MYSQL = {
  host: process.env.LEGACY_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.LEGACY_DB_PORT ?? 3306),
  user: process.env.LEGACY_DB_USER ?? 'root',
  password: process.env.LEGACY_DB_PASS ?? '',
  database: process.env.LEGACY_DB_NAME ?? 'elourwa_ref',
  charset: 'utf8mb4',
};

/**
 * `clé=valeur|clé=valeur…`, trié, pour comparer une répartition d'un coup.
 *
 * ⚠ Comparer « 2 153 élèves des deux côtés » ne prouve pas grand-chose : deux
 * erreurs peuvent se compenser, et deux notes interverties entre deux élèves
 * laissent tous les totaux intacts. Là où la répartition importe, la mesure est
 * une empreinte, comparée caractère par caractère.
 *
 * Les deux pilotes rendent des lignes librement indexées ; la convention est que
 * chaque requête nomme ses colonnes `cle` et `n`, des deux côtés.
 */
export function empreinte(lignes: Record<string, unknown>[]): string {
  return lignes
    .map((l) => `${String(l.cle ?? '∅')}=${String(l.n)}`)
    .sort()
    .join('|');
}

/**
 * Deux totaux ne se comparent qu'après avoir été mis à la même forme. `Decimal`
 * la fixe sans jamais passer par un flottant (règle 25) : deux totaux qui ne
 * diffèrent que d'un centime doivent se voir, et c'est exactement ce que
 * l'arithmétique flottante efface.
 */
export function sou(v: unknown): string {
  if (v === null || v === undefined) return '0.00';
  return new Decimal(String(v)).toFixed(2);
}

/**
 * Le premier écart lisible entre deux empreintes — celle des notes fait des
 * dizaines de milliers de clés, et l'afficher entière ne dit rien à personne.
 */
export function premierEcart(a: string, b: string): string {
  const decouper = (s: string) =>
    new Map(
      s
        .split('|')
        .filter(Boolean)
        .map((p) => {
          const i = p.lastIndexOf('=');
          return [p.slice(0, i), p.slice(i + 1)] as [string, string];
        }),
    );
  const ga = decouper(a);
  const gb = decouper(b);
  const ecarts: string[] = [];
  for (const [k, v] of ga) {
    const autre = gb.get(k);
    if (autre !== v) ecarts.push(`${k} : El Ourwa ${v}, nous ${autre ?? '—'}`);
  }
  for (const [k, v] of gb) if (!ga.has(k)) ecarts.push(`${k} : absent chez lui, nous ${v}`);
  const reste = ecarts.length > 5 ? ` (+${ecarts.length - 5} autres)` : '';
  return ecarts.slice(0, 5).join(' · ') + reste;
}

/**
 * L'EMPREINTE D'UNE EMPREINTE, quand les clés elles-mêmes ne doivent pas sortir.
 *
 * ⚠ « notes par élève, matière et trimestre » vaut 663 770 caractères de
 * `100:126:1=2|…` — et ces nombres sont des identifiants d'ENFANTS. Le rapport
 * daté est versionné, et `run.ts` promet qu'il ne contient « aucun nom, aucun
 * identifiant, aucun montant individuel ». Une promesse tenue partout sauf à un
 * endroit n'est pas tenue.
 *
 * La mesure compare donc deux condensés. Ils diffèrent dès qu'une seule clé
 * diffère — c'est tout ce qu'on demande à une barrière — et les clés fautives
 * partent dans `sample`, qui ne s'imprime qu'à la console avec `--verbose` et
 * n'est jamais écrit sur le disque.
 */
export function condense(v: string): string {
  return `${createHash('sha256').update(v).digest('hex').slice(0, 16)} · ${v.length} car.`;
}

/** Les clés qui diffèrent réellement, pour la console seulement. */
export function clesDivergentes(a: string, b: string, max = 10): string[] {
  const decouper = (s: string) =>
    new Map(
      s
        .split('|')
        .filter(Boolean)
        .map((p) => {
          const i = p.lastIndexOf('=');
          return [p.slice(0, i), p.slice(i + 1)] as [string, string];
        }),
    );
  const ga = decouper(a);
  const gb = decouper(b);
  const out: string[] = [];
  for (const [k, v] of ga) {
    const autre = gb.get(k);
    if (autre !== v) out.push(`${k} : El Ourwa ${v}, nous ${autre ?? '—'}`);
  }
  for (const [k, v] of gb) if (!ga.has(k)) out.push(`${k} : absent chez lui, nous ${v}`);
  return out.slice(0, max);
}
