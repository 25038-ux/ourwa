import { SOURCES_SERVICES } from '@elourwa/shared';

/**
 * UNE ÉCRITURE ANNULÉE N'EXISTE PLUS DANS LES RAPPORTS — demande d'El Mourad
 * (30/09, 0.7.9) : « you cancel a month (15000 for instance) and then rapports
 * journalier and mensuel and every rapports still shows it … the numbers don't
 * add up between the screen and the real solde in our caisse ».
 *
 * Le grand livre ne change pas (règle 7) : une annulation reste une écriture
 * NÉGATIVE qui désigne l'originale (`reverses_id`), et ses moyens repartent en
 * « out ». Mais ce que la caisse voit, c'est qu'il ne s'est RIEN passé : le
 * rapport du jour de l'encaissement comptait l'argent en « entrée », celui de
 * l'annulation le comptait en « sortie », et « Total encaissé » gardait les
 * 15 000. Désormais, partout où l'on compte l'argent (journalier, mensuel, par
 * moyen, période, synthèse de l'année, tableau de bord), l'ORIGINALE ANNULÉE ET
 * SON ANNULATION sont écartées ensemble — quels que soient leurs jours. Les
 * reçus, eux, se lisent toujours (un reçu annulé dit qu'il l'est).
 *
 * Les grands livres qui s'annulent par contre-passation, et l'origine de leurs
 * lignes de caisse (`tender_lines.source_type`).
 */
/*
 * ⚠ FUSION (0.7.10) — la même règle avait été écrite deux fois : ici
 * (`ligneRetenue` / `ecritureRetenue`, El Mourad 0.7.9) et dans
 * `reports.service.ts` (`ligneVive` / `vive`, balayage du 04/10, ADR-0077).
 * Il n'en reste QU'UNE, ici ; les rapports, la caisse par moyen
 * (`tender.service`) et la plateforme la lisent tous. Elle porte la forme la
 * plus stricte des deux : les grands livres qui marquent aussi l'originale
 * (`reversed`) sont écartés sur ce drapeau également.
 */
/** `drapeau` : le grand livre marque aussi l'originale annulée (`reversed`). */
const LIVRES: { table: string; origines: readonly string[]; drapeau: boolean }[] = [
  { table: 'payments', origines: ['paiement'], drapeau: false },
  { table: 'service_payments', origines: SOURCES_SERVICES, drapeau: false },
  { table: 'evening_payments', origines: ['cours_soir'], drapeau: false },
  { table: 'evening_teacher_payments', origines: ['cours_soir_prof'], drapeau: true },
  { table: 'expenses', origines: ['depense'], drapeau: true },
  { table: 'salary_payments', origines: ['salaire_prof', 'salaire_staff', 'salaire'], drapeau: true },
];

const liste = (xs: readonly string[]) => xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(', ');

/**
 * La condition SQL « cette ligne de caisse compte » : elle n'appartient ni à
 * une écriture annulée, ni à une annulation. `alias` : la table `tender_lines`
 * dans la requête (des identifiants de code, jamais une saisie). Les
 * `source_type` sont des constantes du code : les écrire dans la requête la
 * laisse lisible et servie par l'index `(school_id, source_type, source_id)`.
 */
/*
 * ⚠ LA MÊME RÈGLE, ÉCRITE POUR ÊTRE LUE PAR LES ANNULATIONS ET NON PAR LES
 * LIGNES (10/10/2026, « the site is still kinda slow »).
 *
 * L'écriture d'avant (gardée mot pour mot dans ligne-retenue.spec.ts, qui
 * prouve que les deux retiennent les mêmes lignes) partait de la ligne de
 * caisse : « son écriture est-elle une annulation, ou a-t-elle été annulée ? »
 * — et Postgres allait donc chercher, POUR CHAQUE LIGNE, son écriture par sa
 * clé puis une annulation éventuelle. Sur les 7 458 lignes d'une année :
 * quinze mille recherches pour ne rien trouver, l'école n'ayant à ce jour
 * aucune annulation. C'était le plus gros poste de la synthèse de l'année et
 * de chaque rapport.
 *
 * Les annulations sont RARES ; les lignes ne le sont pas. On part donc d'elles,
 * par leur index partiel (`…_reverses_idx … WHERE reverses_id IS NOT NULL`) :
 *
 *   (a) la ligne est celle d'une ANNULATION   : son écriture porte `reverses_id` ;
 *   (b) la ligne est celle d'une ANNULÉE      : une annulation la désigne ;
 *   (c) et, pour les grands livres à drapeau, son écriture est marquée `reversed`.
 *
 * (b) ne relit plus l'écriture d'origine : la clé étrangère composite
 * `(school_id, reverses_id) → (school_id, id)` — présente sur les six grands
 * livres — garantit qu'elle existe, dans la même école.
 *
 * Le tout en UN seul ensemble — « les écritures écartées », chacune avec
 * l'origine de ses lignes — et une seule exclusion : Postgres le lit une fois
 * par requête (quelques lignes) et y cherche chaque ligne de caisse par
 * hachage, au lieu de planifier une quinzaine d'exclusions à part.
 */
function ecrituresEcartees(): string {
  return LIVRES.flatMap(({ table, origines, drapeau }) => {
    // Un grand livre peut servir plusieurs origines (les salaires, les services).
    const o = `(VALUES ${origines.map((x) => `('${x.replace(/'/g, "''")}')`).join(', ')}) AS o(origine)`;
    return [
      `SELECT o.origine, a.id AS ecriture FROM ${table} a CROSS JOIN ${o} WHERE a.reverses_id IS NOT NULL`,
      `SELECT o.origine, a.reverses_id FROM ${table} a CROSS JOIN ${o} WHERE a.reverses_id IS NOT NULL`,
      ...(drapeau ? [`SELECT o.origine, a.id FROM ${table} a CROSS JOIN ${o} WHERE a.reversed`] : []),
    ];
  }).join('\n              UNION ALL ');
}

export function ligneRetenue(alias = 'tl'): string {
  if (!/^[a-z_]+$/.test(alias)) throw new Error(`alias invalide : ${alias}`);
  return (
    `NOT EXISTS (SELECT 1 FROM (${ecrituresEcartees()}) ecartee` +
    ` WHERE ecartee.origine = ${alias}.source_type AND ecartee.ecriture = ${alias}.source_id)`
  );
}

/**
 * La même condition sur une ligne d'un grand livre : ni annulation, ni annulée.
 * `table` doit être l'un des grands livres ci-dessus.
 */
export function ecritureRetenue(table: string, alias: string): string {
  const livre = LIVRES.find((l) => l.table === table);
  if (!livre) throw new Error(`grand livre inconnu : ${table}`);
  if (!/^[a-z_]+$/.test(alias)) throw new Error(`alias invalide : ${alias}`);
  return (
    `${alias}.reverses_id IS NULL` +
    (livre.drapeau ? ` AND ${alias}.reversed = false` : '') +
    ` AND NOT EXISTS (SELECT 1 FROM ${table} annul WHERE annul.reverses_id = ${alias}.id)`
  );
}

/**
 * LA FENÊTRE D'UNE ANNÉE SCOLAIRE POUR SA SYNTHÈSE — 0.7.9.
 *
 * ⚠ ELLE COMMENÇAIT AU MOIS DE RENTRÉE (le 1er octobre) et finissait au mois de
 * fin (le 30 juin) : juillet, août et septembre n'appartenaient à AUCUNE année.
 * Or c'est la saison des réinscriptions. El Mourad, installée le 23/09, a tout
 * encaissé en septembre : sa « Synthèse — Année scolaire » affichait 0 pour
 * chaque année. Désormais une année va du 1er du mois qui suit la fin de la
 * précédente (le 1er juillet) au dernier jour de son mois de fin : les années
 * se suivent sans trou, chaque jour appartient à une année.
 */
export function fenetreAnnee(annee: { start_year: number; start_month: number; end_month: number }): {
  du: string;
  au: string;
} {
  const p = (n: number) => String(n).padStart(2, '0');
  // Le mois qui suit la fin (juin → juillet) — s'il tombe avant la rentrée ;
  // une année déclarée sans été (fin ≥ rentrée) garde sa rentrée.
  const debut = annee.end_month + 1 <= annee.start_month ? annee.end_month + 1 : annee.start_month;
  const finAnnee = annee.start_year + 1;
  const dernierJour = new Date(Date.UTC(finAnnee, annee.end_month, 0)).getUTCDate();
  return {
    du: `${annee.start_year}-${p(debut)}-01`,
    au: `${finAnnee}-${p(annee.end_month)}-${p(dernierJour)}`,
  };
}
