/**
 * L'EMPLOI DU TEMPS — les jours et les créneaux, partagés par l'API et le site.
 *
 * `timetable_slots` (0008) range les cases par ordinaux : `day_of_week`
 * 1 = lundi … 7 = dimanche (ISO 8601), `slot` 1, 2, 3. Les heures ne sont pas
 * en base ; ce sont celles qu'El Ourwa affiche en salle des profs —
 * « 8h-9h45 », « 10h-11h45 », « 12h-14h » — et elles vivaient, recopiées, dans
 * trois écrans. Les absences du personnel (ADR-0074) ont besoin de leur DURÉE
 * (heures manquées) : elles vivent donc ici, une fois.
 *
 * ⚠ La base admet jusqu'au créneau 6 (CHECK de 0008) ; El Ourwa n'en affiche
 * que trois. Un créneau au-delà n'a ni heure ni durée connues : il s'affiche
 * « Créneau n » et une absence y compte comme une séance, jamais comme zéro
 * heure.
 */

export const JOURS_SEMAINE = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] as const;

/** « Lundi » pour 1, … « Dimanche » pour 7. */
export function libelleJour(dayOfWeek: number): string {
  return JOURS_SEMAINE[dayOfWeek - 1] ?? `Jour ${dayOfWeek}`;
}

/** Le jour ISO (1 = lundi … 7 = dimanche) d'une date « AAAA-MM-JJ », sans fuseau. */
export function jourIso(dateIso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!m) throw new RangeError(`Date invalide : « ${dateIso} » (AAAA-MM-JJ attendu).`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCMonth() !== Number(m[2]) - 1) throw new RangeError(`Date invalide : « ${dateIso} ».`);
  return d.getUTCDay() === 0 ? 7 : d.getUTCDay();
}

export interface Creneau {
  slot: number;
  /** Tel qu'El Ourwa l'affiche : « 8h-9h45 ». */
  libelle: string;
  /** « 08:00 » ; null au-delà des trois créneaux d'El Ourwa. */
  debut: string | null;
  fin: string | null;
  /** La durée en minutes ; null si inconnue. */
  minutes: number | null;
}

const CRENEAUX_CONNUS: readonly Creneau[] = Object.freeze([
  Object.freeze({ slot: 1, libelle: '8h-9h45', debut: '08:00', fin: '09:45', minutes: 105 }),
  Object.freeze({ slot: 2, libelle: '10h-11h45', debut: '10:00', fin: '11:45', minutes: 105 }),
  Object.freeze({ slot: 3, libelle: '12h-14h', debut: '12:00', fin: '14:00', minutes: 120 }),
]);

/** Les trois créneaux d'El Ourwa, dans l'ordre. */
export const CRENEAUX: readonly Creneau[] = CRENEAUX_CONNUS;

/** Le créneau n (1 à 6). Au-delà des trois connus : « Créneau n », sans heure. */
export function creneau(slot: number): Creneau {
  return CRENEAUX_CONNUS.find((c) => c.slot === slot) ?? { slot, libelle: `Créneau ${slot}`, debut: null, fin: null, minutes: null };
}

/** « 07:30 » → 450. Refuse ce qui n'est pas une heure HH:MM (ou HH:MM:SS) valable. */
export function minutesDuJour(heure: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(heure);
  if (!m) throw new RangeError(`Heure invalide : « ${heure} » (HH:MM attendu).`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** La durée entre deux heures du même jour, en minutes. */
export function minutesEntre(debut: string, fin: string): number {
  return minutesDuJour(fin) - minutesDuJour(debut);
}

/** « 07:30:00 » → « 07:30 ». */
export function heureCourte(heure: string): string {
  return heure.slice(0, 5);
}

/** 105 → « 1 h 45 » ; 120 → « 2 h » ; 45 → « 45 min ». */
export function dureeLisible(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}
