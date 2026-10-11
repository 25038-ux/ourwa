import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { CollectionService } from '../src/finance/collection.service.js';
import { PaymentsService } from '../src/finance/payments.service.js';
import { ExpensesService } from '../src/finance/expenses.service.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { fenetreAnnee } from '../src/finance/annulations.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * UN PAIEMENT ANNULÉ DISPARAÎT DE TOUS LES RAPPORTS — El Mourad, 0.7.9.
 *
 * « You cancel a month (15000 for instance) and then rapports journalier and
 * mensuel and every rapports still shows it and per payement rapports and total
 * encaissé etc. still shows it and that makes the numbers don't add up between
 * the screen and the real solde in our caisse. »
 *
 * Le scénario : octobre payé 10 000 en espèces, novembre 10 000 par Bankily,
 * puis octobre ANNULÉ ; une dépense de 3 000, une autre de 2 000 annulée. La
 * caisse réelle : +10 000 Bankily, −3 000 espèces. Chaque rapport doit dire
 * exactement cela — ni l'octobre annulé, ni son annulation, ni la dépense
 * annulée. De l'argent : le test d'abord (règle 15).
 */

let owner: pg.Pool;
let collection: CollectionService;
let payments: PaymentsService;
let expenses: ExpensesService;
let reports: ReportsService;
let enrollments: EnrollmentService;

let schoolId: string;
let yearId: string;
let groupId: string;
let especes: string;
let bankily: string;
let ACTOR: string;
let jour: string;
let mois: number;
let annee: number;
let studentId: string;

const START_YEAR = 2019; // chaque mois est échu

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'annul' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  schoolId = (await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('annul', 'Annulations', 'ANN') RETURNING id`,
  )).rows[0]!.id;
  yearId = (await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status) VALUES ($1, '2019-2020', $2, 'active') RETURNING id`,
    [schoolId, START_YEAR],
  )).rows[0]!.id;
  const level = (await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle) VALUES ($1, '5eme', 10000, 'college') RETURNING id`,
    [schoolId],
  )).rows[0]!.id;
  groupId = (await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '5eme A') RETURNING id`, [schoolId, level],
  )).rows[0]!.id;
  ACTOR = (await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('annul.caisse@test', 'x', 'Caissière') RETURNING id`,
  )).rows[0]!.id;
  especes = (await owner.query<{ id: string }>(
    `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Especes') RETURNING id`, [schoolId],
  )).rows[0]!.id;
  bankily = (await owner.query<{ id: string }>(
    `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Bankily') RETURNING id`, [schoolId],
  )).rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  collection = moduleRef.get(CollectionService);
  payments = moduleRef.get(PaymentsService);
  expenses = moduleRef.get(ExpensesService);
  reports = moduleRef.get(ReportsService);
  enrollments = moduleRef.get(EnrollmentService);

  const g = (await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('annul.parent@test', 'x', 'Parent') RETURNING id`,
  )).rows[0]!.id;
  studentId = (await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, 'RIM-ANN', 'NID-ANN', 'Salma', 'Annul') RETURNING id`,
    [schoolId, g],
  )).rows[0]!.id;
  await inTenant(() =>
    enrollments.enrol({ studentId, academicYearId: yearId, groupId, entryDate: `${START_YEAR}-10-01` }, ACTOR, ['scolarite.niveaux']),
  );

  const oct = await inTenant(() =>
    collection.encaisserGroupe(
      { studentId, mois: [{ mois: 10, annee: START_YEAR }], tender: [{ paymentMethodId: especes, amount: '10000.00' }] },
      ACTOR,
    ),
  );
  await inTenant(() =>
    collection.encaisserGroupe(
      { studentId, mois: [{ mois: 11, annee: START_YEAR }], tender: [{ paymentMethodId: bankily, amount: '10000.00' }] },
      ACTOR,
    ),
  );
  // Octobre : annulé.
  await inTenant(() => payments.reverse(oct.paymentIds[0]!, 'Erreur de saisie', ACTOR));

  // Deux dépenses en espèces ; la seconde annulée.
  await inTenant(() => expenses.record({ amount: '3000', description: 'Craies', tender: [{ paymentMethodId: especes, amount: '3000' }] }, ACTOR));
  const d2 = await inTenant(() =>
    expenses.record({ amount: '2000', description: 'Erreur', tender: [{ paymentMethodId: especes, amount: '2000' }] }, ACTOR),
  );
  await inTenant(() => expenses.reverse((d2 as { id: string }).id, 'Saisie en double', ACTOR));

  const { rows } = await owner.query<{ j: string; m: number; a: number }>(
    `SELECT CURRENT_DATE::text AS j, EXTRACT(MONTH FROM CURRENT_DATE)::int AS m, EXTRACT(YEAR FROM CURRENT_DATE)::int AS a`,
  );
  jour = rows[0]!.j;
  mois = rows[0]!.m;
  annee = rows[0]!.a;
});

afterAll(async () => {
  await owner?.end();
});

describe('un paiement annulé disparaît de tous les rapports', () => {
  it('⚠ le rapport journalier : 10 000 entrés (Bankily), 3 000 sortis (espèces) — rien d’autre', async () => {
    const j = await inTenant(() => reports.revenusDuJour(jour));
    expect(j.total).toBe('10000.00');
    expect(j.sortant).toBe('3000.00');
    expect(j.moyens).toEqual([
      { moyen: 'Bankily', entrant: '10000.00', sortant: '0.00' },
      { moyen: 'Especes', entrant: '0.00', sortant: '3000.00' },
    ]);
    expect(j.parMoyen).toEqual([{ moyen: 'Bankily', total: '10000.00' }]);
  });

  it('⚠ les transactions du jour : ni l’octobre annulé, ni son annulation, ni la dépense annulée', async () => {
    const tx = await inTenant(() => reports.transactions({ day: jour }));
    expect(tx.map((t) => [t.direction, t.amount, t.method]).sort()).toEqual([
      ['in', '10000.00', 'Bankily'],
      ['out', '3000.00', 'Especes'],
    ]);
  });

  it('⚠ le mois : par moyen, et les totaux', async () => {
    const parMoyen = await inTenant(() => reports.byPaymentMethod(mois, annee));
    expect(parMoyen.map((m) => [m.name, m.entrant, m.sortant])).toEqual([
      ['Bankily', '10000.00', '0.00'],
      ['Especes', '0.00', '3000.00'],
    ]);
    const m = await inTenant(() => reports.monthly(mois, annee));
    expect(m.income.tuition).toBe('10000.00');
    expect(m.outgoings.expenses).toBe('3000.00');
    expect(m.receipts).toBe(1);
    const jours = await inTenant(() => reports.dailyCollections(mois, annee));
    expect(jours.map((d) => d.total)).toEqual(['10000.00']);
  });

  it('⚠ la caisse du jour (tableau de bord)', async () => {
    const t = await inTenant(() => reports.today());
    expect(t.collected).toBe('10000.00');
    expect(t.receipts).toBe(1);
    expect(t.expenses).toBe('3000.00');
  });

  it('⚠ la période : par moyen, jour par jour, et les totaux', async () => {
    const p = await inTenant(() => reports.periode(jour, jour));
    expect(p.entrant).toBe('10000.00');
    expect(p.sortant).toBe('3000.00');
    expect(p.solde).toBe('7000.00');
    expect(p.moyens).toEqual([
      { moyen: 'Bankily', entrant: '10000.00', sortant: '0.00' },
      { moyen: 'Especes', entrant: '0.00', sortant: '3000.00' },
    ]);
    expect(p.jours).toHaveLength(1);
    expect(p.jours[0]!.jour).toBe(jour);
    expect(p.jours[0]!.entrant).toBe('10000.00');
    expect(p.jours[0]!.sortant).toBe('3000.00');
    expect(p.jours[0]!.transactions).toHaveLength(2);
  });

  it('⚠ la synthèse de l’année (caisse)', async () => {
    const y = new Date().getUTCFullYear();
    const b = await inTenant(() => reports.bilanAnneeScolaire({ id: yearId, label: 'x', start_year: y - 1, start_month: 1, end_month: 12 }));
    // Une fenêtre qui couvre aujourd'hui, quelle que soit la date du test.
    expect(b.source).toBe('caisse');
    expect(b.encaisse).toBe('10000.00');
    expect(b.depense).toBe('3000.00');
  });

  it('le reçu annulé reste lisible (le grand livre ne change pas)', async () => {
    const { rows } = await owner.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM payments WHERE student_id = $1',
      [studentId],
    );
    expect(rows[0]!.n).toBe('3'); // octobre, son annulation, novembre
  });
});

describe('la période : ses bornes', () => {
  it('refuse une fin avant le début, et plus d’un an', async () => {
    await expect(inTenant(() => reports.periode('2026-09-10', '2026-09-01'))).rejects.toThrow(/fin/);
    await expect(inTenant(() => reports.periode('2025-01-01', '2026-06-01'))).rejects.toThrow(/366/);
  });

  it('un jour sans mouvement : zéro, et aucun jour listé', async () => {
    const p = await inTenant(() => reports.periode('2001-01-01', '2001-01-03'));
    expect(p.entrant).toBe('0.00');
    expect(p.jours).toEqual([]);
  });
});

describe('la fenêtre d’une année scolaire', () => {
  it('⚠ octobre → juin : du 1er JUILLET au 30 juin — la rentrée de septembre en fait partie', () => {
    expect(fenetreAnnee({ start_year: 2026, start_month: 10, end_month: 6 })).toEqual({ du: '2026-07-01', au: '2027-06-30' });
    expect(fenetreAnnee({ start_year: 2026, start_month: 9, end_month: 6 })).toEqual({ du: '2026-07-01', au: '2027-06-30' });
  });

  it('les années se suivent sans trou', () => {
    const a = fenetreAnnee({ start_year: 2025, start_month: 10, end_month: 6 });
    const b = fenetreAnnee({ start_year: 2026, start_month: 10, end_month: 6 });
    expect(a.au).toBe('2026-06-30');
    expect(b.du).toBe('2026-07-01');
  });

  it('juillet de fin : l’année finit le 31 juillet, la suivante commence en août', () => {
    expect(fenetreAnnee({ start_year: 2026, start_month: 9, end_month: 7 })).toEqual({ du: '2026-08-01', au: '2027-07-31' });
  });
});
