import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { CollectionService } from '../src/finance/collection.service.js';
import { FeesService } from '../src/finance/fees.service.js';
import { DebtService } from '../src/finance/debt.service.js';
import { PaymentsService } from '../src/finance/payments.service.js';
import { money } from '@elourwa/shared';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * THE COLLECTION WINDOW — `includes/encaissement_inscription.php`.
 *
 * Written before the service, because it is money (standing rule 15).
 *
 * The window takes ONE total from the operator and settles THREE debts of
 * different natures with it: the first month of tuition, the enrolment fee and
 * the photocopy fee. El Ourwa's comment says exactly what went wrong before it
 * split them — everything was imputed to the tuition month, "ce qui gonflait le
 * mois d'un montant qui ne lui revenait pas": the month was inflated by money
 * that did not belong to it.
 *
 * Its order is fixed and is the thing to protect: THE ANNEXE FEES FIRST, THE
 * REMAINDER TO THE MONTH.
 */

let owner: pg.Pool;
let collection: CollectionService;
let fees: FeesService;
let debts: DebtService;
let payments: PaymentsService;
let enrollments: EnrollmentService;

let schoolId: string;
let yearId: string;
let closedYearId: string;
let groupId: string;
let cashId: string;
let ACTOR: string;

const DIRECTION = ['scolarite.niveaux'];
const START_YEAR = 2019; // in the past; every month has elapsed
const MONTHLY = '10000.00';

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'enc' }, fn);
}

/** A fresh family with one enrolled child, so no test inherits another's debt. */
async function family(tag: string): Promise<{ guardianId: string; studentId: string }> {
  const guardian = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ($1, 'x', $2) RETURNING id`,
    [`enc.${tag}@test`, `Parent ${tag}`],
  );
  const guardianId = guardian.rows[0]!.id;

  const student = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5, 'Enc') RETURNING id`,
    [schoolId, guardianId, `RIM-${tag}`, `NID-${tag}`, tag],
  );
  const studentId = student.rows[0]!.id;

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
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('enc', 'Encaissement', 'ENC')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const years = await owner.query<{ id: string; status: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2019-2020', $2, 'active'), ($1, '2017-2018', $3, 'closed')
     RETURNING id, status`,
    [schoolId, START_YEAR, START_YEAR - 2],
  );
  yearId = years.rows.find((r) => r.status === 'active')!.id;
  closedYearId = years.rows.find((r) => r.status === 'closed')!.id;

  const level = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle)
     VALUES ($1, '5eme', $2, 'college') RETURNING id`,
    [schoolId, MONTHLY],
  );
  const group = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '5eme A') RETURNING id`,
    [schoolId, level.rows[0]!.id],
  );
  groupId = group.rows[0]!.id;

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('enc.cashier@test', 'x', 'Caissier') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const method = await owner.query<{ id: string }>(
    `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Especes') RETURNING id`,
    [schoolId],
  );
  cashId = method.rows[0]!.id;

  // The two annexe scales for this year, as El Ourwa keys them.
  await owner.query(
    `INSERT INTO configuration (school_id, key, value) VALUES
       ($1, $2, '5000'), ($1, $3, '2000')`,
    [schoolId, `frais_inscription_${START_YEAR}`, `frais_photocopie_${START_YEAR}`],
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  collection = moduleRef.get(CollectionService);
  fees = moduleRef.get(FeesService);
  debts = moduleRef.get(DebtService);
  payments = moduleRef.get(PaymentsService);
  enrollments = moduleRef.get(EnrollmentService);
});

afterAll(async () => {
  await owner?.end();
});

describe('the window quotes what is due', () => {
  it('offers the month plus both annexe fees, and totals them', async () => {
    const { studentId } = await family('quote');
    const quote = await inTenant(() => collection.quote(studentId, yearId));

    expect(quote.monthly).toBe('10000.00');
    expect(quote.fees.map((f) => f.kind)).toEqual(['enrolment', 'photocopy']);
    expect(quote.fees.map((f) => f.remaining)).toEqual(['5000.00', '2000.00']);
    // "Total attendu" — what the window shows before the operator changes it.
    expect(quote.expected).toBe('17000.00');
  });

  it('carries the civil year on every payable month', async () => {
    // ⚠ "Janvier" alone does not say whether it is January of the closed year
    // or of this one. Its <option value> is "YYYY-M" for that reason.
    const { studentId } = await family('months');
    const quote = await inTenant(() => collection.quote(studentId, yearId));

    const january = quote.months.find((m) => m.month === 1);
    expect(january).toBeDefined();
    expect(january!.year).toBe(START_YEAR + 1); // January falls in the SECOND civil year
    expect(quote.months[0]!.year).toBe(START_YEAR);
    expect(quote.months.every((m) => m.value === `${m.year}-${m.month}`)).toBe(true);
  });
});

describe('the split', () => {
  it('⚠ pays the annexe fees FIRST and gives the remainder to the month', async () => {
    const { guardianId, studentId } = await family('split');

    const result = await inTenant(() =>
      collection.collect(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 10,
          calendarYear: START_YEAR,
          fees: { enrolment: '5000.00', photocopy: '2000.00' },
          tender: [{ paymentMethodId: cashId, amount: '17000.00' }],
        },
        ACTOR,
      ),
    );

    expect(result.tuition).toBe('10000.00');
    expect(result.feesPaid).toEqual([
      { kind: 'enrolment', amount: '5000.00' },
      { kind: 'photocopy', amount: '2000.00' },
    ]);

    // The month carries its own 10 000 and not a cent of the other 7 000.
    const { rows } = await owner.query<{ amount: string }>(
      `SELECT amount::text FROM payments
        WHERE student_id = $1 AND calendar_month = 10 AND calendar_year = $2`,
      [studentId, START_YEAR],
    );
    expect(rows.map((r) => r.amount)).toEqual(['10000.00']);

    const due = await inTenant(() => fees.annualFeesDue(guardianId, yearId, START_YEAR));
    expect(due.map((f) => f.remaining.toFixed(2))).toEqual(['0.00', '0.00']);
  });

  it('lets the operator part-pay an annexe and carry the rest into the debt', async () => {
    // "Laissez à 0 pour le reporter en dette." — the fee does not vanish.
    const { guardianId, studentId } = await family('partial');

    const result = await inTenant(() =>
      collection.collect(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 10,
          calendarYear: START_YEAR,
          fees: { enrolment: '2000.00', photocopy: '0' },
          tender: [{ paymentMethodId: cashId, amount: '12000.00' }],
        },
        ACTOR,
      ),
    );

    expect(result.tuition).toBe('10000.00');
    expect(result.feesPaid).toEqual([{ kind: 'enrolment', amount: '2000.00' }]);

    const due = await inTenant(() => fees.annualFeesDue(guardianId, yearId, START_YEAR));
    expect(due.map((f) => f.remaining.toFixed(2))).toEqual(['3000.00', '2000.00']);
  });

  it('settles annexes alone when nothing is put against the month', async () => {
    const { studentId } = await family('feesonly');

    const result = await inTenant(() =>
      collection.collect(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 10,
          calendarYear: START_YEAR,
          fees: { enrolment: '5000.00', photocopy: '2000.00' },
          tender: [{ paymentMethodId: cashId, amount: '7000.00' }],
        },
        ACTOR,
      ),
    );

    expect(result.tuition).toBe('0.00');
    // No tuition row at all, rather than one for zero: a receipt for nothing.
    const { rows } = await owner.query(
      `SELECT 1 FROM payments WHERE student_id = $1 AND calendar_month = 10`,
      [studentId],
    );
    expect(rows).toHaveLength(0);
  });
});

describe('what it refuses', () => {
  it('⚠ never collects beyond an annexe fee’s remainder', async () => {
    // Beyond it the money has no debt to settle and becomes a phantom credit.
    const { guardianId, studentId } = await family('overpay');

    const result = await inTenant(() =>
      collection.collect(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 10,
          calendarYear: START_YEAR,
          fees: { enrolment: '9999.00', photocopy: '0' }, // scale is 5 000
          tender: [{ paymentMethodId: cashId, amount: '5000.00' }],
        },
        ACTOR,
      ),
    );

    expect(result.feesPaid).toEqual([{ kind: 'enrolment', amount: '5000.00' }]);
    const due = await inTenant(() => fees.annualFeesDue(guardianId, yearId, START_YEAR));
    expect(due[0]!.paid.toFixed(2)).toBe('5000.00'); // capped, not 9 999
  });

  it('refuses a total below the annexe fees asked for, naming both figures', async () => {
    const { studentId } = await family('short');

    await expect(
      inTenant(() =>
        collection.collect(
          {
            studentId,
            academicYearId: yearId,
            calendarMonth: 10,
            calendarYear: START_YEAR,
            fees: { enrolment: '5000.00', photocopy: '2000.00' },
            tender: [{ paymentMethodId: cashId, amount: '3000.00' }],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/3\s?000.*7\s?000|7\s?000/);
  });

  it('refuses when more than the month is imputed to the month', async () => {
    const { studentId } = await family('excess');

    await expect(
      inTenant(() =>
        collection.collect(
          {
            studentId,
            academicYearId: yearId,
            calendarMonth: 10,
            calendarYear: START_YEAR,
            fees: {},
            tender: [{ paymentMethodId: cashId, amount: '15000.00' }], // month is 10 000
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/scolarit|month/i);
  });

  it('refuses a month outside the year being collected for', async () => {
    // The period is validated against the year's own payable months, server
    // side. A form that posts "2050-7" does not get to invent a school month.
    const { studentId } = await family('outside');

    await expect(
      inTenant(() =>
        collection.collect(
          {
            studentId,
            academicYearId: yearId,
            calendarMonth: 7,
            calendarYear: 2050,
            fees: {},
            tender: [{ paymentMethodId: cashId, amount: '10000.00' }],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow();
  });

  it('refuses a closed year outright', async () => {
    const { studentId } = await family('closed');

    await expect(
      inTenant(() =>
        collection.collect(
          {
            studentId,
            academicYearId: closedYearId,
            calendarMonth: 10,
            calendarYear: START_YEAR - 2,
            fees: {},
            tender: [{ paymentMethodId: cashId, amount: '10000.00' }],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow();
  });

  it('refuses tender lines that do not sum to the money taken', async () => {
    const { studentId } = await family('tender');

    await expect(
      inTenant(() =>
        collection.collect(
          {
            studentId,
            academicYearId: yearId,
            calendarMonth: 10,
            calendarYear: START_YEAR,
            fees: {},
            tender: [], // nothing says how the money arrived
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('once per family, not once per child', () => {
  it('⚠ charges a second child nothing when the elder already settled the fees', async () => {
    const { guardianId, studentId } = await family('elder');

    await inTenant(() =>
      collection.collect(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 10,
          calendarYear: START_YEAR,
          fees: { enrolment: '5000.00', photocopy: '2000.00' },
          tender: [{ paymentMethodId: cashId, amount: '17000.00' }],
        },
        ACTOR,
      ),
    );

    // The younger sibling, same guardian.
    const younger = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, 'RIM-younger', 'NID-younger', 'Cadet', 'Enc') RETURNING id`,
      [schoolId, guardianId],
    );
    const youngerId = younger.rows[0]!.id;
    await inTenant(() =>
      enrollments.enrol(
        { studentId: youngerId, academicYearId: yearId, groupId, entryDate: `${START_YEAR}-10-01` },
        ACTOR,
        DIRECTION,
      ),
    );

    const quote = await inTenant(() => collection.quote(youngerId, yearId));
    expect(quote.fees.map((f) => f.remaining)).toEqual(['0.00', '0.00']);
    // The window asks for the month alone — not the fees a second time.
    expect(quote.expected).toBe('10000.00');
    expect(quote.fees.every((f) => f.settled)).toBe(true);
  });

  it('asks nothing of an exempted family and says so', async () => {
    const { guardianId, studentId } = await family('exempt');
    await owner.query(
      `INSERT INTO family_fee_exemptions (school_id, guardian_id, kind, granted_by)
       VALUES ($1, $2, 'photocopy', $3)`,
      [schoolId, guardianId, ACTOR],
    );

    const quote = await inTenant(() => collection.quote(studentId, yearId));
    const photocopy = quote.fees.find((f) => f.kind === 'photocopy')!;
    expect(photocopy.remaining).toBe('0.00');
    expect(photocopy.exempt).toBe(true);
    expect(quote.expected).toBe('15000.00'); // month + enrolment only
  });
});

describe('the ledger it leaves', () => {
  it('records how the money arrived for the annexe fees too, not only tuition', async () => {
    // Before the tender ledger, a fee paid by Bankily was indistinguishable
    // from one paid in cash, and the till never balanced.
    const { studentId } = await family('ledger');

    const result = await inTenant(() =>
      collection.collect(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 10,
          calendarYear: START_YEAR,
          fees: { enrolment: '5000.00', photocopy: '0' },
          tender: [{ paymentMethodId: cashId, amount: '15000.00' }],
        },
        ACTOR,
      ),
    );

    const { rows } = await owner.query<{ source_type: string; amount: string }>(
      `SELECT source_type, SUM(amount)::text AS amount FROM tender_lines
        WHERE source_id = ANY($1::uuid[]) GROUP BY source_type ORDER BY source_type`,
      [[result.paymentId, ...result.feePaymentIds].filter(Boolean)],
    );
    expect(rows).toEqual([
      { source_type: 'frais_annuel', amount: '5000.00' },
      { source_type: 'paiement', amount: '10000.00' },
    ]);
  });

  it('gives each annexe fee its own receipt number', async () => {
    const { studentId } = await family('receipts');

    const result = await inTenant(() =>
      collection.collect(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 10,
          calendarYear: START_YEAR,
          fees: { enrolment: '5000.00', photocopy: '2000.00' },
          tender: [{ paymentMethodId: cashId, amount: '17000.00' }],
        },
        ACTOR,
      ),
    );

    expect(result.receiptNumber).toMatch(/^ENC-2019-\d{5}$/);
    const { rows } = await owner.query<{ receipt_number: string }>(
      `SELECT receipt_number FROM family_fee_payments WHERE id = ANY($1::uuid[])`,
      [result.feePaymentIds],
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.receipt_number)).size).toBe(2);
  });

  it('leaves the family owing less by exactly what was taken', async () => {
    const { guardianId, studentId } = await family('debt');

    const before = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    const result = await inTenant(() =>
      collection.collect(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 10,
          calendarYear: START_YEAR,
          fees: { enrolment: '5000.00', photocopy: '2000.00' },
          tender: [{ paymentMethodId: cashId, amount: '17000.00' }],
        },
        ACTOR,
      ),
    );
    const after = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));

    expect(result.total).toBe('17000.00');
    // Compared as decimals, never as JS numbers (standing rule 25).
    const moved = Number(before.total) - Number(after.total);
    expect(moved.toFixed(2)).toBe('17000.00');
  });
});

/**
 * ⚠ "RÉGLÉ PAR FACTURE" — an import artefact that would read as arrears across
 * the whole school.
 *
 * The software before El Ourwa issued ONE invoice covering several things at
 * once — its own example is "Insc + Photocopieuse + Oct + Nov + Juin". The
 * import spreads that receipt month by month, so each month carries LESS than
 * its tariff and would render "Partiel": a family who paid in full, in a single
 * payment, shown as owing money on five separate months.
 *
 * No row is in this state today because the import has not run. That is exactly
 * why it is built and tested now — standing rule 23 forbids cutting over with a
 * financial discrepancy, and discovering this on the day with 1 372 families
 * showing false arrears is what that rule exists to prevent.
 */
describe('a month settled inside a multi-month invoice', () => {
  it('⚠ reads as settled, not as partial', async () => {
    const { guardianId, studentId } = await family('facture');

    // Half the tariff, and the month flagged as covered — what the importer
    // will write for a month inside a lump-sum invoice.
    await inTenant(() =>
      collection.collect(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 10,
          calendarYear: START_YEAR,
          fees: {},
          tender: [{ paymentMethodId: cashId, amount: '4000.00' }],
        },
        ACTOR,
      ),
    );
    await owner.query(
      `UPDATE enrollment_months m SET covered_by_invoice = true
        FROM enrollments e
       WHERE e.id = m.enrollment_id AND e.student_id = $1
         AND m.calendar_month = 10 AND m.calendar_year = $2`,
      [studentId, START_YEAR],
    );

    const ledger = await inTenant(() => debts.familyLedger(guardianId, yearId));
    const october = ledger.children[0]!.months.find(
      (m) => m.month === 10 && m.year === START_YEAR,
    )!;

    expect(october.state).toBe('invoice');
    expect(october.state).not.toBe('partial');
  });

  it('⚠ an ordinary part-payment is STILL partial', async () => {
    // The flag is the only thing that separates them, and it must be: a genuine
    // instalment has to keep chasing.
    const { guardianId, studentId } = await family('partiel-vrai');
    await inTenant(() =>
      collection.collect(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 10,
          calendarYear: START_YEAR,
          fees: {},
          tender: [{ paymentMethodId: cashId, amount: '4000.00' }],
        },
        ACTOR,
      ),
    );

    const ledger = await inTenant(() => debts.familyLedger(guardianId, yearId));
    const october = ledger.children[0]!.months.find((m) => m.month === 10)!;
    expect(october.state).toBe('partial');
  });

  it('a fully paid month is plain "paid", flag or no flag', async () => {
    const { guardianId, studentId } = await family('facture-pleine');
    await inTenant(() =>
      collection.collect(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 10,
          calendarYear: START_YEAR,
          fees: {},
          tender: [{ paymentMethodId: cashId, amount: '10000.00' }],
        },
        ACTOR,
      ),
    );
    await owner.query(
      `UPDATE enrollment_months m SET covered_by_invoice = true
        FROM enrollments e
       WHERE e.id = m.enrollment_id AND e.student_id = $1 AND m.calendar_month = 10`,
      [studentId],
    );

    const ledger = await inTenant(() => debts.familyLedger(guardianId, yearId));
    expect(ledger.children[0]!.months.find((m) => m.month === 10)!.state).toBe('paid');
  });
});

/**
 * UN SEUL REÇU POUR PLUSIEURS MOIS ET LES FRAIS — décision du propriétaire
 * (20/09) : « it makes no sense to issue multiple receipts for paying October
 * and June ». Écrit avant la fenêtre.
 */
describe('le reçu groupé', () => {
  it('⚠ trois mois et les deux frais : UN numéro, cinq lignes, la dette qui tombe d’autant', async () => {
    const { guardianId, studentId } = await family('groupe');
    const avant = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));

    const r = await inTenant(() =>
      collection.encaisserGroupe(
        {
          studentId,
          mois: [{ mois: 10, annee: START_YEAR }, { mois: 11, annee: START_YEAR }, { mois: 6, annee: START_YEAR + 1 }],
          fraisInscription: true,
          fraisPhotocopie: true,
          tender: [
            { paymentMethodId: cashId, amount: '30000.00', reference: 'BK-777' },
            { paymentMethodId: cashId, amount: '7000.00' },
          ],
        },
        ACTOR,
      ),
    );
    expect(r.total).toBe('37000.00');
    expect(r.receiptNumber).toMatch(/^ENC-2019-\d{5}$/);

    // Cinq lignes, toutes sous le même numéro et le même reçu.
    const { rows: mois } = await owner.query<{ receipt_number: string; receipt_id: string; amount: string }>(
      'SELECT receipt_number, receipt_id, amount::text FROM payments WHERE student_id = $1 ORDER BY calendar_year, calendar_month',
      [studentId],
    );
    expect(mois).toHaveLength(3);
    expect(new Set(mois.map((m) => m.receipt_number))).toEqual(new Set([r.receiptNumber]));
    expect(new Set(mois.map((m) => m.receipt_id))).toEqual(new Set([r.receiptId]));
    const { rows: frais } = await owner.query<{ receipt_number: string; amount: string }>(
      'SELECT receipt_number, amount::text FROM family_fee_payments WHERE guardian_id = $1 ORDER BY kind',
      [guardianId],
    );
    expect(frais.map((f) => [f.receipt_number, f.amount])).toEqual([[r.receiptNumber, '5000.00'], [r.receiptNumber, '2000.00']]);

    // Le reçu lu : ses mois, ses frais, ses moyens additionnés avec la référence.
    const recu = await inTenant(() => payments.receiptGroup(r.receiptId));
    expect(recu.amount).toBe('37000.00');
    expect(recu.months.map((m) => `${m.month}/${m.year}`)).toEqual(['10/2019', '11/2019', '6/2020']);
    expect(recu.fees.map((f) => f.amount)).toEqual(['5000.00', '2000.00']);
    expect(recu.tender).toEqual([
      { method: 'Especes', amount: '30000.00', reference: 'BK-777' },
      { method: 'Especes', amount: '7000.00', reference: null },
    ]);

    // La dette a baissé d'exactement ce qui a été encaissé.
    const apres = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    expect(money(avant.total).minus(apres.total).toFixed(2)).toBe('37000.00');
    // Chaque carte de mois renvoie au reçu groupé.
    expect(await inTenant(() => payments.receiptOf(recu.months[0]!.paymentId))).toBe(r.receiptId);
  });

  it('refuse un mois déjà réglé, un total qui ne colle pas, et rien de coché', async () => {
    const { studentId } = await family('groupe2');
    await inTenant(() =>
      collection.encaisserGroupe({ studentId, mois: [{ mois: 10, annee: START_YEAR }], tender: [{ paymentMethodId: cashId, amount: '10000.00' }] }, ACTOR),
    );
    await expect(
      inTenant(() => collection.encaisserGroupe({ studentId, mois: [{ mois: 10, annee: START_YEAR }], tender: [{ paymentMethodId: cashId, amount: '10000.00' }] }, ACTOR)),
    ).rejects.toThrow(/déjà réglé/);
    await expect(
      inTenant(() => collection.encaisserGroupe({ studentId, mois: [{ mois: 11, annee: START_YEAR }], tender: [{ paymentMethodId: cashId, amount: '9000.00' }] }, ACTOR)),
    ).rejects.toThrow(/doit égaler le total coché/);
    await expect(
      inTenant(() => collection.encaisserGroupe({ studentId, mois: [], tender: [{ paymentMethodId: cashId, amount: '1.00' }] }, ACTOR)),
    ).rejects.toThrow(/Cochez au moins/);
  });

  it('les frais seuls, sans aucun mois : un reçu quand même', async () => {
    const { guardianId, studentId } = await family('groupe3');
    const r = await inTenant(() =>
      collection.encaisserGroupe({ studentId, mois: [], fraisPhotocopie: true, tender: [{ paymentMethodId: cashId, amount: '2000.00' }] }, ACTOR),
    );
    expect(r.total).toBe('2000.00');
    const due = await inTenant(() => fees.annualFeesDue(guardianId, yearId, START_YEAR));
    expect(due.map((f) => f.remaining.toFixed(2))).toEqual(['5000.00', '0.00']);
  });
});
