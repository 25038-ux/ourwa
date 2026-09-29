import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import pg from 'pg';

/**
 * CE QUE TOUTES LES ÉTAPES DE LA REPRISE PARTAGENT.
 *
 * Le journal, les conversions, et `reprendre()` — qui décide comment une ligne
 * d'El Ourwa retrouve la sienne ici. Deux copies de ce fichier qui divergeraient
 * d'un cheveu feraient qu'une table serait idempotente et l'autre non, ce qui ne
 * se verrait qu'à la deuxième reprise — sur des doublons.
 */

/**
 * Les identifiants vivent dans le `.env` de la racine, comme pour l'API. Sans
 * cela l'outil se rabattrait sur des valeurs par défaut et échouerait à
 * s'authentifier — ou pire, écrirait dans une autre base que celle attendue.
 */
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
  } catch {
    // Pas de `.env` : on continue avec l'environnement tel qu'il est.
  }
}

export const MYSQL = {
  host: process.env.LEGACY_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.LEGACY_DB_PORT ?? 3306),
  user: process.env.LEGACY_DB_USER ?? 'root',
  password: process.env.LEGACY_DB_PASS ?? '',
  database: process.env.LEGACY_DB_NAME ?? 'elourwa_ref',
  charset: 'utf8mb4',
};

export const POSTGRES =
  process.env.DATABASE_URL ?? 'postgres://app_user:devpassword@localhost:5432/elourwa';

// ══ Journal ════════════════════════════════════════════════════════════════

export interface Etape {
  nom: string;
  lues: number;
  creees: number;
  majs: number;
  ecartees: number;
}
export const etapes: Etape[] = [];
/** Les décisions qui ne sont pas un simple comptage : défauts, pertes, heurts. */
export const decisions: string[] = [];

export function noter(e: Etape) {
  etapes.push(e);
  const ecart = e.ecartees ? `  ${e.ecartees} écartée(s)` : '';
  console.log(
    `  ${e.nom.padEnd(16)} ${String(e.lues).padStart(5)} lues → ` +
      `${String(e.creees).padStart(5)} créées, ${String(e.majs).padStart(5)} mises à jour${ecart}`,
  );
}

export function decision(texte: string) {
  decisions.push(texte);
}

// ══ Conversions ════════════════════════════════════════════════════════════

/**
 * ⚠ MySQL `datetime` NE PORTE PAS DE FUSEAU, et Node l'interpréterait dans celui
 * de la machine qui lance l'import. Sur un poste réglé ailleurs qu'à Nouakchott,
 * chaque horodatage se décalerait — assez pour faire passer une inscription du
 * 1er octobre au 30 septembre, donc pour changer le premier mois dû.
 *
 * L'école vit à `Africa/Nouakchott`, qui est UTC+0 **sans heure d'été** ; une
 * valeur héritée est donc déjà une heure UTC, et il suffit de le dire
 * explicitement à Postgres. La connexion MySQL est ouverte en `dateStrings`,
 * ce qui évite que le pilote ait fait sa propre conversion avant nous.
 */
export function horodatage(v: string | null): string | null {
  return v ? `${v}+00` : null;
}

/** Une date seule n'a pas de fuseau à porter. */
export function jour(v: string | null): string | null {
  return v ? v.slice(0, 10) : null;
}

/**
 * ⚠ JAMAIS DE `number` POUR DE L'ARGENT (règle 6). `mysql2` rend les `DECIMAL`
 * en chaîne, `pg` les relit en chaîne, et rien entre les deux ne doit les
 * changer en flottant. Le jour où une mise à jour de pilote inverserait ce
 * réglage, ce garde-fou le dit au lieu de laisser passer des centimes faux.
 */
export function montant(v: unknown, ou = '0'): string {
  if (v === null || v === undefined) return ou;
  if (typeof v === 'number') {
    throw new Error(
      `Un montant est arrivé en « number » (${v}) : le pilote MySQL ne rend ` +
        'plus les DECIMAL en chaîne. Corrigez cela avant d’importer de l’argent.',
    );
  }
  return String(v);
}

export const STATUT: Record<string, string> = {
  inscrit: 'enrolled',
  archive: 'archived',
  bloque_dette: 'debt_blocked',
  annule: 'cancelled',
};

export const DECISION: Record<string, string> = {
  en_cours: 'pending',
  admis: 'passed',
  ajourne: 'held_back',
  exclu: 'expelled',
};

// ══ L'écriture, rapprochée par `legacy_id` ═════════════════════════════════

/** legacy_id → uuid, d'une étape à la suivante. */
export type Carte = Map<number, string>;

const IDENTIFIANT = /^[a-z_]+$/;

/**
 * Reprend une ligne : on la retrouve par `legacy_id`, sinon on la crée.
 *
 * ⚠ POURQUOI PAS `ON CONFLICT (school_id, legacy_id)` : il n'existe aucun index
 * unique sur ce couple. Chaque table porte bien une clé naturelle — `levels` a
 * `(school_id, name)`, `groups` a `(school_id, name)` — mais s'en servir comme
 * cible de conflit ferait qu'un groupe RENOMMÉ dans El Ourwa arriverait ici en
 * double au lieu d'être mis à jour. `legacy_id` est l'identité stable ; la clé
 * naturelle reste là, en garde-fou, et fera échouer un vrai doublon.
 *
 * Les noms de table et de colonne viennent d'objets littéraux de ce fichier, pas
 * d'une entrée ; les valeurs, elles, sont toujours paramétrées.
 */
export async function reprendre(
  c: pg.PoolClient,
  table: string,
  ecole: string,
  legacyId: number,
  champs: Record<string, unknown>,
  /** Posées à la création seulement — `created_at` ne se réécrit pas. */
  aLaCreation: Record<string, unknown> = {},
): Promise<{ id: string; cree: boolean }> {
  if (!IDENTIFIANT.test(table)) throw new Error(`Table douteuse : ${table}`);

  const existant = await c.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE school_id = $1 AND legacy_id = $2`,
    [ecole, legacyId],
  );

  const cols = Object.keys(champs);
  for (const col of cols) if (!IDENTIFIANT.test(col)) throw new Error(`Colonne douteuse : ${col}`);
  const vals = Object.values(champs);

  if (existant.rows[0]) {
    const sets = cols.map((col, i) => `${col} = $${i + 3}`).join(', ');
    const { rows } = await c.query<{ id: string }>(
      `UPDATE ${table} SET ${sets} WHERE school_id = $1 AND id = $2 RETURNING id`,
      [ecole, existant.rows[0].id, ...vals],
    );
    return { id: rows[0]!.id, cree: false };
  }

  const colsCrea = Object.keys(aLaCreation);
  for (const col of colsCrea) if (!IDENTIFIANT.test(col)) throw new Error(`Colonne douteuse : ${col}`);
  const tous = [...cols, ...colsCrea];
  const toutes = [...vals, ...Object.values(aLaCreation)];
  const trous = tous.map((_, i) => `$${i + 3}`).join(', ');

  // ⚠ `origin` N'EST PAS TOUJOURS « migrated », et le supposer cassait la
  // tranche financière. Un encaissement saisi à la main dans El Ourwa arrive ici
  // en `native`, un encaissement reconstitué en `imputed` — c'est la distinction
  // sur laquelle ses rapports s'appuient, et 17 106 lignes en dépendent. Quand
  // l'appelant la pose lui-même, on ne la pose pas une seconde fois.
  const origine = tous.includes('origin') ? '' : ", origin";
  const valeurOrigine = tous.includes('origin') ? '' : ", 'migrated'";

  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO ${table} (school_id, legacy_id${origine}, ${tous.join(', ')})
     VALUES ($1, $2${valeurOrigine}, ${trous}) RETURNING id`,
    [ecole, legacyId, ...toutes],
  );
  return { id: rows[0]!.id, cree: true };
}

/**
 * L'EXEMPTION AUTOMATIQUE D'EL OURWA — les mois d'avant l'entrée de l'élève.
 *
 * ⚠ CHEZ LUI C'EST UNE RÈGLE DE CALCUL, CHEZ NOUS UN ÉTAT. `obtenir_dette_parent_
 * detaillee()` saute, au moment de calculer, les mois antérieurs à l'entrée
 * effective de l'élève dans l'année — `mois_auto_exempte_infos()`. Notre
 * constructeur d'échéancier, lui, écrit ces mois `free` une fois pour toutes, et
 * `DebtService` n'a donc pas la règle. L'échéancier repris de son
 * `inscription_mois` les porte `a_facturer` : sans cette traduction, nous
 * réclamions 142 mois de plus à 71 familles.
 *
 * La règle, transcrite de `debut_effectif_annee()` et `mois_de_rattachement()` :
 *
 *  - la date d'entrée est `etudiants.date_inscription` (sa table
 *    `reinscriptions` est vide) ;
 *  - règle du 25 : entré le 25 ou après, le premier mois dû est le suivant ;
 *  - bornée à l'année : une date avant l'ouverture n'exempte rien (présent dès
 *    le début), une date après la fin ne décrit pas cette année. C'est ce
 *    bornage qui empêche la date d'une année de contaminer les autres — 35 %
 *    de ses `date_inscription` sont la date de SA reprise, pas la vraie entrée.
 *
 * `checks/finance.ts` applique la même fonction du côté El Ourwa pour vérifier
 * la traduction : c'est ce qui rend « mois par état » comparable.
 */
export function moisAutoExempte(
  dateInscription: string | null,
  anneeScolaire: number,
  moisCivil: number,
  anneeCivile: number,
  moisDebut = 10,
  moisFin = 6,
): boolean {
  if (!dateInscription) return false;
  const [y, m, d] = dateInscription.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return false;
  let mois = m;
  let an = y;
  if (d >= 25) {
    mois += 1;
    if (mois > 12) {
      mois = 1;
      an += 1;
    }
  }
  const idx = an * 12 + mois;
  const premier = anneeScolaire * 12 + moisDebut;
  const dernier = (anneeScolaire + 1) * 12 + moisFin;
  if (idx <= premier || idx > dernier) return false;
  return anneeCivile * 12 + moisCivil < idx;
}
