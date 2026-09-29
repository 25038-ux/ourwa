import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { GradesService } from '../src/grades/grades.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * SAISIR LES NOTES — LE PROFESSEUR (décision du propriétaire, 2026-09-17).
 *
 * Écrit avant la route : un professeur enregistre les notes de SON
 * enseignement sans `notes.saisir`, et celles d'un enseignement qui n'est pas
 * le sien sont refusées avant toute écriture — la même porte que la lecture
 * de la feuille (`assertOwnTeaching`), la règle 15.
 */
let owner: pg.Pool;
let grades: GradesService;
let teachingMien: string;
let teachingAutre: string;

let schoolId: string;
let yearId: string;
let userMien: string;
let userAutre: string;
let groupeMien: string;
let groupeAutre: string;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'notesprof' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('notesprof', 'Notes', 'NOT')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const y = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2025-2026', 2025, 'active') RETURNING id`,
    [schoolId],
  );
  yearId = y.rows[0]!.id;

  const l = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order)
     VALUES ($1, '6eme', 3000, 'college', 10) RETURNING id`,
    [schoolId],
  );
  const sub = await owner.query<{ id: string }>(
    `INSERT INTO subjects (school_id, name, coefficient) VALUES ($1, 'Calcul', 2) RETURNING id`,
    [schoolId],
  );
  const sub2 = await owner.query<{ id: string }>(
    `INSERT INTO subjects (school_id, name, coefficient) VALUES ($1, 'Arabe', 2) RETURNING id`,
    [schoolId],
  );

  // Deux groupes, deux professeurs : chacun le sien.
  const [gm, ga] = await Promise.all(
    ['6A', '6B'].map((nom) =>
      owner.query<{ id: string }>(
        `INSERT INTO groups (school_id, level_id, name, capacity)
         VALUES ($1, $2, $3, 30) RETURNING id`,
        [schoolId, l.rows[0]!.id, nom],
      ),
    ),
  );
  groupeMien = gm.rows[0]!.id;
  groupeAutre = ga.rows[0]!.id;

  for (const [tag, groupId, matiere] of [
    ['mien', groupeMien, sub.rows[0]!.id],
    ['autre', groupeAutre, sub.rows[0]!.id],
  ] as const) {
    const u = await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', $2) RETURNING id`,
      [`notesprof.${tag}@test`, `Prof ${tag}`],
    );
    const t = await owner.query<{ id: string }>(
      `INSERT INTO teachers (school_id, user_id, first_name, last_name, employment, salary)
       VALUES ($1, $2, 'Prof', $3, 'permanent', 1000) RETURNING id`,
      [schoolId, u.rows[0]!.id, tag],
    );
    const ens = await owner.query<{ id: string }>(
      `INSERT INTO teachings
         (school_id, academic_year_id, group_id, subject_id, teacher_id, hours_per_week)
       VALUES ($1, $2, $3, $4, $5, 4) RETURNING id`,
      [schoolId, yearId, groupId, matiere, t.rows[0]!.id],
    );
    if (tag === 'mien') teachingMien = ens.rows[0]!.id; else teachingAutre = ens.rows[0]!.id;
    if (tag === 'mien') {
      userMien = u.rows[0]!.id;
      // Le même professeur prend AUSSI la seconde matière dans le même groupe.
      await owner.query(
        `INSERT INTO teachings
           (school_id, academic_year_id, group_id, subject_id, teacher_id, hours_per_week)
         VALUES ($1, $2, $3, $4, $5, 2)`,
        [schoolId, yearId, groupId, sub2.rows[0]!.id, t.rows[0]!.id],
      );
    } else userAutre = u.rows[0]!.id;
  }

  // Deux élèves dans 6A, un dans 6B, plus une inscription annulée.
  for (const [rim, nom, groupId, statut] of [
    ['R1', 'Ba', groupeMien, 'enrolled'],
    ['R2', 'Aw', groupeMien, 'enrolled'],
    ['R3', 'Ka', groupeAutre, 'enrolled'],
    ['R4', 'Zz', groupeMien, 'cancelled'],
  ] as const) {
    const s = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, $2, 'E', $3) RETURNING id`,
      [schoolId, rim, nom],
    );
    await owner.query(
      `INSERT INTO enrollments (school_id, student_id, group_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [schoolId, s.rows[0]!.id, groupId, yearId, statut],
    );
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  grades = moduleRef.get(GradesService);
});

afterAll(async () => {
  await owner?.end();
});

describe('un professeur saisit les notes de SES enseignements seulement', () => {
  it('refuse la feuille d’un autre professeur avant toute écriture', async () => {
    await expect(inTenant(() => grades.assertOwnTeaching(userMien, teachingAutre))).rejects.toThrow(
      'Cette classe n’est pas la vôtre.',
    );
    await expect(inTenant(() => grades.assertOwnTeaching(userAutre, teachingMien))).rejects.toThrow();
  });

  it('enregistre devoirs et examen sur le sien, et la feuille les relit', async () => {
    await inTenant(() => grades.assertOwnTeaching(userMien, teachingMien));
    const feuille = await inTenant(() => grades.sheet(teachingMien, 1));
    const eleves = feuille.students.map((s) => s.studentId);
    expect(eleves.length).toBe(2); // R1, R2 — l’inscription annulée n’y est pas
    await inTenant(() =>
      grades.record(
        teachingMien,
        1,
        [
          { studentId: eleves[0]!, kind: 'coursework', sequenceNo: 1, score: '12.5' },
          { studentId: eleves[0]!, kind: 'exam', sequenceNo: 1, score: '14' },
          { studentId: eleves[1]!, kind: 'coursework', sequenceNo: 1, score: '-1' },
        ],
        userMien,
        { replaceCourseworkFor: eleves },
      ),
    );
    const relue = await inTenant(() => grades.sheet(teachingMien, 1));
    const e0 = relue.students.find((s) => s.studentId === eleves[0]!)!;
    expect(e0.coursework[1]).toBe('12.50');
    expect(e0.exam).toBe('14.00');
    const e1 = relue.students.find((s) => s.studentId === eleves[1]!)!;
    expect(e1.coursework[1]).toBe('-1.00'); // le marqueur d’absence, gardé tel quel
  });
});

/**
 * UNE MATIÈRE, UNE FEUILLE — décision du propriétaire (20/09) : deux
 * professeurs sur la même matière du même groupe partagent la saisie, et le
 * bulletin lit cette feuille unique.
 */
describe('deux professeurs sur la même matière partagent la feuille', () => {
  let teachingSecond: string;
  let userSecond: string;

  beforeAll(async () => {
    const u = await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name) VALUES ('notesprof.second@test', 'x', 'Prof second') RETURNING id`,
    );
    userSecond = u.rows[0]!.id;
    const t = await owner.query<{ id: string }>(
      `INSERT INTO teachers (school_id, user_id, first_name, last_name, employment, salary)
       VALUES ($1, $2, 'Prof', 'second', 'permanent', 1000) RETURNING id`,
      [schoolId, userSecond],
    );
    const { rows } = await owner.query<{ subject_id: string }>('SELECT subject_id FROM teachings WHERE id = $1', [teachingMien]);
    const ens = await owner.query<{ id: string }>(
      `INSERT INTO teachings (school_id, academic_year_id, group_id, subject_id, teacher_id, hours_per_week)
       VALUES ($1, $2, $3, $4, $5, 2) RETURNING id`,
      [schoolId, yearId, groupeMien, rows[0]!.subject_id, t.rows[0]!.id],
    );
    teachingSecond = ens.rows[0]!.id;
  });

  it('le second professeur ouvre la feuille par SON affectation et y lit les notes du premier', async () => {
    await inTenant(() => grades.assertOwnTeaching(userSecond, teachingSecond));
    // … et même par l’affectation du premier : c’est la même matière du même groupe.
    await inTenant(() => grades.assertOwnTeaching(userSecond, teachingMien));
    const feuille = await inTenant(() => grades.sheet(teachingSecond, 1));
    const e0 = feuille.students.find((s) => s.coursework[1] === '12.50');
    expect(e0).toBeDefined();
    expect(e0!.exam).toBe('14.00');
  });

  it('⚠ ce que le second écrit, le premier le relit — et le bulletin ne voit la matière qu’une fois', async () => {
    const feuille = await inTenant(() => grades.sheet(teachingSecond, 1));
    const eleve = feuille.students.find((s) => s.exam === '14.00')!;
    await inTenant(() =>
      grades.record(teachingSecond, 1, [{ studentId: eleve.studentId, kind: 'exam', sequenceNo: 1, score: '16' }], userSecond),
    );
    const relue = await inTenant(() => grades.sheet(teachingMien, 1));
    expect(relue.students.find((s) => s.studentId === eleve.studentId)!.exam).toBe('16.00');
    // Une seule ligne « Calcul » sur le bulletin, avec la note écrite par le second.
    const bulletin = await inTenant(() => grades.reportCardFor(eleve.studentId, 1, { academicYearId: yearId }));
    const calcul = bulletin.subjects.filter((s) => s.subject === 'Calcul');
    expect(calcul).toHaveLength(1);
    expect(Number(calcul[0]!.exam)).toBe(16);
  });

  it('⚠ copier les affectations vers l’année suivante ne vide pas le bulletin de cette année', async () => {
    const y2 = await owner.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, label, start_year, status) VALUES ($1, '2026-2027', 2026, 'future') RETURNING id`,
      [schoolId],
    );
    await owner.query(
      `INSERT INTO teachings (school_id, academic_year_id, group_id, subject_id, teacher_id, hours_per_week)
       SELECT school_id, $2, group_id, subject_id, teacher_id, hours_per_week FROM teachings WHERE academic_year_id = $1`,
      [yearId, y2.rows[0]!.id],
    );
    const feuille = await inTenant(() => grades.sheet(teachingMien, 1));
    const eleve = feuille.students.find((s) => s.exam === '16.00')!;
    const bulletin = await inTenant(() => grades.reportCardFor(eleve.studentId, 1, { academicYearId: yearId }));
    expect(Number(bulletin.subjects.find((s) => s.subject === 'Calcul')!.exam)).toBe(16);
  });
});
