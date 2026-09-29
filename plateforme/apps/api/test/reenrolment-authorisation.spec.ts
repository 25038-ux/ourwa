import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { DebtService } from '../src/finance/debt.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * « AUTORISÉE MALGRÉ DETTE » — `reinscriptions.php`, action `autoriser`.
 *
 * ⚠ THIS WAS A FLAG ON A FUNCTION CALL AND IT HAS TO BE A RECORD. `enrol()`
 * takes `bypassDebt`, gated on `scolarite.niveaux`, which is right as far as it
 * goes — and it goes as far as that one call. El Ourwa stores the decision, and
 * its bulk re-enrolment screen depends on that: it prints "Autorisée malgré
 * dette" as a STATE of the family, sorts the still-blocked families to the top
 * because those are the ones needing a decision, and stops asking once the
 * decision is made.
 *
 * ⚠ AND THE AMOUNT IS FROZEN AT THE MOMENT OF THE DECISION. The question an
 * auditor asks is "how much was owed when somebody waved this through?", and the
 * debt moves afterwards — in both directions.
 *
 * Money and a decision that unblocks money, so the tests come first.
 */

let owner: pg.Pool;
let enrollments: EnrollmentService;
let debts: DebtService;

let schoolId: string;
let yearId: string;
let priorYearId: string;
let groupId: string;
let guardianId: string;
let debtorChild: string;
let ACTOR: string;

const DIRECTION = ['scolarite.niveaux', 'scolarite.reinscrire'];
const CLERK = ['scolarite.reinscrire'];

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'autor' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('autor', 'Autorisation', 'AUT')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const ys = await owner.query<{ id: string; start_year: number }>(
    `INSERT INTO academic_years (school_id, label, start_year, status) VALUES
       ($1, '2024-2025', 2024, 'closed'), ($1, '2025-2026', 2025, 'active')
     RETURNING id, start_year`,
    [schoolId],
  );
  priorYearId = ys.rows.find((r) => r.start_year === 2024)!.id;
  yearId = ys.rows.find((r) => r.start_year === 2025)!.id;

  const level = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order)
     VALUES ($1, '6eme', 10000, 'college', 10) RETURNING id`,
    [schoolId],
  );
  const group = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6eme A') RETURNING id`,
    [schoolId, level.rows[0]!.id],
  );
  groupId = group.rows[0]!.id;

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('autor.admin@test', 'x', 'Direction') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const guardian = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('autor.parent@test', 'x', 'Famille En Dette') RETURNING id`,
  );
  guardianId = guardian.rows[0]!.id;

  const student = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, 'RIM-AU', 'NID-AU', 'Enfant', 'Endette') RETURNING id`,
    [schoolId, guardianId],
  );
  debtorChild = student.rows[0]!.id;

  // Last year, with an elapsed month nobody paid.
  const enrolment = await owner.query<{ id: string }>(
    `INSERT INTO enrollments
       (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee, outcome)
     VALUES ($1, $2, $3, $4, $5, 'enrolled', 10000, 'passed') RETURNING id`,
    [schoolId, debtorChild, priorYearId, groupId, level.rows[0]!.id],
  );
  await owner.query(
    `INSERT INTO enrollment_months
       (school_id, enrollment_id, month_order, calendar_month, calendar_year, status, amount_due)
     VALUES ($1, $2, 1, 10, 2024, 'billable', 10000)`,
    [schoolId, enrolment.rows[0]!.id],
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  enrollments = moduleRef.get(EnrollmentService);
  debts = moduleRef.get(DebtService);
});

afterAll(async () => {
  await owner?.end();
});

describe('la dette bloque la réinscription', () => {
  it('confirms the family really owes something', async () => {
    const owed = await inTenant(() => debts.outstandingAcrossYears(guardianId));
    expect(owed.greaterThan(0)).toBe(true);
  });

  it('refuses to re-enrol without an authorisation', async () => {
    await expect(
      inTenant(() =>
        enrollments.reEnrol(debtorChild, groupId, ACTOR, CLERK),
      ),
    ).rejects.toThrow(/dette/i);
  });
});

describe('autoriser malgré la dette', () => {
  it('⚠ is the direction’s, never the counter’s', async () => {
    await expect(
      inTenant(() =>
        enrollments.authoriseDespiteDebt(debtorChild, yearId, 'Accord verbal', ACTOR, CLERK),
      ),
    ).rejects.toThrow(/administrateur|permission/i);
  });

  it('records the decision, with the amount as it stood', async () => {
    const owed = await inTenant(() => debts.outstandingAcrossYears(guardianId));

    await inTenant(() =>
      enrollments.authoriseDespiteDebt(
        debtorChild, yearId, 'Difficulté familiale', ACTOR, DIRECTION,
      ),
    );

    const { rows } = await owner.query<{
      amount_owed: string;
      reason: string;
      authorised_by: string;
    }>(
      `SELECT amount_owed::text, reason, authorised_by
         FROM reenrolment_authorisations WHERE student_id = $1 AND academic_year_id = $2`,
      [debtorChild, yearId],
    );
    expect(rows).toHaveLength(1);
    // ⚠ Frozen. The question later is what was owed at the time.
    expect(rows[0]!.amount_owed).toBe(owed.toFixed(2));
    expect(rows[0]!.reason).toBe('Difficulté familiale');
    expect(rows[0]!.authorised_by).toBe(ACTOR);
  });

  it('⚠ authorising twice is one authorisation, not two', async () => {
    await inTenant(() =>
      enrollments.authoriseDespiteDebt(debtorChild, yearId, 'Encore', ACTOR, DIRECTION),
    );
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM reenrolment_authorisations WHERE student_id = $1`,
      [debtorChild],
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('and the re-enrolment now goes through — for the CLERK', async () => {
    // The point of storing it: the decision was the direction's, and the
    // office does the work afterwards without needing them again.
    const result = await inTenant(() => enrollments.reEnrol(debtorChild, groupId, ACTOR, CLERK));
    expect(result.id).toBeTruthy();
  });
});

describe('révoquer l’autorisation', () => {
  it('⚠ keeps the row — who allowed this and then changed their mind is a fact', async () => {
    await inTenant(() => enrollments.revokeAuthorisation(debtorChild, yearId, ACTOR, DIRECTION));

    const { rows } = await owner.query<{ revoked_at: Date | null; reason: string }>(
      `SELECT revoked_at, reason FROM reenrolment_authorisations
        WHERE student_id = $1 AND academic_year_id = $2`,
      [debtorChild, yearId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revoked_at).not.toBeNull();
    // The original reason survives the revocation.
    expect(rows[0]!.reason).toBe('Encore');
  });

  it('the block is back', async () => {
    const other = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, 'RIM-AU2', 'NID-AU2', 'Second', 'Endette') RETURNING id`,
      [schoolId, guardianId],
    );
    await expect(
      inTenant(() =>
        enrollments.reEnrol(other.rows[0]!.id, groupId, ACTOR, CLERK),
      ),
    ).rejects.toThrow(/dette/i);
  });
});
