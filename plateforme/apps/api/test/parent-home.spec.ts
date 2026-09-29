import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { ParentController } from '../src/parent/parent.controller.js';
import { runInTenant } from '../src/tenant/tenant.context.js';
import type { AuthenticatedRequest } from '../src/auth/permissions.guard.js';

/**
 * ⚠ `GET /parent/children` — THE PARENT APP'S HOME SCREEN — RETURNED 500.
 *
 * Its query counted a child's absences with `a.academic_year_id = $2`, and
 * `attendance` HAS NO SUCH COLUMN: it carries `teaching_id`, and the teaching
 * carries the year. Postgres answered "column a.academic_year_id does not
 * exist", Nest turned that into a 500, and the first screen a family sees was
 * an error.
 *
 * Nothing caught it because nothing called the controller. The suites here
 * exercise SERVICES; this handler builds its SQL inline, so it had no test at
 * all and its query was never run. Found by signing in as a parent against the
 * running system while checking something else.
 *
 * ⚠ AND THE ABSENCE COUNT MUST NOT SILENTLY DROP ROWS. `attendance.teaching_id`
 * is nullable — an absence recorded outside a lesson has none — so joining
 * through `teachings` to reach the year would quietly under-count. The year is
 * bounded by the school year's own dates instead, which is a fact about the
 * absence rather than about how it was recorded.
 */

let owner: pg.Pool;
let parent: ParentController;
let schoolId: string;
let guardianId: string;
let studentId: string;
let yearId: string;

const req = (userId: string) =>
  ({ auth: { userId, schoolId, roles: ['parent'], permissions: [], impersonated: false } }) as
    unknown as AuthenticatedRequest;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'phome' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('phome', 'Accueil', 'PHM')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const y = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, start_month, end_month, status)
     VALUES ($1, '2025-2026', 2025, 10, 6, 'active') RETURNING id`,
    [schoolId],
  );
  yearId = y.rows[0]!.id;

  const level = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle)
     VALUES ($1, '6eme', 5000, 'college') RETURNING id`,
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
  const teacher = await owner.query<{ id: string }>(
    `INSERT INTO teachers (school_id, first_name, last_name) VALUES ($1, 'P', 'T') RETURNING id`,
    [schoolId],
  );
  const teaching = await owner.query<{ id: string }>(
    `INSERT INTO teachings (school_id, academic_year_id, teacher_id, group_id, subject_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [schoolId, yearId, teacher.rows[0]!.id, group.rows[0]!.id, subject.rows[0]!.id],
  );

  const guardian = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('phome.parent@test', 'x', 'Le parent') RETURNING id`,
  );
  guardianId = guardian.rows[0]!.id;

  const student = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, 'RIM-PH', 'NID-PH', 'Enfant', 'Present') RETURNING id`,
    [schoolId, guardianId],
  );
  studentId = student.rows[0]!.id;

  await owner.query(
    `INSERT INTO enrollments
       (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee)
     VALUES ($1, $2, $3, $4, $5, 'enrolled', 5000)`,
    [schoolId, studentId, yearId, group.rows[0]!.id, level.rows[0]!.id],
  );

  // Two absences inside the year, one of them recorded WITHOUT a teaching, and
  // one outside it. Only the first two may be counted.
  for (const [date, teachingId] of [
    ['2025-11-04', teaching.rows[0]!.id],
    ['2025-11-05', null],
  ] as const) {
    await owner.query(
      `INSERT INTO attendance (school_id, student_id, teaching_id, on_date, status)
       VALUES ($1, $2, $3, $4, 'absent')`,
      [schoolId, studentId, teachingId, date],
    );
  }
  await owner.query(
    `INSERT INTO attendance (school_id, student_id, teaching_id, on_date, status)
     VALUES ($1, $2, NULL, '2024-11-04', 'absent')`,
    [schoolId, studentId],
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  parent = moduleRef.get(ParentController);
});

afterAll(async () => {
  await owner?.end();
});

describe('la page d’accueil du parent', () => {
  it('⚠ answers at all — it used to be a 500', async () => {
    const result = await inTenant(() => parent.children(req(guardianId)));
    expect(result.children).toHaveLength(1);
    expect(result.children[0]!.first_name).toBe('Enfant');
  });

  it('⚠ counts an absence recorded outside a lesson', async () => {
    // `attendance.teaching_id` is nullable. Reaching the year through the
    // teaching would drop this one silently, and a parent would be told their
    // child had one absence when the school recorded two.
    const result = await inTenant(() => parent.children(req(guardianId)));
    expect(Number(result.children[0]!.absences)).toBe(2);
  });

  it('⚠ leaves last year’s absences out', async () => {
    // The count is for the year being shown. Carrying the whole history forward
    // makes a child look worse every September.
    const result = await inTenant(() => parent.children(req(guardianId)));
    expect(Number(result.children[0]!.absences)).toBeLessThan(3);
  });

  it('shows another family nothing', async () => {
    const other = await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('phome.autre@test', 'x', 'Autre parent') RETURNING id`,
    );
    const result = await inTenant(() => parent.children(req(other.rows[0]!.id)));
    expect(result.children).toHaveLength(0);
  });
});

/**
 * LA FICHE D'UN ENFANT — `pages/parent/enfant.php`.
 *
 * ⚠ SON COMPTEUR D'ABSENCES N'ÉTAIT BORNÉ PAR AUCUNE ANNÉE.
 * `GET /parent/children/:id/attendance` lisait `WHERE a.student_id = $1`, sans
 * plus. Un enfant scolarisé depuis quatre ans voyait donc s'additionner quatre
 * années d'absences sur une page qui annonce l'année en cours — et le grand
 * chiffre rouge de l'en-tête est précisément ce qu'un parent regarde en premier.
 * El Ourwa borne la sienne : `WHERE a.etudiant_id = :e AND en.annee_id = :an`.
 *
 * ⚠ ET SON TOTAL COMPTE LES RETARDS. `statut IN ("absent","retard")`, sur le
 * tableau de bord comme sur la fiche. Nous ne comptions que les absences : un
 * enfant huit fois en retard s'affichait à zéro chez nous et à huit chez lui.
 */
describe('la fiche d’un enfant', () => {
  it('⚠ ne compte que l’année consultée', async () => {
    // Le jeu de données porte deux absences dans l'année et une en 2024.
    const result = await inTenant(() => parent.attendance(studentId, req(guardianId)));
    expect(result.absences).toBe(2);
    expect(result.entries).toHaveLength(2);
  });

  it('⚠ son total additionne absences ET retards, comme le sien', async () => {
    await owner.query(
      `INSERT INTO attendance (school_id, student_id, teaching_id, on_date, status)
       VALUES ($1, $2, NULL, '2025-11-06', 'late')`,
      [schoolId, studentId],
    );
    const result = await inTenant(() => parent.attendance(studentId, req(guardianId)));
    expect(result.absences).toBe(2);
    expect(result.late).toBe(1);
    // Le grand chiffre de l'en-tête, celui qu'El Ourwa nomme « total absences ».
    expect(result.total).toBe(3);
  });

  it('⚠ un parent ne lit pas la fiche de l’enfant d’un autre', async () => {
    // Le parent d'à côté existe déjà dans ce jeu de données.
    const autre = await owner.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'phome.autre@test'`,
    );
    await expect(
      inTenant(() => parent.attendance(studentId, req(autre.rows[0]!.id))),
    ).rejects.toThrow();
  });
});
