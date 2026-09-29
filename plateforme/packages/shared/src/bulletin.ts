import { Decimal } from 'decimal.js';
import { NOTE_ABSENT, isAbsent } from './grades.js';

/**
 * REPORT CARD COMPUTATION — ported from El Ourwa's `includes/bulletin.php`.
 *
 * Pure functions, no database. This is the most consequential arithmetic in the
 * system: a mistake here is wrong on every child's report card, and quietly.
 *
 * Two regimes, and they are genuinely different calculations:
 *
 *   A. collège / lycée — a weighted MEAN out of 20
 *   B. fondamental     — a TOTAL out of the sum of the subjects' own scales
 *
 * Regime B is not "the same thing scaled differently". It produces a total, not
 * an average, and El Ourwa prints it as such.
 */

export interface Formula {
  /** Weight on the mean of coursework marks. El Ourwa default: 2. */
  courseworkWeight: Decimal;
  /** Weight on the exam mark. El Ourwa default: 3. */
  examWeight: Decimal;
  /** Divisor. El Ourwa default: 5. */
  divisor: Decimal;
}

export const DEFAULT_FORMULA: Formula = {
  courseworkWeight: new Decimal(2),
  examWeight: new Decimal(3),
  divisor: new Decimal(5),
};

export function formula(coursework: string | number, exam: string | number, divisor: string | number): Formula {
  return {
    courseworkWeight: new Decimal(coursework),
    examWeight: new Decimal(exam),
    divisor: new Decimal(divisor),
  };
}

export interface SubjectMarks {
  subjectId: string;
  subjectName: string;
  /** The subject's own scale — 5, 10, 20, 30 and 50 all occur in real data. */
  maxScore: string;
  coefficient: number;
  /** Raw coursework marks, absent markers included; they are filtered here. */
  coursework: string[];
  /** The exam mark, or null when not sat. `-1` means absent. */
  exam: string | null;
}

export interface SubjectResult {
  subjectId: string;
  subjectName: string;
  coefficient: number;
  maxScore: string;
  /** The raw coursework marks, absent markers included, as recorded. */
  coursework: readonly string[];
  /** Mean of the counted coursework marks, or null when none were sat. */
  courseworkMean: Decimal | null;
  exam: Decimal | null;
  /** The subject mark, on the subject's OWN scale. */
  mark: Decimal | null;
  /** The same mark rescaled to /20. Regime A only. */
  markOutOf20: Decimal | null;
  /** True when every mark for this subject was an absent marker. */
  allAbsent: boolean;
}

/**
 * The mean of the coursework marks, excluding absent markers.
 *
 * ⚠ `-1` is a MARKER, not a grade. Averaging `[-1, 10, 12]` gives 7; excluding
 * first gives 11. The first number is wrong, and nothing about it looks wrong.
 */
export function courseworkMean(marks: readonly string[]): Decimal | null {
  const counted = marks.filter((m) => !isAbsent(m));
  if (counted.length === 0) return null;
  return counted
    .reduce<Decimal>((sum, m) => sum.plus(new Decimal(m)), new Decimal(0))
    .dividedBy(counted.length);
}

/**
 * One subject's mark, on its own scale.
 *
 * When only one component exists it is returned unchanged — El Ourwa does the
 * same, and it matters: a subject with coursework but no exam yet must show the
 * coursework mark rather than half of it.
 */
export function subjectMark(
  coursework: Decimal | null,
  exam: Decimal | null,
  f: Formula,
): Decimal | null {
  if (coursework !== null && exam !== null) {
    // A divisor of 0 in one level's configuration would flatten every report
    // card in that level. Fall back to the sum of the weights, then to 1.
    let divisor = f.divisor;
    if (divisor.lessThanOrEqualTo(0)) divisor = f.courseworkWeight.plus(f.examWeight);
    if (divisor.lessThanOrEqualTo(0)) divisor = new Decimal(1);

    return coursework
      .times(f.courseworkWeight)
      .plus(exam.times(f.examWeight))
      .dividedBy(divisor);
  }
  if (coursework !== null) return coursework;
  if (exam !== null) return exam;
  return null;
}

export function evaluateSubject(marks: SubjectMarks, f: Formula): SubjectResult {
  const mean = courseworkMean(marks.coursework);
  const exam = marks.exam !== null && !isAbsent(marks.exam) ? new Decimal(marks.exam) : null;
  const mark = subjectMark(mean, exam, f);

  const maxScore = new Decimal(marks.maxScore);
  let markOutOf20: Decimal | null = null;
  if (mark !== null && maxScore.greaterThan(0)) {
    // Subjects are not all out of 20. Without rescaling, a subject marked out of
    // 50 drags the general average above 20 — which is what El Ourwa fixed.
    markOutOf20 = maxScore.equals(20) ? mark : mark.times(20).dividedBy(maxScore);
  }

  const attempted = marks.coursework.length + (marks.exam !== null ? 1 : 0);
  return {
    subjectId: marks.subjectId,
    subjectName: marks.subjectName,
    coefficient: marks.coefficient,
    maxScore: marks.maxScore,
    // Carried through so the bulletin can print the individual marks beside
    // their mean, as El Ourwa's does: a family disputing a mark asks which
    // piece of work it was, and an average cannot answer that.
    coursework: marks.coursework,
    courseworkMean: mean,
    exam,
    mark,
    markOutOf20,
    allAbsent: attempted > 0 && mark === null,
  };
}

export interface ClassicResult {
  regime: 'classic';
  subjects: SubjectResult[];
  /** Coefficient-weighted mean out of 20, or null when nothing was marked. */
  average: Decimal | null;
  totalCoefficients: number;
}

/** Regime A — collège and lycée. A weighted mean out of 20. */
export function classicReportCard(marks: readonly SubjectMarks[], f: Formula): ClassicResult {
  const subjects = marks.map((m) => evaluateSubject(m, f));

  let weighted = new Decimal(0);
  let coefficients = 0;
  for (const s of subjects) {
    if (s.markOutOf20 === null) continue;
    weighted = weighted.plus(s.markOutOf20.times(s.coefficient));
    coefficients += s.coefficient;
  }

  return {
    regime: 'classic',
    subjects,
    average: coefficients > 0 ? weighted.dividedBy(coefficients) : null,
    totalCoefficients: coefficients,
  };
}

export interface FondamentalResult {
  regime: 'fondamental';
  subjects: SubjectResult[];
  /** Sum of the subject marks, on their own scales. */
  points: Decimal;
  /** Sum of the scales of the subjects that were actually marked. */
  outOf: Decimal;
  /** points / outOf * 20, for display only. Never the printed figure. */
  equivalentOutOf20: Decimal | null;
}

/**
 * Regime B — fondamental.
 *
 * Subject mark = (mean(coursework) + exam) / 2, on the subject's OWN scale.
 * The result is a TOTAL out of the sum of the scales evaluated, with no
 * coefficients and no rescaling. El Ourwa prints exactly this.
 */
export function fondamentalReportCard(marks: readonly SubjectMarks[]): FondamentalResult {
  const subjects: SubjectResult[] = [];
  let points = new Decimal(0);
  let outOf = new Decimal(0);

  for (const m of marks) {
    const mean = courseworkMean(m.coursework);
    const exam = m.exam !== null && !isAbsent(m.exam) ? new Decimal(m.exam) : null;

    // Note the plain average of the two components — NOT the weighted formula.
    const mark =
      mean !== null && exam !== null
        ? mean.plus(exam).dividedBy(2)
        : (mean ?? exam);

    const attempted = m.coursework.length + (m.exam !== null ? 1 : 0);
    subjects.push({
      subjectId: m.subjectId,
      subjectName: m.subjectName,
      coefficient: m.coefficient,
      maxScore: m.maxScore,
      coursework: m.coursework,
      courseworkMean: mean,
      exam,
      mark,
      markOutOf20: null,
      allAbsent: attempted > 0 && mark === null,
    });

    if (mark !== null) {
      points = points.plus(mark);
      outOf = outOf.plus(new Decimal(m.maxScore));
    }
  }

  return {
    regime: 'fondamental',
    subjects,
    points,
    outOf,
    equivalentOutOf20: outOf.greaterThan(0) ? points.times(20).dividedBy(outOf) : null,
  };
}

/** Très Bien / Bien / Assez Bien / Passable / Insuffisant. */
export function performanceBand(averageOutOf20: Decimal | number | string): string {
  const value = new Decimal(averageOutOf20);
  if (value.greaterThanOrEqualTo(16)) return 'Très Bien';
  if (value.greaterThanOrEqualTo(14)) return 'Bien';
  if (value.greaterThanOrEqualTo(12)) return 'Assez Bien';
  if (value.greaterThanOrEqualTo(10)) return 'Passable';
  return 'Insuffisant';
}

/**
 * L'ÉQUIVALENT /20 D'UNE MOYENNE — `moyenne_sur_20()`.
 *
 * ⚠ UN NIVEAU FONDAMENTAL NE SE NOTE PAS SUR 20. Il cumule des points sur un
 * barème (souvent 300 ou 500) ; comparer ces points bruts à un seuil sur 20
 * déclarerait ajourné absolument tout le monde. On ramène donc à /20 avant de
 * comparer, exactement comme lui.
 */
export function equivalentOutOf20(
  isFondamental: boolean,
  points: Decimal | number | string | null,
  outOf: Decimal | number | string | null,
): number | null {
  if (!isFondamental) return points === null ? null : new Decimal(points).toNumber();
  if (points === null || outOf === null) return null;
  const total = new Decimal(outOf);
  if (total.lessThanOrEqualTo(0)) return null;
  return new Decimal(points).times(20).dividedBy(total).toNumber();
}

export interface AdmissionVerdict {
  status: 'admis' | 'ajourne' | 'non_evalue';
  label: string;
  labelAr: string;
  /** `bul-pass` / `bul-fail`, ses propres classes de bulletin. */
  cssClass: string;
}

/**
 * ADMIS OU AJOURNÉ — `verdict_admission()`, imprimé en bas du bulletin officiel.
 *
 * ⚠ UNE MOYENNE ABSENTE NE REND PAS L'ÉLÈVE AJOURNÉ. C'est sa règle la plus
 * importante, et son commentaire la dit : « Une moyenne absente ne rend PAS
 * l'élève ajourné : elle rend "Non évalué". » Un enfant dont aucune note n'est
 * saisie n'a pas échoué, et imprimer « Ajourné » sur son bulletin est une
 * accusation, pas une information.
 *
 * ⚠ ET LA TOLÉRANCE D'UN CENTIÈME EST DÉLIBÉRÉE. « 9,995 arrondi à 10,00 à
 * l'écran doit être admis » : sans elle le bulletin imprime 10,00 juste à côté
 * d'« Ajourné », et personne ne peut expliquer la contradiction à la famille.
 *
 * Le libellé s'accorde au genre, dans les deux langues — c'est un document
 * officiel, et « Admis » sur le bulletin d'une fille se remarque.
 */
export function admissionVerdict(
  averageOutOf20: number | string | Decimal | null,
  passMark: number | string | Decimal,
  sex: string | null,
): AdmissionVerdict {
  if (averageOutOf20 === null) {
    return { status: 'non_evalue', label: 'Non évalué', labelAr: 'غير مقيّم', cssClass: '' };
  }
  const feminine = sex === 'F';
  const value = new Decimal(averageOutOf20).toDecimalPlaces(2).plus('0.0001');
  if (value.greaterThanOrEqualTo(new Decimal(passMark))) {
    return {
      status: 'admis',
      label: feminine ? 'Admise' : 'Admis',
      labelAr: feminine ? 'ناجحة' : 'ناجح',
      cssClass: 'bul-pass',
    };
  }
  return {
    status: 'ajourne',
    label: feminine ? 'Ajournée' : 'Ajourné',
    labelAr: feminine ? 'مؤجلة' : 'مؤجل',
    cssClass: 'bul-fail',
  };
}

/**
 * Class ranking.
 *
 * Ties share a rank and the next rank skips — two firsts are followed by a
 * third, not a second. Students with no marks are unranked rather than ranked
 * last: having sat nothing is not the same as having failed everything.
 */
export function rank(
  entries: readonly { studentId: string; score: Decimal | null }[],
): Map<string, number | null> {
  const ranked = entries
    .filter((e) => e.score !== null)
    .sort((a, b) => b.score!.comparedTo(a.score!));

  const result = new Map<string, number | null>();
  for (const e of entries) result.set(e.studentId, null);

  let position = 0;
  let previous: Decimal | null = null;
  ranked.forEach((entry, index) => {
    if (previous === null || !entry.score!.equals(previous)) {
      position = index + 1;
      previous = entry.score!;
    }
    result.set(entry.studentId, position);
  });
  return result;
}

export { NOTE_ABSENT };
