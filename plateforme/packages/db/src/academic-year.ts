/**
 * Academic year arithmetic — ported from El Ourwa's includes/annee_scolaire.php.
 *
 * A school does not think in 2026 but in 2026-2027: a year opens in a chosen
 * month (October) and closes in another (June). October–December belong to the
 * year that opens; January–June to the year that closes.
 */

export interface AcademicYearShape {
  startYear: number;
  startMonth: number;
  endMonth: number;
}

export interface PayableMonth {
  /** 1-based position within the academic year. */
  order: number;
  /** Calendar month, 1–12. */
  month: number;
  /** Calendar year the month actually falls in. */
  year: number;
  label: string;
}

const MONTH_NAMES = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
] as const;

/**
 * The payable months of an academic year, in order.
 *
 * Derived from the year's own definition rather than read from a table keyed by
 * calendar year. El Ourwa's `annee_scolaire_mois` is keyed by (month, calendar
 * year), and a calendar year overlaps TWO academic years — so a naive
 * `WHERE annee = 2026` returns both sets, and the enrolment screens offered
 * "January 2026", a month of the closed year, while enrolling into 2026-2027.
 */
export function payableMonths(year: AcademicYearShape): PayableMonth[] {
  const { startYear, startMonth, endMonth } = year;
  const months: PayableMonth[] = [];
  let month = startMonth;
  let calendarYear = startYear;
  let order = 1;

  // Bounded rather than while(true): a malformed year definition must not spin.
  for (let guard = 0; guard < 24; guard++) {
    months.push({
      order,
      month,
      year: calendarYear,
      label: `${MONTH_NAMES[month - 1]} ${calendarYear}`,
    });
    if (month === endMonth && calendarYear > startYear) break;
    if (month === endMonth && startMonth <= endMonth) break;
    month += 1;
    order += 1;
    if (month > 12) {
      month = 1;
      calendarYear += 1;
    }
  }
  return months;
}

/**
 * Which academic year a (month, calendar year) pair belongs to.
 * Returns the year's `startYear`.
 */
export function academicYearOfMonth(
  month: number,
  calendarYear: number,
  startMonth = 10,
): number {
  return month >= startMonth ? calendarYear : calendarYear - 1;
}

/**
 * THE RULE OF THE 25th.
 *
 * Entered on or before the 25th → the entry month is owed.
 * Entered after the 25th       → the first owed month is the next one.
 *
 * Bounded to the year passed in: a date from another year can neither advance
 * nor push back this year's first month. Returns a 1-based order into
 * `payableMonths(year)`.
 */
export function firstOwedMonthOrder(
  year: AcademicYearShape,
  entryDate: string | Date | null | undefined,
): number {
  const months = payableMonths(year);
  if (!entryDate) return 1;

  const date = typeof entryDate === 'string' ? new Date(entryDate) : entryDate;
  if (Number.isNaN(date.getTime())) return 1;

  const day = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const calendarYear = date.getUTCFullYear();

  // Chronological index, so months are comparable across the year boundary.
  const index = calendarYear * 12 + month;
  const entryIndex = day <= 25 ? index : index + 1;

  const first = months[0]!;
  const last = months[months.length - 1]!;
  const firstIndex = first.year * 12 + first.month;
  const lastIndex = last.year * 12 + last.month;

  if (entryIndex <= firstIndex) return 1;
  // ⚠ UNE DATE HORS DE LA FENÊTRE DE L'ANNÉE NE DÉCRIT PAS CETTE ANNÉE — son
  // `debut_effectif_annee()` : « une ligne d'inscription non annulée AFFIRME
  // que l'élève était scolarisé cette année-là ; une date extérieure ne peut
  // pas le dé-scolariser ». Après le dernier mois : AUCUNE exemption, tout est
  // dû. Nous rendions « rien n'est dû » — une inscription saisie en septembre
  // dans l'année qui s'achève n'avait aucun mois exigible, la fenêtre
  // d'encaissement n'avait rien à proposer et la dette valait zéro.
  if (entryIndex > lastIndex) return 1;

  const match = months.find((m) => m.year * 12 + m.month >= entryIndex);
  return match ? match.order : months.length + 1;
}
