import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PayrollService } from '../src/payroll/payroll.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * THE LOAN SCHEDULE IS A SET OF MONTHS, NOT A COUNT OF THEM.
 *
 * `dette.php` ticks the months the deduction happens in —
 * `input[name="pret_mois[]"]:checked` — and divides the principal by how many
 * are ticked. Ours took a number and generated that many CONSECUTIVE months
 * from a start date.
 *
 * ⚠ THE DIFFERENCE IS NOT COSMETIC. A school agreeing "we'll take it back in
 * November, December, February and April" — skipping January because of other
 * outgoings, skipping March because there is no salary that month — cannot
 * express that as "four months from November", which would take it in November,
 * December, January and February. Every deduction after the first would land in
 * the wrong month, and a person would be short in a month they had budgeted.
 *
 * Written before the change: it decides when money leaves somebody's pay.
 */

let owner: pg.Pool;
let payroll: PayrollService;

let schoolId: string;
let ACTOR: string;
let CASH: string;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'pret' }, fn);
}

async function staffMember(tag: string) {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO staff (school_id, first_name, last_name, role_title, salary)
     VALUES ($1, $2, 'Pret', 'Secretaire', 60000) RETURNING id`,
    [schoolId, tag],
  );
  return rows[0]!.id;
}

async function scheduleOf(loanId: string) {
  const { rows } = await owner.query<{ m: number; y: number; amount: string }>(
    `SELECT calendar_month AS m, calendar_year AS y, amount::text
       FROM loan_instalments WHERE loan_id = $1
      ORDER BY calendar_year, calendar_month`,
    [loanId],
  );
  return rows.map((r) => ({ month: r.m, year: r.y, amount: r.amount }));
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('pret', 'Prets', 'PRT')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('pret.admin@test', 'x', 'Direction') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const cash = await owner.query<{ id: string }>(
    `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Espèces') RETURNING id`,
    [schoolId],
  );
  CASH = cash.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  payroll = moduleRef.get(PayrollService);
});

afterAll(async () => {
  await owner?.end();
});

describe('the months are chosen, not counted', () => {
  it('⚠ takes the deduction in exactly the months ticked, skipping the rest', async () => {
    const who = await staffMember('Choisis');
    const loan = await inTenant(() =>
      payroll.grantLoan(
        {
          payeeKind: 'staff',
          payeeId: who,
          principal: '40000.00',
          // November, December, February, April — January and March skipped.
          months: [
            { month: 11, year: 2025 },
            { month: 12, year: 2025 },
            { month: 2, year: 2026 },
            { month: 4, year: 2026 },
          ],
          reason: 'Avance',
          tender: [{ paymentMethodId: CASH, amount: '40000.00' }],
        },
        ACTOR,
        new Date('2025-06-01'),
      ),
    );

    expect(await scheduleOf(loan.id)).toEqual([
      { month: 11, year: 2025, amount: '10000.00' },
      { month: 12, year: 2025, amount: '10000.00' },
      { month: 2, year: 2026, amount: '10000.00' },
      { month: 4, year: 2026, amount: '10000.00' },
    ]);
  });

  it('crosses a year boundary without inventing months in between', async () => {
    const who = await staffMember('Annee');
    const loan = await inTenant(() =>
      payroll.grantLoan(
        {
          payeeKind: 'staff',
          payeeId: who,
          principal: '9000.00',
          months: [
            { month: 12, year: 2025 },
            { month: 6, year: 2026 },
            { month: 12, year: 2026 },
          ],
          tender: [{ paymentMethodId: CASH, amount: '9000.00' }],
        },
        ACTOR,
        new Date('2025-06-01'),
      ),
    );

    const schedule = await scheduleOf(loan.id);
    expect(schedule.map((s) => `${s.year}-${s.month}`)).toEqual([
      '2025-12',
      '2026-6',
      '2026-12',
    ]);
  });
});

describe('the arithmetic', () => {
  it('⚠ the instalments sum to the principal exactly, to the centime', async () => {
    // 10 000 over 3 gives 3 333.33 twice and 3 333.34 once. Rounding each and
    // hoping is how a loan ends a centime short and never closes.
    const who = await staffMember('Centime');
    const loan = await inTenant(() =>
      payroll.grantLoan(
        {
          payeeKind: 'staff',
          payeeId: who,
          principal: '10000.00',
          months: [
            { month: 1, year: 2026 },
            { month: 2, year: 2026 },
            { month: 3, year: 2026 },
          ],
          tender: [{ paymentMethodId: CASH, amount: '10000.00' }],
        },
        ACTOR,
        new Date('2025-06-01'),
      ),
    );

    const schedule = await scheduleOf(loan.id);
    const total = schedule.reduce((n, s) => n + Number(s.amount), 0);
    expect(total.toFixed(2)).toBe('10000.00');
    // The remainder lands on the LAST instalment, not the first: a person's
    // first deduction should not be the odd one.
    expect(schedule[0]!.amount).toBe('3333.33');
    expect(schedule[2]!.amount).toBe('3333.34');
  });
});

describe('what it refuses', () => {
  it('refuses a schedule with no months at all', async () => {
    const who = await staffMember('Vide');
    await expect(
      inTenant(() =>
        payroll.grantLoan(
          {
            payeeKind: 'staff',
            payeeId: who,
            principal: '5000.00',
            months: [],
            tender: [{ paymentMethodId: CASH, amount: '5000.00' }],
          },
          ACTOR,
          new Date('2025-06-01'),
        ),
      ),
    ).rejects.toThrow("Sélectionnez au moins un mois de retenue (parmi les mois de l'année scolaire).");
  });

  it('⚠ the same month twice is ticked ONCE — his array_unique', async () => {
    const who = await staffMember('Doublon');
    const loan = await inTenant(() =>
      payroll.grantLoan(
        {
          payeeKind: 'staff',
          payeeId: who,
          principal: '5000.00',
          months: [
            { month: 3, year: 2026 },
            { month: 3, year: 2026 },
          ],
          tender: [{ paymentMethodId: CASH, amount: '5000.00' }],
        },
        ACTOR,
        new Date('2025-06-01'),
      ),
    );
    expect(loan.instalments).toBe(1);
    expect(loan.receiptNumber).toMatch(/^PRET-\d{6}$/);
  });

  it('refuses months beyond the three-year horizon', async () => {
    const who = await staffMember('Trop');
    const many = Array.from({ length: 61 }, (_, i) => ({
      month: (i % 12) + 1,
      year: 2026 + Math.floor(i / 12),
    }));
    await expect(
      inTenant(() =>
        payroll.grantLoan(
          {
            payeeKind: 'staff',
            payeeId: who,
            principal: '5000.00',
            months: many,
            tender: [{ paymentMethodId: CASH, amount: '5000.00' }],
          },
          ACTOR,
          new Date('2025-06-01'),
        ),
      ),
    ).rejects.toThrow(/dépassent l'horizon de 3 ans/);
  });

  it('refuses a principal of zero', async () => {
    const who = await staffMember('Zero');
    await expect(
      inTenant(() =>
        payroll.grantLoan(
          {
            payeeKind: 'staff',
            payeeId: who,
            principal: '0',
            months: [{ month: 1, year: 2026 }],
            tender: [{ paymentMethodId: CASH, amount: '5000.00' }],
          },
          ACTOR,
          new Date('2025-06-01'),
        ),
      ),
    ).rejects.toThrow('Montant du prêt invalide.');
  });
});

describe('a cash advance — `imputer_avance_pret`', () => {
  it('⚠ spreads the remaining balance evenly over the open instalments', async () => {
    const who = await staffMember('Avance');
    const loan = await inTenant(() =>
      payroll.grantLoan(
        {
          payeeKind: 'staff',
          payeeId: who,
          principal: '6000.00',
          months: [
            { month: 1, year: 2026 },
            { month: 2, year: 2026 },
          ],
          tender: [{ paymentMethodId: CASH, amount: '6000.00' }],
        },
        ACTOR,
        new Date('2025-06-01'),
      ),
    );

    // 2 000 back in cash: the loan owes 4 000, split 2 000 / 2 000 over the
    // two open instalments — not "January settled, February untouched".
    const r = await inTenant(() =>
      payroll.repayLoan(loan.id, [{ paymentMethodId: CASH, amount: '2000.00' }], ACTOR),
    );
    expect(r.remaining).toBe('4000.00');

    const all = await inTenant(() => payroll.allLoans());
    const mine = all.find((l) => l.id === loan.id)!;
    expect(mine.echeances.map((e) => e.montant)).toEqual(['2000.00', '2000.00']);
    expect(mine.echeances.every((e) => e.rembourse === '0.00')).toBe(true);
    expect(mine.reste).toBe('4000.00');

    // The rest in cash: every open instalment is closed and the loan is settled.
    const fin = await inTenant(() =>
      payroll.repayLoan(loan.id, [{ paymentMethodId: CASH, amount: '4000.00' }], ACTOR),
    );
    expect(fin.remaining).toBe('0.00');
    const apres = (await inTenant(() => payroll.allLoans())).find((l) => l.id === loan.id)!;
    expect(apres.status).toBe('settled');
    expect(apres.echeances.every((e) => e.rembourse === e.montant)).toBe(true);
  });

  it('refuses an advance on a settled loan, with his words', async () => {
    const all = await inTenant(() => payroll.allLoans());
    const settled = all.find((l) => l.status === 'settled')!;
    await expect(
      inTenant(() =>
        payroll.repayLoan(settled.id, [{ paymentMethodId: CASH, amount: '1.00' }], ACTOR),
      ),
    ).rejects.toThrow('Prêt introuvable ou déjà soldé.');
  });
});
