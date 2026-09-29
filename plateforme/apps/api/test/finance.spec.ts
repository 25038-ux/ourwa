import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PaymentsService } from '../src/finance/payments.service.js';
import { DebtService } from '../src/finance/debt.service.js';
import { FeesService } from '../src/finance/fees.service.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/** Phase 4 — money. Test-first territory; standing rules 5 to 10. */

let owner: pg.Pool;
let payments: PaymentsService;
let debts: DebtService;
let fees: FeesService;
let enrollments: EnrollmentService;
let reports: ReportsService;

let schoolId: string;
let yearId: string;
let groupId: string;
let guardianId: string;
let studentId: string;
let cashId: string;
let bankilyId: string;

let ACTOR: string;
const DIRECTION = ['scolarite.niveaux'];
const START_YEAR = 2020; // safely in the past, so every month has elapsed

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'fin' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('fin', 'Finance', 'FIN')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const year = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2020-2021', $2, 'active') RETURNING id`,
    [schoolId, START_YEAR],
  );
  yearId = year.rows[0]!.id;

  const level = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle) VALUES ($1, '6eme', 10000, 'college')
     RETURNING id`,
    [schoolId],
  );
  const group = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6eme A') RETURNING id`,
    [schoolId, level.rows[0]!.id],
  );
  groupId = group.rows[0]!.id;

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('fin.cashier@test', 'x', 'Cashier') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const guardian = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('fin.parent@test', 'x', 'Fin Parent') RETURNING id`,
  );
  guardianId = guardian.rows[0]!.id;

  const student = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, 'RIM-F', 'NID-F', 'Fin', 'Child') RETURNING id`,
    [schoolId, guardianId],
  );
  studentId = student.rows[0]!.id;

  const methods = await owner.query<{ id: string; name: string }>(
    `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Especes'), ($1, 'Bankily')
     RETURNING id, name`,
    [schoolId],
  );
  cashId = methods.rows.find((r) => r.name === 'Especes')!.id;
  bankilyId = methods.rows.find((r) => r.name === 'Bankily')!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  payments = moduleRef.get(PaymentsService);
  debts = moduleRef.get(DebtService);
  fees = moduleRef.get(FeesService);
  enrollments = moduleRef.get(EnrollmentService);
  reports = moduleRef.get(ReportsService);

  await inTenant(() =>
    enrollments.enrol(
      { studentId, academicYearId: yearId, groupId, entryDate: `${START_YEAR}-10-01` },
      ACTOR,
      DIRECTION,
    ),
  );
});

afterAll(async () => {
  await owner?.end();
});

describe('receipt numbering', () => {
  it('formats as PREFIX-YEAR-NNNNN and starts at 1', async () => {
    const result = await inTenant(() =>
      payments.record(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 10,
          calendarYear: START_YEAR,
          amount: '10000.00',
          tender: [{ paymentMethodId: cashId, amount: '10000.00' }],
        },
        ACTOR,
      ),
    );
    expect(result.receiptNumber).toBe(`FIN-${START_YEAR}-00001`);
  });

  it('⚠ never issues the same number twice under concurrency', async () => {
    // The bug this guards: MAX(number)+1 lets two simultaneous collections read
    // the same maximum and hand two families the same receipt.
    const students = await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        const { rows } = await owner.query<{ id: string }>(
          `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
           VALUES ($1, $2, $3, $4, 'Conc', 'Urrent') RETURNING id`,
          [schoolId, guardianId, `RIM-C${i}`, `NID-C${i}`],
        );
        await inTenant(() =>
          enrollments.enrol(
            { studentId: rows[0]!.id, academicYearId: yearId, groupId },
            ACTOR,
            DIRECTION,
          ),
        );
        return rows[0]!.id;
      }),
    );

    const results = await Promise.all(
      students.map((id) =>
        inTenant(() =>
          payments.record(
            {
              studentId: id,
              academicYearId: yearId,
              calendarMonth: 11,
              calendarYear: START_YEAR,
              amount: '10000.00',
              tender: [{ paymentMethodId: cashId, amount: '10000.00' }],
            },
            ACTOR,
          ),
        ),
      ),
    );

    const numbers = results.map((r) => r.receiptNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe('tender lines must reconcile', () => {
  it('accepts a split that sums exactly', async () => {
    const result = await inTenant(() =>
      payments.record(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 12,
          calendarYear: START_YEAR,
          amount: '10000.00',
          tender: [
            { paymentMethodId: cashId, amount: '6000.00' },
            { paymentMethodId: bankilyId, amount: '4000.00' },
          ],
        },
        ACTOR,
      ),
    );
    expect(result.amount).toBe('10000.00');
  });

  it('refuses a split that is short by one cent', async () => {
    await expect(
      inTenant(() =>
        payments.record(
          {
            studentId,
            academicYearId: yearId,
            calendarMonth: 1,
            calendarYear: START_YEAR + 1,
            amount: '10000.00',
            tender: [{ paymentMethodId: cashId, amount: '9999.99' }],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/correspondre.*exactement/is);
  });

  it('refuses a payment with no tender lines at all', async () => {
    await expect(
      inTenant(() =>
        payments.record(
          {
            studentId,
            academicYearId: yearId,
            calendarMonth: 2,
            calendarYear: START_YEAR + 1,
            amount: '100.00',
            tender: [],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/au moins un moyen de paiement/i);
  });

  it('reports a clean till', async () => {
    const check = await inTenant(() => payments.tillConsistency());
    expect(check.mismatched).toBe(0);
    expect(check.gap).toBe('0.00');
  });
});

describe('financial records are append-only', () => {
  it('reverses with a negated entry and leaves the original untouched', async () => {
    const original = await inTenant(() =>
      payments.record(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 3,
          calendarYear: START_YEAR + 1,
          amount: '10000.00',
          tender: [{ paymentMethodId: cashId, amount: '10000.00' }],
        },
        ACTOR,
      ),
    );

    const reversal = await inTenant(() =>
      payments.reverse(original.id, 'Recorded against the wrong child', ACTOR),
    );
    expect(reversal.amount).toBe('-10000.00');

    const { rows } = await owner.query<{ amount: string }>(
      'SELECT amount FROM payments WHERE id = $1',
      [original.id],
    );
    // The original still says what it always said.
    expect(rows[0]!.amount).toBe('10000.00');

    // And the month nets to zero.
    const net = await inTenant(() => payments.paidForMonth(studentId, 3, START_YEAR + 1));
    expect(net.toString()).toBe('0');
  });

  it('refuses to reverse the same payment twice', async () => {
    const { rows } = await owner.query<{ id: string }>(
      'SELECT id FROM payments WHERE calendar_month = 3 AND reverses_id IS NULL LIMIT 1',
    );
    await expect(
      inTenant(() => payments.reverse(rows[0]!.id, 'again', ACTOR)),
    ).rejects.toThrow(/déjà été annulé/i);
  });
});

describe('three-level fee resolution', () => {
  it('falls back to zero when nothing is configured', async () => {
    expect((await inTenant(() => fees.resolveScale('enrolment', START_YEAR))).toString()).toBe('0');
  });

  it('uses the global default when no per-year key exists', async () => {
    await owner.query(
      `INSERT INTO configuration (school_id, key, value) VALUES ($1, 'frais_inscription', '3000')`,
      [schoolId],
    );
    expect((await inTenant(() => fees.resolveScale('enrolment', START_YEAR))).toString()).toBe('3000');
  });

  it('prefers the per-year key over the global default', async () => {
    await owner.query(
      `INSERT INTO configuration (school_id, key, value)
       VALUES ($1, $2, '5000')`,
      [schoolId, `frais_inscription_${START_YEAR}`],
    );
    expect((await inTenant(() => fees.resolveScale('enrolment', START_YEAR))).toString()).toBe('5000');
    // A different year still sees the global default.
    expect((await inTenant(() => fees.resolveScale('enrolment', 1999))).toString()).toBe('3000');
  });

  it('charges an annual fee once per FAMILY, not once per child', async () => {
    const before = await inTenant(() => fees.annualFeesDue(guardianId, yearId, START_YEAR));
    expect(before.find((f) => f.kind === 'enrolment')!.remaining.toString()).toBe('5000');

    await owner.query(
      `INSERT INTO family_fee_payments
         (school_id, guardian_id, academic_year_id, kind, amount, receipt_number)
       VALUES ($1, $2, $3, 'enrolment', 5000, 'FIN-ANNUAL-1')`,
      [schoolId, guardianId, yearId],
    );

    const after = await inTenant(() => fees.annualFeesDue(guardianId, yearId, START_YEAR));
    // The elder sibling paid; a second child must not be charged again.
    expect(after.find((f) => f.kind === 'enrolment')!.remaining.toString()).toBe('0');
  });
});

describe('the debt rule', () => {
  it('counts an elapsed unpaid month', async () => {
    const debt = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    expect(Number(debt.total)).toBeGreaterThan(0);
    expect(debt.tuition.length).toBeGreaterThan(0);
  });

  it('does not count a month that has already been settled', async () => {
    const debt = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    // Scoped to THIS child: the guardian also has the 20 children created by the
    // concurrency test, and their Octobers are genuinely unpaid.
    expect(
      debt.tuition.find((l) => l.studentId === studentId && l.calendarMonth === 10),
    ).toBeUndefined();
    // And the settled month really was billable to begin with, so this is not
    // passing merely because nothing was ever owed.
    expect(debt.tuition.some((l) => l.calendarMonth === 10)).toBe(true);
  });

  it('does not count a month that has not happened yet', async () => {
    const future = await owner.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, label, start_year, status)
       VALUES ($1, '2099-2100', 2099, 'active') RETURNING id`,
      [schoolId],
    );
    await owner.query("UPDATE academic_years SET status = 'active' WHERE id = $1", [yearId]);

    const student = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, 'RIM-FUT', 'NID-FUT', 'Future', 'Child') RETURNING id`,
      [schoolId, guardianId],
    );
    await owner.query(
      `INSERT INTO enrollments
         (school_id, student_id, academic_year_id, group_id, status, monthly_fee)
       VALUES ($1, $2, $3, $4, 'enrolled', 10000)`,
      [schoolId, student.rows[0]!.id, future.rows[0]!.id, groupId],
    );
    await owner.query(
      `INSERT INTO enrollment_months
         (school_id, enrollment_id, month_order, calendar_month, calendar_year, status, amount_due)
       SELECT $1, e.id, 1, 10, 2099, 'billable', 10000 FROM enrollments e
        WHERE e.academic_year_id = $2`,
      [schoolId, future.rows[0]!.id],
    );

    const debt = await inTenant(() =>
      debts.forGuardian(guardianId, future.rows[0]!.id, 2099),
    );
    // No tuition month is owed: October 2099 has not happened.
    expect(debt.tuition).toEqual([]);
    // The annual enrolment fee IS still due — it falls due when the family
    // enrols, not when the months elapse. That is deliberate, and it is why
    // this asserts on `tuition` rather than on the total.
    expect(Number(debt.total)).toBe(Number(debt.annualFees[0]?.outstanding ?? 0));
  });

  it('excludes an exempted month', async () => {
    const before = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    const target = before.tuition[0]!;

    await owner.query(
      `INSERT INTO exemptions
         (school_id, student_id, kind, calendar_month, calendar_year, reason)
       VALUES ($1, $2, 'monthly', $3, $4, 'hardship')`,
      [schoolId, target.studentId, target.calendarMonth, target.calendarYear],
    );

    const after = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    expect(
      after.tuition.find(
        (l) =>
          l.studentId === target.studentId &&
          l.calendarMonth === target.calendarMonth &&
          l.calendarYear === target.calendarYear,
      ),
    ).toBeUndefined();
    expect(Number(after.total)).toBeLessThan(Number(before.total));
  });

  it('reduces a month by its discount rather than claiming the full rate', async () => {
    const before = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    const target = before.tuition[0]!;

    await owner.query(
      `INSERT INTO discounts
         (school_id, student_id, calendar_month, calendar_year, amount, reason)
       VALUES ($1, $2, $3, $4, 2500, 'sibling')`,
      [schoolId, target.studentId, target.calendarMonth, target.calendarYear],
    );

    const after = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    const line = after.tuition.find(
      (l) =>
        l.studentId === target.studentId &&
        l.calendarMonth === target.calendarMonth &&
        l.calendarYear === target.calendarYear,
    )!;
    expect(line.due).toBe('7500.00');
  });

  it('a total write-off brings the debt to exactly zero', async () => {
    const before = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    expect(Number(before.total)).toBeGreaterThan(0);

    const writeOff = await owner.query<{ id: string }>(
      `INSERT INTO debt_write_offs
         (school_id, guardian_id, academic_year_id, clears_all, reason)
       VALUES ($1, $2, $3, true, 'direction decision') RETURNING id`,
      [schoolId, guardianId, yearId],
    );

    const after = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    expect(after.total).toBe('0.00');
    expect(after.writtenOff).toBe(before.total);

    // Revoking restores exactly what was there before — nothing is lost.
    await owner.query('UPDATE debt_write_offs SET revoked_at = now() WHERE id = $1', [
      writeOff.rows[0]!.id,
    ]);
    const restored = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    expect(restored.total).toBe(before.total);
  });
});

describe('the tender split, by month', () => {
  /**
   * The bug this covers: a month filter hung off a LEFT JOIN removes no ledger
   * row, so every line ever recorded lands in whichever month you happen to ask
   * about. It reads as a plausible report and is wrong by the whole history of
   * the school.
   */
  it('counts only the lines whose payment moved in that month', async () => {
    const paid = await inTenant(() =>
      payments.record(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 11,
          calendarYear: START_YEAR,
          amount: '1000.00',
          tender: [
            { paymentMethodId: cashId, amount: '600.00' },
            { paymentMethodId: bankilyId, amount: '400.00' },
          ],
        },
        ACTOR,
      ),
    );

    // Placed in a month of its own, far from every other fixture here.
    //
    // Both tables, because since 0014 the report reads the LEDGER's date — as
    // El Ourwa's does, filtering on `paiement_lignes.date_creation`. Moving the
    // receipt without its lines is not something the application can do; only a
    // test reaching into the database can, and it should not pretend otherwise.
    await owner.query(
      `UPDATE payments SET paid_at = '2019-02-10T09:00:00Z'::timestamptz WHERE id = $1`,
      [paid.id],
    );
    await owner.query(
      `UPDATE tender_lines SET created_at = '2019-02-10T09:00:00Z'::timestamptz
        WHERE source_type = 'paiement' AND source_id = $1`,
      [paid.id],
    );

    const february = await inTenant(() => reports.byPaymentMethod(2, 2019));
    const total = february.reduce((n, r) => n + Number(r.total), 0);
    expect(total).toBe(1000);
    expect(february).toHaveLength(2);

    // And a month with no movement reports every means at zero — his LEFT
    // JOIN lists all of them — never the year's figures.
    const march = await inTenant(() => reports.byPaymentMethod(3, 2019));
    expect(march.every((r) => r.entrant === '0.00' && r.sortant === '0.00')).toBe(true);
  });
});

/**
 * LES FRAIS ANNUELS — the block on `gestion_caisse.php` that could be read but
 * never changed.
 *
 * ⚠ THREE OF ITS FOUR ACTIONS DID NOT EXIST. `configurer_frais_annuels`,
 * `exempter_frais_annuel` and `retirer_exemption_frais_annuel` had no endpoint,
 * so a school could see that a family owed 5 000 MRU of enrolment fee and had no
 * way to waive it, and no way to set the year's amount without a migration.
 *
 * Money, so the tests come first.
 */
describe('les frais annuels — exempter et configurer', () => {
  let famille: string;

  beforeAll(async () => {
    const g = await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('fin.annual@test', 'x', 'Famille Annuelle') RETURNING id`,
    );
    famille = g.rows[0]!.id;
  });

  it('waives a fee for one family and one year only', async () => {
    const before = await inTenant(() => fees.annualFeesDue(famille, yearId, START_YEAR));
    expect(before.find((f) => f.kind === 'photocopy')!.exempt).toBe(false);

    await inTenant(() => fees.exempt(famille, 'photocopy', yearId, ACTOR));

    const after = await inTenant(() => fees.annualFeesDue(famille, yearId, START_YEAR));
    const photocopy = after.find((f) => f.kind === 'photocopy')!;
    expect(photocopy.exempt).toBe(true);
    // ⚠ Exempt means nothing is owed — not that the scale became zero. The
    // amount stays visible so the office can see what was waived.
    expect(photocopy.remaining.toString()).toBe('0');

    // The other fee is untouched: they are waived one at a time.
    expect(after.find((f) => f.kind === 'enrolment')!.exempt).toBe(false);
  });

  it('is idempotent — waiving twice is not an error, and not two rows', async () => {
    await inTenant(() => fees.exempt(famille, 'photocopy', yearId, ACTOR));
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM family_fee_exemptions
        WHERE guardian_id = $1 AND kind = 'photocopy'`,
      [famille],
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('takes the waiver back, and the fee is owed again', async () => {
    await inTenant(() => fees.removeExemption(famille, 'photocopy', yearId, ACTOR));
    const after = await inTenant(() => fees.annualFeesDue(famille, yearId, START_YEAR));
    const photocopy = after.find((f) => f.kind === 'photocopy')!;
    expect(photocopy.exempt).toBe(false);
    expect(photocopy.remaining.toString()).toBe(photocopy.scale.toString());
  });

  it('sets a year’s amount as an exact decimal, and only that year’s', async () => {
    await inTenant(() => fees.setScale('photocopy', START_YEAR, '1500.50', ACTOR));
    expect(
      (await inTenant(() => fees.resolveScale('photocopy', START_YEAR))).toString(),
    ).toBe('1500.5');
    // ⚠ A different year is untouched: the scale is per year precisely so that
    // raising this year's fee does not rewrite what last year's families owed.
    expect((await inTenant(() => fees.resolveScale('photocopy', 1999))).toString()).toBe('0');
  });

  it('⚠ refuses a negative amount', async () => {
    await expect(
      inTenant(() => fees.setScale('photocopy', START_YEAR, '-100', ACTOR)),
    ).rejects.toThrow(/positif/i);
  });

  it('lists what the family has paid, with its receipt number', async () => {
    await owner.query(
      `INSERT INTO family_fee_payments
         (school_id, guardian_id, academic_year_id, kind, amount, receipt_number)
       VALUES ($1, $2, $3, 'enrolment', 2500, 'FIN-ANNUAL-9')`,
      [schoolId, famille, yearId],
    );
    const history = await inTenant(() => fees.paymentsFor(famille, yearId));
    expect(history).toHaveLength(1);
    expect(history[0]!.receipt_number).toBe('FIN-ANNUAL-9');
    // Money crosses the wire as a string, never a float.
    expect(history[0]!.amount).toBe('2500.00');
  });
});
