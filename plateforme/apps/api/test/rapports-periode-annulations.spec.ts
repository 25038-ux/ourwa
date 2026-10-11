import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PaymentsService } from '../src/finance/payments.service.js';
import { ExpensesService } from '../src/finance/expenses.service.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { money, toStorage } from '@elourwa/shared';
import { parsePlage } from '../src/reports/periode.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LES RAPPORTS — trois demandes du propriétaire (El Mourad, octobre 2026).
 *
 *  1. Une période de PLUSIEURS JOURS (« du … au … »), bornes comprises, en plus
 *     du jour, du mois et de l'année.
 *  2. La « Synthèse — Année scolaire » n'affichait aucun chiffre : la caisse
 *     était bornée aux mois nominaux de l'année (octobre → juin), et l'argent
 *     de la rentrée (septembre) n'était dans aucune année.
 *  3. Un paiement ANNULÉ disparaît des rapports — l'original ET son écriture
 *     d'annulation — comme dans El Ourwa, qui supprime ses `paiement_lignes`.
 *     Le grand livre, lui, reste intact : rien n'est effacé.
 */

let owner: pg.Pool;
let payments: PaymentsService;
let expenses: ExpensesService;
let enrollments: EnrollmentService;
let reports: ReportsService;

let schoolId: string;
let yearId: string;
let studentId: string;
let staffId: string;
let cashId: string;
let bankilyId: string;
let ACTOR: string;
let jour: string;
let mois: number;
let an: number;

const START_YEAR = 2020;
const ANNEE = { label: '2020-2021', start_year: START_YEAR, start_month: 10, end_month: 6 };

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'rap' }, fn);
}

/** Tout ce que les deux pages lisent pour un jour et son mois. */
async function instantane() {
  return inTenant(async () => {
    const j = await reports.revenusDuJour(jour);
    const journal = await reports.transactions({ day: jour });
    const moyens = await reports.byPaymentMethod(mois, an);
    const m = await reports.monthly(mois, an);
    const bilan = await reports.bilanAnneeScolaire({ id: yearId, ...ANNEE });
    return { j, journal, moyens, m, bilan };
  });
}

const moyen = (rows: { name: string; entrant: string; sortant: string }[], name: string) =>
  rows.find((r) => r.name === name)!;

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('rap', 'Rapports', 'RAP') RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const year = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2020-2021', $2, 'active') RETURNING id`,
    [schoolId, START_YEAR],
  );
  yearId = year.rows[0]!.id;

  const level = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle) VALUES ($1, '6eme', 10000, 'college') RETURNING id`,
    [schoolId],
  );
  const group = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6eme A') RETURNING id`,
    [schoolId, level.rows[0]!.id],
  );

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('rap.caisse@test', 'x', 'Caissier') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;
  const guardian = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('rap.parent@test', 'x', 'Parent Rap') RETURNING id`,
  );
  const student = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, 'RIM-RAP', 'NID-RAP', 'Rap', 'Eleve') RETURNING id`,
    [schoolId, guardian.rows[0]!.id],
  );
  studentId = student.rows[0]!.id;

  const staff = await owner.query<{ id: string }>(
    `INSERT INTO staff (school_id, first_name, last_name, role_title, salary)
     VALUES ($1, 'Sidi', 'Gardien', 'Gardien', 30000) RETURNING id`,
    [schoolId],
  );
  staffId = staff.rows[0]!.id;

  const methods = await owner.query<{ id: string; name: string }>(
    `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Especes'), ($1, 'Bankily') RETURNING id, name`,
    [schoolId],
  );
  cashId = methods.rows.find((r) => r.name === 'Especes')!.id;
  bankilyId = methods.rows.find((r) => r.name === 'Bankily')!.id;

  const today = await owner.query<{ j: string; m: number; a: number }>(
    `SELECT CURRENT_DATE::text AS j, EXTRACT(MONTH FROM CURRENT_DATE)::int AS m, EXTRACT(YEAR FROM CURRENT_DATE)::int AS a`,
  );
  jour = today.rows[0]!.j;
  mois = today.rows[0]!.m;
  an = today.rows[0]!.a;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  payments = moduleRef.get(PaymentsService);
  expenses = moduleRef.get(ExpensesService);
  enrollments = moduleRef.get(EnrollmentService);
  reports = moduleRef.get(ReportsService);

  await inTenant(() =>
    enrollments.enrol(
      { studentId, academicYearId: yearId, groupId: group.rows[0]!.id, entryDate: `${START_YEAR}-10-01` },
      ACTOR,
      ['scolarite.niveaux'],
    ),
  );
});

afterAll(async () => {
  await owner?.end();
});

describe('3. un paiement annulé disparaît des rapports', () => {
  it('⚠ scolarité : payé → visible partout ; annulé → plus nulle part, totaux revenus au chiffre d’avant', async () => {
    const avant = await instantane();

    const paiement = await inTenant(() =>
      payments.record(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 11,
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

    const paye = await instantane();
    // Le jour : total, par moyen, par origine.
    expect(paye.j.total).toBe('10000.00');
    expect(paye.j.parMoyen).toEqual([
      { moyen: 'Especes', total: '6000.00' },
      { moyen: 'Bankily', total: '4000.00' },
    ]);
    expect(paye.j.parSource).toEqual([
      { source_type: 'paiement', total: '10000.00', label: 'Frais scolaires' },
    ]);
    // Le journal du jour : une ligne par moyen.
    expect(paye.journal.map((l) => [l.direction, l.sourceType, l.amount]).sort()).toEqual([
      ['in', 'paiement', '4000.00'],
      ['in', 'paiement', '6000.00'],
    ]);
    // Par moyen, sur le mois.
    expect(moyen(paye.moyens, 'Especes')).toMatchObject({ entrant: '6000.00', sortant: '0.00' });
    expect(moyen(paye.moyens, 'Bankily')).toMatchObject({ entrant: '4000.00', sortant: '0.00' });
    expect(paye.m.income.tuition).toBe('10000.00');
    expect(paye.m.receipts).toBe(1);

    const annulation = await inTenant(() => payments.reverse(paiement.id, 'Saisi sur le mauvais élève', ACTOR));
    expect(annulation.amount).toBe('-10000.00');

    const apres = await instantane();
    // Plus rien : ni l'original, ni l'écriture d'annulation.
    expect(apres.j).toEqual(avant.j);
    expect(apres.j.total).toBe('0.00');
    expect(apres.j.parMoyen).toEqual([]);
    expect(apres.j.parSource).toEqual([]);
    expect(apres.journal).toEqual([]);
    expect(apres.moyens).toEqual(avant.moyens);
    expect(moyen(apres.moyens, 'Especes')).toMatchObject({ entrant: '0.00', sortant: '0.00' });
    expect(moyen(apres.moyens, 'Bankily')).toMatchObject({ entrant: '0.00', sortant: '0.00' });
    expect(apres.m.income.tuition).toBe('0.00');
    expect(apres.m.income.total).toBe(avant.m.income.total);
    expect(apres.m.receipts).toBe(0);
    expect(apres.m.net).toBe(avant.m.net);

    // ⚠ LE GRAND LIVRE N'A PAS BOUGÉ : deux écritures, l'originale intacte,
    // et leurs lignes de caisse dans les deux sens.
    const { rows: livre } = await owner.query<{ amount: string; reverses_id: string | null }>(
      'SELECT amount, reverses_id FROM payments WHERE school_id = $1 ORDER BY paid_at, amount DESC',
      [schoolId],
    );
    expect(livre.map((r) => r.amount).sort()).toEqual(['-10000.00', '10000.00']);
    const { rows: lignes } = await owner.query<{ direction: string; n: string }>(
      `SELECT direction, count(*)::text AS n FROM tender_lines
        WHERE school_id = $1 AND source_type = 'paiement' GROUP BY direction ORDER BY direction`,
      [schoolId],
    );
    expect(lignes).toEqual([{ direction: 'in', n: '2' }, { direction: 'out', n: '2' }]);

    // Et le contrôle de caisse tient toujours, des deux côtés.
    const till = await inTenant(() => payments.tillConsistency());
    expect(till).toEqual({ payments: 2, mismatched: 0, gap: '0.00' });
    expect(apres.bilan.controle).toEqual({ paiements: 2, sans_ligne: 0, ecart_nb: 0, ecart_montant: '0.00' });
  });

  it('⚠ dépense : payée → visible ; annulée → plus de sortie, et SURTOUT aucune « entrée » de dépense', async () => {
    const avant = await instantane();

    const depense = await inTenant(() =>
      expenses.record(
        { amount: '2500.50', description: 'Fournitures', tender: [{ paymentMethodId: cashId, amount: '2500.50' }] },
        ACTOR,
      ),
    );

    const payee = await instantane();
    expect(payee.journal.map((l) => [l.direction, l.sourceType, l.amount])).toEqual([['out', 'depense', '2500.50']]);
    expect(moyen(payee.moyens, 'Especes')).toMatchObject({ entrant: '0.00', sortant: '2500.50' });
    expect(payee.m.outgoings.expenses).toBe('2500.50');
    // Une dépense n'est pas un encaissement.
    // ⚠ FUSION (0.7.10) — cette assertion était `expect(payee.j).toEqual(avant.j)`.
    // Le rapport du jour porte désormais AUSSI les sorties (El Mourad, 30/09,
    // ADR-0076 : `sortant`, `solde`, `moyens`, `origines`) : une dépense payée
    // ne change toujours RIEN aux entrées — c'est ce que la phrase voulait dire,
    // et c'est ce qui reste vérifié —, mais elle paraît en sortie.
    const entrees = (j: typeof avant.j) => ({ total: j.total, parMoyen: j.parMoyen, parSource: j.parSource });
    expect(entrees(payee.j)).toEqual(entrees(avant.j));
    expect(payee.j.sortant).toBe('2500.50');
    expect(payee.j.moyens).toEqual([{ moyen: 'Especes', entrant: '0.00', sortant: '2500.50' }]);

    await inTenant(() => expenses.reverse(depense.id, 'Double saisie', ACTOR));

    const apres = await instantane();
    expect(apres.journal).toEqual([]);
    expect(apres.moyens).toEqual(avant.moyens);
    expect(apres.m.outgoings.expenses).toBe('0.00');
    expect(apres.m.net).toBe(avant.m.net);
    // L'annulation écrit des lignes « in » : elles ne sont pas un revenu du jour.
    expect(apres.j.total).toBe('0.00');
    expect(apres.j.parMoyen).toEqual([]);
    expect(apres.j.parSource).toEqual([]);
    // … et la sortie annulée n'est plus une sortie : le jour entier est celui d'avant.
    expect(apres.j).toEqual(avant.j);
    expect(apres.bilan.encaisse).toBe(avant.bilan.encaisse);
    expect(apres.bilan.depense).toBe(avant.bilan.depense);

    // Rien n'a été effacé.
    const { rows } = await owner.query<{ amount: string; reversed: boolean }>(
      'SELECT amount, reversed FROM expenses WHERE school_id = $1 ORDER BY amount',
      [schoolId],
    );
    expect(rows).toEqual([
      { amount: '-2500.50', reversed: false },
      { amount: '2500.50', reversed: true },
    ]);
  });

  it('⚠ salaire : une paie annulée (écriture négative) sort des rapports, elle aussi', async () => {
    const avant = await instantane();

    const original = await owner.query<{ id: string }>(
      `INSERT INTO salary_payments (school_id, payee_kind, payee_id, payee_name, calendar_month, calendar_year, gross, net, paid_by)
       VALUES ($1, 'staff', $2, 'Sidi Gardien', $3, $4, 30000, 30000, $5) RETURNING id`,
      [schoolId, staffId, mois, an, ACTOR],
    );
    await owner.query(
      `INSERT INTO tender_lines (school_id, source_type, source_id, payment_method_id, amount, direction)
       VALUES ($1, 'salaire_staff', $2, $3, 30000, 'out')`,
      [schoolId, original.rows[0]!.id, cashId],
    );

    const payee = await instantane();
    expect(payee.journal.map((l) => [l.direction, l.sourceType, l.amount])).toEqual([['out', 'salaire_staff', '30000.00']]);
    expect(payee.m.outgoings.salaries).toBe('30000.00');
    expect((await inTenant(() => reports.salairesDuMois(mois, an))).staff).toBe('30000.00');

    // L'annulation, telle que le grand livre la porte : l'original marqué,
    // une écriture négative qui le désigne, et l'argent qui revient.
    await owner.query('UPDATE salary_payments SET reversed = true WHERE id = $1', [original.rows[0]!.id]);
    const negation = await owner.query<{ id: string }>(
      `INSERT INTO salary_payments (school_id, payee_kind, payee_id, payee_name, calendar_month, calendar_year, gross, net, paid_by, reverses_id)
       VALUES ($1, 'staff', $2, 'Sidi Gardien', $3, $4, -30000, -30000, $5, $6) RETURNING id`,
      [schoolId, staffId, mois, an, ACTOR, original.rows[0]!.id],
    );
    await owner.query(
      `INSERT INTO tender_lines (school_id, source_type, source_id, payment_method_id, amount, direction)
       VALUES ($1, 'salaire_staff', $2, $3, 30000, 'in')`,
      [schoolId, negation.rows[0]!.id, cashId],
    );

    const apres = await instantane();
    expect(apres.journal).toEqual([]);
    expect(apres.moyens).toEqual(avant.moyens);
    expect(apres.j.total).toBe('0.00');
    expect(apres.j.parSource).toEqual([]);
    expect(apres.m.outgoings.salaries).toBe('0.00');
    expect(apres.m.outgoings.salariesStaff).toBe('0.00');
    expect((await inTenant(() => reports.salairesDuMois(mois, an))).staff).toBe('0.00');
  });
});

describe('1. une période de plusieurs jours, bornes comprises', () => {
  const ids: string[] = [];

  beforeAll(async () => {
    // Trois dépenses, datées de trois jours de mars 2021 — et une recette.
    for (const [i, d] of ['2021-03-10', '2021-03-11', '2021-03-12'].entries()) {
      const e = await inTenant(() =>
        expenses.record(
          { amount: `${i + 1}000.00`, description: `Jour ${d}`, tender: [{ paymentMethodId: cashId, amount: `${i + 1}000.00` }] },
          ACTOR,
        ),
      );
      ids.push(e.id);
      await owner.query(`UPDATE tender_lines SET created_at = $2::timestamptz WHERE source_id = $1`, [e.id, `${d} 12:00:00`]);
      await owner.query(`UPDATE expenses SET spent_at = $2::timestamptz WHERE id = $1`, [e.id, `${d} 12:00:00`]);
    }
    const p = await inTenant(() =>
      payments.record(
        {
          studentId, academicYearId: yearId, calendarMonth: 3, calendarYear: START_YEAR + 1,
          amount: '10000.00', tender: [{ paymentMethodId: bankilyId, amount: '10000.00' }],
        },
        ACTOR,
      ),
    );
    await owner.query(`UPDATE tender_lines SET created_at = '2021-03-11 09:00:00' WHERE source_id = $1`, [p.id]);
    await owner.query(`UPDATE payments SET paid_at = '2021-03-11 09:00:00' WHERE id = $1`, [p.id]);
  });

  it('le journal « du 10 au 11 » porte les deux jours et pas le troisième', async () => {
    const journal = await inTenant(() => reports.transactions({ from: '2021-03-10', to: '2021-03-11' }));
    expect(journal.map((l) => [l.direction, l.amount]).sort()).toEqual([
      ['in', '10000.00'],
      ['out', '1000.00'],
      ['out', '2000.00'],
    ]);
    expect(journal.every((l) => typeof l.amount === 'string')).toBe(true);
  });

  it('la synthèse par moyen « du 10 au 11 » additionne les deux jours, en chaînes', async () => {
    const moyens = await inTenant(() => reports.byPaymentMethod({ from: '2021-03-10', to: '2021-03-11' }));
    expect(moyen(moyens, 'Especes')).toMatchObject({ entrant: '0.00', sortant: '3000.00' });
    expect(moyen(moyens, 'Bankily')).toMatchObject({ entrant: '10000.00', sortant: '0.00' });
  });

  it('les revenus « du 11 au 12 » : la recette du 11, par moyen et par origine', async () => {
    const r = await inTenant(() => reports.revenusDuJour('2021-03-11', '2021-03-12'));
    expect(r.total).toBe('10000.00');
    expect(r.parMoyen).toEqual([{ moyen: 'Bankily', total: '10000.00' }]);
    expect(r.parSource).toEqual([{ source_type: 'paiement', total: '10000.00', label: 'Frais scolaires' }]);
    expect((await inTenant(() => reports.revenusDuJour('2021-03-12', '2021-03-12'))).total).toBe('0.00');
  });

  it('une période d’un seul jour égale ce jour ; le jour, le mois et l’année répondent comme avant', async () => {
    const unJour = await inTenant(() => reports.transactions({ from: '2021-03-12', to: '2021-03-12' }));
    const leJour = await inTenant(() => reports.transactions({ day: '2021-03-12' }));
    expect(unJour).toEqual(leJour);
    expect(leJour.map((l) => l.amount)).toEqual(['3000.00']);

    const leMois = await inTenant(() => reports.transactions({ month: 3, year: 2021 }));
    expect(leMois).toHaveLength(4);
    const moisMoyens = await inTenant(() => reports.byPaymentMethod(3, 2021));
    expect(moyen(moisMoyens, 'Especes')).toMatchObject({ entrant: '0.00', sortant: '6000.00' });
    expect(moyen(moisMoyens, 'Bankily')).toMatchObject({ entrant: '10000.00', sortant: '0.00' });
    // Le mois entier, demandé comme une période : les mêmes chiffres.
    expect(await inTenant(() => reports.byPaymentMethod({ from: '2021-03-01', to: '2021-03-31' }))).toEqual(moisMoyens);
    expect((await inTenant(() => reports.revenusDuJour('2021-03-11'))).total).toBe('10000.00');
  });

  it('⚠ refuse une période mal formée', () => {
    expect(parsePlage(undefined, undefined)).toBeUndefined();
    expect(parsePlage('2021-03-10', '2021-03-11')).toEqual({ from: '2021-03-10', to: '2021-03-11' });
    expect(parsePlage('2021-03-10', '2021-03-10')).toEqual({ from: '2021-03-10', to: '2021-03-10' });
    // Une année entière, bissextile comprise, passe.
    expect(parsePlage('2024-01-01', '2024-12-31')).toEqual({ from: '2024-01-01', to: '2024-12-31' });

    expect(() => parsePlage('2021-03-11', '2021-03-10')).toThrow('La date de début doit précéder la date de fin.');
    expect(() => parsePlage('2021-03-10', undefined)).toThrow('Indiquez les deux dates de la période');
    expect(() => parsePlage(undefined, '2021-03-10')).toThrow('Indiquez les deux dates de la période');
    expect(() => parsePlage('2021-02-30', '2021-03-10')).toThrow('Date invalide');
    expect(() => parsePlage('2021-13-01', '2021-13-02')).toThrow('Date invalide');
    expect(() => parsePlage('10/03/2021', '11/03/2021')).toThrow('Date invalide');
    expect(() => parsePlage("2021-03-10'; DROP TABLE payments;--", '2021-03-11')).toThrow('Date invalide');
    expect(() => parsePlage('2021-01-01', '2022-01-02')).toThrow('ne peut pas dépasser 366 jours');
  });

  it('⚠ des lignes du MÊME instant sortent dans un ordre fixe — le même par jour, par période et par mois', async () => {
    // 10/10/2026 : le journal n'était trié que par date. Les lignes d'un même
    // instant (les moyens d'un reçu, les mois réglés d'un coup) sortaient dans
    // l'ordre du plan que Postgres choisissait — sur les données de l'école,
    // novembre 2025 demandé comme un mois et comme une période donnait deux
    // ordres. Désormais : la plus récemment écrite d'abord (`id` décroissant).
    // Deux dépenses à deux moyens, les quatre lignes au même instant, un jour
    // qu'aucun autre test ne regarde (et hors de l'année : la synthèse l'ignore).
    for (const [a, b] of [['100.00', '200.00'], ['300.00', '400.00']] as const) {
      const e = await inTenant(() =>
        expenses.record(
          {
            amount: toStorage(money(a).plus(money(b))),
            description: 'Même instant',
            tender: [{ paymentMethodId: cashId, amount: a }, { paymentMethodId: bankilyId, amount: b }],
          },
          ACTOR,
        ),
      );
      await owner.query(`UPDATE tender_lines SET created_at = '2020-02-10 12:00:00' WHERE source_id = $1`, [e.id]);
      await owner.query(`UPDATE expenses SET spent_at = '2020-02-10 12:00:00' WHERE id = $1`, [e.id]);
    }
    const { rows } = await owner.query<{ id: string; amount: string }>(
      `SELECT id, amount::text FROM tender_lines
        WHERE school_id = $1 AND created_at = '2020-02-10 12:00:00' ORDER BY id DESC`,
      [schoolId],
    );
    const attendu = rows.map((r) => r.amount);
    expect([...attendu].sort()).toEqual(['100.00', '200.00', '300.00', '400.00']);

    const parJour = await inTenant(() => reports.transactions({ day: '2020-02-10' }));
    const parPeriode = await inTenant(() => reports.transactions({ from: '2020-02-10', to: '2020-02-10' }));
    const parMois = await inTenant(() => reports.transactions({ month: 2, year: 2020 }));
    expect(parJour.map((l) => l.amount)).toEqual(attendu);
    expect(parPeriode).toEqual(parJour);
    expect(parMois).toEqual(parJour);

    // Et pour des lignes REPRISES d'El Ourwa, c'est SON numéro qui départage
    // (`legacy_id`, l'ordre où il les a écrites) : l'identifiant d'ici a été
    // tiré à l'import et ne suit pas cet ordre (867 instants partagés sur 3 968
    // dans les données de l'école). On donne donc aux deux lignes que `id`
    // classait EN TÊTE les numéros chez lui, le plus petit à la première : les
    // lignes d'ici (sans numéro, les plus récentes) restent devant, puis les
    // reprises, numéro décroissant — l'inverse de leur ordre par `id`.
    await owner.query('UPDATE tender_lines SET legacy_id = 990001 WHERE id = $1', [rows[0]!.id]);
    await owner.query('UPDATE tender_lines SET legacy_id = 990002 WHERE id = $1', [rows[1]!.id]);
    const avecReprises = [attendu[2], attendu[3], attendu[1], attendu[0]];
    const jourRepris = await inTenant(() => reports.transactions({ day: '2020-02-10' }));
    expect(jourRepris.map((l) => l.amount)).toEqual(avecReprises);
    expect(await inTenant(() => reports.transactions({ month: 2, year: 2020 }))).toEqual(jourRepris);
  });
});

describe('2. la « Synthèse — Année scolaire » compte l’argent de l’année', () => {
  it('une année qui a des paiements rend des chiffres non nuls', async () => {
    const bilan = await inTenant(() => reports.bilanAnneeScolaire({ id: yearId, ...ANNEE }));
    // Mars 2021 est dans octobre 2020 → juin 2021.
    expect(bilan.source).toBe('caisse');
    expect(bilan.encaisse).toBe('10000.00');
    expect(bilan.depense).toBe('6000.00');
    expect(typeof bilan.encaisse).toBe('string');
  });

  it('⚠ l’argent de la RENTRÉE (septembre, avant le premier mois nominal) est dans l’année', async () => {
    // L'année « commence » en octobre ; l'école encaisse dès la rentrée. Bornée
    // à ses mois nominaux, la synthèse d'une année qui démarre affichait 0.
    const p = await inTenant(() =>
      payments.record(
        {
          studentId, academicYearId: yearId, calendarMonth: 10, calendarYear: START_YEAR,
          amount: '10000.00', tender: [{ paymentMethodId: cashId, amount: '10000.00' }],
        },
        ACTOR,
      ),
    );
    await owner.query(`UPDATE tender_lines SET created_at = '2020-09-15 10:00:00' WHERE source_id = $1`, [p.id]);
    await owner.query(`UPDATE payments SET paid_at = '2020-09-15 10:00:00' WHERE id = $1`, [p.id]);

    const bilan = await inTenant(() => reports.bilanAnneeScolaire({ id: yearId, ...ANNEE }));
    expect(bilan.encaisse).toBe('20000.00');
    expect(bilan.depense).toBe('6000.00');
    // « Entrées − sorties depuis le … » dit la vraie borne.
    expect(bilan.du <= '2020-09-15').toBe(true);
    expect(bilan.controle.sans_ligne).toBe(0);
    expect(bilan.controle.ecart_nb).toBe(0);
  });

  it('une année suivante OUVERTE referme la précédente : son argent n’est pas compté deux fois', async () => {
    const suivante = await owner.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, label, start_year, status)
       VALUES ($1, '2021-2022', 2021, 'future') RETURNING id`,
      [schoolId],
    );
    const e = await inTenant(() =>
      expenses.record(
        { amount: '700.00', description: 'Rentrée 2021', tender: [{ paymentMethodId: cashId, amount: '700.00' }] },
        ACTOR,
      ),
    );
    await owner.query(`UPDATE tender_lines SET created_at = '2021-09-20 10:00:00' WHERE source_id = $1`, [e.id]);

    // Tant que la suivante n'est que « créée », septembre 2021 reste à 2020-2021.
    const ouverte = await inTenant(() => reports.bilanAnneeScolaire({ id: yearId, ...ANNEE }));
    expect(ouverte.depense).toBe('6700.00');

    // La suivante ouverte, 2020-2021 s'arrête à sa fin nominale ; la rentrée 2021 passe à 2021-2022.
    await owner.query(`UPDATE academic_years SET status = 'closed', closed_at = now() WHERE id = $1`, [yearId]);
    await owner.query(`UPDATE academic_years SET status = 'active' WHERE id = $1`, [suivante.rows[0]!.id]);
    const close = await inTenant(() => reports.bilanAnneeScolaire({ id: yearId, ...ANNEE }));
    expect(close.depense).toBe('6000.00');
    expect(close.au).toBe('2021-06-30');
    const nouvelle = await inTenant(() =>
      reports.bilanAnneeScolaire({ id: suivante.rows[0]!.id, label: '2021-2022', start_year: 2021, start_month: 10, end_month: 6 }),
    );
    expect(nouvelle.depense).toBe('700.00');
    expect(nouvelle.du).toBe('2021-07-01');
  });
});
