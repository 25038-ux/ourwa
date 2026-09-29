import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { ConcessionsService } from '../src/finance/concessions.service.js';
import { DebtService } from '../src/finance/debt.service.js';
import { CollectionService } from '../src/finance/collection.service.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * EXEMPTIONS AND RÉDUCTIONS — `gestion_caisse.php`.
 *
 * Three ways a school charges a family less, and they are NOT the same thing:
 *
 *   exemption totale     — this child pays nothing, ever
 *   exemption mensuelle  — one named month is excused
 *   réduction            — one month costs less than the rate
 *
 * A fourth, the remise, already exists and is different again: a discount lowers
 * the price BEFORE it is owed, a write-off forgives what is already owed.
 *
 * ⚠ THE TABLES EXISTED AND THE DEBT QUERY READ THEM, BUT NOTHING COULD CREATE
 * ONE. A school could not excuse a single month of a single child.
 *
 * Written first: every one of these changes what a family owes.
 */

let owner: pg.Pool;
let concessions: ConcessionsService;
let debts: DebtService;
let collection: CollectionService;
let enrollments: EnrollmentService;

let schoolId: string;
let yearId: string;
let groupId: string;
let cashId: string;
let ACTOR: string;

const DIRECTION = ['scolarite.niveaux'];
const START_YEAR = 2019;
const MONTHLY = '10000.00';

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'conc' }, fn);
}

/** A child who arrives mid-year, so the months before are written free. */
async function lateArrival(tag: string) {
  const g = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', $2) RETURNING id`,
    [`conc.${tag}@test`, `Parent ${tag}`],
  );
  const guardianId = g.rows[0]!.id;
  const s2 = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5, 'Conc') RETURNING id`,
    [schoolId, guardianId, `RIM-${tag}`, `NID-${tag}`, tag],
  );
  const studentId = s2.rows[0]!.id;
  await inTenant(() =>
    enrollments.enrol(
      { studentId, academicYearId: yearId, groupId, entryDate: `${START_YEAR + 1}-01-10` },
      ACTOR,
      DIRECTION,
    ),
  );
  return { guardianId, studentId };
}

async function pupil(tag: string) {
  const g = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', $2) RETURNING id`,
    [`conc.${tag}@test`, `Parent ${tag}`],
  );
  const guardianId = g.rows[0]!.id;
  const s = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5, 'Conc') RETURNING id`,
    [schoolId, guardianId, `RIM-${tag}`, `NID-${tag}`, tag],
  );
  const studentId = s.rows[0]!.id;
  await inTenant(() =>
    enrollments.enrol(
      { studentId, academicYearId: yearId, groupId, entryDate: `${START_YEAR}-10-01` },
      ACTOR,
      DIRECTION,
    ),
  );
  return { guardianId, studentId };
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('conc', 'Concessions', 'CNC')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const year = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2019-2020', $2, 'active') RETURNING id`,
    [schoolId, START_YEAR],
  );
  yearId = year.rows[0]!.id;

  const level = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle)
     VALUES ($1, '3eme', $2, 'college') RETURNING id`,
    [schoolId, MONTHLY],
  );
  const group = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '3eme A') RETURNING id`,
    [schoolId, level.rows[0]!.id],
  );
  groupId = group.rows[0]!.id;

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('conc.admin@test', 'x', 'Direction') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const method = await owner.query<{ id: string }>(
    `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Especes') RETURNING id`,
    [schoolId],
  );
  cashId = method.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  concessions = moduleRef.get(ConcessionsService);
  debts = moduleRef.get(DebtService);
  collection = moduleRef.get(CollectionService);
  enrollments = moduleRef.get(EnrollmentService);
});

afterAll(async () => {
  await owner?.end();
});

describe('exemption totale', () => {
  it('⚠ takes the whole year off the family’s debt', async () => {
    const { guardianId, studentId } = await pupil('totale');
    const before = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    expect(Number(before.total)).toBeGreaterThan(0);

    await inTenant(() => concessions.exemptStudent(studentId, 'Boursier', ACTOR));

    const after = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    expect(after.tuition).toHaveLength(0);
  });

  it('refuses a second one, in its words', async () => {
    const { studentId } = await pupil('deuxfois');
    await inTenant(() => concessions.exemptStudent(studentId, null, ACTOR));
    await expect(
      inTenant(() => concessions.exemptStudent(studentId, null, ACTOR)),
    ).rejects.toThrow(/déjà une exemption totale/i);
  });

  it('can be lifted, and the debt comes back', async () => {
    const { guardianId, studentId } = await pupil('lever');
    const granted = await inTenant(() => concessions.exemptStudent(studentId, null, ACTOR));
    expect((await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR))).tuition)
      .toHaveLength(0);

    await inTenant(() => concessions.liftExemption(granted.id, ACTOR));

    const after = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    expect(after.tuition.length).toBeGreaterThan(0);
  });
});

describe('exemption mensuelle', () => {
  it('excuses exactly one month and no other', async () => {
    const { guardianId, studentId } = await pupil('unmois');
    await inTenant(() =>
      concessions.exemptMonth(
        { studentId, calendarMonth: 11, calendarYear: START_YEAR, reason: 'Ramadan' },
        ACTOR,
      ),
    );

    const debt = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    const november = debt.tuition.find(
      (l) => l.calendarMonth === 11 && l.calendarYear === START_YEAR,
    );
    expect(november).toBeUndefined();
    // October is untouched.
    expect(
      debt.tuition.some((l) => l.calendarMonth === 10 && l.calendarYear === START_YEAR),
    ).toBe(true);
  });

  it('refuses the same month twice', async () => {
    const { studentId } = await pupil('memois');
    const input = { studentId, calendarMonth: 12, calendarYear: START_YEAR, reason: null };
    await inTenant(() => concessions.exemptMonth(input, ACTOR));
    await expect(inTenant(() => concessions.exemptMonth(input, ACTOR))).rejects.toThrow(
      /déjà exempté/i,
    );
  });
});

describe('réduction', () => {
  it('lowers what one month costs, by exactly the amount', async () => {
    const { guardianId, studentId } = await pupil('reduc');
    await inTenant(() =>
      concessions.applyDiscount(
        {
          studentId,
          calendarMonth: 10,
          calendarYear: START_YEAR,
          amount: '2500.00',
          reason: 'Difficulté familiale',
        },
        ACTOR,
      ),
    );

    const debt = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    const october = debt.tuition.find(
      (l) => l.calendarMonth === 10 && l.calendarYear === START_YEAR,
    );
    expect(october!.outstanding).toBe('7500.00');
  });

  it('⚠ refuses a discount larger than the month itself', async () => {
    const { studentId } = await pupil('trop');
    await expect(
      inTenant(() =>
        concessions.applyDiscount(
          {
            studentId,
            calendarMonth: 10,
            calendarYear: START_YEAR,
            amount: '15000.00',
            reason: null,
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/dépasse/i);
  });

  it('⚠ refuses to reduce a month below what is already paid', async () => {
    // Its own guard, and the reason it exists: if a family has paid 8 000 and
    // the month is then reduced to 6 000, the school owes them 2 000 it never
    // agreed to — a credit conjured out of a concession.
    const { studentId } = await pupil('dejapaye');
    await inTenant(() =>
      collection.collect(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 10,
          calendarYear: START_YEAR,
          fees: {},
          tender: [{ paymentMethodId: cashId, amount: '8000.00' }],
        },
        ACTOR,
      ),
    );

    await expect(
      inTenant(() =>
        concessions.applyDiscount(
          {
            studentId,
            calendarMonth: 10,
            calendarYear: START_YEAR,
            amount: '5000.00', // would leave the month due 5 000, under the 8 000 paid
            reason: null,
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/déjà payés/i);
  });

  it('allows a discount that lands exactly on what was paid', async () => {
    const { studentId } = await pupil('pile');
    await inTenant(() =>
      collection.collect(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 10,
          calendarYear: START_YEAR,
          fees: {},
          tender: [{ paymentMethodId: cashId, amount: '6000.00' }],
        },
        ACTOR,
      ),
    );
    // 10 000 − 4 000 = 6 000, exactly what was paid. The month settles.
    await inTenant(() =>
      concessions.applyDiscount(
        {
          studentId,
          calendarMonth: 10,
          calendarYear: START_YEAR,
          amount: '4000.00',
          reason: null,
        },
        ACTOR,
      ),
    );

    const { rows } = await owner.query(
      `SELECT 1 FROM discounts WHERE student_id = $1 AND calendar_month = 10`,
      [studentId],
    );
    expect(rows).toHaveLength(1);
  });

  it('replaces an existing discount for the month rather than stacking', async () => {
    const { guardianId, studentId } = await pupil('rejoue');
    for (const amount of ['1000.00', '3000.00']) {
      await inTenant(() =>
        concessions.applyDiscount(
          { studentId, calendarMonth: 11, calendarYear: START_YEAR, amount, reason: null },
          ACTOR,
        ),
      );
    }

    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM discounts WHERE student_id = $1 AND calendar_month = 11`,
      [studentId],
    );
    expect(rows[0]!.n).toBe('1');

    const debt = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    const november = debt.tuition.find((l) => l.calendarMonth === 11)!;
    expect(november.outstanding).toBe('7000.00');
  });

  it('can be withdrawn, and the month costs its full rate again', async () => {
    const { guardianId, studentId } = await pupil('retirer');
    await inTenant(() =>
      concessions.applyDiscount(
        {
          studentId,
          calendarMonth: 12,
          calendarYear: START_YEAR,
          amount: '2000.00',
          reason: null,
        },
        ACTOR,
      ),
    );
    await inTenant(() =>
      concessions.removeDiscount(studentId, 12, START_YEAR, ACTOR),
    );

    const debt = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    const december = debt.tuition.find((l) => l.calendarMonth === 12)!;
    expect(december.outstanding).toBe('10000.00');
  });
});

/**
 * RÉTABLIR L'EXEMPTION AUTOMATIQUE — `gestion_caisse.php`, `retablir_exemption_auto`.
 *
 * ⚠ `annuler_exemption_auto` EXISTED AND ITS INVERSE DID NOT. The direction can
 * make a pre-enrolment month billable — a mid-year transfer agreed verbally is
 * the usual reason — and once done there was no way back. A month made due by
 * mistake stayed due for ever, so the family owed money they did not owe, and
 * the only remedy was editing the database.
 *
 * El Ourwa carries both, side by side on the same month card.
 *
 * ⚠ AND OURS REFUSES ONCE THE MONTH HAS BEEN PAID, which El Ourwa does not.
 * Its `retablir` deletes a row and stops; ours would have to set `amount_due` to
 * zero, leaving a payment against a month that costs nothing — money in the
 * ledger belonging to nothing. Refusing says so instead.
 */
describe('rétablir l’exemption automatique', () => {
  it('puts a wrongly-billed month back to free, and out of the debt', async () => {
    const { guardianId, studentId } = await lateArrival('retablir');

    // The child arrives in January, so October was written free by the
    // schedule builder — nobody was there to owe it.
    await inTenant(() =>
      concessions.restoreMonth(
        { studentId, academicYearId: yearId, calendarMonth: 10, calendarYear: START_YEAR },
        ACTOR,
      ),
    );

    const owed = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    expect(owed.tuition.some((l) => l.calendarMonth === 10)).toBe(true);

    await inTenant(() =>
      concessions.reExemptMonth(
        { studentId, academicYearId: yearId, calendarMonth: 10, calendarYear: START_YEAR },
        ACTOR,
      ),
    );

    const after = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    expect(after.tuition.some((l) => l.calendarMonth === 10)).toBe(false);

    // ⚠ And it costs nothing, rather than costing the rate and being hidden.
    const { rows } = await owner.query<{ status: string; amount_due: string }>(
      `SELECT m.status, m.amount_due::text
         FROM enrollment_months m JOIN enrollments e ON e.id = m.enrollment_id
        WHERE e.student_id = $1 AND m.calendar_month = 10`,
      [studentId],
    );
    expect(rows[0]!.status).toBe('free');
    expect(rows[0]!.amount_due).toBe('0.00');
  });

  it('⚠ refuses once the month has been paid', async () => {
    const { studentId } = await lateArrival('retablir-paye');
    await inTenant(() =>
      concessions.restoreMonth(
        { studentId, academicYearId: yearId, calendarMonth: 10, calendarYear: START_YEAR },
        ACTOR,
      ),
    );

    await owner.query(
      `INSERT INTO payments
         (school_id, student_id, academic_year_id, calendar_month, calendar_year,
          amount, receipt_number)
       VALUES ($1, $2, $3, 10, $4, 10000, 'CNC-RET-1')`,
      [schoolId, studentId, yearId, START_YEAR],
    );

    // Setting the month free would leave a payment against something that costs
    // nothing — money in the ledger belonging to no charge.
    await expect(
      inTenant(() =>
        concessions.reExemptMonth(
          { studentId, academicYearId: yearId, calendarMonth: 10, calendarYear: START_YEAR },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/réglé|paiement/i);
  });

  it('says so when the month is not on the child’s schedule at all', async () => {
    const { studentId } = await lateArrival('retablir-absent');
    await expect(
      inTenant(() =>
        concessions.reExemptMonth(
          { studentId, academicYearId: yearId, calendarMonth: 7, calendarYear: START_YEAR },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/programme/i);
  });
});
