import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  admissionVerdict,
  classicReportCard,
  equivalentOutOf20,
  fondamentalReportCard,
  performanceBand,
  rank,
  DEFAULT_FORMULA,
  NOTE_ABSENT,
  isAbsent,
  formula,
  type Formula,
  type SubjectMarks,
} from '@elourwa/shared';
import { Decimal } from 'decimal.js';
import type { Queryable } from '@elourwa/db';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { AcademicYearService } from '../academic/academic-year.service.js';
import { NotificationsService } from '../parent/notifications.service.js';

export interface MarkInput {
  studentId: string;
  kind: 'coursework' | 'exam';
  sequenceNo: number;
  /** `-1` records an absence. Any other value is a mark. */
  score: string;
}

/**
 * One subject line, as a report card shows it.
 *
 * Shared by the single card and the whole-class print run, so the two documents
 * cannot present the same marks differently. El Ourwa's parent space once had
 * its own copy of this and the two drifted apart with every correction.
 */
export function present(s: {
  subjectName: string;
  coefficient: number;
  maxScore: string;
  /** The individual marks, before averaging. */
  coursework?: readonly string[];
  courseworkMean: { toFixed(n: number): string } | null;
  exam: { toString(): string } | null;
  mark: { toFixed(n: number): string } | null;
  markOutOf20: { toFixed(n: number): string } | null;
  allAbsent: boolean;
}) {
  return {
    subject: s.subjectName,
    coefficient: s.coefficient,
    maxScore: s.maxScore,
    // ⚠ THE INDIVIDUAL MARKS, not only their mean. El Ourwa's bulletin prints
    // both — a "Devoirs" column listing them separated by " · " and a
    // "Moy. Devoirs" column with the average. A family disputing a mark asks
    // which piece of work it was, and a bare average cannot answer.
    courseworkMarks: (s.coursework ?? []).map((m) =>
      Number(m) === NOTE_ABSENT ? 'Abs' : Number(m).toFixed(2),
    ),
    // ⚠ ALWAYS TWO DECIMALS. El Ourwa prints `number_format($moy, 2)`, so a mark
    // of exactly fifteen appears as "15.00" on every bulletin it has ever
    // issued. `toDecimalPlaces(2).toString()` dropped the zeros and printed
    // "15" — the same number, on a document a family keeps next to last year's,
    // formatted differently for no reason they could see.
    coursework: s.courseworkMean ? s.courseworkMean.toFixed(2) : null,
    exam: s.exam ? s.exam.toString() : null,
    mark: s.mark ? s.mark.toFixed(2) : null,
    markOutOf20: s.markOutOf20 ? s.markOutOf20.toFixed(2) : null,
    // La colonne « Total » (moyenne × coefficient), calculée ICI en décimal,
    // une fois — ni le site ni le téléphone ne la refont en flottant.
    total: s.mark ? new Decimal(String(s.mark)).times(s.coefficient).toFixed(2) : null,
    absent: s.allAbsent,
  };
}

@Injectable()
export class GradesService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AcademicYearService) private readonly years: AcademicYearService,
      @Inject(NotificationsService) private readonly notifications: NotificationsService,
) {}

  /**
   * The mark sheet for one teaching and term: every enrolled student, with
   * whatever has already been recorded.
   */
  /**
   * UNE MATIÈRE D'UN GROUPE, UNE SEULE FEUILLE DE NOTES — décision du
   * propriétaire (2026-09-20) : « if a matière has two different teachers you
   * don't duplicate it, you just make them share the saisir notes interface ».
   * Deux affectations (année, groupe, matière) sont des ÉQUIVALENTS : elles
   * lisent et écrivent les mêmes notes. Les notes vivent sous l'affectation
   * CANONIQUE — la plus récente, son `SQL_ENS_COURANTS` — et toute écriture
   * y rapatrie ce que les autres portaient encore. L'emploi du temps, lui,
   * garde chaque affectation : chaque professeur y a ses cases.
   */
  private async equivalents(tx: Queryable, teachingId: string): Promise<{ canonique: string; tous: string[] } | null> {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT e.id
         FROM teachings t
         JOIN teachings e ON e.academic_year_id = t.academic_year_id AND e.group_id = t.group_id AND e.subject_id = t.subject_id
        WHERE t.id = $1
        ORDER BY (e.legacy_id IS NULL) DESC, e.legacy_id DESC, e.id DESC`,
      [teachingId],
    );
    if (rows.length === 0) return null;
    return { canonique: rows[0]!.id, tous: rows.map((r) => r.id) };
  }

  async sheet(teachingId: string, term: number, academicYearId?: string) {
    const year = academicYearId
      ? await this.years.byId(academicYearId)
      : await this.years.defaultView();
    if (!year) return { students: [], subject: null };

    return this.db.query(async (tx) => {
      const { rows: meta } = await tx.query<{
        subject: string;
        max_score: string;
        coefficient: number;
        group_name: string;
        level_name: string | null;
        is_fondamental: boolean | null;
      }>(
        `SELECT s.name AS subject, s.max_score, s.coefficient,
                g.name AS group_name, l.name AS level_name, l.is_fondamental
           FROM teachings t
           JOIN subjects s ON s.id = t.subject_id
           JOIN groups g ON g.id = t.group_id
           LEFT JOIN levels l ON l.id = g.level_id
          WHERE t.id = $1`,
        [teachingId],
      );

      const equiv = (await this.equivalents(tx, teachingId)) ?? { canonique: teachingId, tous: [teachingId] };
      const { rows } = await tx.query<{
        student_id: string;
        first_name: string;
        last_name: string;
        matricule: string | null;
        kind: string | null;
        sequence_no: number | null;
        score: string | null;
      }>(
        `SELECT * FROM (
           SELECT DISTINCT ON (st.id, gr.kind, gr.sequence_no)
                  st.id AS student_id, st.first_name, st.last_name, st.matricule,
                  gr.kind, gr.sequence_no, gr.score
             FROM teachings t
             JOIN enrollments e
               ON e.group_id = t.group_id AND e.academic_year_id = t.academic_year_id
              AND e.status <> 'cancelled'
             JOIN students st ON st.id = e.student_id
             LEFT JOIN grades gr
               ON gr.student_id = st.id AND gr.teaching_id = ANY($3::uuid[]) AND gr.term = $2
            WHERE t.id = $1
            ORDER BY st.id, gr.kind, gr.sequence_no, (gr.teaching_id = $4) DESC
         ) x
         ORDER BY last_name, first_name, kind, sequence_no`,
        [teachingId, term, equiv.tous, equiv.canonique],
      );

      const byStudent = new Map<
        string,
        {
          studentId: string;
          name: string;
          /** Sa colonne « Identifiant » : le matricule (`etudiants.identifiant`). */
          identifier: string | null;
          coursework: Record<number, string>;
          exam: string | null;
        }
      >();
      for (const row of rows) {
        if (!byStudent.has(row.student_id)) {
          byStudent.set(row.student_id, {
            studentId: row.student_id,
            name: `${row.first_name} ${row.last_name}`.trim(),
            identifier: row.matricule,
            coursework: {},
            exam: null,
          });
        }
        const entry = byStudent.get(row.student_id)!;
        if (row.kind === 'coursework' && row.sequence_no !== null) {
          entry.coursework[row.sequence_no] = row.score!;
        } else if (row.kind === 'exam') {
          entry.exam = row.score;
        }
      }

      return {
        subject: meta[0] ?? null,
        term,
        academicYear: year.label,
        students: [...byStudent.values()],
      };
    });
  }

  /**
   * Record marks for one teaching and term.
   *
   * Upsert on the natural key, so re-submitting a sheet corrects it rather than
   * duplicating. Refuses on a closed year — that would rewrite a report card the
   * school has already handed out.
   */
  async record(
    teachingId: string,
    term: number,
    marks: MarkInput[],
    actorId: string,
    /**
     * Son POST : les devoirs d'un élève sont EFFACÉS puis réécrits en séquence
     * (D1…Dn compactés) ; un devoir retiré à l'écran disparaît. L'examen, lui,
     * est un `ON DUPLICATE KEY UPDATE`. Les élèves listés ici voient leurs
     * devoirs remplacés par ceux de `marks`, même s'il n'y en a plus aucun.
     */
    opts: { replaceCourseworkFor?: string[] } = {},
  ): Promise<{ recorded: number }> {
    const { schoolId } = currentTenant();

    const teaching = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        academic_year_id: string;
        max_score: string;
        matiere: string;
      }>(
        `SELECT t.academic_year_id, s.max_score, s.name AS matiere
           FROM teachings t JOIN subjects s ON s.id = t.subject_id
          WHERE t.id = $1`,
        [teachingId],
      );
      return rows[0];
    });
    if (!teaching) throw new BadRequestException('Enseignement introuvable.');
    await this.years.assertWritable(teaching.academic_year_id);

    const ceiling = Number(teaching.max_score);
    for (const mark of marks) {
      const value = Number(mark.score);
      // -1 is the absence marker and is always allowed. Anything else must be
      // within the subject's own scale — a 25 on a subject marked out of 20 is a
      // typing slip, and silently storing it corrupts every average it enters.
      if (value !== NOTE_ABSENT && (value < 0 || value > ceiling)) {
        throw new BadRequestException(
          `${mark.score} est hors du barème de cette matière ` +
            `(0 à ${teaching.max_score}). Utilisez ${NOTE_ABSENT} pour ` +
            'enregistrer une absence.',
        );
      }
    }

    return this.db.query(async (tx) => {
      // La feuille partagée : tout s'écrit sous l'affectation canonique, et ce
      // que les affectations équivalentes portaient encore y est rapatrié.
      const equiv = (await this.equivalents(tx, teachingId)) ?? { canonique: teachingId, tous: [teachingId] };
      const canon = equiv.canonique;
      const autres = equiv.tous.filter((id) => id !== canon);
      if (autres.length > 0) {
        // ⚠ RIEN NE SE PERD EN SILENCE. Quand les deux affectations portent
        // une note pour la même case (élève, trimestre, sorte, rang), la plus
        // récente l'emporte — et le conflit est écrit dans l'audit avec les
        // deux valeurs, pour qu'un désaccord entre deux professeurs se voie.
        const { rows: conflits } = await tx.query<{ student_id: string; term: number; kind: string; sequence_no: number; garde: string; ecarte: string }>(
          `SELECT a.student_id, a.term, a.kind, a.sequence_no,
                  CASE WHEN a.recorded_at > c.recorded_at THEN a.score ELSE c.score END::text AS garde,
                  CASE WHEN a.recorded_at > c.recorded_at THEN c.score ELSE a.score END::text AS ecarte
             FROM grades a
             JOIN grades c ON c.teaching_id = $1 AND c.student_id = a.student_id AND c.term = a.term
                          AND c.kind = a.kind AND c.sequence_no = a.sequence_no
            WHERE a.teaching_id = ANY($2::uuid[]) AND a.score <> c.score`,
          [canon, autres],
        );
        await tx.query(
          `INSERT INTO grades (school_id, student_id, teaching_id, academic_year_id, term, kind, sequence_no, score, recorded_at)
           SELECT DISTINCT ON (school_id, student_id, term, kind, sequence_no)
                  school_id, student_id, $1, academic_year_id, term, kind, sequence_no, score, recorded_at
             FROM grades WHERE teaching_id = ANY($2::uuid[])
            ORDER BY school_id, student_id, term, kind, sequence_no, recorded_at DESC
           ON CONFLICT (school_id, student_id, teaching_id, term, kind, sequence_no)
           DO UPDATE SET score = EXCLUDED.score, recorded_at = EXCLUDED.recorded_at
             WHERE EXCLUDED.recorded_at > grades.recorded_at`,
          [canon, autres],
        );
        await tx.query('DELETE FROM grades WHERE teaching_id = ANY($1::uuid[])', [autres]);
        if (conflits.length > 0) {
          await this.audit.record(
            {
              actorId,
              schoolId,
              action: 'grades_consolidated_conflicts',
              entity: 'teaching',
              entityId: canon,
              before: { equivalents: autres },
              after: { conflits },
            },
            tx,
          );
        }
      }
      if (opts.replaceCourseworkFor?.length) {
        await tx.query(
          `DELETE FROM grades
            WHERE teaching_id = $1 AND term = $2 AND kind = 'coursework'
              AND student_id = ANY($3::uuid[])`,
          [canon, term, opts.replaceCourseworkFor],
        );
      }
      for (const mark of marks) {
        await tx.query(
          `INSERT INTO grades
             (school_id, student_id, teaching_id, academic_year_id, term, kind,
              sequence_no, score)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (school_id, student_id, teaching_id, term, kind, sequence_no)
           DO UPDATE SET score = EXCLUDED.score, recorded_at = now()`,
          [
            schoolId, mark.studentId, canon, teaching.academic_year_id,
            term, mark.kind, mark.sequenceNo, mark.score,
          ],
        );
      }

      // ⚠ LA FAMILLE EST PRÉVENUE D'UNE NOTE D'EXAMEN, pas d'un devoir — c'est
      // ce que fait `saisir_notes.php` (« examen, trimestre N »). Le marqueur
      // d'absence n'est pas une note : rien n'est envoyé pour lui. Et le
      // chiffre voyage dans la notification, jamais sur l'écran verrouillé
      // (`renduPourPousser` le masque). Une famille en dette ne le voit pas
      // dans l'application — ADR-0025 — mais la notification est écrite : le
      // filtre est à la lecture, comme chez lui.
      const examens = marks.filter((m) => m.kind === 'exam' && !isAbsent(m.score));
      if (examens.length) {
        const { rows: eleves } = await tx.query<{
          id: string;
          nom: string;
          guardian_id: string | null;
        }>(
          `SELECT id, first_name || ' ' || last_name AS nom, guardian_id
             FROM students WHERE id = ANY($1::uuid[])`,
          [examens.map((m) => m.studentId)],
        );
        const parId = new Map(eleves.map((e) => [e.id, e]));
        for (const m of examens) {
          const e = parId.get(m.studentId);
          if (!e?.guardian_id) continue;
          await this.notifications.notifier(tx, {
            guardianId: e.guardian_id,
            studentId: e.id,
            academicYearId: teaching.academic_year_id,
            kind: 'grade',
            souche: 'notif_note',
            params: {
              eleve: e.nom,
              // Son `rtrim(rtrim(number_format(…, 2), '0'), '.')` : 12.50 → 12.5,
              // 12.00 → 12. ⚠ Formater à deux décimales D'ABORD : sur la chaîne
              // brute, « 10 » perdait son zéro et la famille lisait « 1 ».
              note: noteAffichee(m.score),
              matiere: teaching.matiere,
              trimestre: `T${term}`,
            },
            route: 'resultats',
          });
        }
      }

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'grades_recorded',
          entity: 'teaching',
          entityId: teachingId,
          after: { term, count: marks.length },
        },
        tx,
      );

      return { recorded: marks.length };
    });
  }

  /**
   * Every report card for a class, in ONE pass.
   *
   * ⚠ El Ourwa called its bulletin builder once per student, so a class of 333
   * cost 2,110 queries for a single page. This fetches the roster and every mark
   * in two queries and assembles in memory: the query count does not grow with
   * the class.
   */
  async classReportCards(groupId: string, term: number, academicYearId?: string) {
    // The year is EXPLICIT. Resolving it inside the computation from "whichever
    // year happens to have data" made this order-dependent in tests and, worse,
    // would print report cards for a year the user did not choose. The UI
    // default belongs at the controller boundary, not in the arithmetic.
    const year = academicYearId
      ? await this.years.byId(academicYearId)
      : await this.years.defaultView();
    if (!year) return { students: [] };

    const { level, rows } = await this.db.query(async (tx) => {
      const { rows: lv } = await tx.query<{
        level_name: string | null;
        level_id: string | null;
        is_fondamental: boolean | null;
        pass_mark: string;
        group_name: string;
      }>(
        `SELECT l.name AS level_name, l.id AS level_id, l.is_fondamental,
                COALESCE(l.pass_mark, 10) AS pass_mark, g.name AS group_name
           FROM groups g LEFT JOIN levels l ON l.id = g.level_id
          WHERE g.id = $1`,
        [groupId],
      );

      const { rows: marks } = await tx.query<{
        student_id: string;
        first_name: string;
        last_name: string;
        rim: string;
        matricule: string | null;
        sex: string | null;
        guardian_name: string | null;
        term: number | null;
        subject_id: string | null;
        subject: string | null;
        coefficient: number | null;
        max_score: string | null;
        kind: string | null;
        score: string | null;
      }>(
        // ⚠ TOUS LES TRIMESTRES JUSQU'AU DEMANDÉ, EN UNE PASSE. Le bas du
        // bulletin officiel récapitule T1, T2, T3 et, au troisième, décide de
        // l'année. Rappeler la carte individuelle par élève pour obtenir ce
        // récapitulatif ferait trente lots de requêtes là où il en faut une :
        // c'est toute la raison d'être de cette méthode.
        `SELECT st.id AS student_id, st.first_name, st.last_name, st.rim, st.matricule, st.sex,
                u.full_name AS guardian_name,
                gr.term, sub.id AS subject_id, sub.name AS subject, sub.coefficient,
                sub.max_score, gr.kind, gr.score
           FROM enrollments e
           JOIN students st ON st.id = e.student_id
           LEFT JOIN users u ON u.id = st.guardian_id
           -- Ses matières : SQL_ENS_COURANTS — une affectation par matière,
           -- la plus récente — même sans note, dans SON ordre (coefficient
           -- décroissant, puis nom).
           LEFT JOIN (SELECT DISTINCT ON (t0.subject_id) t0.*
                        FROM teachings t0
                       WHERE t0.group_id = $1 AND t0.academic_year_id = $3
                       ORDER BY t0.subject_id, (t0.legacy_id IS NULL) DESC, t0.legacy_id DESC, t0.id DESC) t
             ON TRUE
           LEFT JOIN subjects sub ON sub.id = t.subject_id
           LEFT JOIN grades gr
             ON gr.student_id = st.id
            AND gr.teaching_id IN (SELECT t2.id FROM teachings t2
                                    WHERE t2.academic_year_id = $3 AND t2.group_id = $1 AND t2.subject_id = t.subject_id)
            AND gr.academic_year_id = $3 AND gr.term <= $2
          WHERE e.group_id = $1 AND e.academic_year_id = $3
            AND e.status <> 'cancelled'
          ORDER BY st.last_name, st.first_name, sub.coefficient DESC, sub.name, gr.kind, gr.sequence_no`,
        [groupId, term, year.id],
      );
      return { level: lv[0], rows: marks };
    });

    // Assemble in memory: student -> term -> subject -> marks.
    interface Eleve {
      name: string;
      firstName: string;
      lastName: string;
      rim: string;
      matricule: string | null;
      sex: string | null;
      guardianName: string | null;
      /** Un jeu de matières PAR TRIMESTRE : le récapitulatif en a besoin. */
      terms: Map<number, Map<string, SubjectMarks>>;
    }
    const students = new Map<string, Eleve>();
    for (const row of rows) {
      if (!students.has(row.student_id)) {
        students.set(row.student_id, {
          name: `${row.first_name} ${row.last_name}`.trim(),
          // ⚠ LE NOM EN DEUX MORCEAUX, PAS RECOLLÉ PUIS REDÉCOUPÉ. Le bulletin
          // officiel imprime « Nom et Prénom » ; reconstituer les deux moitiés
          // en coupant `name` au premier espace se trompe dès qu'un prénom en
          // compte deux — et c'est un document d'État.
          firstName: row.first_name,
          lastName: row.last_name,
          rim: row.rim,
          matricule: row.matricule,
          sex: row.sex,
          guardianName: row.guardian_name,
          terms: new Map(),
        });
      }
      if (!row.subject_id) continue;
      const student = students.get(row.student_id)!;
      // Une ligne sans note appartient au trimestre demandé : elle sert à
      // faire apparaître la matière sur le bulletin, vide.
      const t = row.term ?? term;
      if (!student.terms.has(t)) student.terms.set(t, new Map());
      const parMatiere = student.terms.get(t)!;
      if (!parMatiere.has(row.subject_id)) {
        parMatiere.set(row.subject_id, {
          subjectId: row.subject_id,
          subjectName: row.subject!,
          maxScore: row.max_score!,
          coefficient: row.coefficient ?? 1,
          coursework: [],
          exam: null,
        });
      }
      if (row.score === null) continue;
      const subject = parMatiere.get(row.subject_id)!;
      if (row.kind === 'coursework') subject.coursework.push(row.score);
      else if (row.kind === 'exam') subject.exam = row.score;
    }

    const fondamental = level?.is_fondamental === true;

    // ⚠ ONCE FOR THE CLASS, not once per pupil. Every child in a group sits the
    // same level, so the formula is the same for all of them — and a lookup
    // inside the map would be thirty identical queries and could not be awaited
    // there anyway.
    // ⚠ UNE FORMULE PAR TRIMESTRE : le récapitulatif T1/T2 et la décision
    // annuelle recalculaient les trimestres passés avec la formule du trimestre
    // demandé — deux bulletins officiels du même enfant, deux décisions.
    const formules = await Promise.all(
      Array.from({ length: term }, (_, i) => this.formulaFor(level?.level_id ?? null, i + 1)),
    );
    const f = formules[term - 1]!;

    const passMark = level?.pass_mark ?? '10';

    const cards = [...students.entries()].map(([studentId, student]) => {
      const matieresDe = (t: number) => [...(student.terms.get(t)?.values() ?? [])];
      const list = matieresDe(term);
      const commun = {
        studentId,
        name: student.name,
        firstName: student.firstName,
        lastName: student.lastName,
        term,
        academicYear: year.label,
        rim: student.rim,
        matricule: student.matricule,
        sex: student.sex,
        guardianName: student.guardianName,
        passMark: Number(passMark).toFixed(2),
        // Sa `calculer_moyennes_groupe()` : la formule classique, sur 20, quel
        // que soit le régime — c'est elle que lit « Résultats — Trimestre N ».
        classicAverage: (() => {
          const r = classicReportCard(list, f);
          return r.average ? r.average.toFixed(2) : null;
        })(),
      };

      if (fondamental) {
        const result = fondamentalReportCard(list);
        // Le récapitulatif : chaque trimestre jusqu'au demandé, recalculé sur
        // ses propres notes — déjà chargées, donc sans requête de plus.
        const recapFond = Array.from({ length: term }, (_, i) => {
          const r = i + 1 === term ? result : fondamentalReportCard(matieresDe(i + 1));
          return r.outOf.greaterThan(0)
            ? { points: r.points.toFixed(2), outOf: r.outOf.toFixed(2) }
            : null;
        });
        const vus = recapFond.filter((x) => x !== null);
        const annuel =
          term === 3 && vus.length > 0
            ? {
                points: (vus.reduce((a, x) => a + Number(x!.points), 0) / vus.length).toFixed(2),
                outOf: (vus.reduce((a, x) => a + Number(x!.outOf), 0) / vus.length).toFixed(2),
              }
            : null;
        const sur20 = equivalentOutOf20(
          true,
          result.outOf.greaterThan(0) ? result.points : null,
          result.outOf.greaterThan(0) ? result.outOf : null,
        );
        const annuelSur20 = annuel ? equivalentOutOf20(true, annuel.points, annuel.outOf) : null;

        return {
          ...commun,
          regime: 'fondamental' as const,
          // The same rows the single card shows, from the SAME computation.
          // Fetching thirty cards one at a time would repeat this query thirty
          // times and, worse, rank each child against a roster it had loaded
          // separately.
          subjects: result.subjects.map(present),
          points: result.points.toFixed(2),
          outOf: result.outOf.toFixed(2),
          average: null as string | null,
          band: sur20 !== null ? performanceBand(sur20) : 'Non évalué',
          score: result.equivalentOutOf20,
          termRecap: [] as (string | null)[],
          termRecapFondamental: recapFond,
          annualAverage: null as string | null,
          annualFondamental: annuel,
          verdict: admissionVerdict(sur20, passMark, student.sex),
          annualVerdict:
            annuelSur20 !== null ? admissionVerdict(annuelSur20, passMark, student.sex) : null,
        };
      }
      const result = classicReportCard(list, f);
      const recap = Array.from({ length: term }, (_, i) => {
        const r = i + 1 === term ? result : classicReportCard(matieresDe(i + 1), formules[i]!);
        return r.average ? r.average.toFixed(2) : null;
      });
      const vus = recap.filter((x): x is string => x !== null);
      const annuel =
        term === 3 && vus.length > 0
          ? (vus.reduce((a, x) => a + Number(x), 0) / vus.length).toFixed(2)
          : null;

      return {
        ...commun,
        regime: 'classic' as const,
        subjects: result.subjects.map(present),
        points: null as string | null,
        outOf: null as string | null,
        average: result.average ? result.average.toFixed(2) : null,
        band: result.average ? performanceBand(result.average) : 'Non évalué',
        score: result.average,
        termRecap: recap,
        termRecapFondamental: [] as ({ points: string; outOf: string } | null)[],
        annualAverage: annuel,
        annualFondamental: null as { points: string; outOf: string } | null,
        verdict: admissionVerdict(
          result.average ? result.average.toFixed(2) : null,
          passMark,
          student.sex,
        ),
        annualVerdict: annuel !== null ? admissionVerdict(annuel, passMark, student.sex) : null,
      };
    });

    // Ranking: ties share a rank, and a student with no marks is unranked
    // rather than last. Having sat nothing is not the same as having failed.
    const ranks = rank(cards.map((c) => ({ studentId: c.studentId, score: c.score })));

    return {
      group: level?.group_name ?? null,
      level: level?.level_name ?? null,
      regime: fondamental ? ('fondamental' as const) : ('classic' as const),
      term,
      academicYear: year.label,
      students: cards
        .map(({ score, ...rest }) => ({ ...rest, rank: ranks.get(rest.studentId) ?? null }))
        .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999)),
    };
  }

  /** Son `appreciation_pour()`. */
  static appreciationPour(m: number): string {
    if (m >= 16) return 'Très Bien';
    if (m >= 14) return 'Bien';
    if (m >= 12) return 'Assez Bien';
    if (m >= 10) return 'Passable';
    return 'Insuffisant';
  }

  /**
   * CLASSEMENT D'UN GROUPE — `notes_etudiants.php?classement=1` : base = un
   * trimestre ou « annee » (moyenne des trimestres disponibles), sur l'année
   * scolaire commençant `startYear`. Classique : moyenne sur 20 ; fondamental :
   * total des points / somme des barèmes, « année » = moyenne des points et
   * moyenne des barèmes. Tri décroissant, non-évalués en bas ; rang avec
   * ex-aequo (écart ≤ 0,004) ; appréciation ou « Non évalué ».
   */
  async classement(groupId: string, base: '1' | '2' | '3' | 'annee', startYear: number) {
    const years = await this.years.list();
    const year = years.find((y) => y.start_year === startYear);
    if (!year) return { rows: [], fondamental: false };

    const termes = base === 'annee' ? [1, 2, 3] : [Number(base)];
    const parTri = await Promise.all(termes.map((tr) => this.classReportCards(groupId, tr, year.id)));
    const fondamental = parTri[0]?.regime === 'fondamental';

    interface Ligne { nom: string; matricule: string | null; moyenne: number | null; aff: string | null }
    const lignes = new Map<string, Ligne>();
    const valeurs = new Map<string, { moy: number[]; pts: number[]; sur: number[] }>();
    for (const cards of parTri) {
      for (const c of cards.students) {
        if (!lignes.has(c.studentId)) {
          lignes.set(c.studentId, { nom: `${c.firstName} ${c.lastName}`, matricule: c.matricule, moyenne: null, aff: null });
          valeurs.set(c.studentId, { moy: [], pts: [], sur: [] });
        }
        const v = valeurs.get(c.studentId)!;
        if (fondamental) {
          if (c.outOf !== null && Number(c.outOf) > 0) {
            v.pts.push(Number(c.points));
            v.sur.push(Number(c.outOf));
          }
        } else if (c.average !== null) {
          v.moy.push(Number(c.average));
        }
      }
    }
    const trim = (x: number) => String(Number(x.toFixed(2)));
    for (const [id, l] of lignes) {
      const v = valeurs.get(id)!;
      if (fondamental) {
        if (v.pts.length) {
          const pts = v.pts.reduce((a, b) => a + b, 0) / v.pts.length;
          const sur = v.sur.reduce((a, b) => a + b, 0) / v.sur.length;
          l.moyenne = sur > 0 ? (pts / sur) * 20 : null;
          l.aff = `${pts.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ${trim(sur)}`;
        }
      } else if (v.moy.length) {
        l.moyenne = v.moy.reduce((a, b) => a + b, 0) / v.moy.length;
      }
    }

    const tri = [...lignes.entries()].sort(([, a], [, b]) => {
      if (a.moyenne === null && b.moyenne === null) return 0;
      if (a.moyenne === null) return 1;
      if (b.moyenne === null) return -1;
      return b.moyenne - a.moyenne;
    });
    let rang = 0;
    let pos = 0;
    let prev: number | null = null;
    const rows = tri.map(([, l]) => {
      pos++;
      let rangAff: number | null = null;
      if (l.moyenne !== null) {
        if (prev === null || Math.abs(l.moyenne - prev) > 0.004) rang = pos;
        prev = l.moyenne;
        rangAff = rang;
      }
      return {
        rang: rangAff,
        nom: l.nom,
        matricule: l.matricule,
        moyenne: l.moyenne === null ? null : l.moyenne.toFixed(2),
        aff: l.aff,
        appreciation: l.moyenne !== null ? GradesService.appreciationPour(l.moyenne) : 'Non évalué',
      };
    });
    return { rows, fondamental };
  }

  /** Les années scolaires (année civile de début) qui portent des notes, la plus récente d'abord — pour `annee_notes_defaut()`. */
  async anneesAvecNotes(): Promise<number[]> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ start_year: number }>(
        `SELECT DISTINCT y.start_year
           FROM grades gr
           JOIN teachings t ON t.id = gr.teaching_id
           JOIN academic_years y ON y.id = t.academic_year_id
          ORDER BY y.start_year DESC`,
      );
      return rows.map((r) => r.start_year);
    });
  }

  /**
   * THE REPORT-CARD FORMULA FOR A LEVEL AND TERM — `bulletin_formules`.
   *
   *     moyenne = (moyenne des devoirs × A + examen × B) / C
   *
   * ⚠ THE DEFAULT IS 2/3/5 AND IS RETURNED WHEN NOTHING IS CONFIGURED. That is
   * El Ourwa's default and it is the 0.4/0.6 split `saisir_notes.php` shows
   * live, so a school that never opens the configuration screen keeps exactly
   * the marks it had. Returning "no formula" instead would make every caller
   * decide the default for itself, and they would not all decide the same.
   */
  async formulaFor(levelId: string | null, term: number): Promise<Formula> {
    if (!levelId) return DEFAULT_FORMULA;
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        coursework_weight: string;
        exam_weight: string;
        divisor: string;
      }>(
        `SELECT coursework_weight::text, exam_weight::text, divisor::text
           FROM bulletin_formulas WHERE level_id = $1 AND term = $2`,
        [levelId, term],
      );
      const r = rows[0];
      if (!r) return DEFAULT_FORMULA;
      return formula(r.coursework_weight, r.exam_weight, r.divisor);
    });
  }

  /** Every term's formula for a level, defaults filled in, for the form. */
  async formulasFor(
    levelId: string,
  ): Promise<Record<number, { courseworkWeight: string; examWeight: string; divisor: string }>> {
    const rows = await this.db.query(async (tx) => {
      const { rows: r } = await tx.query<{
        term: number;
        coursework_weight: string;
        exam_weight: string;
        divisor: string;
      }>(
        `SELECT term, coursework_weight::text, exam_weight::text, divisor::text
           FROM bulletin_formulas WHERE level_id = $1`,
        [levelId],
      );
      return r;
    });

    const byTerm = new Map(rows.map((r) => [r.term, r]));
    const out: Record<number, { courseworkWeight: string; examWeight: string; divisor: string }> = {};
    for (const term of [1, 2, 3]) {
      const r = byTerm.get(term);
      // The unset terms come back as the DEFAULT, not as nothing: the form has
      // to show what will actually be used, or it invites someone to "fix" a
      // blank that was never blank.
      out[term] = r
        ? {
            courseworkWeight: r.coursework_weight,
            examWeight: r.exam_weight,
            divisor: r.divisor,
          }
        : { courseworkWeight: '2.00', examWeight: '3.00', divisor: '5.00' };
    }
    return out;
  }

  /**
   * Set a level's formula for one term.
   *
   * ⚠ A DIVISOR OF ZERO DIVIDES EVERY BULLETIN OF THAT LEVEL. Refused here as
   * well as by the CHECK constraint, so the message names the field rather than
   * surfacing a constraint violation.
   *
   * This is configuration, not a financial record: setting it again REPLACES it.
   * What changed and who changed it lives in the audit log.
   */
  async setFormula(
    input: {
      levelId: string;
      term: number;
      courseworkWeight: string;
      examWeight: string;
      divisor: string;
    },
    actorId: string,
  ): Promise<void> {
    const { schoolId } = currentTenant();

    if (!Number.isInteger(input.term) || input.term < 1 || input.term > 3) {
      throw new BadRequestException('Le trimestre doit être 1, 2 ou 3.');
    }
    const a = new Decimal(input.courseworkWeight);
    const b = new Decimal(input.examWeight);
    const c = new Decimal(input.divisor);
    if (a.lessThan(0) || b.lessThan(0)) {
      throw new BadRequestException('Un coefficient ne peut pas être négatif.');
    }
    if (c.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Le diviseur doit être supérieur à zéro.');
    }

    await this.db.query(async (tx) => {
      await tx.query(
        `INSERT INTO bulletin_formulas
           (school_id, level_id, term, coursework_weight, exam_weight, divisor, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (school_id, level_id, term) DO UPDATE
           SET coursework_weight = EXCLUDED.coursework_weight,
               exam_weight       = EXCLUDED.exam_weight,
               divisor           = EXCLUDED.divisor,
               updated_by        = EXCLUDED.updated_by,
               updated_at        = now()`,
        [schoolId, input.levelId, input.term, a.toFixed(2), b.toFixed(2), c.toFixed(2), actorId],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'bulletin_formula_set',
          entity: 'level',
          entityId: input.levelId,
          after: {
            term: String(input.term),
            formula: `(devoirs × ${a.toFixed(2)} + examen × ${b.toFixed(2)}) / ${c.toFixed(2)}`,
          },
        },
        tx,
      );
    });
  }

  /**
   * One student's report card.
   *
   * Assembled from the same marks and the same functions as the class view and
   * the parent app. Three implementations of one calculation is how El Ourwa's
   * two report cards drifted apart.
   */
  async reportCardFor(
    studentId: string,
    term: number,
    /**
     * ⚠ `recap: false` COUPE LA RÉCURSION. Le récapitulatif d'un bulletin de 3e
     * trimestre rappelle cette même méthode pour T1 et T2 ; sans ce drapeau,
     * chacun de ces appels rappellerait à son tour les précédents.
     */
    opts: { recap?: boolean; academicYearId?: string } = {},
  ) {
    // Son `annee_notes` : l'année demandée, sinon celle par défaut.
    const year = opts.academicYearId
      ? await this.years.byId(opts.academicYearId)
      : await this.years.defaultView();
    if (!year) return { student: null, subjects: [] };

    const { student, marks } = await this.db.query(async (tx) => {
      const { rows: s } = await tx.query<{
        first_name: string;
        last_name: string;
        rim: string;
        matricule: string | null;
        sex: string | null;
        group_id: string | null;
        group_name: string | null;
        level_name: string | null;
        level_id: string | null;
        is_fondamental: boolean | null;
        pass_mark: string;
        guardian_name: string | null;
      }>(
        // Sa grille d'informations : nom, MATRICULE, classe DE L'ANNÉE
        // (l'inscription de l'année consultée), trimestre, PARENT / TUTEUR ;
        // le verdict s'accorde au SEXE et se décide contre le SEUIL DU NIVEAU.
        `SELECT st.first_name, st.last_name, st.rim, st.matricule, st.sex,
                g.id AS group_id, g.name AS group_name,
                l.name AS level_name, l.id AS level_id, l.is_fondamental,
                COALESCE(l.pass_mark, 10) AS pass_mark,
                u.full_name AS guardian_name
           FROM students st
           LEFT JOIN enrollments e ON e.student_id = st.id AND e.academic_year_id = $2
                                  AND e.status <> 'cancelled'
           LEFT JOIN groups g ON g.id = e.group_id
           LEFT JOIN levels l ON l.id = g.level_id
           LEFT JOIN users u ON u.id = st.guardian_id
          WHERE st.id = $1`,
        [studentId, year.id],
      );

      // Ses matières : TOUTES celles de la classe — `SQL_ENS_COURANTS`, une
      // affectation par matière, la plus récente — même sans note, dans SON
      // ordre : coefficient décroissant puis nom ; les notes de l'élève, du
      // trimestre et de l'année consultée.
      const { rows } = await tx.query<{
        subject_id: string;
        subject: string;
        coefficient: number;
        max_score: string;
        kind: string | null;
        score: string | null;
      }>(
        `SELECT subject_id, subject, coefficient, max_score, kind, score FROM (
           SELECT DISTINCT ON (sub.id, gr.kind, gr.sequence_no)
                  sub.id AS subject_id, sub.name AS subject, sub.coefficient,
                  sub.max_score, gr.kind, gr.score, gr.sequence_no
             -- ⚠ LES AFFECTATIONS DE L'ANNÉE CONSULTÉE : prises sur toutes les
             -- années, la « plus récente » d'une matière était celle de l'année
             -- suivante dès que les affectations y étaient copiées — et le
             -- bulletin de l'année passée ne trouvait plus une seule note.
             FROM (SELECT DISTINCT ON (t.subject_id) t.*
                     FROM teachings t
                    WHERE t.group_id = $4 AND t.academic_year_id = $2
                    ORDER BY t.subject_id, (t.legacy_id IS NULL) DESC, t.legacy_id DESC, t.id DESC) en
             JOIN subjects sub ON sub.id = en.subject_id
             -- Les notes de la matière, quelle que soit l'affectation équivalente qui les porte.
             LEFT JOIN grades gr
               ON gr.student_id = $1 AND gr.academic_year_id = $2 AND gr.term = $3
              AND gr.teaching_id IN (SELECT t2.id FROM teachings t2
                                      WHERE t2.academic_year_id = $2 AND t2.group_id = $4 AND t2.subject_id = sub.id)
            ORDER BY sub.id, gr.kind, gr.sequence_no, (gr.teaching_id = en.id) DESC
         ) x
         ORDER BY coefficient DESC, subject, kind, sequence_no`,
        [studentId, year.id, term, s[0]?.group_id ?? null],
      );
      return { student: s[0] ?? null, marks: rows };
    });

    const bySubject = new Map<string, SubjectMarks>();
    for (const row of marks) {
      if (!bySubject.has(row.subject_id)) {
        bySubject.set(row.subject_id, {
          subjectId: row.subject_id,
          subjectName: row.subject,
          maxScore: row.max_score,
          coefficient: row.coefficient,
          coursework: [],
          exam: null,
        });
      }
      if (row.score === null) continue;
      const subject = bySubject.get(row.subject_id)!;
      if (row.kind === 'coursework') subject.coursework.push(row.score);
      else subject.exam = row.score;
    }
    const list = [...bySubject.values()];

    /**
     * ⚠ LE RÉCAPITULATIF DES TRIMESTRES — T1 jusqu'au trimestre demandé.
     *
     * Le bas du bulletin officiel liste « Moyenne Générale — 1er trimestre »,
     * « — 2e », « — 3e », puis, AU TROISIÈME SEULEMENT, la moyenne de l'année.
     * Rien de tout cela n'existait chez nous : notre bulletin s'arrêtait à la
     * moyenne du trimestre affiché, si bien qu'un bulletin de 3e trimestre ne
     * portait pas la décision annuelle — la seule ligne qui décide si l'enfant
     * passe.
     *
     * ⚠ ET LA MOYENNE DE L'ANNÉE EST LA MOYENNE DES TRIMESTRES RENSEIGNÉS, pas
     * des trois. `array_filter` puis `array_sum / count` : un trimestre sans
     * notes ne compte pas comme un zéro.
     */
    const recap: (string | null)[] = [];
    const recapFond: ({ points: string; outOf: string } | null)[] = [];
    for (let t = 1; opts.recap !== false && t <= term; t += 1) {
      if (t === term) continue;
      const passe = await this.reportCardFor(studentId, t, { recap: false, academicYearId: year.id });
      if (student?.is_fondamental) {
        recapFond[t - 1] =
          passe.points && Number(passe.outOf) > 0
            ? { points: passe.points, outOf: passe.outOf! }
            : null;
      } else {
        recap[t - 1] = passe.average ?? null;
      }
    }

    const passMark = student?.pass_mark ?? '10';
    const sex = student?.sex ?? null;

    if (student?.is_fondamental) {
      const result = fondamentalReportCard(list);
      recapFond[term - 1] = result.outOf.greaterThan(0)
        ? { points: result.points.toFixed(2), outOf: result.outOf.toFixed(2) }
        : null;

      const vus = recapFond.slice(0, term).filter((x) => x !== null);
      const annuel =
        term === 3 && vus.length > 0
          ? {
              points: (
                vus.reduce((a, x) => a + Number(x!.points), 0) / vus.length
              ).toFixed(2),
              outOf: (vus.reduce((a, x) => a + Number(x!.outOf), 0) / vus.length).toFixed(2),
            }
          : null;

      const sur20 = equivalentOutOf20(
        true,
        result.outOf.greaterThan(0) ? result.points : null,
        result.outOf.greaterThan(0) ? result.outOf : null,
      );
      const annuelSur20 = annuel ? equivalentOutOf20(true, annuel.points, annuel.outOf) : null;

      return {
        regime: 'fondamental' as const,
        student,
        term,
        academicYear: year.label,
        subjects: result.subjects.map(present),
        points: result.points.toFixed(2),
        outOf: result.outOf.toFixed(2),
        average: null as string | null,
        band: sur20 !== null ? performanceBand(sur20) : 'Non évalué',
        passMark: Number(passMark).toFixed(2),
        termRecap: recap.slice(0, term),
        termRecapFondamental: recapFond.slice(0, term),
        annualAverage: null as string | null,
        annualFondamental: annuel,
        verdict: admissionVerdict(sur20, passMark, sex),
        annualVerdict: annuelSur20 !== null ? admissionVerdict(annuelSur20, passMark, sex) : null,
      };
    }

    const f = await this.formulaFor(student?.level_id ?? null, term);
    const result = classicReportCard(list, f);
    recap[term - 1] = result.average ? result.average.toFixed(2) : null;

    const vus = recap.slice(0, term).filter((x): x is string => x !== null && x !== undefined);
    const annuel =
      term === 3 && vus.length > 0
        ? (vus.reduce((a, x) => a + Number(x), 0) / vus.length).toFixed(2)
        : null;

    return {
      regime: 'classic' as const,
      passMark: Number(passMark).toFixed(2),
      termRecap: recap.slice(0, term),
      termRecapFondamental: [] as ({ points: string; outOf: string } | null)[],
      annualAverage: annuel,
      annualFondamental: null as { points: string; outOf: string } | null,
      verdict: admissionVerdict(result.average ? result.average.toFixed(2) : null, passMark, sex),
      annualVerdict: annuel !== null ? admissionVerdict(annuel, passMark, sex) : null,
      // The bulletin prints its own coefficients in its column headers, so it
      // has to be told which ones produced these marks.
      formula: {
        courseworkWeight: f.courseworkWeight.toFixed(2),
        examWeight: f.examWeight.toFixed(2),
        divisor: f.divisor.toFixed(2),
      },
      student,
      term,
      academicYear: year.label,
      subjects: result.subjects.map(present),
      average: result.average ? result.average.toFixed(2) : null,
      band: result.average ? performanceBand(result.average) : 'Non évalué',
      points: null as string | null,
      outOf: null as string | null,
      // Son `$somme_coeffs` : les coefficients des matières ÉVALUÉES.
      totalCoefficients: result.totalCoefficients,
    };
  }

  /**
   * Does this teacher actually teach this child?
   *
   * A security boundary, like `assertOwnTeaching`. Every teacher holds
   * `notes.consulter`, so without this any of them could write a remark on any
   * child in the school — including one they have never taught — and the family
   * would read it. El Ourwa scopes the same screen with
   * `WHERE et.id = :e AND e.professeur_id = :p`.
   */
  /**
   * Son anti-IDOR de `remarques.php` : « l'élève doit faire partie d'un groupe
   * enseigné par ce prof » — l'inscription (de l'année consultée quand elle
   * est donnée) dans un groupe où il a un enseignement, de n'importe quelle année.
   */
  async teachesStudent(
    userId: string,
    studentId: string,
    academicYearId: string | null = null,
  ): Promise<boolean> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT 1
           FROM enrollments e
           JOIN teachings t ON t.group_id = e.group_id
           JOIN teachers te ON te.id = t.teacher_id
          WHERE e.student_id = $1 AND te.user_id = $2 AND e.status <> 'cancelled'
            AND ($3::uuid IS NULL OR e.academic_year_id = $3)
          LIMIT 1`,
        [studentId, userId, academicYearId],
      );
      return rows.length > 0;
    });
  }

  /** « Prénom Nom » de la fiche d'enseignant du compte, ou null sans fiche. */
  async teacherName(userId: string): Promise<string | null> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ nom: string }>(
        `SELECT first_name || ' ' || last_name AS nom FROM teachers WHERE user_id = $1 LIMIT 1`,
        [userId],
      );
      return rows[0]?.nom ?? null;
    });
  }

  /**
   * A teacher may only touch their OWN teaching.
   *
   * This is a security boundary, not a UI filter: without it a teacher can read
   * or overwrite another teacher's marks by changing an id in the URL.
   */
  async assertOwnTeaching(
    userId: string,
    teachingId: string,
    refus = 'Cette classe n’est pas la vôtre.',
  ): Promise<void> {
    const owns = await this.db.query(async (tx) => {
      // La feuille est partagée : n'importe quelle affectation équivalente
      // (même année, groupe, matière) ouvre la porte.
      const { rows } = await tx.query(
        `SELECT 1 FROM teachings t
           JOIN teachings e ON e.academic_year_id = t.academic_year_id AND e.group_id = t.group_id AND e.subject_id = t.subject_id
           JOIN teachers te ON te.id = e.teacher_id
          WHERE t.id = $1 AND te.user_id = $2
          LIMIT 1`,
        [teachingId, userId],
      );
      return rows.length > 0;
    });
    if (!owns) throw new ForbiddenException(refus);
  }
}

/** `rtrim(rtrim(number_format($n, 2), '0'), '.')` — « 10.00 » → « 10 », « 12.50 » → « 12.5 », « 0 » → « 0 ». */
export function noteAffichee(score: string): string {
  return new Decimal(score).toFixed(2).replace(/\.?0+$/, '').replace(/^$/, '0').replace(/^-$/, '0');
}
