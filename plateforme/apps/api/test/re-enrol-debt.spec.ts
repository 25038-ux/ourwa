import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LA PORTE DE LA RÉINSCRIPTION — `reinscrire_etudiant.php`.
 *
 * ⚠ ITS HEADER IS THE SPECIFICATION: "with debt check, admin bypass, and
 * payment integration". Ours had none of the three. `reEnrol()` checked only
 * that the child was not already enrolled, so a family owing 40 000 MRU was
 * re-enrolled without anything being said.
 *
 * Its rule, from the source:
 *
 *   dette > 0.01 and no bypass          → refused, with the figure named
 *   dette > 0.01, bypass, not an admin  → refused: only an admin may authorise
 *   dette > 0.01, bypass, admin         → allowed, and the audit says so
 *
 * ⚠ THE DEBT BELONGS TO THE CORRESPONDENT, NOT THE CHILD. A family of four owes
 * one debt, and re-enrolling any of the four meets the same gate.
 */

let owner: pg.Pool;
let enrollments: EnrollmentService;

let schoolId: string;
let lastYear: string;
let thisYear: string;
let groupId: string;
let ACTOR: string;

const DIRECTION = ['scolarite.niveaux', 'scolarite.reinscrire'];
const TILL = ['scolarite.reinscrire'];
const MONTHLY = '10000.00';

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'reenrol' }, fn);
}

/** A family whose child sat last year and is due to come back. */
async function family(tag: string): Promise<{ guardianId: string; studentId: string }> {
  const g = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', $2) RETURNING id`,
    [`reenrol.${tag}@test`, `Parent ${tag}`],
  );
  const guardianId = g.rows[0]!.id;

  const s = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5, 'Reenrol') RETURNING id`,
    [schoolId, guardianId, `RIM-${tag}`, `NID-${tag}`, tag],
  );
  const studentId = s.rows[0]!.id;

  // Last year's enrolment, written directly: the service refuses a closed year.
  const level = await owner.query<{ level_id: string }>(
    'SELECT level_id FROM groups WHERE id = $1',
    [groupId],
  );
  const e = await owner.query<{ id: string }>(
    `INSERT INTO enrollments
       (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee)
     VALUES ($1, $2, $3, $4, $5, 'enrolled', $6) RETURNING id`,
    [schoolId, studentId, lastYear, groupId, level.rows[0]!.level_id, MONTHLY],
  );

  return { guardianId, studentId, ...({ enrolmentId: e.rows[0]!.id } as object) } as never;
}

/** Leave an unpaid, elapsed month on last year — a real debt. */
async function owe(studentId: string, amount = MONTHLY): Promise<void> {
  const { rows } = await owner.query<{ id: string }>(
    `SELECT id FROM enrollments WHERE student_id = $1 AND academic_year_id = $2`,
    [studentId, lastYear],
  );
  await owner.query(
    `INSERT INTO enrollment_months
       (school_id, enrollment_id, month_order, month_label, calendar_month,
        calendar_year, status, amount_due)
     VALUES ($1, $2, 1, 'Octobre', 10, 2019, 'billable', $3)`,
    [schoolId, rows[0]!.id, amount],
  );
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('reenrol', 'Reenrol', 'REN')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const years = await owner.query<{ id: string; status: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2019-2020', 2019, 'closed'), ($1, '2020-2021', 2020, 'active')
     RETURNING id, status`,
    [schoolId],
  );
  lastYear = years.rows.find((r) => r.status === 'closed')!.id;
  thisYear = years.rows.find((r) => r.status === 'active')!.id;

  const level = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle)
     VALUES ($1, '6eme', $2, 'college') RETURNING id`,
    [schoolId, MONTHLY],
  );
  const group = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6eme A') RETURNING id`,
    [schoolId, level.rows[0]!.id],
  );
  groupId = group.rows[0]!.id;

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('reenrol.admin@test', 'x', 'Direction') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  enrollments = moduleRef.get(EnrollmentService);

  expect(thisYear).toBeTruthy();
});

afterAll(async () => {
  await owner?.end();
});

describe('a family that owes nothing', () => {
  it('is re-enrolled without ceremony', async () => {
    const { studentId } = await family('clear');
    const result = await inTenant(() =>
      enrollments.reEnrol(studentId, groupId, ACTOR, TILL, {}),
    );
    expect(result).toBeTruthy();
  });
});

describe('a family that owes', () => {
  it('⚠ is REFUSED, and the refusal names the figure', async () => {
    const { studentId } = await family('owes');
    await owe(studentId);

    await expect(
      inTenant(() => enrollments.reEnrol(studentId, groupId, ACTOR, TILL, {})),
    ).rejects.toThrow(/10 000|dette/i);
  });

  it('⚠ is still refused when the till ticks the bypass', async () => {
    // "Seul un administrateur peut autoriser la réinscription malgré la dette."
    // A checkbox on a form is not authority.
    const { studentId } = await family('till-bypass');
    await owe(studentId);

    await expect(
      inTenant(() =>
        enrollments.reEnrol(studentId, groupId, ACTOR, TILL, { bypassDebt: true }),
      ),
    ).rejects.toThrow(/administrateur/i);
  });

  it('⚠ is allowed when an ADMIN bypasses, deliberately', async () => {
    const { studentId } = await family('admin-bypass');
    await owe(studentId);

    const result = await inTenant(() =>
      enrollments.reEnrol(studentId, groupId, ACTOR, DIRECTION, { bypassDebt: true }),
    );
    expect(result).toBeTruthy();
  });

  it('⚠ the bypass is recorded — "(dette ignorée par admin)"', async () => {
    // Its own journal line. A decision to waive the gate must be findable
    // afterwards, or nobody can answer who let the family back in.
    // ⚠ Et le MONTANT y est. Sa ligne de journal dit « Réinscription malgré
    // dette (10 000.00 MRU) — décision administrateur » : « oui » ne répond pas
    // à la question qu'on posera en juin, « combien » y répond.
    const { rows } = await owner.query<{ bypassed: string }>(
      `SELECT after->>'debtBypassed' AS bypassed FROM audit_log
        WHERE action = 'student_re_enrolled'
          AND after->>'debtBypassed' IS NOT NULL`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.bypassed).toMatch(/[0-9]/);
  });
});

describe('the debt belongs to the household', () => {
  it('⚠ a sibling meets the same gate', async () => {
    // A family of four owes ONE debt. Re-enrolling any of them asks the same
    // question, because the money is the correspondent's.
    const { guardianId, studentId } = await family('elder');
    await owe(studentId);

    const younger = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, 'RIM-younger2', 'NID-younger2', 'Cadet', 'Reenrol') RETURNING id`,
      [schoolId, guardianId],
    );
    const level = await owner.query<{ level_id: string }>(
      'SELECT level_id FROM groups WHERE id = $1',
      [groupId],
    );
    await owner.query(
      `INSERT INTO enrollments
         (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee)
       VALUES ($1, $2, $3, $4, $5, 'enrolled', $6)`,
      [schoolId, younger.rows[0]!.id, lastYear, groupId, level.rows[0]!.level_id, MONTHLY],
    );

    await expect(
      inTenant(() => enrollments.reEnrol(younger.rows[0]!.id, groupId, ACTOR, TILL, {})),
    ).rejects.toThrow(/dette/i);
  });
});
