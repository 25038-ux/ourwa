/**
 * UNE PÉRIODE DE PLUSIEURS JOURS — « du … au … », bornes comprises.
 *
 * Demande du propriétaire (octobre 2026) : El Ourwa ne propose qu'un jour ou un
 * mois ; le bureau veut aussi une semaine, une quinzaine, « du 28 au 3 ».
 * Les dates arrivent de l'URL : elles sont vérifiées ici avant d'appeler l'API
 * (qui les vérifie à son tour — `apps/api/src/reports/periode.ts`), pour qu'une
 * saisie impossible donne une phrase, pas une page d'erreur.
 */
export const PLAGE_MAX_JOURS = 366;

/** AAAA-MM-JJ, et une date qui existe. */
export function jourValide(valeur: string | undefined): valeur is string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur ?? '');
  if (!m) return false;
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(a, mo - 1, j));
  return a >= 2000 && a <= 2100 && d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j;
}

export type Plage = { from: string; to: string };

/**
 * La période demandée : `null` si aucune ne l'est, une phrase si elle est
 * impossible, sinon ses deux bornes.
 */
export function lirePlage(du: string | undefined, au: string | undefined): Plage | { erreur: string } | null {
  if (!du && !au) return null;
  if (!du || !au) return { erreur: 'Indiquez les deux dates de la période (du … au …).' };
  if (!jourValide(du) || !jourValide(au)) return { erreur: 'Date invalide.' };
  if (du > au) return { erreur: 'La date de début doit précéder la date de fin.' };
  const jours = Math.round((Date.parse(`${au}T00:00:00Z`) - Date.parse(`${du}T00:00:00Z`)) / 86_400_000) + 1;
  if (jours > PLAGE_MAX_JOURS) return { erreur: `La période ne peut pas dépasser ${PLAGE_MAX_JOURS} jours.` };
  return { from: du, to: au };
}

/** Son `date('d/m/Y')`. */
export const dmy = (iso: string) => iso.split('-').reverse().join('/');
