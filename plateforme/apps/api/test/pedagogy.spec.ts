import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PedagogyService } from '../src/pedagogy/pedagogy.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * Homework, remarks and the notifications they raise.
 *
 * ⚠ THIS FILE EXISTS BECAUSE SENDING AN EXERCISE WAS BROKEN AND NOTHING NOTICED.
 *
 * `sendHomework` writes the exercise and then one notification per family, and
 * the notification INSERT put an uncast `$1` in a SELECT list. Postgres has no
 * column to infer a parameter's type from there, settles on text, and refuses to
 * put text in a uuid column — so every call failed. It had no test.
 */

let owner: pg.Pool;
let pedagogy: PedagogyService;

let schoolId: string;
let yearId: string;
let teachingId: string;
let studentId: string;
let guardianId: string;
let ACTOR: string;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'ped' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix)
     VALUES ('ped', 'Pedagogy', 'PED') RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const year = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2020-2021', 2020, 'active') RETURNING id`,
    [schoolId],
  );
  yearId = year.rows[0]!.id;

  const level = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle)
     VALUES ($1, '6eme', 10000, 'college') RETURNING id`,
    [schoolId],
  );
  const group = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6eme A') RETURNING id`,
    [schoolId, level.rows[0]!.id],
  );
  const subject = await owner.query<{ id: string }>(
    `INSERT INTO subjects (school_id, level_id, name) VALUES ($1, $2, 'Maths') RETURNING id`,
    [schoolId, level.rows[0]!.id],
  );

  const users = await owner.query<{ id: string; email: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES
       ('ped.admin@test', 'x', 'Directeur'),
       ('ped.parent@test', 'x', 'Parent')
     RETURNING id, email`,
  );
  ACTOR = users.rows.find((r) => r.email === 'ped.admin@test')!.id;
  guardianId = users.rows.find((r) => r.email === 'ped.parent@test')!.id;

  const teacher = await owner.query<{ id: string }>(
    `INSERT INTO teachers (school_id, first_name, last_name)
     VALUES ($1, 'Le', 'Prof') RETURNING id`,
    [schoolId],
  );
  const teaching = await owner.query<{ id: string }>(
    `INSERT INTO teachings (school_id, academic_year_id, teacher_id, group_id, subject_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [schoolId, yearId, teacher.rows[0]!.id, group.rows[0]!.id, subject.rows[0]!.id],
  );
  teachingId = teaching.rows[0]!.id;

  const student = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, 'RIM-PED', 'NID-PED', 'Enfant', 'Pedago') RETURNING id`,
    [schoolId, guardianId],
  );
  studentId = student.rows[0]!.id;

  await owner.query(
    `INSERT INTO enrollments
       (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee)
     VALUES ($1, $2, $3, $4, $5, 'enrolled', 10000)`,
    [schoolId, studentId, yearId, group.rows[0]!.id, level.rows[0]!.id],
  );

  // A second child of the SAME family in the SAME class, so "one notification
  // per guardian" can be told apart from "one per child".
  const sibling = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, 'RIM-PED2', 'NID-PED2', 'Frere', 'Pedago') RETURNING id`,
    [schoolId, guardianId],
  );
  await owner.query(
    `INSERT INTO enrollments
       (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee)
     VALUES ($1, $2, $3, $4, $5, 'enrolled', 10000)`,
    [schoolId, sibling.rows[0]!.id, yearId, group.rows[0]!.id, level.rows[0]!.id],
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  pedagogy = moduleRef.get(PedagogyService);
});

afterAll(async () => {
  await owner?.end();
});

describe('sending an exercise', () => {
  it('⚠ actually works', async () => {
    // The regression test for the uncast parameter. Before the fix this threw
    // `column "school_id" is of type uuid but expression is of type text`.
    const sent = await inTenant(() =>
      pedagogy.sendHomework(
        teachingId,
        { title: 'Exercices 1 à 10', body: 'Pour lundi', dueOn: '2021-03-01' },
        ACTOR,
      ),
    );
    expect(sent).toBeTruthy();

    const { rows } = await owner.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM homework WHERE teaching_id = $1',
      [teachingId],
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('notifies the family, once per child', async () => {
    const { rows } = await owner.query<{ n: string; guardians: string }>(
      `SELECT count(*)::text AS n,
              count(DISTINCT guardian_id)::text AS guardians
         FROM notifications
        WHERE school_id = $1 AND kind = 'homework'`,
      [schoolId],
    );
    // Two children, one family: two rows, one guardian. A notification names a
    // child, so a parent with two in the class hears about both.
    expect(rows[0]!.n).toBe('2');
    expect(rows[0]!.guardians).toBe('1');
  });

  it('⚠ stamps the notification with its academic year', async () => {
    // v15 added this so a closed year's notifications stop being visible to
    // families while everything else from that year disappears (ADR-0015).
    const { rows } = await owner.query<{ academic_year_id: string | null }>(
      `SELECT academic_year_id FROM notifications
        WHERE school_id = $1 AND kind = 'homework' LIMIT 1`,
      [schoolId],
    );
    expect(rows[0]!.academic_year_id).toBe(yearId);
  });

  it('carries the title as a parameter, not as a baked sentence', async () => {
    // The parent app renders `notif_exercice_titre` / `_corps` in French or
    // Arabic from ONE string table. A pre-built
    // sentence would arrive in whichever language the office happened to use.
    const { rows } = await owner.query<{
      i18n_key: string;
      i18n_params: { titre: string; matiere: string; eleve: string; limite: string };
    }>(
      `SELECT i18n_key, i18n_params FROM notifications
        WHERE school_id = $1 AND kind = 'homework' LIMIT 1`,
      [schoolId],
    );
    expect(rows[0]!.i18n_key).toBe('notif_exercice');
    expect(rows[0]!.i18n_params.titre).toBe('Exercices 1 à 10');

    // ⚠ EVERY PLACEHOLDER THE TEMPLATE ASKS FOR. The strings are
    // "Nouvel exercice : {matiere}" and "Exercice « {titre} » pour
    // {eleve}.{limite}"; a parameter the sender omits renders as the literal
    // {eleve} on a parent's phone.
    expect(rows[0]!.i18n_params.matiere).toBeTruthy();
    expect(rows[0]!.i18n_params.eleve).toBeTruthy();
    expect(typeof rows[0]!.i18n_params.limite).toBe('string');
  });
});

describe('remarks', () => {
  it('records one, with its author by name', async () => {
    await inTenant(() =>
      pedagogy.addRemark(studentId, 'Très bon trimestre.', 'positive', ACTOR, 'Directeur'),
    );
    const list = await inTenant(() => pedagogy.remarksFor(studentId));
    expect(list).toHaveLength(1);
    expect(list[0]!.body).toContain('Très bon');
    expect(list[0]!.author_name).toBe('Directeur');
  });

  it('keeps the severity, which the family sees', async () => {
    const list = await inTenant(() => pedagogy.remarksFor(studentId));
    expect(list[0]!.severity).toBe('positive');
  });
});
