import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { TenderService } from '../src/finance/tender.service.js';
import { ExpensesService } from '../src/finance/expenses.service.js';
import { PayrollService } from '../src/payroll/payroll.service.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * The tender ledger — one record of HOW money moved, both directions.
 *
 * ⚠ THIS CLOSES OPEN ISSUE 1. Before it, only tuition recorded a means of
 * payment, so "Synthèse par moyen de paiement" on Rapport Financier could fill
 * its Entrées column and not its Sorties: the school could see that 120 000
 * arrived by Bankily and had no way to say that 40 000 left in cash.
 */

let owner: pg.Pool;
let tender: TenderService;
let expenses: ExpensesService;
let payroll: PayrollService;
let reports: ReportsService;

let schoolId: string;
let cashId: string;
let bankilyId: string;
let staffId: string;
let holderId: string;
let ACTOR: string;

const M = 5;
const Y = 2021;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'tnd' }, fn);
}

/** Put a movement in a known month, as only a test reaching into the DB can. */
async function dateLines(sourceType: string, at: string) {
  await owner.query(
    `UPDATE tender_lines SET created_at = $2::timestamptz
      WHERE school_id = $1 AND source_type = $3`,
    [schoolId, at, sourceType],
  );
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix)
     VALUES ('tnd', 'Tender', 'TND') RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const methods = await owner.query<{ id: string; name: string }>(
    `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Espèces'), ($1, 'Bankily')
     RETURNING id, name`,
    [schoolId],
  );
  cashId = methods.rows.find((m) => m.name === 'Espèces')!.id;
  bankilyId = methods.rows.find((m) => m.name === 'Bankily')!.id;

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('tnd.actor@test', 'x', 'Comptable') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const staff = await owner.query<{ id: string }>(
    `INSERT INTO staff (school_id, first_name, last_name, role_title, salary)
     VALUES ($1, 'Sidi', 'Ould Ahmed', 'Gardien', 30000) RETURNING id`,
    [schoolId],
  );
  staffId = staff.rows[0]!.id;

  const holder = await owner.query<{ id: string }>(
    `INSERT INTO fund_holders (school_id, full_name, monthly_limit)
     VALUES ($1, 'Fonds de direction', 200000) RETURNING id`,
    [schoolId],
  );
  holderId = holder.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  tender = moduleRef.get(TenderService);
  expenses = moduleRef.get(ExpensesService);
  payroll = moduleRef.get(PayrollService);
  reports = moduleRef.get(ReportsService);
});

afterAll(async () => {
  await owner?.end();
});

describe('the lines must reconcile with the movement', () => {
  it('⚠ refuses a split that does not sum to the amount', async () => {
    // A receipt for 5 000 settled as 3 000 + 1 500 is not a receipt for 5 000;
    // it is a till that will not balance, found by whoever counts the drawer.
    await expect(
      inTenant(() =>
        expenses.record(
          {
            amount: '5000.00',
            description: 'Fournitures',
            tender: [
              { paymentMethodId: cashId, amount: '3000.00' },
              { paymentMethodId: bankilyId, amount: '1500.00' },
            ],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow('La somme des moyens de paiement (4 500 MRU) doit égaler le montant dû (5 000 MRU).');
  });

  it('refuses a line of zero or less', async () => {
    await expect(
      inTenant(() =>
        expenses.record(
          {
            amount: '0.00',
            description: 'Rien',
            tender: [{ paymentMethodId: cashId, amount: '0.00' }],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow();
  });

  it('⚠ leaves nothing behind when the split is refused', async () => {
    // The lines are posted inside the movement's own transaction, so a rejected
    // split rolls the expense back with it. An expense with no ledger entry
    // would be money the report cannot see.
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM expenses
        WHERE school_id = $1 AND description = 'Fournitures'`,
      [schoolId],
    );
    expect(rows[0]!.n).toBe('0');
  });
});

describe('outflows now appear in the split', () => {
  it('records how an expense left the till', async () => {
    await inTenant(() =>
      expenses.record(
        {
          amount: '40000.00',
          description: 'Réparation',
          tender: [{ paymentMethodId: cashId, amount: '40000.00' }],
        },
        ACTOR,
      ),
    );
    await dateLines('depense', `${Y}-0${M}-10T10:00:00Z`);

    const lines = await inTenant(() => reports.byPaymentMethod(M, Y));
    const cash = lines.find((l) => l.name === 'Espèces')!;
    expect(cash.sortant).toBe('40000.00');
  });

  it('⚠ records the NET of a salary, never the gross', async () => {
    // The withholding against a loan never moved. Posting the gross would
    // invent money leaving the till that nobody handed over.
    await inTenant(() =>
      payroll.grantLoan(
        {
          payeeKind: 'staff',
          payeeId: staffId,
          principal: '10000.00',
          months: [{ month: M, year: Y }],
          tender: [{ paymentMethodId: cashId, amount: '10000.00' }],
        },
        ACTOR,
        new Date('2020-01-01'),
      ),
    );
    const paid = await inTenant(() =>
      payroll.paySalary(
        {
          payeeKind: 'staff',
          payeeId: staffId,
          calendarMonth: M,
          calendarYear: Y,
          tender: [{ paymentMethodId: bankilyId, amount: '20000.00' }],
        },
        ACTOR,
      ),
    );
    expect(paid.deduction).toBe('10000.00');
    expect(paid.net).toBe('20000.00');

    await dateLines('salaire_staff', `${Y}-0${M}-11T10:00:00Z`);
    const lines = await inTenant(() => reports.byPaymentMethod(M, Y));
    const bankily = lines.find((l) => l.name === 'Bankily')!;
    // 20 000 left, not the 30 000 gross.
    expect(bankily.sortant).toBe('20000.00');
  });

  it('records a withdrawal', async () => {
    await inTenant(() =>
      payroll.withdraw(
        {
          fundHolderId: holderId,
          calendarMonth: M,
          calendarYear: Y,
          tender: [{ paymentMethodId: cashId, amount: '15000.00' }],
        },
        ACTOR,
      ),
    );
    await dateLines('admin_retrait', `${Y}-0${M}-12T10:00:00Z`);

    const lines = await inTenant(() => reports.byPaymentMethod(M, Y));
    const cash = lines.find((l) => l.name === 'Espèces')!;
    // 40 000 expense + 15 000 withdrawal.
    expect(cash.sortant).toBe('55000.00');
  });
});

describe('a movement entered without a means of payment', () => {
  it('⚠ is refused, with his words — `lire_lignes_paiement(true, $montant)`', async () => {
    // depenses.php requires the split and requires it to equal the amount.
    // An expense without a means of payment is not a partial record; it is a
    // till that cannot be counted, and he refuses it at the door.
    await expect(
      inTenant(() => expenses.record({ amount: '7000.00', description: 'Sans moyen', tender: [] }, ACTOR)),
    ).rejects.toThrow('Veuillez indiquer au moins un moyen de paiement avec un montant.');

    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM expenses
        WHERE school_id = $1 AND description = 'Sans moyen'`,
      [schoolId],
    );
    expect(rows[0]!.n).toBe('0');
  });
});

describe('what a movement was settled with', () => {
  it('can be read back for a receipt', async () => {
    const { rows } = await owner.query<{ id: string }>(
      `SELECT source_id AS id FROM tender_lines
        WHERE school_id = $1 AND source_type = 'admin_retrait' LIMIT 1`,
      [schoolId],
    );
    const lines = await inTenant(() =>
      tender.forSource('admin_retrait', rows[0]!.id),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.moyen).toBe('Espèces');
    expect(lines[0]!.montant).toBe('15000.00');
  });

  it('offers cash as the default means, which is what a school till is', async () => {
    const method = await inTenant(() => tender.defaultMethod());
    expect(method?.name).toBe('Espèces');
  });
});

/**
 * LA RÉFÉRENCE DE L'APPLICATION DE PAIEMENT (0038, décision du propriétaire
 * 18/09) : facultative, portée par la ligne de moyen, relue avec la ligne, et
 * présente dans le résumé des moyens — c'est ce que le reçu imprime.
 */
describe('la référence du paiement externe suit la ligne de moyen', () => {
  it('est enregistrée quand elle est donnée, absente sinon, et relue avec les lignes', async () => {
    // La caisse est polymorphe (source_type + source_id, sans clé étrangère) :
    // un identifiant suffit pour exercer la ligne.
    const sourceId = '00000000-0000-7000-8000-00000000ab38';
    // La vraie écriture, par la voie normale.
    const { DbService } = await import('../src/db/db.service.js');
    const db = (tender as unknown as { db: InstanceType<typeof DbService> }).db;
    await inTenant(() =>
      db.query((tx) =>
        tender.post(tx, {
          sourceType: 'depense',
          sourceId,
          direction: 'in',
          total: '5000.00',
          lines: [
            { paymentMethodId: bankilyId, amount: '3000.00', reference: ' BK-2026-000123 ' },
            { paymentMethodId: cashId, amount: '2000.00' },
          ],
        }),
      ),
    );
    const lignes = await inTenant(() => db.query((tx) => tender.linesFor(tx, 'depense', sourceId)));
    const bankily = lignes.find((l) => l.moyen === 'Bankily')!;
    const especes = lignes.find((l) => l.moyen === 'Espèces')!;
    expect(bankily.reference).toBe('BK-2026-000123'); // coupée de ses espaces
    expect(especes.reference).toBeNull();
    const { resumeMoyens } = await import('../src/finance/expenses.service.js');
    expect(resumeMoyens(lignes)).toBe('Bankily 3 000 (réf. BK-2026-000123) + Espèces 2 000');
  });
});
