import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AcademicYearService } from '../src/academic/academic-year.service.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * WHAT YEAR A PARENT SEES — `includes/parent_scope.php`.
 *
 * ⚠ THE ACTIVE YEAR, AND NOTHING ELSE. El Ourwa's `parent_annee_visible_id()`
 * returns `annee_active()` with no fallback whatever, and the comment at the top
 * of its dashboard says why in as many words:
 *
 *   "Entre la cloture d'une annee et l'ouverture de la suivante, il n'y a rien
 *    [...] page vide, et SURTOUT sans se rabattre sur l'annee precedente."
 *
 * A parent looking at the app in the gap between two school years must see an
 * empty state, NOT last year's marks and last year's absences presented as
 * current. The direction may want the fallback — an administrator opening a
 * fresh year wants to see the one that has data — but a family reading "3
 * absences this term" about a term that ended in June is being told something
 * false.
 *
 * ⚠ AND THE CHILDREN ARE BOUNDED TO THAT YEAR TOO. Another bug it records: the
 * dashboard "listait tous les enfants du parent, toutes annees confondues", so a
 * child who left two years ago still appeared beside their siblings.
 */

let owner: pg.Pool;
let years: AcademicYearService;
let enrollments: EnrollmentService;

let schoolId: string;
let closedYear: string;
let guardianId: string;
let ACTOR: string;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'pscope' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('pscope', 'Parent scope', 'PSC')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  // ⚠ ONE CLOSED YEAR AND NOTHING ACTIVE — the gap between two school years.
  const year = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2024-2025', 2024, 'closed') RETURNING id`,
    [schoolId],
  );
  closedYear = year.rows[0]!.id;

  const level = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle)
     VALUES ($1, '6eme', 5000, 'college') RETURNING id`,
    [schoolId],
  );
  const group = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6eme A') RETURNING id`,
    [schoolId, level.rows[0]!.id],
  );

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('pscope.admin@test', 'x', 'Direction') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const guardian = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('pscope.parent@test', 'x', 'Le parent') RETURNING id`,
  );
  guardianId = guardian.rows[0]!.id;

  const student = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, 'RIM-PS', 'NID-PS', 'Enfant', 'Parti') RETURNING id`,
    [schoolId, guardianId],
  );

  // History in the closed year, written directly: the service rightly refuses
  // to enrol into a settled year.
  await owner.query(
    `INSERT INTO enrollments
       (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee)
     VALUES ($1, $2, $3, $4, $5, 'enrolled', 5000)`,
    [schoolId, student.rows[0]!.id, closedYear, group.rows[0]!.id, level.rows[0]!.id],
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  years = moduleRef.get(AcademicYearService);
  enrollments = moduleRef.get(EnrollmentService);
});

afterAll(async () => {
  await owner?.end();
});

describe('the year a parent is shown', () => {
  it('⚠ is null when no year is active, even though a closed one has data', async () => {
    // This is the whole rule. `defaultView()` deliberately falls back to the
    // most recent year WITH enrolments, which is right for the office and wrong
    // for a family: it would hand them June's absences in October.
    const forParent = await inTenant(() => years.activeForParent());
    expect(forParent).toBeNull();
  });

  it('⚠ differs from what the direction is shown, deliberately', async () => {
    // The direction still gets the fallback — an administrator opening a fresh
    // year wants the one that has data in it.
    const forOffice = await inTenant(() => years.defaultView());
    expect(forOffice).not.toBeNull();
    expect(forOffice!.id).toBe(closedYear);

    const forParent = await inTenant(() => years.activeForParent());
    expect(forParent).toBeNull();
    // The two must not be the same call.
    expect(forParent).not.toEqual(forOffice);
  });

  it('returns the active year once one is opened', async () => {
    const opened = await owner.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, label, start_year, status)
       VALUES ($1, '2025-2026', 2025, 'active') RETURNING id`,
      [schoolId],
    );

    const forParent = await inTenant(() => years.activeForParent());
    expect(forParent?.id).toBe(opened.rows[0]!.id);
    expect(enrollments).toBeTruthy();
  });

  it('⚠ never returns a closed year, even the newest one', async () => {
    await owner.query(`UPDATE academic_years SET status = 'closed' WHERE school_id = $1`, [
      schoolId,
    ]);
    expect(await inTenant(() => years.activeForParent())).toBeNull();

    // And restore, so the ordering of this file's tests does not leak.
    await owner.query(
      `UPDATE academic_years SET status = 'active' WHERE school_id = $1 AND start_year = 2025`,
      [schoolId],
    );
    expect(ACTOR).toBeTruthy();
  });
});
