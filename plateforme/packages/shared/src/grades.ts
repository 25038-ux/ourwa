import { Decimal } from 'decimal.js';

/**
 * `note_absent = -1` is a MARKER, not a grade (PROJECT.md §2.4).
 *
 * If -1 enters an average as a number, every affected student's result is wrong
 * and the error is quiet. This constant and `isAbsent` exist so the exclusion is
 * a named rule rather than a magic number repeated at each call site.
 */
export const NOTE_ABSENT = -1;

export function isAbsent(score: string | number | Decimal): boolean {
  return new Decimal(score as never).equals(NOTE_ABSENT);
}

/** Drops absent markers before any averaging. */
export function countedScores<T>(
  rows: readonly T[],
  score: (row: T) => string | number | Decimal,
): T[] {
  return rows.filter((row) => !isAbsent(score(row)));
}
