import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { CollectionService } from '../src/finance/collection.service.js';
import { DebtService } from '../src/finance/debt.service.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * ENCAISSER UN RÈGLEMENT / AVANCE — `gestion_caisse.php`, action `paiement_global`.
 *
 * A family hands over a lump sum. It does not name a month or a child; the till
 * spreads it. El Ourwa's order:
 *
 *   1. the DEBT — elapsed, owed, unpaid months, oldest first
 *   2. then FORWARD, into the remaining months of the year being viewed
 *
 * ⚠ WRITTEN FIRST. This decides which child and which month a family's money
 * lands on, and getting it wrong is invisible: the total is right, so nothing
 * looks broken, and the error only surfaces months later when a month everyone
 * thought was settled turns out not to be.
 */

let owner: pg.Pool;
let collection: CollectionService;
let debts: DebtService;
let enrollments: EnrollmentService;

let schoolId: string;
let yearId: string;
let groupId: string;
let cashId: string;
let bankilyId: string;
let ACTOR: string;

const DIRECTION = ['scolarite.niveaux'];
const START_YEAR = 2019; // in the past, so every month has elapsed
const MONTHLY = '10000.00';

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'glob' }, fn);
}

async function family(tag: string, children = 1, free = false) {
  const g = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', $2) RETURNING id`,
    [`glob.${tag}@test`, `Parent ${tag}`],
  );
  const guardianId = g.rows[0]!.id;
  const studentIds: string[] = [];

  for (let i = 0; i < children; i++) {
    const s = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5, 'Glob') RETURNING id`,
      [schoolId, guardianId, `RIM-${tag}${i}`, `NID-${tag}${i}`, `${tag}${i}`],
    );
    const studentId = s.rows[0]!.id;
    await inTenant(() =>
      enrollments.enrol(
        {
          studentId,
          academicYearId: yearId,
          groupId,
          entryDate: `${START_YEAR}-10-01`,
          isFree: free,
        },
        ACTOR,
        DIRECTION,
      ),
    );
    studentIds.push(studentId);
  }
  return { guardianId, studentIds };
}

/** Every payment row for a student, oldest month first. */
async function paymentsOf(studentId: string) {
  const { rows } = await owner.query<{ m: number; y: number; amount: string }>(
    `SELECT calendar_month AS m, calendar_year AS y, amount::text
       FROM payments WHERE student_id = $1
      ORDER BY calendar_year, calendar_month, paid_at`,
    [studentId],
  );
  return rows.map((r) => ({ month: r.m, year: r.y, amount: r.amount }));
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('glob', 'Global', 'GLB')
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
     VALUES ($1, '4eme', $2, 'college') RETURNING id`,
    [schoolId, MONTHLY],
  );
  const group = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '4eme A') RETURNING id`,
    [schoolId, level.rows[0]!.id],
  );
  groupId = group.rows[0]!.id;

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('glob.cashier@test', 'x', 'Caissier') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const methods = await owner.query<{ id: string; name: string }>(
    `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Especes'), ($1, 'Bankily')
     RETURNING id, name`,
    [schoolId],
  );
  cashId = methods.rows.find((r) => r.name === 'Especes')!.id;
  bankilyId = methods.rows.find((r) => r.name === 'Bankily')!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  collection = moduleRef.get(CollectionService);
  debts = moduleRef.get(DebtService);
  enrollments = moduleRef.get(EnrollmentService);
});

afterAll(async () => {
  await owner?.end();
});

describe('it pays the debt first, oldest month first', () => {
  it('⚠ fills the earliest owed months and stops when the money runs out', async () => {
    const { guardianId, studentIds } = await family('ordre');

    // 25 000 against a 10 000/month debt: two months in full and a third part-paid.
    const result = await inTenant(() =>
      collection.payGlobal(
        {
          guardianId,
          academicYearId: yearId,
          tender: [{ paymentMethodId: cashId, amount: '25000.00' }],
        },
        ACTOR,
      ),
    );

    expect(result.allocated).toBe('25000.00');
    const paid = await paymentsOf(studentIds[0]!);
    expect(paid.slice(0, 3).map((p) => p.amount)).toEqual([
      '10000.00',
      '10000.00',
      '5000.00',
    ]);
    // The oldest month of the year is October — the school year starts there.
    expect(paid[0]!.month).toBe(10);
  });

  it('⚠ never puts more on a month than that month is short', async () => {
    const { guardianId, studentIds } = await family('plafond');
    await inTenant(() =>
      collection.payGlobal(
        {
          guardianId,
          academicYearId: yearId,
          tender: [{ paymentMethodId: cashId, amount: '4000.00' }],
        },
        ACTOR,
      ),
    );
    // A second lump of 9 000: 6 000 completes October, 3 000 starts November.
    await inTenant(() =>
      collection.payGlobal(
        {
          guardianId,
          academicYearId: yearId,
          tender: [{ paymentMethodId: cashId, amount: '9000.00' }],
        },
        ACTOR,
      ),
    );

    const paid = await paymentsOf(studentIds[0]!);
    const october = paid.filter((p) => p.month === 10).reduce((n, p) => n + Number(p.amount), 0);
    const november = paid.filter((p) => p.month === 11).reduce((n, p) => n + Number(p.amount), 0);
    expect(october.toFixed(2)).toBe('10000.00');
    expect(november.toFixed(2)).toBe('3000.00');
  });

  it('spreads across the children of the family, not just the first', async () => {
    const { guardianId, studentIds } = await family('fratrie', 2);

    // Enough for every elapsed month of the elder plus some of the younger.
    await inTenant(() =>
      collection.payGlobal(
        {
          guardianId,
          academicYearId: yearId,
          tender: [{ paymentMethodId: cashId, amount: '95000.00' }],
        },
        ACTOR,
      ),
    );

    const first = await paymentsOf(studentIds[0]!);
    const second = await paymentsOf(studentIds[1]!);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
  });
});

describe('the advance', () => {
  it('⚠ runs forward into the rest of the year once the debt is clear', async () => {
    const { guardianId, studentIds } = await family('avance');

    // The whole year at once: nine months × 10 000.
    const result = await inTenant(() =>
      collection.payGlobal(
        {
          guardianId,
          academicYearId: yearId,
          tender: [{ paymentMethodId: cashId, amount: '90000.00' }],
        },
        ACTOR,
      ),
    );

    expect(result.allocated).toBe('90000.00');
    const paid = await paymentsOf(studentIds[0]!);
    const total = paid.reduce((n, p) => n + Number(p.amount), 0);
    expect(total.toFixed(2)).toBe('90000.00');
    // Every month of the year has something on it.
    expect(new Set(paid.map((p) => `${p.year}-${p.month}`)).size).toBe(9);
  });

  it('⚠ stays inside the year being paid for', async () => {
    // El Ourwa's own fix, in its words: without the year filter an overpayment
    // "pouvait donc etre impute a un mois d'une annee cloturee, ou d'une annee
    // ou l'eleve n'est pas inscrit."
    const { guardianId, studentIds } = await family('annee');
    await inTenant(() =>
      collection.payGlobal(
        {
          guardianId,
          academicYearId: yearId,
          tender: [{ paymentMethodId: cashId, amount: '90000.00' }],
        },
        ACTOR,
      ),
    );

    const paid = await paymentsOf(studentIds[0]!);
    for (const p of paid) {
      const withinYear =
        (p.year === START_YEAR && p.month >= 10) ||
        (p.year === START_YEAR + 1 && p.month <= 6);
      expect(withinYear, `${p.year}-${p.month} is outside the school year`).toBe(true);
    }
  });
});

describe('who it skips', () => {
  it('⚠ puts nothing on a child whose schooling is free', async () => {
    const { guardianId, studentIds } = await family('gratuit', 1, true);
    await expect(
      inTenant(() =>
        collection.payGlobal(
          {
            guardianId,
            academicYearId: yearId,
            tender: [{ paymentMethodId: cashId, amount: '5000.00' }],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/rien|aucun/i);

    expect(await paymentsOf(studentIds[0]!)).toHaveLength(0);
  });

  it('⚠ puts nothing on a child exempted outright', async () => {
    const { guardianId, studentIds } = await family('exempte', 2);
    await owner.query(
      `INSERT INTO exemptions (school_id, student_id, kind, reason, granted_by)
       VALUES ($1, $2, 'full', 'Boursier', $3)`,
      [schoolId, studentIds[0]!, ACTOR],
    );

    await inTenant(() =>
      collection.payGlobal(
        {
          guardianId,
          academicYearId: yearId,
          tender: [{ paymentMethodId: cashId, amount: '20000.00' }],
        },
        ACTOR,
      ),
    );

    expect(await paymentsOf(studentIds[0]!)).toHaveLength(0);
    expect((await paymentsOf(studentIds[1]!)).length).toBeGreaterThan(0);
  });

  it('skips a month that was exempted on its own', async () => {
    const { guardianId, studentIds } = await family('moisexempt');
    await owner.query(
      `INSERT INTO exemptions
         (school_id, student_id, kind, calendar_month, calendar_year, reason, granted_by)
       VALUES ($1, $2, 'monthly', 10, $3, 'Ramadan', $4)`,
      [schoolId, studentIds[0]!, START_YEAR, ACTOR],
    );

    await inTenant(() =>
      collection.payGlobal(
        {
          guardianId,
          academicYearId: yearId,
          tender: [{ paymentMethodId: cashId, amount: '10000.00' }],
        },
        ACTOR,
      ),
    );

    const paid = await paymentsOf(studentIds[0]!);
    expect(paid.some((p) => p.month === 10 && p.year === START_YEAR)).toBe(false);
    // It went to November instead.
    expect(paid[0]!.month).toBe(11);
  });
});

describe('the money is never lost', () => {
  it('⚠ refuses more than the family could possibly owe this year', async () => {
    // El Ourwa stops allocating when it runs out of months and the remainder is
    // simply never written — the family paid more than the school recorded.
    // Refusing names the figure instead. See docs/DECISIONS.md.
    const { guardianId } = await family('trop');
    await expect(
      inTenant(() =>
        collection.payGlobal(
          {
            guardianId,
            academicYearId: yearId,
            tender: [{ paymentMethodId: cashId, amount: '200000.00' }],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/90 000|dépasse/i);
  });

  it('⚠ the tender lines sum to what was allocated, across every month', async () => {
    const { guardianId } = await family('moyens');
    const result = await inTenant(() =>
      collection.payGlobal(
        {
          guardianId,
          academicYearId: yearId,
          tender: [
            { paymentMethodId: cashId, amount: '12000.00' },
            { paymentMethodId: bankilyId, amount: '13000.00' },
          ],
        },
        ACTOR,
      ),
    );

    const { rows } = await owner.query<{ total: string }>(
      `SELECT COALESCE(SUM(tl.amount), 0)::text AS total
         FROM tender_lines tl
        WHERE tl.source_id = ANY($1::uuid[])`,
      [result.paymentIds],
    );
    expect(rows[0]!.total).toBe('25000.00');
    expect(result.allocated).toBe('25000.00');
  });

  it('leaves the family owing exactly what was paid off', async () => {
    const { guardianId } = await family('dette');
    const before = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));

    await inTenant(() =>
      collection.payGlobal(
        {
          guardianId,
          academicYearId: yearId,
          tender: [{ paymentMethodId: cashId, amount: '30000.00' }],
        },
        ACTOR,
      ),
    );

    const after = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    expect((Number(before.total) - Number(after.total)).toFixed(2)).toBe('30000.00');
  });
});
