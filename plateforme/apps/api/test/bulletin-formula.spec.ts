import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { GradesService } from '../src/grades/grades.service.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * THE REPORT-CARD FORMULA, PER LEVEL AND PER TERM.
 *
 * `notes_etudiants.php`, action `config_formule`, table `bulletin_formules`:
 *
 *     moyenne = (moyenne des devoirs × A + examen × B) / C
 *
 * ⚠ WRITTEN BEFORE THE FEATURE because it decides a mark on a document a family
 * keeps (standing rule 15). The failure mode is the one rule 11 warns about: a
 * level configured 3/2/5 and computed at 2/3/5 gets every mark quietly
 * mis-weighted, with nothing on the page to say so.
 *
 * El Ourwa's defaults are 2/3/5 — the 0.4/0.6 split `saisir_notes.php` shows
 * live. A level with no row configured must still come out at 2/3/5, or turning
 * the feature on would silently restate every existing bulletin.
 */

let owner: pg.Pool;
let grades: GradesService;
let enrollments: EnrollmentService;

let schoolId: string;
let yearId: string;
let ACTOR: string;

const DIRECTION = ['scolarite.niveaux'];

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'formule' }, fn);
}

/** A level with its own group, one pupil, and one subject taught to them. */
async function level(tag: string): Promise<{
  levelId: string;
  groupId: string;
  studentId: string;
  teachingId: string;
}> {
  const l = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle)
     VALUES ($1, $2, 1000, 'college') RETURNING id`,
    [schoolId, `Niveau ${tag}`],
  );
  const levelId = l.rows[0]!.id;

  const g = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, $3) RETURNING id`,
    [schoolId, levelId, `${tag} A`],
  );
  const groupId = g.rows[0]!.id;

  const guardian = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'P') RETURNING id`,
    [`formule.${tag}@test`],
  );
  const s = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5, 'Form') RETURNING id`,
    [schoolId, guardian.rows[0]!.id, `RIM-${tag}`, `NID-${tag}`, tag],
  );
  const studentId = s.rows[0]!.id;

  await inTenant(() =>
    enrollments.enrol(
      { studentId, academicYearId: yearId, groupId, entryDate: '2020-10-01' },
      ACTOR,
      DIRECTION,
    ),
  );

  const sub = await owner.query<{ id: string }>(
    `INSERT INTO subjects (school_id, name, coefficient, max_score)
     VALUES ($1, $2, 1, 20) RETURNING id`,
    [schoolId, `Maths ${tag}`],
  );
  const teacher = await owner.query<{ id: string }>(
    `INSERT INTO teachers (school_id, first_name, last_name)
     VALUES ($1, $2, 'Prof') RETURNING id`,
    [schoolId, tag],
  );
  const t = await owner.query<{ id: string }>(
    `INSERT INTO teachings (school_id, group_id, subject_id, teacher_id, academic_year_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [schoolId, groupId, sub.rows[0]!.id, teacher.rows[0]!.id, yearId],
  );

  return { levelId, groupId, studentId, teachingId: t.rows[0]!.id };
}

/** Two coursework marks averaging 12, and an exam of 17. */
async function mark(teachingId: string, studentId: string) {
  await inTenant(() =>
    grades.record(teachingId, 1, [
          { studentId, kind: 'coursework', sequenceNo: 1, score: '10.00' },
          { studentId, kind: 'coursework', sequenceNo: 2, score: '14.00' },
          { studentId, kind: 'exam', sequenceNo: 1, score: '17.00' },
        ], ACTOR),
  );
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('formule', 'Formule', 'FML')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const year = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2020-2021', 2020, 'active') RETURNING id`,
    [schoolId],
  );
  yearId = year.rows[0]!.id;

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('formule.admin@test', 'x', 'Direction') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  grades = moduleRef.get(GradesService);
  enrollments = moduleRef.get(EnrollmentService);
});

afterAll(async () => {
  await owner?.end();
});

describe('the default', () => {
  it('⚠ a level with no formula configured still computes at 2/3/5', async () => {
    // Turning this feature on must not restate a single existing bulletin.
    // (12 × 2 + 17 × 3) / 5 = (24 + 51) / 5 = 15.00
    const { studentId, teachingId } = await level('defaut');
    await mark(teachingId, studentId);

    const card = await inTenant(() => grades.reportCardFor(studentId, 1));
    const subject = card.subjects[0]!;
    expect(subject.mark).toBe('15.00');
  });
});

describe('a configured formula', () => {
  it('⚠ changes the mark, and by exactly what it says', async () => {
    const { levelId, studentId, teachingId } = await level('config');
    await mark(teachingId, studentId);

    // Weight coursework more heavily than the exam: 3/2/5.
    // (12 × 3 + 17 × 2) / 5 = (36 + 34) / 5 = 14.00
    await inTenant(() =>
      grades.setFormula({ levelId, term: 1, courseworkWeight: '3', examWeight: '2', divisor: '5' }, ACTOR),
    );

    const card = await inTenant(() => grades.reportCardFor(studentId, 1));
    expect(card.subjects[0]!.mark).toBe('14.00');
  });

  it('applies per TERM, not to the whole year', async () => {
    // A school may weight the first term's coursework heavily and the third
    // term's exam heavily. Configuring term 1 must leave term 2 at the default.
    const { levelId, studentId, teachingId } = await level('parterme');
    await mark(teachingId, studentId);
    await inTenant(() =>
      grades.record(teachingId, 2, [
            { studentId, kind: 'coursework', sequenceNo: 1, score: '10.00' },
            { studentId, kind: 'coursework', sequenceNo: 2, score: '14.00' },
            { studentId, kind: 'exam', sequenceNo: 1, score: '17.00' },
          ], ACTOR),
    );

    await inTenant(() =>
      grades.setFormula({ levelId, term: 1, courseworkWeight: '4', examWeight: '1', divisor: '5' }, ACTOR),
    );

    // Term 1: (12 × 4 + 17 × 1) / 5 = 65 / 5 = 13.00
    const t1 = await inTenant(() => grades.reportCardFor(studentId, 1));
    expect(t1.subjects[0]!.mark).toBe('13.00');

    // Term 2: untouched, still the default 15.00
    const t2 = await inTenant(() => grades.reportCardFor(studentId, 2));
    expect(t2.subjects[0]!.mark).toBe('15.00');
  });

  it('applies per LEVEL, not to the whole school', async () => {
    const a = await level('niveauA');
    const b = await level('niveauB');
    await mark(a.teachingId, a.studentId);
    await mark(b.teachingId, b.studentId);

    await inTenant(() =>
      grades.setFormula(
        { levelId: a.levelId, term: 1, courseworkWeight: '1', examWeight: '4', divisor: '5' },
        ACTOR,
      ),
    );

    // A: (12 × 1 + 17 × 4) / 5 = 80 / 5 = 16.00
    expect((await inTenant(() => grades.reportCardFor(a.studentId, 1))).subjects[0]!.mark).toBe('16.00');
    // B: untouched.
    expect((await inTenant(() => grades.reportCardFor(b.studentId, 1))).subjects[0]!.mark).toBe('15.00');
  });

  it('reads back what was set, so the form can show it', async () => {
    const { levelId } = await level('lecture');
    await inTenant(() =>
      grades.setFormula({ levelId, term: 2, courseworkWeight: '1.5', examWeight: '2.5', divisor: '4' }, ACTOR),
    );

    const all = await inTenant(() => grades.formulasFor(levelId));
    expect(all[2]).toEqual({
      courseworkWeight: '1.50',
      examWeight: '2.50',
      divisor: '4.00',
    });
    // The two unset terms come back as the default rather than as nothing, so
    // the form shows what will actually be used.
    expect(all[1]).toEqual({ courseworkWeight: '2.00', examWeight: '3.00', divisor: '5.00' });
  });

  it('setting it again replaces it rather than stacking rows', async () => {
    const { levelId } = await level('rejoue');
    await inTenant(() =>
      grades.setFormula({ levelId, term: 1, courseworkWeight: '2', examWeight: '3', divisor: '5' }, ACTOR),
    );
    await inTenant(() =>
      grades.setFormula({ levelId, term: 1, courseworkWeight: '3', examWeight: '3', divisor: '6' }, ACTOR),
    );

    const { rows } = await owner.query(
      `SELECT 1 FROM bulletin_formulas WHERE level_id = $1 AND term = 1`,
      [levelId],
    );
    expect(rows).toHaveLength(1);
    const all = await inTenant(() => grades.formulasFor(levelId));
    expect(all[1]!.divisor).toBe('6.00');
  });
});

describe('what it refuses', () => {
  it('⚠ refuses a divisor of zero — it divides every bulletin of that level', async () => {
    const { levelId } = await level('zero');
    await expect(
      inTenant(() =>
        grades.setFormula(
          { levelId, term: 1, courseworkWeight: '2', examWeight: '3', divisor: '0' },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/diviseur|divisor/i);
  });

  it('refuses a negative weight', async () => {
    const { levelId } = await level('negatif');
    await expect(
      inTenant(() =>
        grades.setFormula(
          { levelId, term: 1, courseworkWeight: '-1', examWeight: '3', divisor: '5' },
          ACTOR,
        ),
      ),
    ).rejects.toThrow();
  });

  it('refuses a term outside 1..3', async () => {
    const { levelId } = await level('trimestre');
    await expect(
      inTenant(() =>
        grades.setFormula(
          { levelId, term: 4, courseworkWeight: '2', examWeight: '3', divisor: '5' },
          ACTOR,
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('the marker still does not enter the average', () => {
  it('⚠ -1 is excluded whatever the formula says', async () => {
    // The formula changes the weights, never what counts as a mark. An absence
    // weighted 4 is still not a zero.
    const { levelId, studentId, teachingId } = await level('absent');
    await inTenant(() =>
      grades.record(teachingId, 1, [
            { studentId, kind: 'coursework', sequenceNo: 1, score: '10.00' },
            { studentId, kind: 'coursework', sequenceNo: 2, score: '-1' },
            { studentId, kind: 'exam', sequenceNo: 1, score: '17.00' },
          ], ACTOR),
    );
    await inTenant(() =>
      grades.setFormula({ levelId, term: 1, courseworkWeight: '4', examWeight: '1', divisor: '5' }, ACTOR),
    );

    // Coursework mean is 10, NOT (10 + -1) / 2 = 4.5.
    // (10 × 4 + 17 × 1) / 5 = 57 / 5 = 11.40
    const card = await inTenant(() => grades.reportCardFor(studentId, 1));
    expect(card.subjects[0]!.mark).toBe('11.40');
  });
});

/**
 * LE BAS DU BULLETIN OFFICIEL — son récapitulatif et sa décision.
 *
 * ⚠ RIEN DE TOUT CELA N'EXISTAIT. Notre bulletin s'arrêtait à la moyenne du
 * trimestre affiché. Le document mauritanien porte, sous le tableau :
 * « Moyenne Générale — 1er trimestre », « — 2e », « — 3e », puis AU TROISIÈME
 * la « Moyenne Générale de l'Année », l'appréciation, le seuil d'admission et
 * la décision « Admis / Ajourné » en toutes lettres, dans les deux langues.
 *
 * La décision annuelle est la seule ligne qui dit si l'enfant passe. Un
 * bulletin de 3e trimestre qui ne la porte pas n'est pas un bulletin.
 */
describe('le bas du bulletin officiel', () => {
  it('⚠ récapitule les trimestres jusqu’à celui demandé, pas au-delà', async () => {
    const { levelId, studentId, teachingId } = await level('recap');
    void levelId;
    // T1 : 10 et 14 en devoirs (moyenne 12), 17 à l'examen → (12×2 + 17×3)/5 = 15,00.
    await mark(teachingId, studentId);
    await inTenant(() =>
      grades.record(
        teachingId,
        2,
        [
          { studentId, kind: 'coursework', sequenceNo: 1, score: '8.00' },
          { studentId, kind: 'exam', sequenceNo: 1, score: '8.00' },
        ],
        ACTOR,
      ),
    );

    const t1 = await inTenant(() => grades.reportCardFor(studentId, 1));
    expect(t1.termRecap).toEqual(['15.00']);

    const t2 = await inTenant(() => grades.reportCardFor(studentId, 2));
    expect(t2.termRecap).toEqual(['15.00', '8.00']);
    // Pas de moyenne d'année avant le 3e trimestre.
    expect(t2.annualAverage).toBeNull();
    expect(t2.annualVerdict).toBeNull();
  });

  it('⚠ la moyenne de l’année est la moyenne des trimestres RENSEIGNÉS', async () => {
    const { studentId, teachingId } = await level('annee');
    // T1 = 15,00 ; T3 = 8,00 ; T2 laissé vide.
    await mark(teachingId, studentId);
    await inTenant(() =>
      grades.record(
        teachingId,
        3,
        [
          { studentId, kind: 'coursework', sequenceNo: 1, score: '8.00' },
          { studentId, kind: 'exam', sequenceNo: 1, score: '8.00' },
        ],
        ACTOR,
      ),
    );

    const t3 = await inTenant(() => grades.reportCardFor(studentId, 3));
    expect(t3.termRecap).toEqual(['15.00', null, '8.00']);
    // ⚠ (15,00 + 8,00) / 2 = 11,50 — et NON / 3. Un trimestre sans notes n'est
    // pas un zéro : `array_filter` puis `array_sum / count`.
    expect(t3.annualAverage).toBe('11.50');
    expect(t3.annualVerdict?.status).toBe('admis');
  });

  it('⚠ un élève sans aucune note est « Non évalué », pas ajourné', async () => {
    const { studentId } = await level('vide');
    const card = await inTenant(() => grades.reportCardFor(studentId, 1));
    expect(card.average).toBeNull();
    expect(card.verdict.status).toBe('non_evalue');
    expect(card.verdict.label).toBe('Non évalué');
    expect(card.band).toBe('Non évalué');
  });

  it('⚠ la décision se prend contre le seuil DU NIVEAU', async () => {
    const { levelId, studentId, teachingId } = await level('seuil');
    await mark(teachingId, studentId); // 15,00
    await owner.query(`UPDATE levels SET pass_mark = 16 WHERE id = $1`, [levelId]);

    const card = await inTenant(() => grades.reportCardFor(studentId, 1));
    expect(card.passMark).toBe('16.00');
    // 15,00 sous un seuil à 16 : ajourné, alors qu'il passerait à 10.
    expect(card.verdict.status).toBe('ajourne');
  });

  it('le verdict s’accorde au genre de l’élève', async () => {
    const { studentId, teachingId } = await level('genre');
    await mark(teachingId, studentId);
    await owner.query(`UPDATE students SET sex = 'F' WHERE id = $1`, [studentId]);

    const card = await inTenant(() => grades.reportCardFor(studentId, 1));
    expect(card.verdict.label).toBe('Admise');
    expect(card.verdict.labelAr).toBe('ناجحة');
  });

  it('⚠ il porte le matricule et le correspondant, que sa grille imprime', async () => {
    const { studentId, teachingId } = await level('grille');
    await mark(teachingId, studentId);
    const card = await inTenant(() => grades.reportCardFor(studentId, 1));
    expect(card.student?.rim).toBe('RIM-grille');
    expect(card.student?.guardian_name).toBe('P');
  });
});
