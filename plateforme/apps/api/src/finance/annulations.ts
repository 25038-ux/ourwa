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
const LIVRES: { table: string; origines: readonly string[] }[] = [
  { table: 'payments', origines: ['paiement'] },
  { table: 'service_payments', origines: SOURCES_SERVICES },
  { table: 'evening_payments', origines: ['cours_soir'] },
  { table: 'evening_teacher_payments', origines: ['cours_soir_prof'] },
  { table: 'expenses', origines: ['depense'] },
  { table: 'salary_payments', origines: ['salaire_prof', 'salaire_staff', 'salaire'] },
];

const liste = (xs: readonly string[]) => xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(', ');

/**
 * La condition SQL « cette ligne de caisse compte » : elle n'appartient ni à
 * une écriture annulée, ni à une annulation. `alias` : la table `tender_lines`
 * dans la requête (des identifiants de code, jamais une saisie).
 */
export function ligneRetenue(alias = 'tl'): string {
  if (!/^[a-z_]+$/.test(alias)) throw new Error(`alias invalide : ${alias}`);
  return LIVRES.map(
    ({ table, origines }) =>
      `NOT (${alias}.source_type IN (${liste(origines)}) AND (
         EXISTS (SELECT 1 FROM ${table} x WHERE x.id = ${alias}.source_id AND x.reverses_id IS NOT NULL)
         OR EXISTS (SELECT 1 FROM ${table} x WHERE x.reverses_id = ${alias}.source_id)))`,
  ).join('\n AND ');
}

/**
 * La même condition sur une ligne d'un grand livre : ni annulation, ni annulée.
 * `table` doit être l'un des grands livres ci-dessus.
 */
export function ecritureRetenue(table: string, alias: string): string {
  if (!LIVRES.some((l) => l.table === table)) throw new Error(`grand livre inconnu : ${table}`);
  if (!/^[a-z_]+$/.test(alias)) throw new Error(`alias invalide : ${alias}`);
  return `${alias}.reverses_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM ${table} x WHERE x.reverses_id = ${alias}.id)`;
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
