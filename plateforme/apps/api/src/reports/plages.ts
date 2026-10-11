/**
 * DES PLAGES DE JOURS — pour la synthèse de l'année (10/10/2026).
 *
 * Une plage : `[début, fin]`, AAAA-MM-JJ, bornes comprises ; `'-infinity'` et
 * `'infinity'` pour une borne ouverte (Postgres les comprend comme des dates).
 * Ces chaînes se comparent telles quelles : `'-infinity' < '2026-07-01' <
 * 'infinity'` dans l'ordre des caractères, comme dans celui du calendrier.
 *
 * La synthèse s'en sert pour ne lire dans la caisse que les jours qui PEUVENT
 * compter pour une année — ceux qu'elle possède, et ceux qui sont hors des
 * mois nominaux de toute année (où l'année du paiement fait foi) — au lieu de
 * la caisse entière. Ce ne sont que des bornes de lecture : la règle elle-même
 * reste écrite dans la requête.
 */
export type PlageJours = [debut: string, fin: string];

const OUVERTE = new Set(['-infinity', 'infinity']);

/** Le jour d'à côté ; une borne ouverte reste ouverte. */
function decaler(jour: string, jours: number): string {
  if (OUVERTE.has(jour)) return jour;
  const d = new Date(`${jour}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

/** Le lendemain d'un jour — la borne EXCLUE d'une plage dont il est la fin. */
export function lendemain(jour: string): string {
  return decaler(jour, 1);
}

/**
 * Les mêmes jours, en plages triées qui ne se touchent ni ne se chevauchent :
 * aucune ligne lue par ces plages ne l'est deux fois.
 */
export function reunirPlages(plages: PlageJours[]): PlageJours[] {
  const triees = plages
    .filter(([debut, fin]) => debut <= fin)
    .map(([debut, fin]): PlageJours => [debut, fin])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const reunies: PlageJours[] = [];
  for (const [debut, fin] of triees) {
    const derniere = reunies[reunies.length - 1];
    // Se touchent : le lendemain de la fin de l'une est le début de l'autre.
    if (derniere && (derniere[1] === 'infinity' || debut <= decaler(derniere[1], 1))) {
      if (fin > derniere[1]) derniere[1] = fin;
    } else {
      reunies.push([debut, fin]);
    }
  }
  return reunies;
}

/** Tous les jours qui ne sont dans AUCUNE des plages données, du fond des temps à l'infini. */
export function horsDesPlages(plages: PlageJours[]): PlageJours[] {
  const dehors: PlageJours[] = [];
  let debut = '-infinity';
  for (const [d, f] of reunirPlages(plages)) {
    if (d !== '-infinity') dehors.push([debut, decaler(d, -1)]);
    if (f === 'infinity') return dehors;
    debut = decaler(f, 1);
  }
  dehors.push([debut, 'infinity']);
  return dehors;
}
