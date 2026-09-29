import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PayrollService } from '../src/payroll/payroll.service.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { CommsService } from '../src/comms/comms.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * Phase 9 — payroll, loans, withdrawals, reports and the two small workflows.
 *
 * Money again, so test-first: standing rules 5 to 10 apply to a salary exactly
 * as they apply to a receipt.
 */

let owner: pg.Pool;
let payroll: PayrollService;
let reports: ReportsService;
let comms: CommsService;

let schoolId: string;
let otherSchoolId: string;
let ACTOR: string;
let guardianId: string;
let directorId: string;
let cleanerId: string;
let guardId: string;
let teacherId: string;
let holderId: string;
let CASH: string;

const M = 3;
const Y = 2021;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'pay' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const schools = await owner.query<{ id: string; slug: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES
       ('pay', 'Payroll', 'PAY'), ('pay-other', 'Payroll Other', 'PAO')
     RETURNING id, slug`,
  );
  schoolId = schools.rows.find((r) => r.slug === 'pay')!.id;
  otherSchoolId = schools.rows.find((r) => r.slug === 'pay-other')!.id;

  const users = await owner.query<{ id: string; email: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES
       ('pay.accountant@test', 'x', 'Agent comptable'),
       ('pay.parent@test', 'x', 'Pay Parent')
     RETURNING id, email`,
  );
  ACTOR = users.rows.find((r) => r.email === 'pay.accountant@test')!.id;
  guardianId = users.rows.find((r) => r.email === 'pay.parent@test')!.id;
  // Un correspondant d'ici a un enfant ici : sans lui, un message ciblé est refusé (22/09).
  await owner.query(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, 'RIM-PAY-P', 'NID-PAY-P', 'Enfant', 'Pay')`,
    [schoolId, guardianId],
  );

  const staff = await owner.query<{ id: string; role_title: string }>(
    `INSERT INTO staff (school_id, first_name, last_name, role_title, salary) VALUES
       ($1, 'Ahmed', 'Ould Sidi', 'Directeur', 90000),
       ($1, 'Fatimetou', 'Mint Ely', 'Femme de menage', 8000),
       ($1, 'Sidi', 'Ould Baba', 'Gardien', 5000)
     RETURNING id, role_title`,
    [schoolId],
  );
  directorId = staff.rows.find((r) => r.role_title === 'Directeur')!.id;
  cleanerId = staff.rows.find((r) => r.role_title === 'Femme de menage')!.id;
  guardId = staff.rows.find((r) => r.role_title === 'Gardien')!.id;

  const teacher = await owner.query<{ id: string }>(
    `INSERT INTO teachers (school_id, first_name, last_name, salary)
     VALUES ($1, 'Moussa', 'Ould Baba', 40000) RETURNING id`,
    [schoolId],
  );
  teacherId = teacher.rows[0]!.id;

  const holder = await owner.query<{ id: string }>(
    `INSERT INTO fund_holders (school_id, full_name, monthly_limit)
     VALUES ($1, 'Fonds de direction', 100000) RETURNING id`,
    [schoolId],
  );
  holderId = holder.rows[0]!.id;

  const cash = await owner.query<{ id: string }>(
    `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Espèces') RETURNING id`,
    [schoolId],
  );
  CASH = cash.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  payroll = moduleRef.get(PayrollService);
  reports = moduleRef.get(ReportsService);
  comms = moduleRef.get(CommsService);
});

afterAll(async () => {
  await owner?.end();
});

describe('salaries — `payer_salaire` de paiement_staff.php', () => {
  it('pays a salary from its tender lines and returns strings, never numbers', async () => {
    const paid = await inTenant(() =>
      payroll.paySalary(
        {
          payeeKind: 'staff',
          payeeId: directorId,
          calendarMonth: M,
          calendarYear: Y,
          tender: [{ paymentMethodId: CASH, amount: '90000.00' }],
        },
        ACTOR,
      ),
    );
    expect(paid.gross).toBe('90000.00');
    expect(paid.net).toBe('90000.00');
    expect(typeof paid.net).toBe('string');
    // 'SAL-' . str_pad($id, 6, '0') — the first receipt of this school.
    expect(paid.receiptNumber).toBe('SAL-000001');
  });

  it('refuses a payment without any means of payment, with its words', async () => {
    await expect(
      inTenant(() =>
        payroll.paySalary(
          { payeeKind: 'staff', payeeId: cleanerId, calendarMonth: M, calendarYear: Y, tender: [] },
          ACTOR,
        ),
      ),
    ).rejects.toThrow('Veuillez indiquer au moins un moyen de paiement avec un montant.');
  });

  it('refuses a second payment once the month is settled, naming the month', async () => {
    await expect(
      inTenant(() =>
        payroll.paySalary(
          {
            payeeKind: 'staff',
            payeeId: directorId,
            calendarMonth: M,
            calendarYear: Y,
            tender: [{ paymentMethodId: CASH, amount: '1.00' }],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(
      'Ce bénéficiaire a déjà été intégralement payé pour Mars 2021 (90 000 MRU net). ' +
        "Aucun paiement supplémentaire n'est autorisé pour ce mois.",
    );
  });

  it('pays a teacher from the same payroll, posting salaire_prof lines', async () => {
    const paid = await inTenant(() =>
      payroll.paySalary(
        {
          payeeKind: 'teacher',
          payeeId: teacherId,
          calendarMonth: M,
          calendarYear: Y,
          tender: [{ paymentMethodId: CASH, amount: '40000.00' }],
        },
        ACTOR,
      ),
    );
    expect(paid.net).toBe('40000.00');
    const { rows } = await owner.query<{ source_type: string }>(
      'SELECT source_type FROM tender_lines WHERE source_id = $1',
      [paid.id],
    );
    expect(rows.map((r) => r.source_type)).toEqual(['salaire_prof']);
  });

  it('lists the page as paiement_staff.php computes it', async () => {
    const page = await inTenant(() => payroll.staffPay('staff', M, Y));
    const byId = new Map(page.lignes.map((r) => [r.id, r]));
    expect(byId.get(directorId)!.reste).toBe('0.00');
    expect(byId.get(directorId)!.paye).toBe('90000.00');
    expect(byId.get(directorId)!.reste_nul).toBe(true);
    expect(byId.get(cleanerId)!.reste).toBe('8000.00');
    expect(byId.get(cleanerId)!.paye).toBe('0.00');
    expect(byId.get(cleanerId)!.fonction).toBe('Femme de menage');
    // Staff has all twelve months; only teachers are restricted to the school year.
    expect(page.moisDisponibles).toHaveLength(12);
  });

  it('prints the receipt the way `print_recu_salaire` does', async () => {
    const { rows } = await owner.query<{ id: string }>(
      `SELECT id FROM salary_payments WHERE payee_id = $1 AND calendar_month = $2`,
      [directorId, M],
    );
    const recu = await inTenant(() => payroll.salaryReceipt(rows[0]!.id));
    expect(recu.numero).toBe('SAL-000001');
    expect(recu.benef_nom).toBe('Ahmed Ould Sidi');
    expect(recu.benef_fonction).toBe('Directeur');
    expect(recu.motif).toBe('Salaire');
    expect(recu.montant).toBe('90000.00');
    expect(recu.moyens).toEqual([{ moyen: 'Espèces', montant: '90000.00', reference: null }]);
    expect(recu.paye_par_nom).toBe('Agent comptable');
  });
});

describe('a salary paid in instalments', () => {
  /**
   * El Ourwa permits this: `reste_mois = gain_net − deja_paye_mois`, and the
   * only refusal is a total above that rest. A school with uneven cash flow
   * pays half now and half at month end.
   */
  const IM = 9;

  it('accepts a part payment and reports what is left', async () => {
    const first = await inTenant(() =>
      payroll.paySalary(
        {
          payeeKind: 'staff',
          payeeId: directorId,
          calendarMonth: IM,
          calendarYear: Y,
          tender: [{ paymentMethodId: CASH, amount: '50000.00' }],
        },
        ACTOR,
      ),
    );
    expect(first.net).toBe('50000.00');
    expect(first.remaining).toBe('40000.00');
  });

  it('accepts the rest, and the month then reconciles exactly', async () => {
    const second = await inTenant(() =>
      payroll.paySalary(
        {
          payeeKind: 'staff',
          payeeId: directorId,
          calendarMonth: IM,
          calendarYear: Y,
          tender: [{ paymentMethodId: CASH, amount: '40000.00' }],
        },
        ACTOR,
      ),
    );
    expect(second.remaining).toBe('0.00');

    // ⚠ The two entries reconstruct the month exactly: Σ net is the cash that
    // left, Σ gross is the reference pay.
    const { rows } = await owner.query<{ net: string; gross: string; n: string }>(
      `SELECT SUM(net)::text AS net, SUM(gross)::text AS gross, count(*)::text AS n
         FROM salary_payments
        WHERE payee_id = $1 AND calendar_month = $2 AND calendar_year = $3`,
      [directorId, IM, Y],
    );
    expect(rows[0]!.n).toBe('2');
    expect(rows[0]!.net).toBe('90000.00');
    expect(rows[0]!.gross).toBe('90000.00');
  });

  it('refuses a part payment once the month is settled', async () => {
    await expect(
      inTenant(() =>
        payroll.paySalary(
          {
            payeeKind: 'staff',
            payeeId: directorId,
            calendarMonth: IM,
            calendarYear: Y,
            tender: [{ paymentMethodId: CASH, amount: '0.01' }],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/déjà été intégralement payé pour Septembre 2021/);
  });

  it('refuses an instalment larger than what is left, with the rest in its words', async () => {
    await expect(
      inTenant(() =>
        payroll.paySalary(
          {
            payeeKind: 'staff',
            payeeId: cleanerId,
            calendarMonth: 10,
            calendarYear: Y,
            tender: [{ paymentMethodId: CASH, amount: '999999.00' }],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow('Le montant dépasse le reste dû du mois (8 000 MRU).');
  });

  it('⚠ the loan is credited when the month is COMPLETE, not on the first entry', async () => {
    // The guard has a 5000 salary and a 2000 instalment in November. The net
    // for the month is 3000. Paying 1000 then 2000: the instalment is credited
    // by the SECOND entry — `crediter_echeances_mois` runs once
    // deja + montant ≥ gain_net, exactly as in paiement_staff.php.
    const loan = await inTenant(() =>
      payroll.grantLoan(
        {
          payeeKind: 'staff',
          payeeId: guardId,
          principal: '2000.00',
          months: [{ month: 11, year: Y }],
          tender: [{ paymentMethodId: CASH, amount: '2000.00' }],
        },
        ACTOR,
        new Date('2020-01-01'),
      ),
    );

    const a = await inTenant(() =>
      payroll.paySalary(
        {
          payeeKind: 'staff',
          payeeId: guardId,
          calendarMonth: 11,
          calendarYear: Y,
          tender: [{ paymentMethodId: CASH, amount: '1000.00' }],
        },
        ACTOR,
      ),
    );
    expect(a.deduction).toBe('0.00');
    expect(a.net).toBe('1000.00');
    expect(a.remaining).toBe('2000.00'); // 5000 − 2000 retenue − 1000 paid

    let loans = await inTenant(() => payroll.loansFor('staff', guardId));
    expect(loans.find((l: any) => l.id === loan.id)!.repaid).toBe('0.00');

    const b = await inTenant(() =>
      payroll.paySalary(
        {
          payeeKind: 'staff',
          payeeId: guardId,
          calendarMonth: 11,
          calendarYear: Y,
          tender: [{ paymentMethodId: CASH, amount: '2000.00' }],
        },
        ACTOR,
      ),
    );
    expect(b.deduction).toBe('2000.00'); // carried by the entry that completes the month
    expect(b.remaining).toBe('0.00');

    loans = await inTenant(() => payroll.loansFor('staff', guardId));
    const settled = loans.find((l: any) => l.id === loan.id)!;
    expect(settled.repaid).toBe('2000.00'); // once, not twice
    expect(settled.status).toBe('settled');

    // And the month's gross reconstructs the reference pay: 1000 + 2000 + 2000.
    const { rows } = await owner.query<{ gross: string }>(
      `SELECT SUM(gross)::text AS gross FROM salary_payments
        WHERE payee_id = $1 AND calendar_month = 11 AND calendar_year = $2`,
      [guardId, Y],
    );
    expect(rows[0]!.gross).toBe('5000.00');
  });

  it('records who took the money out of the till, on every instalment', async () => {
    const { rows } = await owner.query<{ paid_by: string; n: string }>(
      `SELECT paid_by, count(*)::text AS n FROM salary_payments
        WHERE payee_id = $1 AND calendar_month = 11 AND calendar_year = $2
        GROUP BY paid_by`,
      [guardId, Y],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.paid_by).toBe(ACTOR);
    expect(rows[0]!.n).toBe('2');
  });
});

describe('loans', () => {
  let loanId: string;

  it('lays out a schedule that sums exactly to the principal', async () => {
    // 10000 over 3 months is 3333.33 twice and 3333.34 once. Equal instalments
    // would leave one centime owing after the last payment.
    const loan = await inTenant(() =>
      payroll.grantLoan(
        {
          payeeKind: 'staff',
          payeeId: cleanerId,
          principal: '10000.00',
          months: [
            { month: 4, year: Y },
            { month: 5, year: Y },
            { month: 6, year: Y },
          ],
          tender: [{ paymentMethodId: CASH, amount: '10000.00' }],
        },
        ACTOR,
        new Date('2020-01-01'),
      ),
    );
    loanId = loan.id;

    const { rows } = await owner.query<{ total: string; last: string }>(
      `SELECT SUM(amount)::text AS total,
              (SELECT amount::text FROM loan_instalments
                WHERE loan_id = $1 ORDER BY calendar_year DESC, calendar_month DESC
                LIMIT 1) AS last
         FROM loan_instalments WHERE loan_id = $1`,
      [loanId],
    );
    expect(rows[0]!.total).toBe('10000.00');
    expect(rows[0]!.last).toBe('3333.34');
  });

  it('shows the retenue and the net on the page, and withholds no more', async () => {
    const page = await inTenant(() => payroll.staffPay('staff', 4, Y));
    const row = page.lignes.find((r) => r.id === cleanerId)!;
    expect(row.gain).toBe('8000.00');
    expect(row.retenue).toBe('3333.33');
    expect(row.net).toBe('4666.67');
    expect(row.reste).toBe('4666.67');

    const paid = await inTenant(() =>
      payroll.paySalary(
        {
          payeeKind: 'staff',
          payeeId: cleanerId,
          calendarMonth: 4,
          calendarYear: Y,
          tender: [{ paymentMethodId: CASH, amount: '4666.67' }],
        },
        ACTOR,
      ),
    );
    expect(paid.gross).toBe('8000.00');
    expect(paid.deduction).toBe('3333.33');
    expect(paid.net).toBe('4666.67');
  });

  it('⚠ keeps the retenue on a month already paid, so the rest never reopens', async () => {
    // `retenu_salaire = 1` still counts as retenue: otherwise the 3333.33 would
    // become payable again after the net was paid.
    const page = await inTenant(() => payroll.staffPay('staff', 4, Y));
    const row = page.lignes.find((r) => r.id === cleanerId)!;
    expect(row.retenue).toBe('3333.33');
    expect(row.reste).toBe('0.00');
    expect(row.reste_nul).toBe(true);
  });

  it('refuses a repayment larger than the balance, with his words', async () => {
    await expect(
      inTenant(() =>
        payroll.repayLoan(loanId, [{ paymentMethodId: CASH, amount: '999999.00' }], ACTOR),
      ),
    ).rejects.toThrow('Le montant dépasse le reste dû du prêt (6 667 MRU).');
  });

  it('settles a loan once it is fully repaid — `imputer_avance_pret`', async () => {
    // April withheld 3333.33 of the 10000; the rest is handed back in cash.
    const rest = await inTenant(() =>
      payroll.repayLoan(loanId, [{ paymentMethodId: CASH, amount: '6666.67' }], ACTOR),
    );
    expect(rest.remaining).toBe('0.00');
    expect(rest.receiptNumber).toMatch(/^PRT-\d{8}-[0-9a-f]+-\d{4}$/);

    const loans = await inTenant(() => payroll.loansFor('staff', cleanerId));
    expect(loans.find((l: any) => l.id === loanId)!.status).toBe('settled');
  });
});

describe('a loan instalment larger than the salary', () => {
  let bigLoan: string;

  it("refuses the month — « rien à verser » — and leaves the instalment open", async () => {
    // 20000 due in May against a 5000 salary. gain_net = max(0, 5000 − 20000)
    // = 0 → paiement_staff.php refuses: nothing is paid and nothing is
    // credited; the instalment stays open on the loan (Dettes → Prêts).
    const loan = await inTenant(() =>
      payroll.grantLoan(
        {
          payeeKind: 'staff',
          payeeId: guardId,
          principal: '20000.00',
          months: [{ month: 5, year: Y }],
          tender: [{ paymentMethodId: CASH, amount: '20000.00' }],
        },
        ACTOR,
        new Date('2020-01-01'),
      ),
    );
    bigLoan = loan.id;

    await expect(
      inTenant(() =>
        payroll.paySalary(
          {
            payeeKind: 'staff',
            payeeId: guardId,
            calendarMonth: 5,
            calendarYear: Y,
            tender: [{ paymentMethodId: CASH, amount: '1.00' }],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(
      "La retenue de prêt (20 000 MRU) couvre l'intégralité du salaire de ce mois : rien à verser.",
    );

    const page = await inTenant(() => payroll.staffPay('staff', 5, Y));
    const row = page.lignes.find((r) => r.id === guardId)!;
    expect(row.net_nul).toBe(true); // « Retenu (prêt) »

    const loans = await inTenant(() => payroll.loansFor('staff', guardId));
    const still = loans.find((l: any) => l.id === bigLoan)!;
    expect(still.status).toBe('outstanding');
    expect(still.outstanding).toBe('20000.00');
  });

  it('⚠ does NOT carry the shortfall into June: only the instalments dated that month count', async () => {
    // `retenue_pret()` reads `pe.mois = :m AND pe.annee = :a`. June has no
    // instalment, so June is paid in full and May's stays open on the loan.
    const june = await inTenant(() =>
      payroll.paySalary(
        {
          payeeKind: 'staff',
          payeeId: guardId,
          calendarMonth: 6,
          calendarYear: Y,
          tender: [{ paymentMethodId: CASH, amount: '5000.00' }],
        },
        ACTOR,
      ),
    );
    expect(june.deduction).toBe('0.00');
    expect(june.net).toBe('5000.00');

    const loans = await inTenant(() => payroll.loansFor('staff', guardId));
    expect(loans.find((l: any) => l.id === bigLoan)!.outstanding).toBe('20000.00');
  });
});

describe('withdrawals — `retirer_admin` de paiement_staff.php', () => {
  it('allows a withdrawal inside the monthly limit, numbered ADM-…', async () => {
    const out = await inTenant(() =>
      payroll.withdraw(
        {
          fundHolderId: holderId,
          calendarMonth: M,
          calendarYear: Y,
          tender: [{ paymentMethodId: CASH, amount: '60000.00' }],
        },
        ACTOR,
      ),
    );
    expect(out.amount).toBe('60000.00');
    expect(out.remaining).toBe('40000.00');
    expect(out.receiptNumber).toMatch(/^ADM-\d{8}-[0-9a-f]+-\d{4}$/);
  });

  it('refuses one that would exceed it — « LIMITE MENSUELLE DÉPASSÉE »', async () => {
    await expect(
      inTenant(() =>
        payroll.withdraw(
          {
            fundHolderId: holderId,
            calendarMonth: M,
            calendarYear: Y,
            tender: [{ paymentMethodId: CASH, amount: '50000.00' }],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(
      '⚠ LIMITE MENSUELLE DÉPASSÉE : Fonds de direction ne peut retirer que 40 000 MRU ' +
        'de plus ce mois (limite 100 000 MRU, déjà retiré 60 000 MRU). Le retrait de 50 000 MRU est refusé.',
    );
  });

  it('tells the accountant the same refusal without the figures', async () => {
    await expect(
      inTenant(() =>
        payroll.withdraw(
          {
            fundHolderId: holderId,
            calendarMonth: M,
            calendarYear: Y,
            tender: [{ paymentMethodId: CASH, amount: '50000.00' }],
          },
          ACTOR,
          ['comptable'],
        ),
      ),
    ).rejects.toThrow(
      '⚠ LIMITE MENSUELLE DÉPASSÉE : ce retrait (50 000 MRU) dépasse ce que Fonds de direction ' +
        'peut encore retirer pour Mars 2021.',
    );
  });

  it('resets the limit with the calendar month', async () => {
    const next = await inTenant(() =>
      payroll.withdraw(
        {
          fundHolderId: holderId,
          calendarMonth: M + 1,
          calendarYear: Y,
          tender: [{ paymentMethodId: CASH, amount: '90000.00' }],
        },
        ACTOR,
      ),
    );
    expect(next.remaining).toBe('10000.00');
  });

  it('once the limit is reached, says « LIMITE MENSUELLE ATTEINTE »', async () => {
    await inTenant(() =>
      payroll.withdraw(
        {
          fundHolderId: holderId,
          calendarMonth: M + 1,
          calendarYear: Y,
          tender: [{ paymentMethodId: CASH, amount: '10000.00' }],
        },
        ACTOR,
      ),
    );
    await expect(
      inTenant(() =>
        payroll.withdraw(
          {
            fundHolderId: holderId,
            calendarMonth: M + 1,
            calendarYear: Y,
            tender: [{ paymentMethodId: CASH, amount: '1.00' }],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/^⚠ LIMITE MENSUELLE ATTEINTE : Fonds de direction a déjà retiré 100 000 MRU/);
  });

  it('prints the receipt with the limit for the administration, without it for the accountant', async () => {
    const { rows } = await owner.query<{ id: string }>(
      `SELECT id FROM withdrawals WHERE fund_holder_id = $1 AND calendar_month = $2 ORDER BY withdrawn_at LIMIT 1`,
      [holderId, M],
    );
    const direction = await inTenant(() => payroll.withdrawalReceipt(rows[0]!.id));
    expect(direction.nom_complet).toBe('Fonds de direction');
    expect(direction.montant).toBe('60000.00');
    expect(direction.limite_mensuelle).toBe('100000.00');
    expect(direction.cumul_mois).toBe('60000.00');
    expect(direction.reste_apres).toBe('40000.00');
    expect(direction.moyens).toEqual([{ moyen: 'Espèces', montant: '60000.00', reference: null }]);

    const comptable = await inTenant(() => payroll.withdrawalReceipt(rows[0]!.id, ['comptable']));
    expect(comptable.limite_mensuelle).toBeNull();
    expect(comptable.cumul_mois).toBeNull();
    expect(comptable.reste_apres).toBeNull();
    expect(comptable.montant).toBe('60000.00');
  });

  it('hides the limit from the accountant on the admins page, and keeps the rest', async () => {
    const page = await inTenant(() => payroll.staffPay('admins', M, Y, ['comptable']));
    const row = page.lignes.find((r) => r.id === holderId)!;
    expect(row.gain).toBeNull();
    expect(row.paye).toBe('60000.00');
    expect(row.reste).toBe('40000.00');
  });
});

describe('reports', () => {
  /**
   * A report is dated by when the money MOVED, not by the month it settles
   * (ADR-0013), and every row above was written just now. So the fixture states
   * when each movement happened — which is also what makes these assertions say
   * something: two salaries and a withdrawal that all landed in March 2021.
   */
  beforeAll(async () => {
    const at = (m: number) => `${Y}-${String(m).padStart(2, '0')}-15T10:00:00Z`;
    await owner.query(
      `UPDATE salary_payments SET paid_at = $1::timestamptz
        WHERE calendar_month = $2 AND calendar_year = $3 AND school_id = $4`,
      [at(M), M, Y, schoolId],
    );
    // June's one entry — the guard, paid in full — moved in June.
    await owner.query(
      `UPDATE salary_payments SET paid_at = $1::timestamptz
        WHERE calendar_month = 6 AND calendar_year = $2 AND school_id = $3`,
      [at(6), Y, schoolId],
    );
    await owner.query(
      `UPDATE withdrawals SET withdrawn_at = $1::timestamptz
        WHERE calendar_month = $2 AND calendar_year = $3 AND school_id = $4`,
      [at(M), M, Y, schoolId],
    );
  });

  it('reports the month as strings on both sides', async () => {
    const report = await inTenant(() => reports.monthly(M, Y));
    expect(typeof report.outgoings.salaries).toBe('string');
    expect(typeof report.net).toBe('string');
    // Two salaries paid in March: 90000 + 40000. Nothing came in.
    expect(report.outgoings.salaries).toBe('130000.00');
    expect(report.outgoings.withdrawals).toBe('60000.00');
    expect(report.income.total).toBe('0.00');
    expect(report.net).toBe('-190000.00');
  });

  it('counts June as what actually left: the guard’s 5000', async () => {
    const report = await inTenant(() => reports.monthly(6, Y));
    expect(report.outgoings.salaries).toBe('5000.00');
  });

  it('sees nothing from another school', async () => {
    const report = await runInTenant({ schoolId: otherSchoolId, slug: 'pay-other' }, () =>
      reports.monthly(M, Y),
    );
    expect(report.outgoings.salaries).toBe('0.00');
    expect(report.outgoings.withdrawals).toBe('0.00');
  });
});

describe('approval requests', () => {
  let requestId: string;

  it('records who raised it, by name', async () => {
    const raised = await inTenant(() =>
      comms.raise(
        { kind: 'depense', description: 'Reparation du groupe electrogene', amount: '85000.00' },
        ACTOR,
      ),
    );
    requestId = raised.id;

    const { demandes: pending, counts } = await inTenant(() => comms.requests('pending'));
    expect(counts.pending).toBeGreaterThan(0);
    const mine = pending.find((r: any) => r.id === requestId)!;
    expect(mine.raiser_name).toBe('Agent comptable');
    expect(mine.amount).toBe('85000.00');
  });

  it('decides once and only once', async () => {
    const decided = await inTenant(() => comms.decide(requestId, 'approved', 'Accorde.', ACTOR));
    expect(decided.status).toBe('approved');

    // Son refus : « Demande introuvable ou déjà traitée. »
    await expect(
      inTenant(() => comms.decide(requestId, 'refused', undefined, ACTOR)),
    ).rejects.toThrow(/déjà traitée/i);
  });
});

describe('messaging', () => {
  it('refuses to send to nobody rather than reporting a silent success', async () => {
    // The refusal is unchanged; the wording is now El Ourwa's own — "Aucun
    // destinataire trouvé pour ces critères." — because that is the sentence
    // the office reads.
    await expect(
      inTenant(() => comms.send({ subject: 'Rentree', body: 'Bonjour' }, ACTOR)),
    ).rejects.toThrow(/destinataire/i);
  });

  it('sends to one family and stamps the sender by name', async () => {
    const sent = await inTenant(() =>
      comms.send({ subject: 'Reunion', body: 'Mardi a 10h.', guardianId }, ACTOR),
    );
    expect(sent.sent).toBe(1);

    const inbox = await inTenant(() => comms.messagesFor(guardianId));
    expect(inbox[0]!.sender_name).toBe('Agent comptable');
    expect(inbox[0]!.subject).toBe('Reunion');
  });

  it('stamps the moment a family first opened it, and never moves it', async () => {
    const inbox = await inTenant(() => comms.messagesFor(guardianId));
    const id = inbox[0]!.id as string;
    expect(inbox[0]!.read_at).toBeNull();

    const first = await inTenant(() => comms.markRead(id, guardianId));
    expect(first.read).toBe(true);
    expect(await inTenant(() => comms.unreadCount(guardianId))).toBe(0);

    const { rows: after } = await owner.query<{ read_at: Date }>(
      'SELECT read_at FROM messages WHERE id = $1',
      [id],
    );
    const stamped = after[0]!.read_at;

    // Re-opening is not a second event. "First opened at" is the fact the
    // office asked for; overwriting it would silently make it "last opened at".
    const again = await inTenant(() => comms.markRead(id, guardianId));
    expect(again.read).toBe(false);
    const { rows: unchanged } = await owner.query<{ read_at: Date }>(
      'SELECT read_at FROM messages WHERE id = $1',
      [id],
    );
    expect(unchanged[0]!.read_at.getTime()).toBe(stamped.getTime());
  });

  it('⚠ refuses to let one family mark another family message read', async () => {
    const inbox = await inTenant(() => comms.messagesFor(guardianId));
    const id = inbox[0]!.id as string;

    // ACTOR is a member of staff, not this family. Scoping lives in the WHERE
    // clause, so someone else's message is indistinguishable from a missing one.
    const attempt = await inTenant(() => comms.markRead(id, ACTOR));
    expect(attempt.read).toBe(false);
  });

  it('does not deliver one school message into another school', async () => {
    const inbox = await runInTenant({ schoolId: otherSchoolId, slug: 'pay-other' }, () =>
      comms.messagesFor(guardianId),
    );
    expect(inbox).toHaveLength(0);
  });
});
