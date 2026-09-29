import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { payableMonths } from '@elourwa/db';
import { SERVICES_OPTIONNELS, libelleService, money } from '@elourwa/shared';
import { CollectionService } from '../src/finance/collection.service.js';
import { PaymentsService } from '../src/finance/payments.service.js';
import { ReportsService, SOURCE_LABELS } from '../src/reports/reports.service.js';
import { ParentController } from '../src/parent/parent.controller.js';
import { EnrollmentController } from '../src/academic/academic.controller.js';
import type { AuthenticatedRequest } from '../src/auth/permissions.guard.js';
import { AppModule } from '../src/app.module.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { AdmissionsService } from '../src/admissions/admissions.service.js';
import { FeesService } from '../src/finance/fees.service.js';
import { DebtService } from '../src/finance/debt.service.js';
import { BillingModelService } from '../src/finance/billing-model.service.js';
import { TarifsService } from '../src/finance/tarifs.service.js';
import {
  StudentServicesService,
  moisDeDepartParDefaut,
} from '../src/finance/student-services.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { hashPassword } from '../src/auth/passwords.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LA FACTURATION « SERVICES » (Jinan) — tarifs, modes d'étude, inscription,
 * abonnements. ADR-0073 ; docs/specs/jinan-facturation.md §2, §3, §4, §8, §9 ;
 * les points 1 à 6 de son §11.
 *
 * ⚠ ÉCRIT AVANT LE CODE (règle 15) : cela décide de ce qu'une famille doit.
 *
 * Deux écoles dans la même base, sur la même pile de connexions :
 *   - « fsv-jinan », modèle « services » : deux modes d'étude au tarif différent
 *     par niveau, des frais d'inscription par niveau et PAR ÉLÈVE, des services
 *     optionnels par élève, chacun exemptable seul ;
 *   - « fsv-nour », modèle « famille » (la valeur par défaut) : El Ourwa tel
 *     qu'il est, et qui doit le rester au centime près.
 *
 * L'année 2025-2026 (octobre → juin) : neuf mois, d'ordre 1 (octobre 2025) à
 * 9 (juin 2026).
 */

let owner: pg.Pool;
let app: NestFastifyApplication;
let enrollments: EnrollmentService;
let admissions: AdmissionsService;
let fees: FeesService;
let debts: DebtService;
let billing: BillingModelService;
let tarifs: TarifsService;
let abonnements: StudentServicesService;

const S = { schoolId: '', slug: 'fsv-jinan' };
const F = { schoolId: '', slug: 'fsv-nour' };

let yearS: string;
let closedYearS: string;
let yearF: string;
/** 6ème : 3 000 / 4 500, inscription 2 000. */
let level6: string;
/** 5ème : 3 500 / non défini, inscription 1 000. */
let level5: string;
/** 4ème : 3 800 / 5 000, inscription gratuite (0). */
let level4: string;
/** 3ème : 4 000 / 5 500, inscription non définie. */
let level3: string;
let group6: string;
let group5: string;
let group4: string;
let group3: string;
let groupF: string;
let ACTOR: string;

const START_YEAR = 2025;
const DIRECTION = ['scolarite.niveaux', 'scolarite.inscrire', 'scolarite.reinscrire'];
const PASSWORD = 'dev12345';

const MODE_REQUIS = "Choisissez le mode d'étude : 8h – 14h ou 8h – 17h.";
const FAMILLE_REFUS =
  "Cette école facture par famille : elle ne connaît ni mode d'étude ni services par élève.";

const inS = <T>(fn: () => Promise<T>) => runInTenant(S, fn);
const inF = <T>(fn: () => Promise<T>) => runInTenant(F, fn);

let seq = 0;
const tag = (t: string) => `${t}-${++seq}`;

async function parent(t: string): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', $2) RETURNING id`,
    [`fsv.${t}@test`, `Parent ${t}`],
  );
  return rows[0]!.id;
}

async function eleve(schoolId: string, t: string, guardianId: string | null = null): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, $3, $3, $4, 'Fsv') RETURNING id`,
    [schoolId, guardianId, `RIM-FSV-${t}`, t],
  );
  return rows[0]!.id;
}

/** Inscrit un élève neuf de l'école « services ». */
async function inscrire(
  opts: {
    groupId?: string;
    studyMode?: '8h-14h' | '8h-17h';
    services?: ('cantine_petit_dejeuner' | 'cantine_dejeuner' | 'cantine_complet' | 'piscine' | 'docteur' | 'photocopie')[];
    entryDate?: string;
    monthlyFee?: string;
    isFree?: boolean;
    roles?: string[];
    guardianId?: string | null;
  } = {},
) {
  const studentId = await eleve(S.schoolId, tag('ins'), opts.guardianId ?? null);
  const r = await inS(() =>
    enrollments.enrol(
      {
        studentId,
        academicYearId: yearS,
        groupId: opts.groupId ?? group6,
        studyMode: opts.studyMode ?? '8h-14h',
        services: opts.services,
        entryDate: opts.entryDate,
        monthlyFee: opts.monthlyFee,
        isFree: opts.isFree,
      },
      ACTOR,
      DIRECTION,
      opts.roles ?? [],
    ),
  );
  return { studentId, r };
}

async function abonnementsDe(studentId: string) {
  const { rows } = await owner.query<{
    id: string;
    service: string;
    famille: string;
    amount: string;
    start_month: number;
    start_year: number;
    exempt: boolean;
    ended_at: Date | null;
  }>(
    `SELECT id, service, famille, amount::text, start_month, start_year, exempt, ended_at
       FROM student_services WHERE student_id = $1 ORDER BY service, created_at`,
    [studentId],
  );
  return rows;
}

async function moisDe(subscriptionId: string) {
  const { rows } = await owner.query<{ calendar_month: number; calendar_year: number; amount_due: string }>(
    `SELECT calendar_month, calendar_year, amount_due::text FROM student_service_months
      WHERE student_service_id = $1 ORDER BY calendar_year, calendar_month`,
    [subscriptionId],
  );
  return rows;
}

async function inscription(studentId: string) {
  const { rows } = await owner.query<{ study_mode: string | null; full_rate: string; monthly_fee: string }>(
    `SELECT study_mode, full_rate::text, monthly_fee::text FROM enrollments
      WHERE student_id = $1 AND academic_year_id IN ($2, $3)`,
    [studentId, yearS, yearF],
  );
  return rows[0];
}

async function moisScolarite(studentId: string) {
  const { rows } = await owner.query<{ calendar_month: number; calendar_year: number; amount_due: string; status: string }>(
    `SELECT m.calendar_month, m.calendar_year, m.amount_due::text, m.status::text
       FROM enrollment_months m JOIN enrollments e ON e.id = m.enrollment_id
      WHERE e.student_id = $1 ORDER BY m.month_order`,
    [studentId],
  );
  return rows;
}

let recu = 0;
/** Un encaissement de service tel que le reçu groupé l'écrira (étape suivante). */
async function payerService(
  sub: { id: string },
  studentId: string,
  guardianId: string,
  month: number,
  year: number,
  amount: string,
): Promise<string> {
  const number = `FSJ-T-${String(++recu).padStart(5, '0')}`;
  const r = await owner.query<{ id: string }>(
    `INSERT INTO receipts (school_id, academic_year_id, guardian_id, receipt_number, amount)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [S.schoolId, yearS, guardianId, number, amount],
  );
  const p = await owner.query<{ id: string }>(
    `INSERT INTO service_payments
       (school_id, student_service_id, student_id, academic_year_id, calendar_month,
        calendar_year, amount, receipt_number, receipt_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [S.schoolId, sub.id, studentId, yearS, month, year, amount, number, r.rows[0]!.id],
  );
  return p.rows[0]!.id;
}

async function annulerService(paymentId: string): Promise<void> {
  const number = `FSJ-T-${String(++recu).padStart(5, '0')}`;
  await owner.query(
    `INSERT INTO service_payments
       (school_id, student_service_id, student_id, academic_year_id, calendar_month,
        calendar_year, amount, receipt_number, reverses_id)
     SELECT school_id, student_service_id, student_id, academic_year_id, calendar_month,
            calendar_year, -amount, $2, id
       FROM service_payments WHERE id = $1`,
    [paymentId, number],
  );
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const s = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix, billing_model)
     VALUES ('fsv-jinan', 'FSV Jinan', 'FSJ', 'services') RETURNING id`,
  );
  S.schoolId = s.rows[0]!.id;
  // École « famille » : la colonne n'est pas nommée — c'est le défaut qu'on éprouve.
  const f = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('fsv-nour', 'FSV Nour', 'FSN') RETURNING id`,
  );
  F.schoolId = f.rows[0]!.id;

  await owner.query(
    `INSERT INTO roles (code, label, is_system, sort_order)
     VALUES ('parent', 'Parent', true, 30) ON CONFLICT (code) DO NOTHING`,
  );

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('fsv.acteur@test', 'x', 'Acteur') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  // ── L'école « services » ──
  const ys = await owner.query<{ id: string; status: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2025-2026', $2, 'active'), ($1, '2023-2024', $3, 'closed')
     RETURNING id, status`,
    [S.schoolId, START_YEAR, START_YEAR - 2],
  );
  yearS = ys.rows.find((r) => r.status === 'active')!.id;
  closedYearS = ys.rows.find((r) => r.status === 'closed')!.id;

  // ⚠ monthly_rate vaut 0 : une école « services » ne le lit jamais. S'il était
  // lu, chaque mensualité vaudrait zéro et le test le verrait.
  const lv = await owner.query<{ id: string; name: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order,
                         monthly_rate_8h14, monthly_rate_8h17, student_enrolment_fee)
     VALUES ($1, '6ème', 0, 'college', 10, 3000, 4500, 2000),
            ($1, '5ème', 0, 'college', 20, 3500, NULL, 1000),
            ($1, '4ème', 0, 'college', 30, 3800, 5000, 0),
            ($1, '3ème', 0, 'college', 40, 4000, 5500, NULL)
     RETURNING id, name`,
    [S.schoolId],
  );
  const lid = (n: string) => lv.rows.find((r) => r.name === n)!.id;
  level6 = lid('6ème');
  level5 = lid('5ème');
  level4 = lid('4ème');
  level3 = lid('3ème');

  const gs = await owner.query<{ id: string; name: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES
       ($1, $2, '6ème A'), ($1, $3, '5ème A'), ($1, $4, '4ème A'), ($1, $5, '3ème A')
     RETURNING id, name`,
    [S.schoolId, level6, level5, level4, level3],
  );
  const gid = (n: string) => gs.rows.find((r) => r.name === n)!.id;
  group6 = gid('6ème A');
  group5 = gid('5ème A');
  group4 = gid('4ème A');
  group3 = gid('3ème A');

  await owner.query(
    `INSERT INTO service_prices (school_id, academic_year_id, service, amount) VALUES
       ($1, $2, 'cantine_petit_dejeuner', 500), ($1, $2, 'cantine_dejeuner', 800),
       ($1, $2, 'cantine_complet', 1200), ($1, $2, 'piscine', 1000),
       ($1, $2, 'docteur', 300), ($1, $2, 'photocopie', 1500)`,
    [S.schoolId, yearS],
  );
  // ⚠ Le barème des frais annuels PAR FAMILLE existe aussi chez Jinan : il ne
  // doit jamais être lu. S'il l'était, chaque famille devrait 7 000 de trop.
  await owner.query(
    `INSERT INTO configuration (school_id, key, value) VALUES ($1, $2, '5000'), ($1, $3, '2000')`,
    [S.schoolId, `frais_inscription_${START_YEAR}`, `frais_photocopie_${START_YEAR}`],
  );

  // ── L'école « famille » ──
  const yf = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2025-2026', $2, 'active') RETURNING id`,
    [F.schoolId, START_YEAR],
  );
  yearF = yf.rows[0]!.id;
  const lf = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order)
     VALUES ($1, '6eme', 10000, 'college', 10) RETURNING id`,
    [F.schoolId],
  );
  const gf = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6eme A') RETURNING id`,
    [F.schoolId, lf.rows[0]!.id],
  );
  groupF = gf.rows[0]!.id;
  await owner.query(
    `INSERT INTO configuration (school_id, key, value) VALUES ($1, $2, '5000'), ($1, $3, '2000')`,
    [F.schoolId, `frais_inscription_${START_YEAR}`, `frais_photocopie_${START_YEAR}`],
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  enrollments = moduleRef.get(EnrollmentService);
  admissions = moduleRef.get(AdmissionsService);
  fees = moduleRef.get(FeesService);
  debts = moduleRef.get(DebtService);
  billing = moduleRef.get(BillingModelService);
  tarifs = moduleRef.get(TarifsService);
  abonnements = moduleRef.get(StudentServicesService);
});

afterAll(async () => {
  await app?.close();
  await owner?.end();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('1. une école « famille » ne voit rien changer', () => {
  it('lit « famille » ; inscrit au tarif du niveau, sans mode ni abonnement', async () => {
    expect(await inF(() => billing.current())).toBe('famille');

    const studentId = await eleve(F.schoolId, tag('fam'));
    const r = await inF(() =>
      enrollments.enrol({ studentId, academicYearId: yearF, groupId: groupF }, ACTOR, DIRECTION),
    );
    // La réponse d'aujourd'hui, clé pour clé : rien d'ajouté pour une école « famille ».
    expect(Object.keys(r).sort()).toEqual(['entryDate', 'feeRequested', 'id', 'monthlyFee']);
    expect(r.monthlyFee).toBe('10000.00');

    expect(await inscription(studentId)).toEqual({
      study_mode: null,
      full_rate: '10000.00',
      monthly_fee: '10000.00',
    });
    expect(await abonnementsDe(studentId)).toEqual([]);
  });

  it('refuse un mode d’étude ou des services, sans rien écrire', async () => {
    const studentId = await eleve(F.schoolId, tag('fam-mode'));
    await expect(
      inF(() =>
        enrollments.enrol(
          { studentId, academicYearId: yearF, groupId: groupF, studyMode: '8h-14h' },
          ACTOR,
          DIRECTION,
        ),
      ),
    ).rejects.toThrow(FAMILLE_REFUS);
    await expect(
      inF(() =>
        enrollments.enrol(
          { studentId, academicYearId: yearF, groupId: groupF, services: ['piscine'] },
          ACTOR,
          DIRECTION,
        ),
      ),
    ).rejects.toThrow(FAMILLE_REFUS);
    expect(await inscription(studentId)).toBeUndefined();
  });

  it('les frais annuels restent dus une fois par famille', async () => {
    const guardianId = await parent(tag('fam-frais'));
    const studentId = await eleve(F.schoolId, tag('fam-frais'), guardianId);
    await inF(() =>
      enrollments.enrol({ studentId, academicYearId: yearF, groupId: groupF }, ACTOR, DIRECTION),
    );

    const dus = await inF(() => fees.annualFeesDue(guardianId, yearF, START_YEAR));
    expect(dus.map((d) => [d.kind, d.remaining.toFixed(2)])).toEqual([
      ['enrolment', '5000.00'],
      ['photocopy', '2000.00'],
    ]);
    const lot = await inF(() => fees.annualFeesDueFor([guardianId], yearF, START_YEAR));
    expect(lot.get(guardianId)!.map((d) => d.remaining.toFixed(2))).toEqual(['5000.00', '2000.00']);
  });

  it('les gestes « services » y sont refusés ; la page « Frais » y lit « famille »', async () => {
    const page = await inF(() => tarifs.tarifs(yearF));
    expect(page.billingModel).toBe('famille');

    await expect(
      inF(() => tarifs.setServicePrices({ academicYearId: yearF, prix: { piscine: '1000' } }, ACTOR)),
    ).rejects.toThrow(/facture par famille/);
    const { rows } = await owner.query<{ id: string }>(
      'SELECT id FROM levels WHERE school_id = $1 LIMIT 1',
      [F.schoolId],
    );
    await expect(
      inF(() => tarifs.setLevelTarifs(rows[0]!.id, { tarif8h14: '3000' }, ACTOR)),
    ).rejects.toThrow(/facture par famille/);

    const studentId = await eleve(F.schoolId, tag('fam-abo'));
    await inF(() =>
      enrollments.enrol({ studentId, academicYearId: yearF, groupId: groupF }, ACTOR, DIRECTION),
    );
    await expect(
      inF(() => abonnements.subscribe({ studentId, academicYearId: yearF, service: 'piscine' }, ACTOR)),
    ).rejects.toThrow(/facture par famille/);
    await expect(
      inF(() => tarifs.changeStudyMode({ studentId, academicYearId: yearF, studyMode: '8h-17h' }, ACTOR)),
    ).rejects.toThrow(/facture par famille/);
    expect(await inF(() => abonnements.forStudent(studentId, yearF))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('2. le mode d’étude', () => {
  it('⚠ sans mode : refus, et rien n’est écrit', async () => {
    const studentId = await eleve(S.schoolId, tag('sans-mode'));
    await expect(
      inS(() =>
        enrollments.enrol({ studentId, academicYearId: yearS, groupId: group6 }, ACTOR, DIRECTION),
      ),
    ).rejects.toThrow(MODE_REQUIS);
    expect(await inscription(studentId)).toBeUndefined();
    expect(await abonnementsDe(studentId)).toEqual([]);
  });

  it('⚠ un mode dont le tarif n’est pas défini : refus', async () => {
    const studentId = await eleve(S.schoolId, tag('mode-indefini'));
    await expect(
      inS(() =>
        enrollments.enrol(
          { studentId, academicYearId: yearS, groupId: group5, studyMode: '8h-17h' },
          ACTOR,
          DIRECTION,
        ),
      ),
    ).rejects.toThrow("Le tarif 8h – 17h du niveau 5ème n'est pas défini — bouton « Frais ».");
    expect(await inscription(studentId)).toBeUndefined();
  });

  it('8h – 14h et 8h – 17h au même niveau : deux mensualités, figées dans l’échéancier', async () => {
    const court = await inscrire({ studyMode: '8h-14h' });
    const long = await inscrire({ studyMode: '8h-17h' });

    expect(court.r.monthlyFee).toBe('3000.00');
    expect(long.r.monthlyFee).toBe('4500.00');
    expect(court.r).toMatchObject({ studyMode: '8h-14h' });
    expect(await inscription(court.studentId)).toEqual({
      study_mode: '8h-14h',
      full_rate: '3000.00',
      monthly_fee: '3000.00',
    });
    expect(await inscription(long.studentId)).toEqual({
      study_mode: '8h-17h',
      full_rate: '4500.00',
      monthly_fee: '4500.00',
    });
    const mc = await moisScolarite(court.studentId);
    const ml = await moisScolarite(long.studentId);
    expect(mc).toHaveLength(9);
    expect(new Set(mc.map((m) => m.amount_due))).toEqual(new Set(['3000.00']));
    expect(new Set(ml.map((m) => m.amount_due))).toEqual(new Set(['4500.00']));

    // Le tarif du niveau change ensuite : rien de ce qui est inscrit ne bouge.
    await inS(() => tarifs.setLevelTarifs(level6, { tarif8h14: '3300' }, ACTOR));
    try {
      expect(await moisScolarite(court.studentId)).toEqual(mc);
      expect((await inscription(court.studentId))!.monthly_fee).toBe('3000.00');
      // …et la prochaine inscription prend le nouveau tarif.
      const suivant = await inscrire({ studyMode: '8h-14h' });
      expect(suivant.r.monthlyFee).toBe('3300.00');
    } finally {
      await inS(() => tarifs.setLevelTarifs(level6, { tarif8h14: '3000' }, ACTOR));
    }
  });

  it('⚠ la substitution « tarif officiel » du comptable compare au tarif DU MODE', async () => {
    // Égal au tarif 8h – 17h : aucune demande. (Comparé à levels.monthly_rate,
    // qui vaut 0 ici, le comptable aurait vu son montant remplacé par zéro.)
    const egal = await inscrire({ studyMode: '8h-17h', monthlyFee: '4500.00', roles: ['comptable'] });
    expect(egal.r.monthlyFee).toBe('4500.00');
    expect(egal.r.feeRequested).toBeUndefined();

    const autre = await inscrire({ studyMode: '8h-17h', monthlyFee: '1000.00', roles: ['secretaire'] });
    expect(autre.r.monthlyFee).toBe('4500.00');
    expect(autre.r.feeRequested).toBe('1000.00');
    expect(new Set((await moisScolarite(autre.studentId)).map((m) => m.amount_due))).toEqual(
      new Set(['4500.00']),
    );
  });

  it('une gratuité reste gratuite, et garde son mode', async () => {
    const libre = await inscrire({ studyMode: '8h-17h', isFree: true });
    expect(libre.r.monthlyFee).toBe('0');
    expect(await inscription(libre.studentId)).toMatchObject({ study_mode: '8h-17h', full_rate: '4500.00' });
  });

  it('une réinscription sur une inscription annulée reprend le nouveau mode', async () => {
    const { studentId } = await inscrire({ studyMode: '8h-14h' });
    await owner.query(`UPDATE enrollments SET status = 'cancelled' WHERE student_id = $1`, [studentId]);
    await inS(() =>
      enrollments.enrol(
        { studentId, academicYearId: yearS, groupId: group6, studyMode: '8h-17h' },
        ACTOR,
        DIRECTION,
      ),
    );
    expect(await inscription(studentId)).toEqual({
      study_mode: '8h-17h',
      full_rate: '4500.00',
      monthly_fee: '4500.00',
    });
    // L'inscription obligatoire n'est pas recréée.
    expect((await abonnementsDe(studentId)).filter((a) => a.service === 'inscription')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('3. les frais d’inscription, par niveau et par élève', () => {
  it('⚠ deux enfants = deux frais d’inscription ; les frais « famille » ne sont jamais dus', async () => {
    const guardianId = await parent(tag('fratrie'));
    const a = await inscrire({ guardianId });
    const b = await inscrire({ guardianId });

    for (const { studentId } of [a, b]) {
      const abos = await abonnementsDe(studentId);
      expect(abos.map((x) => [x.service, x.amount, x.start_month, x.start_year])).toEqual([
        ['inscription', '2000.00', 10, 2025],
      ]);
      expect(await moisDe(abos[0]!.id)).toEqual([
        { calendar_month: 10, calendar_year: 2025, amount_due: '2000.00' },
      ]);
    }
    expect(a.r).toMatchObject({
      services: [expect.objectContaining({ service: 'inscription', amount: '2000.00', created: true })],
    });

    // Le barème par famille (5 000 + 2 000) existe dans `configuration` : il
    // n'est pas lu. Pas de double facturation.
    expect(await inS(() => fees.annualFeesDue(guardianId, yearS, START_YEAR))).toEqual([]);
    const lot = await inS(() => fees.annualFeesDueFor([guardianId], yearS, START_YEAR));
    expect(lot.get(guardianId)).toEqual([]);
    const dette = await inS(() => debts.forGuardian(guardianId, yearS, START_YEAR));
    expect(dette.annualFees).toEqual([]);
  });

  it('dû au premier mois dû de la scolarité (règle du 25)', async () => {
    const tard = await inscrire({ entryDate: '2025-11-28' });
    const abos = await abonnementsDe(tard.studentId);
    expect(abos.map((x) => [x.service, x.start_month, x.start_year])).toEqual([['inscription', 12, 2025]]);
  });

  it('un niveau à 0 : inscription gratuite, aucun abonnement', async () => {
    const { studentId, r } = await inscrire({ groupId: group4 });
    expect(r.monthlyFee).toBe('3800.00');
    expect(await abonnementsDe(studentId)).toEqual([]);
  });

  it('⚠ un niveau sans frais d’inscription définis : refus', async () => {
    const studentId = await eleve(S.schoolId, tag('frais-indefinis'));
    await expect(
      inS(() =>
        enrollments.enrol(
          { studentId, academicYearId: yearS, groupId: group3, studyMode: '8h-14h' },
          ACTOR,
          DIRECTION,
        ),
      ),
    ).rejects.toThrow("Les frais d'inscription du niveau 3ème ne sont pas définis — bouton « Frais ».");
    expect(await inscription(studentId)).toBeUndefined();
  });

  it('une gratuité de scolarité ne dispense pas des frais d’inscription (exemptables à part)', async () => {
    const { studentId } = await inscrire({ isFree: true });
    expect((await abonnementsDe(studentId)).map((a) => a.service)).toEqual(['inscription']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('4. les services souscrits à l’inscription', () => {
  it('⚠ un échéancier mois par mois, au prix figé', async () => {
    const { studentId, r } = await inscrire({
      services: ['cantine_dejeuner', 'piscine', 'photocopie'],
      entryDate: '2025-11-10',
    });
    const abos = await abonnementsDe(studentId);
    expect(abos.map((a) => [a.service, a.famille, a.amount, a.start_month, a.start_year])).toEqual([
      ['cantine_dejeuner', 'cantine', '800.00', 11, 2025],
      ['inscription', 'inscription', '2000.00', 11, 2025],
      ['photocopie', 'photocopie', '1500.00', 11, 2025],
      ['piscine', 'piscine', '1000.00', 11, 2025],
    ]);
    expect((r as { services: unknown[] }).services).toHaveLength(4);

    const par = (s: string) => abos.find((a) => a.service === s)!;
    const cantine = await moisDe(par('cantine_dejeuner').id);
    // Novembre → juin : huit mois, pas octobre (entré après… non : le 10 novembre).
    expect(cantine.map((m) => `${m.calendar_month}/${m.calendar_year}`)).toEqual([
      '11/2025', '12/2025', '1/2026', '2/2026', '3/2026', '4/2026', '5/2026', '6/2026',
    ]);
    expect(new Set(cantine.map((m) => m.amount_due))).toEqual(new Set(['800.00']));
    expect(await moisDe(par('photocopie').id)).toEqual([
      { calendar_month: 11, calendar_year: 2025, amount_due: '1500.00' },
    ]);

    // ⚠ Un changement de prix ensuite ne touche rien de ce qui est souscrit.
    await inS(() =>
      tarifs.setServicePrices({ academicYearId: yearS, prix: { piscine: '2000' } }, ACTOR),
    );
    try {
      expect((await abonnementsDe(studentId)).find((a) => a.service === 'piscine')!.amount).toBe('1000.00');
      expect(new Set((await moisDe(par('piscine').id)).map((m) => m.amount_due))).toEqual(
        new Set(['1000.00']),
      );
      // …et le souscripteur suivant paie le nouveau prix.
      const suivant = await inscrire({ services: ['piscine'] });
      expect((await abonnementsDe(suivant.studentId)).find((a) => a.service === 'piscine')!.amount).toBe(
        '2000.00',
      );
    } finally {
      await inS(() =>
        tarifs.setServicePrices({ academicYearId: yearS, prix: { piscine: '1000' } }, ACTOR),
      );
    }
  });

  it('⚠ un prix non défini : refus, et l’inscription entière n’a pas lieu', async () => {
    await inS(() => tarifs.setServicePrices({ academicYearId: yearS, prix: { docteur: '' } }, ACTOR));
    try {
      const studentId = await eleve(S.schoolId, tag('prix-indefini'));
      await expect(
        inS(() =>
          enrollments.enrol(
            { studentId, academicYearId: yearS, groupId: group6, studyMode: '8h-14h', services: ['docteur'] },
            ACTOR,
            DIRECTION,
          ),
        ),
      ).rejects.toThrow("Le prix du docteur n'est pas défini pour 2025-2026 — bouton « Frais ».");
      expect(await inscription(studentId)).toBeUndefined();
      expect(await abonnementsDe(studentId)).toEqual([]);
    } finally {
      await inS(() => tarifs.setServicePrices({ academicYearId: yearS, prix: { docteur: '300' } }, ACTOR));
    }
  });

  it('deux formules de cantine dans une même demande : refus', async () => {
    const studentId = await eleve(S.schoolId, tag('deux-cantines'));
    await expect(
      inS(() =>
        enrollments.enrol(
          {
            studentId, academicYearId: yearS, groupId: group6, studyMode: '8h-14h',
            services: ['cantine_dejeuner', 'cantine_complet'],
          },
          ACTOR,
          DIRECTION,
        ),
      ),
    ).rejects.toThrow('Une seule formule de cantine par élève : petit déjeuner, déjeuner, ou les deux.');
    expect(await inscription(studentId)).toBeUndefined();
  });

  it('idempotent : un abonnement actif de la même famille n’est pas recréé', async () => {
    const { studentId } = await inscrire({ services: ['cantine_dejeuner', 'docteur'] });
    const avant = await abonnementsDe(studentId);

    const again = await inS(() =>
      enrollments.enrol(
        {
          studentId, academicYearId: yearS, groupId: group6, studyMode: '8h-14h',
          services: ['cantine_complet', 'docteur'],
        },
        ACTOR,
        DIRECTION,
      ),
    );
    expect(await abonnementsDe(studentId)).toEqual(avant);
    const services = (again as { services: { service: string; created: boolean }[] }).services;
    expect(services.every((s) => !s.created)).toBe(true);
    // La cantine en cours reste celle qui a été souscrite.
    expect(services.find((s) => s.service.startsWith('cantine'))!.service).toBe('cantine_dejeuner');
  });

  it('l’admission : le mode et les services dans la même opération', async () => {
    const guardianId = await parent(tag('adm'));
    const r = await inS(() =>
      admissions.admit(
        {
          firstName: 'Aicha', lastName: 'Jinan', rim: 'RIM-FSV-ADM-1', nationalId: 'NID-FSV-ADM-1',
          guardianId, academicYearId: yearS, groupId: group6,
          studyMode: '8h-17h', services: ['cantine_complet'],
        },
        ACTOR,
        DIRECTION,
      ),
    );
    expect(r.monthlyFee).toBe('4500.00');
    expect((await abonnementsDe(r.studentId)).map((a) => [a.service, a.amount])).toEqual([
      ['cantine_complet', '1200.00'],
      ['inscription', '2000.00'],
    ]);
  });

  it('⚠ l’admission sans mode est refusée AVANT de créer l’élève', async () => {
    const guardianId = await parent(tag('adm-sans'));
    await expect(
      inS(() =>
        admissions.admit(
          {
            firstName: 'Sans', lastName: 'Mode', rim: 'RIM-FSV-ADM-2', nationalId: 'NID-FSV-ADM-2',
            guardianId, academicYearId: yearS, groupId: group6,
          },
          ACTOR,
          DIRECTION,
        ),
      ),
    ).rejects.toThrow(MODE_REQUIS);
    const { rows } = await owner.query('SELECT 1 FROM students WHERE rim = $1', ['RIM-FSV-ADM-2']);
    expect(rows).toHaveLength(0);
  });

  it('la réinscription unitaire porte le mode et les services', async () => {
    const studentId = await eleve(S.schoolId, tag('reins'));
    const r = await inS(() =>
      enrollments.reEnrol(studentId, group6, ACTOR, DIRECTION, { studyMode: '8h-17h', services: ['piscine'] }),
    );
    expect(r.monthlyFee).toBe('4500.00');
    expect((await abonnementsDe(studentId)).map((a) => a.service)).toEqual(['inscription', 'piscine']);
  });

  it('⚠ la réinscription en lot exige le mode, pour tous les élèves cochés', async () => {
    const a = await eleve(S.schoolId, tag('lot'));
    const b = await eleve(S.schoolId, tag('lot'));
    await expect(inS(() => enrollments.bulkReEnrol([a, b], group6, ACTOR, DIRECTION))).rejects.toThrow(
      MODE_REQUIS,
    );
    expect(await inscription(a)).toBeUndefined();

    const r = await inS(() => enrollments.bulkReEnrol([a, b], group6, ACTOR, DIRECTION, { studyMode: '8h-17h' }));
    expect(r.enrolled).toBe(2);
    for (const id of [a, b]) {
      expect(await inscription(id)).toMatchObject({ study_mode: '8h-17h', monthly_fee: '4500.00' });
      expect((await abonnementsDe(id)).map((x) => x.service)).toEqual(['inscription']);
    }
  });

  it('⚠ en lot, un mode sans tarif refuse le lot entier, sans compter de « bloqués »', async () => {
    const a = await eleve(S.schoolId, tag('lot-indefini'));
    await expect(
      inS(() => enrollments.bulkReEnrol([a], group5, ACTOR, DIRECTION, { studyMode: '8h-17h' })),
    ).rejects.toThrow("Le tarif 8h – 17h du niveau 5ème n'est pas défini — bouton « Frais ».");
    expect(await inscription(a)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('5. la cantine est exclusive ; l’arrêt', () => {
  it('le mois de départ par défaut suit la règle du 25', () => {
    const mois = payableMonths({ startYear: 2025, startMonth: 10, endMonth: 6 });
    const d = (iso: string) => {
      const m = moisDeDepartParDefaut(mois, new Date(iso));
      return m ? `${m.month}/${m.year}` : null;
    };
    expect(d('2026-01-20T12:00:00Z')).toBe('1/2026');
    expect(d('2026-01-25T12:00:00Z')).toBe('1/2026');
    expect(d('2026-01-26T12:00:00Z')).toBe('2/2026');
    // Avant le début de l'année : le premier mois.
    expect(d('2025-08-01T12:00:00Z')).toBe('10/2025');
    // Après le dernier mois : rien à facturer.
    expect(d('2026-06-26T12:00:00Z')).toBeNull();
    expect(d('2026-07-10T12:00:00Z')).toBeNull();
  });

  it('souscrire depuis la fiche : départ par défaut, ou le mois choisi', async () => {
    const { studentId } = await inscrire();
    const piscine = await inS(() =>
      abonnements.subscribe({ studentId, academicYearId: yearS, service: 'piscine' }, ACTOR, new Date('2026-01-26T09:00:00Z')),
    );
    expect(piscine).toMatchObject({ service: 'piscine', amount: '1000.00', startMonth: 2, startYear: 2026, created: true });
    expect((await moisDe(piscine.id)).map((m) => m.calendar_month)).toEqual([2, 3, 4, 5, 6]);

    const docteur = await inS(() =>
      abonnements.subscribe({ studentId, academicYearId: yearS, service: 'docteur', startMonth: 12, startYear: 2025 }, ACTOR),
    );
    expect((await moisDe(docteur.id)).map((m) => m.calendar_month)).toEqual([12, 1, 2, 3, 4, 5, 6]);

    await expect(
      inS(() =>
        abonnements.subscribe({ studentId, academicYearId: yearS, service: 'photocopie' }, ACTOR, new Date('2026-07-10T09:00:00Z')),
      ),
    ).rejects.toThrow("L'année 2025-2026 est terminée : il ne reste aucun mois à facturer.");
    await expect(
      inS(() =>
        abonnements.subscribe({ studentId, academicYearId: yearS, service: 'photocopie', startMonth: 8, startYear: 2026 }, ACTOR),
      ),
    ).rejects.toThrow("Ce mois n'appartient pas à l'année 2025-2026.");
  });

  it('refuse un élève qui n’est pas inscrit sur l’année', async () => {
    const studentId = await eleve(S.schoolId, tag('non-inscrit'));
    await expect(
      inS(() => abonnements.subscribe({ studentId, academicYearId: yearS, service: 'piscine' }, ACTOR)),
    ).rejects.toThrow("Cet élève n'est pas inscrit sur cette année.");
  });

  it('⚠ un seul abonnement cantine actif ; le même service redemandé n’est pas recréé', async () => {
    const { studentId } = await inscrire({ services: ['cantine_dejeuner'] });
    const dejeuner = (await abonnementsDe(studentId)).find((a) => a.service === 'cantine_dejeuner')!;

    await expect(
      inS(() => abonnements.subscribe({ studentId, academicYearId: yearS, service: 'cantine_complet' }, ACTOR)),
    ).rejects.toThrow(
      "Cet élève a déjà un abonnement « Cantine — déjeuner » en cours : arrêtez-le d'abord pour changer de formule.",
    );
    const encore = await inS(() =>
      abonnements.subscribe({ studentId, academicYearId: yearS, service: 'cantine_dejeuner' }, ACTOR),
    );
    expect(encore).toMatchObject({ id: dejeuner.id, created: false });
    expect(await abonnementsDe(studentId)).toHaveLength(2);
  });

  it('⚠ l’arrêt supprime les mois futurs non payés ; changer de formule devient possible', async () => {
    const { studentId } = await inscrire({ services: ['cantine_dejeuner'] });
    const dejeuner = (await abonnementsDe(studentId)).find((a) => a.service === 'cantine_dejeuner')!;
    expect(await moisDe(dejeuner.id)).toHaveLength(9);

    const r = await inS(() =>
      abonnements.stop(dejeuner.id, { fromMonth: 2, fromYear: 2026 }, ACTOR),
    );
    expect(r).toMatchObject({ id: dejeuner.id, monthsRemoved: 5 });
    expect((await moisDe(dejeuner.id)).map((m) => `${m.calendar_month}/${m.calendar_year}`)).toEqual([
      '10/2025', '11/2025', '12/2025', '1/2026',
    ]);
    expect((await abonnementsDe(studentId)).find((a) => a.id === dejeuner.id)!.ended_at).not.toBeNull();

    const complet = await inS(() =>
      abonnements.subscribe(
        { studentId, academicYearId: yearS, service: 'cantine_complet', startMonth: 2, startYear: 2026 },
        ACTOR,
      ),
    );
    expect(complet.created).toBe(true);
    const mc = await moisDe(complet.id);
    expect(mc.map((m) => m.calendar_month)).toEqual([2, 3, 4, 5, 6]);
    expect(new Set(mc.map((m) => m.amount_due))).toEqual(new Set(['1200.00']));

    await expect(
      inS(() => abonnements.stop(dejeuner.id, { fromMonth: 3, fromYear: 2026 }, ACTOR)),
    ).rejects.toThrow('Cet abonnement est déjà arrêté.');
  });

  it('par défaut, l’arrêt part du mois suivant', async () => {
    const { studentId } = await inscrire({ services: ['docteur'] });
    const docteur = (await abonnementsDe(studentId)).find((a) => a.service === 'docteur')!;
    await inS(() => abonnements.stop(docteur.id, {}, ACTOR, new Date('2026-01-15T09:00:00Z')));
    expect((await moisDe(docteur.id)).map((m) => m.calendar_month)).toEqual([10, 11, 12, 1]);
  });

  it('⚠ refus si un mois à supprimer est réglé ; une annulation le libère', async () => {
    const guardianId = await parent(tag('arret-paye'));
    const { studentId } = await inscrire({ services: ['piscine'], guardianId });
    const piscine = (await abonnementsDe(studentId)).find((a) => a.service === 'piscine')!;
    const paiement = await payerService(piscine, studentId, guardianId, 3, 2026, '1000.00');

    await expect(
      inS(() => abonnements.stop(piscine.id, { fromMonth: 2, fromYear: 2026 }, ACTOR)),
    ).rejects.toThrow("Mars est déjà réglé : arrêtez à partir d'Avril, ou annulez d'abord le paiement.");
    // Rien n'a bougé.
    expect(await moisDe(piscine.id)).toHaveLength(9);
    expect((await abonnementsDe(studentId)).find((a) => a.id === piscine.id)!.ended_at).toBeNull();

    // Le paiement annulé (net 0) ne retient plus le mois : rien n'y a été réglé,
    // et un mois gardé après l'arrêt serait dû pour un service arrêté.
    await annulerService(paiement);
    const r = await inS(() => abonnements.stop(piscine.id, { fromMonth: 2, fromYear: 2026 }, ACTOR));
    expect(r.monthsRemoved).toBe(5);
    // Le grand livre, lui, garde ses deux lignes : append-only.
    const { rows } = await owner.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM service_payments WHERE student_service_id = $1',
      [piscine.id],
    );
    expect(rows[0]!.n).toBe('2');
  });

  it('arrêter après le dernier mois réglé est accepté', async () => {
    const guardianId = await parent(tag('arret-apres'));
    const { studentId } = await inscrire({ services: ['piscine'], guardianId });
    const piscine = (await abonnementsDe(studentId)).find((a) => a.service === 'piscine')!;
    await payerService(piscine, studentId, guardianId, 3, 2026, '500.00');
    // Un paiement partiel compte comme un paiement : on ne supprime pas mars.
    await expect(
      inS(() => abonnements.stop(piscine.id, { fromMonth: 3, fromYear: 2026 }, ACTOR)),
    ).rejects.toThrow("Mars est déjà réglé : arrêtez à partir d'Avril, ou annulez d'abord le paiement.");
    const r = await inS(() => abonnements.stop(piscine.id, { fromMonth: 4, fromYear: 2026 }, ACTOR));
    expect(r.monthsRemoved).toBe(3);
    expect((await moisDe(piscine.id)).map((m) => m.calendar_month)).toEqual([10, 11, 12, 1, 2, 3]);
  });

  it('⚠ l’inscription ne s’arrête pas', async () => {
    const { studentId } = await inscrire();
    const insc = (await abonnementsDe(studentId)).find((a) => a.service === 'inscription')!;
    await expect(
      inS(() => abonnements.stop(insc.id, { fromMonth: 11, fromYear: 2025 }, ACTOR)),
    ).rejects.toThrow("L'abonnement « Frais d'inscription » ne s'arrête pas : exemptez-le si l'école y renonce.");
    expect(await moisDe(insc.id)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('6. l’exemption d’un service seul', () => {
  it('⚠ ses mois pèsent 0 ; les autres services restent dus ; ce qui est payé reste payé', async () => {
    const guardianId = await parent(tag('exempt'));
    const { studentId } = await inscrire({ services: ['cantine_dejeuner', 'piscine'], guardianId });
    const piscine = (await abonnementsDe(studentId)).find((a) => a.service === 'piscine')!;
    await payerService(piscine, studentId, guardianId, 11, 2025, '1000.00');

    const reste = (abos: Awaited<ReturnType<StudentServicesService['forStudent']>>, code: string) =>
      abos
        .find((a) => a.service === code)!
        .months.reduce((t, m) => t + Number(m.outstanding) * 100, 0) / 100;

    const avant = await inS(() => abonnements.forStudent(studentId, yearS));
    expect(reste(avant, 'piscine')).toBe(8000);
    expect(reste(avant, 'cantine_dejeuner')).toBe(7200);

    const ex = await inS(() => abonnements.setExempt(piscine.id, { exempt: true }, ACTOR));
    expect(ex).toMatchObject({ id: piscine.id, exempt: true, changed: true });

    const pendant = await inS(() => abonnements.forStudent(studentId, yearS));
    const p = pendant.find((a) => a.service === 'piscine')!;
    expect(p.exempt).toBe(true);
    expect(new Set(p.months.map((m) => m.state))).toEqual(new Set(['exempt']));
    expect(new Set(p.months.map((m) => m.outstanding))).toEqual(new Set(['0.00']));
    // Novembre, payé avant l'exemption, reste payé.
    expect(p.months.find((m) => m.month === 11)!.paid).toBe('1000.00');
    // La cantine, elle, reste due, mois par mois.
    const c = pendant.find((a) => a.service === 'cantine_dejeuner')!;
    expect(new Set(c.months.map((m) => m.state))).toEqual(new Set(['due']));
    expect(reste(pendant, 'cantine_dejeuner')).toBe(7200);
    expect(reste(pendant, 'inscription')).toBe(2000);

    // Deux fois : rien de plus.
    expect(await inS(() => abonnements.setExempt(piscine.id, { exempt: true }, ACTOR))).toMatchObject({
      changed: false,
    });

    // Réversible.
    await inS(() => abonnements.setExempt(piscine.id, { exempt: false }, ACTOR));
    const apres = await inS(() => abonnements.forStudent(studentId, yearS));
    const pa = apres.find((a) => a.service === 'piscine')!;
    expect(pa.exempt).toBe(false);
    expect(pa.months.find((m) => m.month === 11)!.state).toBe('paid');
    expect(reste(apres, 'piscine')).toBe(8000);
  });

  it('l’inscription s’exempte, élève par élève', async () => {
    const guardianId = await parent(tag('exempt-insc'));
    const a = await inscrire({ guardianId });
    const b = await inscrire({ guardianId });
    const ia = (await abonnementsDe(a.studentId)).find((x) => x.service === 'inscription')!;
    await inS(() => abonnements.setExempt(ia.id, { exempt: true }, ACTOR));
    expect((await abonnementsDe(a.studentId))[0]!.exempt).toBe(true);
    expect((await abonnementsDe(b.studentId))[0]!.exempt).toBe(false);
    const { rows } = await owner.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY created_at`,
      [ia.id],
    );
    expect(rows.map((r) => r.action)).toContain('student_service_exempted');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('changer de mode en cours d’année (direction)', () => {
  it('⚠ réévalue les seuls mois non réglés ; un mois payé garde son prix', async () => {
    const guardianId = await parent(tag('mode'));
    const { studentId } = await inscrire({ studyMode: '8h-14h', guardianId });
    await owner.query(
      `INSERT INTO payments (school_id, student_id, academic_year_id, calendar_month, calendar_year,
                             amount, receipt_number)
       VALUES ($1, $2, $3, 11, 2025, 3000, $4)`,
      [S.schoolId, studentId, yearS, `FSJ-MODE-${seq}`],
    );

    const r = await inS(() =>
      tarifs.changeStudyMode({ studentId, academicYearId: yearS, studyMode: '8h-17h' }, ACTOR),
    );
    expect(r).toMatchObject({ changed: true, from: '8h-14h', to: '8h-17h', monthlyFee: '4500.00', fullRate: '4500.00' });
    expect(r.monthsRepriced).toBe(8);

    expect(await inscription(studentId)).toEqual({
      study_mode: '8h-17h',
      full_rate: '4500.00',
      monthly_fee: '4500.00',
    });
    const mois = await moisScolarite(studentId);
    expect(mois.find((m) => m.calendar_month === 11)!.amount_due).toBe('3000.00');
    expect(mois.filter((m) => m.calendar_month !== 11).every((m) => m.amount_due === '4500.00')).toBe(true);

    // Le même mode : rien ne change (une remise négociée n'est pas écrasée).
    const meme = await inS(() =>
      tarifs.changeStudyMode({ studentId, academicYearId: yearS, studyMode: '8h-17h' }, ACTOR),
    );
    expect(meme).toMatchObject({ changed: false, monthsRepriced: 0 });
  });

  it('refuse un mode dont le tarif n’est pas défini', async () => {
    const { studentId } = await inscrire({ groupId: group5, studyMode: '8h-14h' });
    await expect(
      inS(() => tarifs.changeStudyMode({ studentId, academicYearId: yearS, studyMode: '8h-17h' }, ACTOR)),
    ).rejects.toThrow("Le tarif 8h – 17h du niveau 5ème n'est pas défini — bouton « Frais ».");
    expect((await inscription(studentId))!.study_mode).toBe('8h-14h');
  });

  it('une gratuité reste à 0 en changeant de mode', async () => {
    const { studentId } = await inscrire({ studyMode: '8h-14h', isFree: true });
    const r = await inS(() =>
      tarifs.changeStudyMode({ studentId, academicYearId: yearS, studyMode: '8h-17h' }, ACTOR),
    );
    expect(r).toMatchObject({ monthlyFee: '0.00', fullRate: '4500.00' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('la page « Frais » : tarifs et prix', () => {
  it('lit les niveaux et les six prix de l’année (défaut : l’année active)', async () => {
    const page = await inS(() => tarifs.tarifs());
    expect(page.billingModel).toBe('services');
    expect(page.annee).toMatchObject({ id: yearS, label: '2025-2026', modifiable: true });
    expect(page.niveaux).toEqual([
      { id: level6, nom: '6ème', tarif8h14: '3000.00', tarif8h17: '4500.00', fraisInscription: '2000.00' },
      { id: level5, nom: '5ème', tarif8h14: '3500.00', tarif8h17: null, fraisInscription: '1000.00' },
      { id: level4, nom: '4ème', tarif8h14: '3800.00', tarif8h17: '5000.00', fraisInscription: '0.00' },
      { id: level3, nom: '3ème', tarif8h14: '4000.00', tarif8h17: '5500.00', fraisInscription: null },
    ]);
    expect(page.services.map((s) => s.code)).toEqual([...SERVICES_OPTIONNELS]);
    expect(page.services.find((s) => s.code === 'piscine')).toEqual({
      code: 'piscine', libelle: 'Piscine', periodicite: 'mensuel', prix: '1000.00',
    });
    expect(page.services.find((s) => s.code === 'photocopie')).toMatchObject({ periodicite: 'annuel', prix: '1500.00' });
  });

  it('une année close se lit, ne se modifie pas', async () => {
    const page = await inS(() => tarifs.tarifs(closedYearS));
    expect(page.annee).toMatchObject({ label: '2023-2024', modifiable: false });
    expect(page.services.every((s) => s.prix === null)).toBe(true);
    await expect(
      inS(() => tarifs.setServicePrices({ academicYearId: closedYearS, prix: { piscine: '900' } }, ACTOR)),
    ).rejects.toThrow(/clôturée/);
  });

  it('refuse un montant qui n’en est pas un, et l’inscription (prix du niveau)', async () => {
    for (const mauvais of ['abc', '-5', '12.345', '1e3']) {
      await expect(
        inS(() => tarifs.setServicePrices({ academicYearId: yearS, prix: { piscine: mauvais } }, ACTOR)),
      ).rejects.toThrow();
      await expect(inS(() => tarifs.setLevelTarifs(level6, { tarif8h17: mauvais }, ACTOR))).rejects.toThrow();
    }
    await expect(
      inS(() =>
        tarifs.setServicePrices(
          { academicYearId: yearS, prix: { inscription: '100' } as Record<string, string> },
          ACTOR,
        ),
      ),
    ).rejects.toThrow();
    expect((await inS(() => tarifs.tarifs(yearS))).services.find((s) => s.code === 'piscine')!.prix).toBe('1000.00');
  });

  it('⚠ l’école d’à côté ne voit ni les prix, ni l’année, ni les abonnements de Jinan', async () => {
    // Même base, même pile de connexions : seule la RLS sépare les deux écoles.
    const page = await inF(() => tarifs.tarifs(yearF));
    expect(page.services.every((s) => s.prix === null)).toBe(true);
    expect(page.niveaux.map((n) => n.nom)).toEqual(['6eme']);
    await expect(inF(() => tarifs.tarifs(yearS))).rejects.toThrow(/introuvable/);

    const { studentId } = await inscrire({ services: ['piscine'] });
    expect((await inS(() => abonnements.forStudent(studentId, yearS))).length).toBe(2);
    expect(await inF(() => abonnements.forStudent(studentId, yearS))).toEqual([]);
    const piscine = (await abonnementsDe(studentId)).find((a) => a.service === 'piscine')!;
    await expect(inF(() => abonnements.stop(piscine.id, { fromMonth: 2, fromYear: 2026 }, ACTOR))).rejects.toThrow();
    expect(await moisDe(piscine.id)).toHaveLength(9);
  });

  it('un tarif vidé redevient « non défini » ; chaque geste est audité', async () => {
    const r = await inS(() => tarifs.setLevelTarifs(level4, { fraisInscription: '' }, ACTOR));
    expect(r).toMatchObject({ id: level4, fraisInscription: null, tarif8h14: '3800.00' });
    await inS(() => tarifs.setLevelTarifs(level4, { fraisInscription: '0' }, ACTOR));
    const { rows } = await owner.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE school_id = $1 AND action IN ('level_tarifs_changed', 'service_prices_set')`,
      [S.schoolId],
    );
    expect(rows.map((x) => x.action)).toContain('level_tarifs_changed');
    expect(rows.map((x) => x.action)).toContain('service_prices_set');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('les routes : gardes et formes', () => {
  let direction: string;
  let caisse: string;

  const call = (token: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      payload: payload as never,
      headers: { authorization: `Bearer ${token}`, 'x-school-slug': S.slug },
    });

  beforeAll(async () => {
    // Le rôle « admin » est un code partagé par toute la suite : créé s'il manque,
    // sans lui toucher. Les permissions viennent de deux rôles propres à ce fichier.
    await owner.query(
      `INSERT INTO roles (code, label, is_system, sort_order)
       VALUES ('admin', 'Administrateur', true, 2) ON CONFLICT (code) DO NOTHING`,
    );
    const perms: Record<string, string[]> = {
      fsv_direction: ['scolarite.niveaux', 'finance.dette', 'finance.encaisser', 'finance.consulter', 'scolarite.inscrire', 'scolarite.reinscrire'],
      fsv_caisse: ['finance.dette', 'finance.encaisser', 'finance.consulter', 'scolarite.inscrire', 'scolarite.reinscrire'],
    };
    const hash = await hashPassword(PASSWORD);
    const auth = app.get(AuthService);
    const ctx = { ip: '10.0.0.42', userAgent: 'vitest' };
    const tokens: Record<string, string> = {};
    for (const [code, list] of Object.entries(perms)) {
      const role = await owner.query<{ id: string }>(
        `INSERT INTO roles (code, label, is_system) VALUES ($1, $1, true) RETURNING id`,
        [code],
      );
      for (const p of list) {
        await owner.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [role.rows[0]!.id, p]);
      }
      const user = await owner.query<{ id: string }>(
        'INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id',
        [`${code}@fsv.test`, hash, code],
      );
      const roles = code === 'fsv_direction' ? [code, 'admin'] : [code];
      for (const r of roles) {
        await owner.query(
          `INSERT INTO user_school_roles (user_id, school_id, role_id)
           SELECT $1, $2, id FROM roles WHERE code = $3`,
          [user.rows[0]!.id, S.schoolId, r],
        );
      }
      tokens[code] = (await auth.login(`${code}@fsv.test`, PASSWORD, S.slug, ctx)).accessToken;
    }
    direction = tokens.fsv_direction!;
    caisse = tokens.fsv_caisse!;
  });

  it('GET /finance/tarifs : ouvert à la caisse, en lecture', async () => {
    const r = await call(caisse, 'GET', `/finance/tarifs?academicYearId=${yearS}`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ billingModel: 'services', annee: { id: yearS } });
  });

  it('⚠ prix et tarifs : la direction seule', async () => {
    expect((await call(caisse, 'POST', '/finance/tarifs/services', { academicYearId: yearS, prix: { docteur: '350' } })).statusCode).toBe(403);
    const ok = await call(direction, 'POST', '/finance/tarifs/services', { academicYearId: yearS, prix: { docteur: '300' } });
    expect(ok.statusCode).toBe(201);
    expect((await call(caisse, 'PATCH', `/levels/${level6}/tarifs`, { tarif8h14: '1' })).statusCode).toBe(403);
    const lv = await call(direction, 'PATCH', `/levels/${level6}/tarifs`, { tarif8h14: '3000' });
    expect(lv.statusCode).toBe(200);
    expect(lv.json()).toMatchObject({ tarif8h14: '3000.00' });
    // Une clé qui n'est pas un service optionnel : 400, pas 500.
    expect((await call(direction, 'POST', '/finance/tarifs/services', { academicYearId: yearS, prix: { inscription: '1' } })).statusCode).toBe(400);
  });

  it('souscrire : la caisse ; arrêter, exempter, changer de mode : la direction seule', async () => {
    const { studentId } = await inscrire();
    const sub = await call(caisse, 'POST', `/finance/students/${studentId}/services`, {
      service: 'docteur', academicYearId: yearS, startMonth: 3, startYear: 2026,
    });
    expect(sub.statusCode).toBe(201);
    const id = sub.json().id as string;

    expect((await call(caisse, 'POST', `/finance/student-services/${id}/exempt`, { exempt: true })).statusCode).toBe(403);
    expect((await call(caisse, 'POST', `/finance/student-services/${id}/stop`, { fromMonth: 4, fromYear: 2026 })).statusCode).toBe(403);
    expect((await call(caisse, 'POST', '/finance/concessions/study-mode', { studentId, studyMode: '8h-17h' })).statusCode).toBe(403);

    expect((await call(direction, 'POST', `/finance/student-services/${id}/exempt`, { exempt: true })).statusCode).toBe(201);
    const stop = await call(direction, 'POST', `/finance/student-services/${id}/stop`, { fromMonth: 4, fromYear: 2026 });
    expect(stop.statusCode).toBe(201);
    expect(stop.json()).toMatchObject({ monthsRemoved: 3 });
    const mode = await call(direction, 'POST', '/finance/concessions/study-mode', { studentId, studyMode: '8h-17h' });
    expect(mode.statusCode).toBe(201);
    expect(mode.json()).toMatchObject({ to: '8h-17h', monthlyFee: '4500.00' });

    const liste = await call(caisse, 'GET', `/finance/students/${studentId}/services?academicYearId=${yearS}`);
    expect(liste.statusCode).toBe(200);
    expect((liste.json() as { service: string }[]).map((a) => a.service)).toEqual(['docteur', 'inscription']);
  });

  it('les formulaires d’inscription portent studyMode et services', async () => {
    const a = await eleve(S.schoolId, tag('http-lot'));
    const sans = await call(direction, 'POST', '/enrollments/re-enrol/bulk', { studentIds: [a], groupId: group6 });
    expect(sans.statusCode).toBe(400);
    expect(JSON.stringify(sans.json())).toContain("Choisissez le mode d'étude");

    // « inscription » est ajoutée d'office : elle ne se coche pas.
    const b = await eleve(S.schoolId, tag('http-reins'));
    const coche = await call(direction, 'POST', '/enrollments/re-enrol', {
      studentId: b, groupId: group6, studyMode: '8h-14h', services: ['inscription'],
    });
    expect(coche.statusCode).toBe(400);

    const ok = await call(direction, 'POST', '/enrollments/re-enrol', {
      studentId: b, groupId: group6, studyMode: '8h-14h', services: ['photocopie'],
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ monthlyFee: '3000.00', studyMode: '8h-14h' });
    expect((await abonnementsDe(b)).map((x) => x.service)).toEqual(['inscription', 'photocopie']);

    const lot = await call(direction, 'POST', '/enrollments/re-enrol/bulk', { studentIds: [a], groupId: group6, studyMode: '8h-17h' });
    expect(lot.statusCode).toBe(201);
    expect(lot.json()).toMatchObject({ enrolled: 1 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// LE GRAND LIVRE DES SERVICES ET LA CAISSE — spec §5, §7, §10 (le reçu), §3 ;
// les points 7 et 8 de son §11. ⚠ Écrits AVANT le code (règle 15) : cela décide
// de l'argent qu'une famille remet au guichet et du papier qu'elle garde.
// ═════════════════════════════════════════════════════════════════════════════

type Optionnel = 'cantine_petit_dejeuner' | 'cantine_dejeuner' | 'cantine_complet' | 'piscine' | 'docteur' | 'photocopie';

let collection: CollectionService;
let payments: PaymentsService;
let especesS: string;
let bankilyS: string;
let especesF: string;
/** La caisse : `finance.encaisser` et `finance.dette` (comme le comptable), sans rôle de direction. */
let caisseRg: string;
/** La direction : les mêmes permissions, et le rôle « admin ». */
let directionRg: string;

/** Un élève neuf de Jinan, sa famille, et ses abonnements rangés par code. */
async function familleJinan(
  t: string,
  services: Optionnel[] = [],
  opts: { studyMode?: '8h-14h' | '8h-17h' } = {},
) {
  const guardianId = await parent(tag(t));
  const { studentId } = await inscrire({ services, guardianId, studyMode: opts.studyMode });
  const subs = Object.fromEntries(
    (await abonnementsDe(studentId)).map((a) => [a.service, a.id]),
  ) as Record<string, string>;
  return { guardianId, studentId, subs };
}

/** Ce que la fenêtre dit encore dû : les mois de scolarité et les lignes de service. */
async function resteFenetre(studentId: string) {
  const f = await inS(() => collection.fenetreInscription(studentId, yearS));
  const total = (xs: { reste: string }[]) => xs.reduce((a, x) => a.plus(money(x.reste)), money('0'));
  return total(f.mois).plus(total(f.services));
}

describe('le grand livre des services et la caisse (§5, §7)', () => {
  beforeAll(async () => {
    collection = app.get(CollectionService);
    payments = app.get(PaymentsService);

    const ms = await owner.query<{ id: string; name: string }>(
      `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Especes'), ($1, 'Bankily') RETURNING id, name`,
      [S.schoolId],
    );
    especesS = ms.rows.find((r) => r.name === 'Especes')!.id;
    bankilyS = ms.rows.find((r) => r.name === 'Bankily')!.id;
    const mf = await owner.query<{ id: string }>(
      `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Especes') RETURNING id`,
      [F.schoolId],
    );
    especesF = mf.rows[0]!.id;

    // Deux comptes propres à ces blocs. La caisse détient `finance.dette` comme
    // le comptable d'El Ourwa : c'est le RÔLE qui lui refuse l'annulation.
    await owner.query(
      `INSERT INTO roles (code, label, is_system, sort_order)
       VALUES ('admin', 'Administrateur', true, 2) ON CONFLICT (code) DO NOTHING`,
    );
    const perms = ['finance.encaisser', 'finance.consulter', 'finance.dette'];
    const hash = await hashPassword(PASSWORD);
    const auth = app.get(AuthService);
    const ctx = { ip: '10.0.0.43', userAgent: 'vitest' };
    const tokens: Record<string, string> = {};
    for (const code of ['fsv_caisse_rg', 'fsv_direction_rg']) {
      const role = await owner.query<{ id: string }>(
        `INSERT INTO roles (code, label, is_system) VALUES ($1, $1, true) RETURNING id`,
        [code],
      );
      for (const p of perms) {
        await owner.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [role.rows[0]!.id, p]);
      }
      const user = await owner.query<{ id: string }>(
        'INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id',
        [`${code}@fsv.test`, hash, code],
      );
      for (const r of code === 'fsv_direction_rg' ? [code, 'admin'] : [code]) {
        await owner.query(
          `INSERT INTO user_school_roles (user_id, school_id, role_id)
           SELECT $1, $2, id FROM roles WHERE code = $3`,
          [user.rows[0]!.id, S.schoolId, r],
        );
      }
      tokens[code] = (await auth.login(`${code}@fsv.test`, PASSWORD, S.slug, ctx)).accessToken;
    }
    caisseRg = tokens.fsv_caisse_rg!;
    directionRg = tokens.fsv_direction_rg!;
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('7. le reçu groupé : scolarité et services sous un seul numéro', () => {
    it('la fenêtre d’une école « services » : aucun frais famille, une ligne par échéance de service', async () => {
      const { studentId, subs } = await familleJinan('fen', ['cantine_dejeuner', 'photocopie']);
      const fen = await inS(() => collection.fenetreInscription(studentId, yearS));

      // §3 : le barème PAR FAMILLE (5 000 + 2 000) est dans `configuration` ; il n'est pas lu.
      expect(fen.annexes).toEqual({});
      // La scolarité garde sa forme : neuf mois à 3 000.
      expect(fen.mois).toHaveLength(9);
      expect(new Set(fen.mois.map((m) => m.du))).toEqual(new Set(['3000.00']));

      // Les services annuels d'abord (ordre du catalogue), puis les mois, dans l'ordre de l'année.
      const cantine = (mois: number, annee: number) => ['cantine_dejeuner', mois, annee, '800.00', 'du'];
      expect(fen.services.map((l) => [l.service, l.mois, l.annee, l.du, l.etat])).toEqual([
        ['photocopie', null, null, '1500.00', 'du'],
        ['inscription', null, null, '2000.00', 'du'],
        cantine(10, 2025), cantine(11, 2025), cantine(12, 2025),
        cantine(1, 2026), cantine(2, 2026), cantine(3, 2026),
        cantine(4, 2026), cantine(5, 2026), cantine(6, 2026),
      ]);
      expect(fen.services[2]).toEqual({
        studentServiceId: subs.cantine_dejeuner,
        service: 'cantine_dejeuner',
        label: 'Cantine — déjeuner',
        periodicite: 'mensuel',
        mois: 10,
        annee: 2025,
        libelleMois: 'Octobre 2025',
        du: '800.00',
        paye: '0.00',
        reste: '800.00',
        etat: 'du',
      });
      expect(fen.services[1]).toMatchObject({
        studentServiceId: subs.inscription,
        label: "Frais d'inscription",
        periodicite: 'annuel',
        libelleMois: null,
      });
    });

    it('⚠ scolarité + cantine + photocopie + inscription : UN numéro, moyens = total, le reste dû baisse d’exactement le total', async () => {
      const { guardianId, studentId, subs } = await familleJinan('groupe', ['cantine_dejeuner', 'photocopie']);
      const avant = await resteFenetre(studentId);

      const r = await inS(() =>
        collection.encaisserGroupe(
          {
            studentId,
            academicYearId: yearS,
            mois: [{ mois: 10, annee: 2025 }],
            services: [
              { studentServiceId: subs.cantine_dejeuner!, mois: 10, annee: 2025 },
              { studentServiceId: subs.cantine_dejeuner!, mois: 11, annee: 2025 },
              { studentServiceId: subs.photocopie! },
              { studentServiceId: subs.inscription! },
            ],
            tender: [
              { paymentMethodId: especesS, amount: '5000.00', reference: 'BK-J1' },
              { paymentMethodId: bankilyS, amount: '3100.00' },
            ],
          },
          ACTOR,
        ),
      );
      expect(r.total).toBe('8100.00');
      expect(r.receiptNumber).toMatch(/^FSJ-2025-\d{5}$/);
      expect(r.guardianId).toBe(guardianId);
      expect(r.servicePaymentIds).toHaveLength(4);

      // Un reçu ; une ligne de scolarité ; quatre lignes de service — toutes sous son numéro.
      const { rows: recus } = await owner.query<{ amount: string; receipt_number: string }>(
        'SELECT amount::text, receipt_number FROM receipts WHERE id = $1',
        [r.receiptId],
      );
      expect(recus).toEqual([{ amount: '8100.00', receipt_number: r.receiptNumber }]);
      const { rows: scol } = await owner.query<{ amount: string; receipt_id: string; receipt_number: string }>(
        'SELECT amount::text, receipt_id, receipt_number FROM payments WHERE student_id = $1',
        [studentId],
      );
      expect(scol).toEqual([{ amount: '3000.00', receipt_id: r.receiptId, receipt_number: r.receiptNumber }]);
      const { rows: serv } = await owner.query<{
        service: string; calendar_month: number; calendar_year: number; amount: string;
        receipt_id: string; receipt_number: string; academic_year_id: string; recorded_by: string;
      }>(
        `SELECT ss.service, sp.calendar_month, sp.calendar_year, sp.amount::text, sp.receipt_id,
                sp.receipt_number, sp.academic_year_id, sp.recorded_by
           FROM service_payments sp JOIN student_services ss ON ss.id = sp.student_service_id
          WHERE sp.student_id = $1
          ORDER BY ss.service, sp.calendar_year, sp.calendar_month`,
        [studentId],
      );
      expect(serv.map((s) => [s.service, `${s.calendar_month}/${s.calendar_year}`, s.amount])).toEqual([
        ['cantine_dejeuner', '10/2025', '800.00'],
        ['cantine_dejeuner', '11/2025', '800.00'],
        // Un service annuel est réglé contre son unique échéance.
        ['inscription', '10/2025', '2000.00'],
        ['photocopie', '10/2025', '1500.00'],
      ]);
      expect(new Set(serv.map((s) => s.receipt_id))).toEqual(new Set([r.receiptId]));
      expect(new Set(serv.map((s) => s.receipt_number))).toEqual(new Set([r.receiptNumber]));
      expect(new Set(serv.map((s) => s.academic_year_id))).toEqual(new Set([yearS]));
      expect(new Set(serv.map((s) => s.recorded_by))).toEqual(new Set([ACTOR]));
      // ⚠ Jamais dans `family_fee_payments` (§5) ; `payments` ne porte que le mois.
      const { rows: ff } = await owner.query('SELECT 1 FROM family_fee_payments WHERE guardian_id = $1', [guardianId]);
      expect(ff).toHaveLength(0);

      // Les moyens : un `source_type` par service, et la somme = le reçu, au centime.
      const { rows: parOrigine } = await owner.query<{ source_type: string; total: string }>(
        `SELECT tl.source_type, SUM(tl.amount)::text AS total
           FROM tender_lines tl
          WHERE tl.direction = 'in'
            AND tl.source_id IN (SELECT id FROM payments WHERE receipt_id = $1
                                 UNION ALL
                                 SELECT id FROM service_payments WHERE receipt_id = $1)
          GROUP BY tl.source_type ORDER BY tl.source_type`,
        [r.receiptId],
      );
      expect(parOrigine).toEqual([
        { source_type: 'paiement', total: '3000.00' },
        { source_type: 'service_cantine', total: '1600.00' },
        { source_type: 'service_inscription', total: '2000.00' },
        { source_type: 'service_photocopie', total: '1500.00' },
      ]);

      // L'ordre d'allocation (§7) : le mois de scolarité, puis les services dans
      // l'ordre de la fenêtre. Les 5 000 en espèces (réf. BK-J1) couvrent le mois
      // (3 000), la photocopie (1 500) et le début de l'inscription (500) ;
      // Bankily, le reste.
      const { rows: ventilation } = await owner.query<{
        service: string; name: string; amount: string; reference: string | null;
      }>(
        `SELECT ss.service, pm.name, tl.amount::text, tl.reference
           FROM tender_lines tl
           JOIN service_payments sp ON sp.id = tl.source_id
           JOIN student_services ss ON ss.id = sp.student_service_id
           JOIN payment_methods pm ON pm.id = tl.payment_method_id
          WHERE sp.receipt_id = $1 AND tl.direction = 'in'
          ORDER BY ss.service, sp.calendar_month, pm.name`,
        [r.receiptId],
      );
      expect(ventilation.map((v) => [v.service, v.name, v.amount, v.reference])).toEqual([
        ['cantine_dejeuner', 'Bankily', '800.00', null],
        ['cantine_dejeuner', 'Bankily', '800.00', null],
        ['inscription', 'Bankily', '1500.00', null],
        ['inscription', 'Especes', '500.00', 'BK-J1'],
        ['photocopie', 'Especes', '1500.00', 'BK-J1'],
      ]);

      // Le reçu lu : son mois, ses quatre services, ses moyens — qui font son total.
      const recu = await inS(() => payments.receiptGroup(r.receiptId));
      expect(recu.amount).toBe('8100.00');
      expect(recu.months.map((m) => `${m.month}/${m.year}`)).toEqual(['10/2025']);
      expect(recu.fees).toEqual([]);
      expect(recu.services.map((s) => [s.service, s.month, s.year, s.amount, s.reversedBy])).toEqual([
        ['photocopie', null, null, '1500.00', null],
        ['inscription', null, null, '2000.00', null],
        ['cantine_dejeuner', 10, 2025, '800.00', null],
        ['cantine_dejeuner', 11, 2025, '800.00', null],
      ]);
      expect(recu.services[2]).toMatchObject({
        studentId,
        studentName: expect.stringContaining('Fsv'),
        label: 'Cantine — déjeuner',
        periodicite: 'mensuel',
      });
      expect(recu.tender).toEqual([
        { method: 'Bankily', amount: '3100.00', reference: null },
        { method: 'Especes', amount: '5000.00', reference: 'BK-J1' },
      ]);
      expect(recu.tender.reduce((a, t) => a.plus(money(t.amount)), money('0')).toFixed(2)).toBe(recu.amount);

      // Ce qui reste dû a baissé d'exactement ce qui a été encaissé.
      const apres = await resteFenetre(studentId);
      expect(avant.minus(apres).toFixed(2)).toBe('8100.00');
      const fen = await inS(() => collection.fenetreInscription(studentId, yearS));
      expect(fen.services.filter((l) => l.etat === 'paye').map((l) => `${l.service}:${l.mois ?? '-'}`)).toEqual([
        'photocopie:-', 'inscription:-', 'cantine_dejeuner:10', 'cantine_dejeuner:11',
      ]);

      // Audité, avec ce que le reçu couvre.
      const { rows: audit } = await owner.query<{ after: { lines: string[]; amount: string } }>(
        `SELECT after FROM audit_log WHERE action = 'receipt_group_recorded' AND entity_id = $1`,
        [r.receiptId],
      );
      expect(audit[0]!.after.amount).toBe('8100.00');
      expect(audit[0]!.after.lines).toEqual(
        expect.arrayContaining(['Octobre 2025', "Frais d'inscription", 'Cantine — déjeuner (Octobre 2025)']),
      );
    });

    it('payer un service seul : un reçu d’une seule ligne (« Cochez au moins » l’accepte)', async () => {
      const { studentId, subs } = await familleJinan('seul', ['piscine']);
      const r = await inS(() =>
        collection.encaisserGroupe(
          {
            studentId,
            mois: [],
            services: [{ studentServiceId: subs.piscine!, mois: 12, annee: 2025 }],
            tender: [{ paymentMethodId: especesS, amount: '1000.00' }],
          },
          ACTOR,
        ),
      );
      expect(r.total).toBe('1000.00');
      expect(r.paymentIds).toEqual([]);
      expect(r.servicePaymentIds).toHaveLength(1);
      const recu = await inS(() => payments.receiptGroup(r.receiptId));
      expect(recu.months).toEqual([]);
      expect(recu.services.map((s) => [s.service, s.month, s.year, s.amount])).toEqual([['piscine', 12, 2025, '1000.00']]);
      const { rows } = await owner.query<{ source_type: string; amount: string }>(
        'SELECT source_type, amount::text FROM tender_lines WHERE source_id = $1',
        [r.servicePaymentIds![0]],
      );
      expect(rows).toEqual([{ source_type: 'service_piscine', amount: '1000.00' }]);
      // ⚠ La scolarité de décembre, elle, reste due : un paiement de service ne
      // marque jamais un mois de scolarité réglé (la raison même de §5).
      const fen = await inS(() => collection.fenetreInscription(studentId, yearS));
      expect(fen.mois.find((m) => m.mois === 12)!.etat).toBe('du');
      expect(fen.services.find((l) => l.service === 'piscine' && l.mois === 12)!.etat).toBe('paye');
    });

    it('la fiche : le mode, les abonnements, une sous-ligne par service dans chaque mois, les services annuels, le reçu', async () => {
      const { guardianId, studentId, subs } = await familleJinan('fiche', ['cantine_dejeuner', 'photocopie'], {
        studyMode: '8h-17h',
      });
      const r = await inS(() =>
        collection.encaisserGroupe(
          {
            studentId,
            mois: [],
            services: [
              { studentServiceId: subs.cantine_dejeuner!, mois: 10, annee: 2025 },
              { studentServiceId: subs.photocopie! },
            ],
            tender: [{ paymentMethodId: especesS, amount: '2300.00' }],
          },
          ACTOR,
        ),
      );
      const { rows: pc } = await owner.query<{ id: string }>(
        'SELECT id FROM service_payments WHERE student_service_id = $1',
        [subs.cantine_dejeuner],
      );

      const ledger = await inS(() => debts.familyLedger(guardianId, yearS));
      const enfant = ledger.children.find((c) => c.studentId === studentId)!;
      expect(enfant.studyMode).toBe('8h-17h');
      expect(
        enfant.services.map((a) => [a.service, a.periodicite, a.amount, a.exempt, a.startMonth, a.startYear, a.endedAt]),
      ).toEqual([
        ['cantine_dejeuner', 'mensuel', '800.00', false, 10, 2025, null],
        ['photocopie', 'annuel', '1500.00', false, 10, 2025, null],
        ['inscription', 'annuel', '2000.00', false, 10, 2025, null],
      ]);
      expect(enfant.services[0]).toMatchObject({ id: subs.cantine_dejeuner, label: 'Cantine — déjeuner', famille: 'cantine' });

      const octobre = enfant.months.find((m) => m.month === 10)!;
      // La scolarité d'octobre reste due : seule la cantine l'a été.
      expect(octobre.state).toBe('due');
      expect(octobre.services).toEqual([
        {
          studentServiceId: subs.cantine_dejeuner,
          service: 'cantine_dejeuner',
          label: 'Cantine — déjeuner',
          due: '800.00',
          paid: '800.00',
          outstanding: '0.00',
          state: 'paid',
          paymentId: pc[0]!.id,
          receiptId: r.receiptId,
          receiptNumber: r.receiptNumber,
        },
      ]);
      expect(enfant.months.find((m) => m.month === 1)!.services).toEqual([
        expect.objectContaining({
          service: 'cantine_dejeuner', state: 'due', paid: '0.00', outstanding: '800.00',
          paymentId: null, receiptId: null, receiptNumber: null,
        }),
      ]);
      expect(
        enfant.annualServices.map((l) => [l.service, l.periodicite, l.month, l.year, l.due, l.paid, l.state, l.receiptId]),
      ).toEqual([
        ['photocopie', 'annuel', null, null, '1500.00', '1500.00', 'paid', r.receiptId],
        ['inscription', 'annuel', null, null, '2000.00', '0.00', 'due', null],
      ]);
      expect(enfant.annualServices[1]).toMatchObject({ studentServiceId: subs.inscription, outstanding: '2000.00' });
    });

    it('refuse : une ligne réglée, exemptée, inconnue, sans mois ou hors échéancier ; un total qui ne colle pas ; rien de coché', async () => {
      const { guardianId, studentId, subs } = await familleJinan('refus', ['piscine', 'docteur']);
      const autre = await familleJinan('refus-autre', ['piscine']);
      const payer = (
        services: { studentServiceId: string; mois?: number; annee?: number }[],
        amount: string,
      ) =>
        inS(() =>
          collection.encaisserGroupe(
            { studentId, mois: [], services, tender: [{ paymentMethodId: especesS, amount }] },
            ACTOR,
          ),
        );

      await payer([{ studentServiceId: subs.piscine!, mois: 10, annee: 2025 }], '1000.00');
      await expect(payer([{ studentServiceId: subs.piscine!, mois: 10, annee: 2025 }], '1000.00')).rejects.toThrow(
        /déjà réglé/,
      );

      await inS(() => abonnements.setExempt(subs.docteur!, { exempt: true }, ACTOR));
      await expect(payer([{ studentServiceId: subs.docteur!, mois: 11, annee: 2025 }], '300.00')).rejects.toThrow(
        /exempté/,
      );
      // La fiche le montre « exempté », à zéro.
      const ledger = await inS(() => debts.familyLedger(guardianId, yearS));
      const nov = ledger.children.find((c) => c.studentId === studentId)!.months.find((m) => m.month === 11)!;
      expect(nov.services.find((s) => s.service === 'docteur')).toMatchObject({ state: 'exempt', outstanding: '0.00' });

      // L'abonnement d'un autre élève, ou un identifiant inventé : pas une ligne de CET élève.
      await expect(
        payer([{ studentServiceId: autre.subs.piscine!, mois: 11, annee: 2025 }], '1000.00'),
      ).rejects.toThrow(/pas un service de cet élève/);
      await expect(payer([{ studentServiceId: randomUUID(), mois: 11, annee: 2025 }], '1000.00')).rejects.toThrow(
        /pas un service de cet élève/,
      );
      // Un service mensuel sans mois, ou un mois hors de son échéancier.
      await expect(payer([{ studentServiceId: subs.piscine! }], '1000.00')).rejects.toThrow(/indiquez le mois/);
      await expect(payer([{ studentServiceId: subs.piscine!, mois: 8, annee: 2026 }], '1000.00')).rejects.toThrow(
        /n'est pas un mois de cet abonnement/,
      );
      // Au centime : les moyens doivent égaler le total coché.
      await expect(payer([{ studentServiceId: subs.piscine!, mois: 11, annee: 2025 }], '999.99')).rejects.toThrow(
        /doit égaler le total coché/,
      );
      // Rien de coché.
      await expect(payer([], '1.00')).rejects.toThrow(/Cochez au moins/);
      // Les frais annuels PAR FAMILLE n'existent pas ici (§3).
      await expect(
        inS(() =>
          collection.encaisserGroupe(
            { studentId, mois: [], fraisInscription: true, tender: [{ paymentMethodId: especesS, amount: '5000.00' }] },
            ACTOR,
          ),
        ),
      ).rejects.toThrow(/pas de frais annuels par famille/);

      // Aucun refus n'a rien écrit : la seule ligne est le premier paiement.
      const { rows } = await owner.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM service_payments WHERE student_id = $1',
        [studentId],
      );
      expect(rows[0]!.n).toBe('1');
      const { rows: r2 } = await owner.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM receipts WHERE guardian_id = $1',
        [guardianId],
      );
      expect(r2[0]!.n).toBe('1');
    });

    it('⚠ trois guichets encaissent la même cantine au même instant : elle est payée une fois', async () => {
      const { studentId, subs } = await familleJinan('course', ['cantine_complet']);
      const un = () =>
        inS(() =>
          collection.encaisserGroupe(
            {
              studentId,
              mois: [],
              services: [{ studentServiceId: subs.cantine_complet!, mois: 2, annee: 2026 }],
              tender: [{ paymentMethodId: especesS, amount: '1200.00' }],
            },
            ACTOR,
          ),
        );
      const res = await Promise.allSettled([un(), un(), un()]);
      expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const { rows } = await owner.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total FROM service_payments
          WHERE student_service_id = $1 AND calendar_month = 2 AND calendar_year = 2026`,
        [subs.cantine_complet],
      );
      expect(rows[0]!.total).toBe('1200.00');
    });

    it('⚠ les anciennes portes refusent proprement une école « services », sans rien écrire', async () => {
      const { guardianId, studentId } = await familleJinan('anciennes', ['piscine']);
      await expect(
        inS(() =>
          collection.encaisserInscription(
            { studentId, periode: '2025-10', tender: [{ paymentMethodId: especesS, amount: '3000.00' }] },
            ACTOR,
          ),
        ),
      ).rejects.toThrow(/fenêtre d'encaissement/);
      await expect(
        inS(() =>
          collection.payerFraisAnnuel(
            {
              guardianId,
              academicYearId: yearS,
              kind: 'enrolment',
              montant: '2000.00',
              tender: [{ paymentMethodId: especesS, amount: '2000.00' }],
            },
            ACTOR,
          ),
        ),
      ).rejects.toThrow(/pas de frais annuels par famille/);
      const { rows } = await owner.query('SELECT 1 FROM payments WHERE student_id = $1', [studentId]);
      expect(rows).toHaveLength(0);
      const { rows: ff } = await owner.query('SELECT 1 FROM family_fee_payments WHERE guardian_id = $1', [guardianId]);
      expect(ff).toHaveLength(0);
    });

    it('une école « famille » : ses frais par famille, `services: []` partout, et une ligne de service y est refusée', async () => {
      const guardianId = await parent(tag('fam-caisse'));
      const studentId = await eleve(F.schoolId, tag('fam-caisse'), guardianId);
      await inF(() => enrollments.enrol({ studentId, academicYearId: yearF, groupId: groupF }, ACTOR, DIRECTION));

      const fen = await inF(() => collection.fenetreInscription(studentId, yearF));
      expect(fen.annexes).toEqual({
        inscription: { libelle: "Frais d'inscription", bareme: '5000.00', paye: '0.00', reste: '5000.00', exempte: false },
        photocopie: expect.objectContaining({ bareme: '2000.00', paye: '0.00', reste: '2000.00', exempte: false }),
      });
      expect(fen.services).toEqual([]);

      await expect(
        inF(() =>
          collection.encaisserGroupe(
            {
              studentId,
              mois: [{ mois: 10, annee: 2025 }],
              services: [{ studentServiceId: randomUUID() }],
              tender: [{ paymentMethodId: especesF, amount: '10000.00' }],
            },
            ACTOR,
          ),
        ),
      ).rejects.toThrow(FAMILLE_REFUS);

      const r = await inF(() =>
        collection.encaisserGroupe(
          {
            studentId,
            mois: [{ mois: 10, annee: 2025 }],
            services: [],
            fraisInscription: true,
            tender: [{ paymentMethodId: especesF, amount: '15000.00' }],
          },
          ACTOR,
        ),
      );
      // La réponse d'aujourd'hui, clé pour clé.
      expect(Object.keys(r).sort()).toEqual([
        'academicYearId', 'guardianId', 'message', 'ok', 'paymentIds', 'receiptId', 'receiptNumber', 'total',
      ]);
      expect(r.receiptNumber).toMatch(/^FSN-2025-\d{5}$/);
      const recu = await inF(() => payments.receiptGroup(r.receiptId));
      expect(recu.services).toEqual([]);
      expect(recu.fees.map((f) => f.amount)).toEqual(['5000.00']);
      expect(recu.tender).toEqual([{ method: 'Especes', amount: '15000.00', reference: null }]);

      const ledger = await inF(() => debts.familyLedger(guardianId, yearF));
      const enfant = ledger.children[0]!;
      expect(enfant.studyMode).toBeNull();
      expect(enfant.services).toEqual([]);
      expect(enfant.annualServices).toEqual([]);
      expect(enfant.months.every((m) => Array.isArray(m.services) && m.services.length === 0)).toBe(true);
      expect(enfant.months.find((m) => m.month === 10)!.state).toBe('paid');

      expect(await inF(() => payments.tillConsistency())).toMatchObject({ mismatched: 0, gap: '0.00' });
    });

    it('HTTP : POST /finance/caisse/encaissement porte les services (au plus 60) ; le reçu se lit', async () => {
      const { studentId, subs } = await familleJinan('http', ['docteur']);
      const call = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
        app.inject({
          method,
          url,
          payload: payload as never,
          headers: { authorization: `Bearer ${caisseRg}`, 'x-school-slug': S.slug },
        });
      const trop = Array.from({ length: 61 }, () => ({ studentServiceId: subs.docteur!, mois: 10, annee: 2025 }));
      expect(
        (await call('POST', '/finance/caisse/encaissement', {
          studentId, mois: [], services: trop, tender: [{ paymentMethodId: especesS, amount: '300.00' }],
        })).statusCode,
      ).toBe(400);

      const ok = await call('POST', '/finance/caisse/encaissement', {
        studentId,
        academicYearId: yearS,
        mois: [],
        services: [{ studentServiceId: subs.docteur!, mois: 10, annee: 2025 }, { studentServiceId: subs.inscription! }],
        tender: [{ paymentMethodId: especesS, amount: '2300.00' }],
      });
      expect(ok.statusCode, ok.body).toBe(201);
      const { receiptId } = ok.json() as { receiptId: string };
      const recu = await call('GET', `/finance/receipt-group/${receiptId}`);
      expect(recu.statusCode).toBe(200);
      expect((recu.json() as { services: { service: string }[] }).services.map((s) => s.service)).toEqual([
        'inscription',
        'docteur',
      ]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('8. l’annulation d’un paiement de service', () => {
    /** Piscine d'octobre et de novembre, sur un reçu : 1 500 en espèces (réf. BK-R1) et 500 par Bankily. */
    async function payePiscine(t: string) {
      const fam = await familleJinan(t, ['piscine']);
      const r = await inS(() =>
        collection.encaisserGroupe(
          {
            studentId: fam.studentId,
            mois: [],
            services: [
              { studentServiceId: fam.subs.piscine!, mois: 10, annee: 2025 },
              { studentServiceId: fam.subs.piscine!, mois: 11, annee: 2025 },
            ],
            tender: [
              { paymentMethodId: especesS, amount: '1500.00', reference: 'BK-R1' },
              { paymentMethodId: bankilyS, amount: '500.00' },
            ],
          },
          ACTOR,
        ),
      );
      const { rows } = await owner.query<{ id: string; calendar_month: number }>(
        'SELECT id, calendar_month FROM service_payments WHERE receipt_id = $1',
        [r.receiptId],
      );
      return {
        ...fam,
        r,
        octobre: rows.find((x) => x.calendar_month === 10)!.id,
        novembre: rows.find((x) => x.calendar_month === 11)!.id,
      };
    }

    it('⚠ une ligne négative, un numéro à elle, les moyens recopiés en sortie ; l’original intact', async () => {
      const p = await payePiscine('annul');
      const rev = await inS(() => payments.reverseServicePayment(p.octobre, 'erreur de saisie', ACTOR));
      expect(rev).toMatchObject({
        amount: '-1000.00',
        calendarMonth: 10,
        calendarYear: 2025,
        service: 'piscine',
        studentServiceId: p.subs.piscine,
        guardianId: p.guardianId,
        academicYearId: yearS,
      });
      expect(rev.receiptNumber).toMatch(/^FSJ-2025-\d{5}$/);
      expect(rev.receiptNumber).not.toBe(p.r.receiptNumber);

      const { rows } = await owner.query(
        `SELECT amount::text, reverses_id, receipt_id, receipt_number, student_id, academic_year_id,
                student_service_id, calendar_month, calendar_year
           FROM service_payments WHERE id = $1`,
        [rev.id],
      );
      expect(rows[0]).toEqual({
        amount: '-1000.00',
        reverses_id: p.octobre,
        receipt_id: null,
        receipt_number: rev.receiptNumber,
        student_id: p.studentId,
        academic_year_id: yearS,
        student_service_id: p.subs.piscine,
        calendar_month: 10,
        calendar_year: 2025,
      });
      // L'original n'a pas bougé : append-only.
      const { rows: orig } = await owner.query('SELECT amount::text, receipt_id FROM service_payments WHERE id = $1', [
        p.octobre,
      ]);
      expect(orig[0]).toEqual({ amount: '1000.00', receipt_id: p.r.receiptId });
      // L'argent repart par où il est entré, sous l'origine du service.
      const { rows: out } = await owner.query(
        `SELECT source_type, direction::text AS direction, amount::text, reference, payment_method_id
           FROM tender_lines WHERE source_id = $1`,
        [rev.id],
      );
      expect(out).toEqual([
        { source_type: 'service_piscine', direction: 'out', amount: '1000.00', reference: 'BK-R1', payment_method_id: especesS },
      ]);

      // Octobre redevient dû ; novembre reste réglé.
      const fen = await inS(() => collection.fenetreInscription(p.studentId, yearS));
      expect(
        fen.services
          .filter((l) => l.service === 'piscine' && l.annee === 2025 && (l.mois === 10 || l.mois === 11))
          .map((l) => [l.mois, l.paye, l.reste, l.etat]),
      ).toEqual([
        [10, '0.00', '1000.00', 'du'],
        [11, '1000.00', '0.00', 'paye'],
      ]);
      // Le reçu d'origine dit que la ligne a été annulée ; son total et ses moyens ne bougent pas.
      const recu = await inS(() => payments.receiptGroup(p.r.receiptId));
      expect(recu.amount).toBe('2000.00');
      expect(recu.services.map((s) => [s.month, s.reversedBy])).toEqual([
        [10, rev.receiptNumber],
        [11, null],
      ]);
      expect(recu.tender.reduce((a, t) => a.plus(money(t.amount)), money('0')).toFixed(2)).toBe('2000.00');
      // La fiche : octobre à nouveau « dû », sans paiement vivant à annuler.
      const ledger = await inS(() => debts.familyLedger(p.guardianId, yearS));
      const oct = ledger.children.find((c) => c.studentId === p.studentId)!.months.find((m) => m.month === 10)!;
      expect(oct.services).toEqual([
        expect.objectContaining({ service: 'piscine', paid: '0.00', state: 'due', paymentId: null, receiptId: null }),
      ]);
      // …et on peut le réencaisser.
      await inS(() =>
        collection.encaisserGroupe(
          {
            studentId: p.studentId,
            mois: [],
            services: [{ studentServiceId: p.subs.piscine!, mois: 10, annee: 2025 }],
            tender: [{ paymentMethodId: especesS, amount: '1000.00' }],
          },
          ACTOR,
        ),
      );

      const { rows: audit } = await owner.query<{ action: string; before: { paymentId: string } }>(
        'SELECT action, before FROM audit_log WHERE entity_id = $1',
        [rev.id],
      );
      expect(audit.map((a) => a.action)).toEqual(['service_payment_reversed']);
      expect(audit[0]!.before.paymentId).toBe(p.octobre);
    });

    it('⚠ une seule fois : ni une seconde annulation, ni l’annulation d’une annulation', async () => {
      const p = await payePiscine('une-fois');
      const rev = await inS(() => payments.reverseServicePayment(p.novembre, 'doublon', ACTOR));
      await expect(inS(() => payments.reverseServicePayment(p.novembre, 'encore', ACTOR))).rejects.toThrow(
        'Ce paiement a déjà été annulé.',
      );
      await expect(inS(() => payments.reverseServicePayment(rev.id, 'annuler l’annulation', ACTOR))).rejects.toThrow(
        'Cette écriture est elle-même une annulation.',
      );
      await expect(inS(() => payments.reverseServicePayment(randomUUID(), 'rien', ACTOR))).rejects.toThrow(
        /introuvable/,
      );
    });

    it('⚠ trois clics simultanés : une seule contre-passation', async () => {
      const p = await payePiscine('clics');
      const res = await Promise.allSettled(
        [1, 2, 3].map(() => inS(() => payments.reverseServicePayment(p.octobre, 'double clic', ACTOR))),
      );
      expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const { rows } = await owner.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM service_payments WHERE reverses_id = $1',
        [p.octobre],
      );
      expect(rows[0]!.n).toBe('1');
    });

    it('le contrôle de caisse couvre le grand livre des services', async () => {
      const avant = await inS(() => payments.tillConsistency());
      const p = await payePiscine('till');
      await inS(() => payments.reverseServicePayment(p.octobre, 'contrôle', ACTOR));
      const apres = await inS(() => payments.tillConsistency());
      // Trois écritures de plus (deux encaissements, une annulation), toutes couvertes par leurs moyens.
      expect(apres.payments - avant.payments).toBe(3);
      expect(apres.mismatched).toBe(avant.mismatched);
      expect(apres.gap).toBe(avant.gap);

      // Une ligne de service sans moyens est VUE : c'est ce que le contrôle existe pour trouver.
      const autre = await familleJinan('till-trou', ['docteur']);
      await payerService({ id: autre.subs.docteur! }, autre.studentId, autre.guardianId, 10, 2025, '300.00');
      const trou = await inS(() => payments.tillConsistency());
      expect(trou.mismatched).toBe(apres.mismatched + 1);
      expect(money(trou.gap).minus(money(apres.gap)).toFixed(2)).toBe('300.00');
    });

    it('HTTP : la caisse n’annule pas ; la direction oui, avec un motif', async () => {
      const p = await payePiscine('http-annul');
      const call = (token: string, payload?: unknown) =>
        app.inject({
          method: 'POST',
          url: `/finance/service-payments/${p.octobre}/reverse`,
          payload: payload as never,
          headers: { authorization: `Bearer ${token}`, 'x-school-slug': S.slug },
        });
      expect((await call(caisseRg, { reason: 'erreur de caisse' })).statusCode).toBe(403);
      expect((await call(directionRg, {})).statusCode).toBe(400);
      const ok = await call(directionRg, { reason: 'erreur de caisse' });
      expect(ok.statusCode, ok.body).toBe(201);
      expect(ok.json()).toMatchObject({ amount: '-1000.00', service: 'piscine' });
    });

    it('⚠ l’école d’à côté ne voit ni n’annule le paiement de Jinan', async () => {
      const p = await payePiscine('rls');
      await expect(inF(() => payments.reverseServicePayment(p.octobre, 'intrusion', ACTOR))).rejects.toThrow(
        /introuvable/,
      );
      await expect(inF(() => payments.receiptGroup(p.r.receiptId))).rejects.toThrow(/introuvable/);
      const { rows } = await owner.query('SELECT 1 FROM service_payments WHERE reverses_id = $1', [p.octobre]);
      expect(rows).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LA DETTE ET LES RAPPORTS — spec §6 et §10 ; les points 9 et 10 de son §11.
  // ⚠ Écrits AVANT le code (règle 15) : la dette décide de qui se réinscrit, de
  // qui reçoit ses résultats d'examen, et de ce qu'on réclame au guichet.
  // ═══════════════════════════════════════════════════════════════════════════

  /** La somme des restes d'une liste, en décimal (jamais un nombre JS). */
  const somme = (xs: { outstanding: string }[]) =>
    xs.reduce((a, x) => a.plus(money(x.outstanding)), money('0')).toFixed(2);
  const ecart = (apres: string, avant: string) => money(apres).minus(money(avant)).toFixed(2);

  /** Le nom tel que la dette et les rapports l'écrivent : « prénom nom ». */
  async function nomDe(studentId: string): Promise<string> {
    const { rows } = await owner.query<{ first_name: string; last_name: string }>(
      'SELECT first_name, last_name FROM students WHERE id = $1',
      [studentId],
    );
    return `${rows[0]!.first_name} ${rows[0]!.last_name}`;
  }

  /**
   * CE QUE DISENT LES QUATRE CHEMINS de la dette pour une famille de l'année
   * courante : la fiche (`forGuardian`), les Impayés d'une année
   * (`forGuardians` puis `outstanding(année)`), la porte de réinscription et
   * des examens (`detailAcrossYears`), les Impayés « toutes années ».
   */
  async function quatreChemins(guardianId: string) {
    const seul = await inS(() => debts.forGuardian(guardianId, yearS, START_YEAR));
    const lot = (await inS(() => debts.forGuardians([guardianId], yearS, START_YEAR))).get(guardianId)!;
    const detail = await inS(() => debts.detailAcrossYears(guardianId));
    const impayes = (await inS(() => debts.outstanding(yearS, START_YEAR))).find((l) => l.guardianId === guardianId);
    const toutes = (await inS(() => debts.outstanding(null, null))).find((l) => l.guardianId === guardianId);
    return { seul, lot, detail, impayes, toutes };
  }

  // ───────────────────────────────────────────────────────────────────────────
  describe('9. la dette : les quatre chemins ajoutent les mêmes services, avant les remises', () => {
    /**
     * Une famille de deux enfants, toute l'année 2025-2026 échue :
     *   A (8h – 14h, 3 000) : cantine déjeuner (800 × 9), photocopie (1 500), inscription (2 000) ;
     *   B (8h – 17h, 4 500) : piscine (1 000 × 9, novembre payé 500), docteur EXEMPTÉ, inscription (2 000).
     */
    async function familleDeDeux(t: string) {
      const guardianId = await parent(tag(t));
      const a = await inscrire({ guardianId, services: ['cantine_dejeuner', 'photocopie'] });
      const b = await inscrire({ guardianId, services: ['piscine', 'docteur'], studyMode: '8h-17h' });
      const par = async (studentId: string) =>
        Object.fromEntries((await abonnementsDe(studentId)).map((x) => [x.service, x.id])) as Record<string, string>;
      const subsA = await par(a.studentId);
      const subsB = await par(b.studentId);
      await inS(() => abonnements.setExempt(subsB.docteur!, { exempt: true }, ACTOR));
      await payerService({ id: subsB.piscine! }, b.studentId, guardianId, 11, 2025, '500.00');
      return { guardianId, a: a.studentId, b: b.studentId, subsA, subsB };
    }

    it('⚠ forGuardian == forGuardians == detailAcrossYears == outstanding(), scolarité + services + inscription ; la dette baisse exactement du reçu', async () => {
      const f = await familleDeDeux('dette');

      // Avant tout encaissement.
      // A : 27 000 + 7 200 + 1 500 + 2 000 = 37 700 ; B : 40 500 + 8 500 + 0 + 2 000 = 51 000.
      const avant = await quatreChemins(f.guardianId);
      expect(avant.seul.total).toBe('88700.00');
      expect(avant.detail.total.toFixed(2)).toBe('88700.00');

      // Un reçu groupé : la scolarité d'octobre de A, sa cantine d'octobre, son inscription.
      const r = await inS(() =>
        collection.encaisserGroupe(
          {
            studentId: f.a,
            academicYearId: yearS,
            mois: [{ mois: 10, annee: 2025 }],
            services: [
              { studentServiceId: f.subsA.cantine_dejeuner!, mois: 10, annee: 2025 },
              { studentServiceId: f.subsA.inscription! },
            ],
            tender: [{ paymentMethodId: especesS, amount: '5800.00' }],
          },
          ACTOR,
        ),
      );
      expect(r.total).toBe('5800.00');

      const c = await quatreChemins(f.guardianId);
      // ⚠ La dette a baissé d'exactement le reçu — sur la fiche comme à la porte.
      expect(ecart(avant.seul.total, c.seul.total)).toBe('5800.00');
      expect(ecart(avant.detail.total.toFixed(2), c.detail.total.toFixed(2))).toBe('5800.00');

      // A : 24 000 + 6 400 + 1 500 ; B : 40 500 + 8 500 + 2 000. Total 82 900.
      expect(c.seul).toMatchObject({
        guardianId: f.guardianId,
        annualFees: [],
        beforeWriteOffs: '82900.00',
        writtenOff: '0.00',
        total: '82900.00',
        clearsAll: false,
      });
      // « Mois impayés » = la scolarité seule (§6) ; les services à part.
      expect(c.seul.tuition).toHaveLength(17);
      expect(somme(c.seul.tuition)).toBe('64500.00');
      expect(somme(c.seul.services)).toBe('18400.00');

      // Le même calcul par lot (Impayés d'une année) : ligne pour ligne.
      expect(c.lot).toEqual(c.seul);

      // Toutes années (porte de réinscription, examens, fiche, application) : les mêmes lignes.
      expect(c.detail.total.toFixed(2)).toBe('82900.00');
      expect(c.detail.beforeWriteOffs).toBe('82900.00');
      expect(c.detail.writtenOff).toBe('0.00');
      expect(c.detail.services).toEqual(c.seul.services);
      expect(somme(c.detail.tuition)).toBe('64500.00');
      expect(c.detail.tuition).toHaveLength(17);
      expect((await inS(() => debts.outstandingAcrossYears(f.guardianId))).toFixed(2)).toBe('82900.00');

      // Les Impayés : même total ; les mois comptent la scolarité seule.
      expect(c.impayes).toMatchObject({ total: '82900.00', scolarite: '82900.00', diverses: '0.00', months: 17 });
      expect(c.toutes).toMatchObject({ total: '82900.00', months: 17 });

      // Les lignes : par enfant, les services annuels d'abord, puis mois par mois.
      const lignes = (studentId: string) =>
        c.seul.services
          .filter((l) => l.studentId === studentId)
          .map((l) => [l.service, l.month, l.year, l.outstanding]);
      const cantine = (m: number, y: number) => ['cantine_dejeuner', m, y, '800.00'];
      expect(lignes(f.a)).toEqual([
        ['photocopie', null, null, '1500.00'],
        // Octobre et l'inscription sont réglés ; ils ne sont plus dus.
        cantine(11, 2025), cantine(12, 2025), cantine(1, 2026), cantine(2, 2026),
        cantine(3, 2026), cantine(4, 2026), cantine(5, 2026), cantine(6, 2026),
      ]);
      const piscine = (m: number, y: number, reste = '1000.00') => ['piscine', m, y, reste];
      expect(lignes(f.b)).toEqual([
        ['inscription', null, null, '2000.00'],
        // Novembre : 1 000 dus, 500 payés. Le docteur, exempté, pèse 0 : absent.
        piscine(10, 2025), piscine(11, 2025, '500.00'), piscine(12, 2025), piscine(1, 2026),
        piscine(2, 2026), piscine(3, 2026), piscine(4, 2026), piscine(5, 2026), piscine(6, 2026),
      ]);
      expect(c.seul.services.find((l) => l.service === 'piscine' && l.month === 11)).toEqual({
        studentId: f.b,
        studentName: await nomDe(f.b),
        studentServiceId: f.subsB.piscine,
        service: 'piscine',
        label: 'Piscine',
        periodicite: 'mensuel',
        month: 11,
        year: 2025,
        monthLabel: 'Novembre 2025',
        due: '1000.00',
        paid: '500.00',
        outstanding: '500.00',
      });
      expect(c.seul.services.find((l) => l.service === 'photocopie')).toMatchObject({
        studentId: f.a,
        label: libelleService('photocopie'),
        periodicite: 'annuel',
        month: null,
        year: null,
        monthLabel: null,
        due: '1500.00',
        paid: '0.00',
      });
    });

    it('⚠ un mois de service à venir n’est pas dû ; un service annuel l’est dès l’inscription', async () => {
      const f = await familleDeDeux('futur');
      await inS(() =>
        collection.encaisserGroupe(
          {
            studentId: f.a,
            mois: [{ mois: 10, annee: 2025 }],
            services: [
              { studentServiceId: f.subsA.cantine_dejeuner!, mois: 10, annee: 2025 },
              { studentServiceId: f.subsA.inscription! },
            ],
            tender: [{ paymentMethodId: especesS, amount: '5800.00' }],
          },
          ACTOR,
        ),
      );

      // Le 15 janvier 2026 : octobre → janvier sont échus, février → juin à venir.
      vi.setSystemTime(new Date(2026, 0, 15, 12, 0, 0));
      let c: Awaited<ReturnType<typeof quatreChemins>>;
      try {
        c = await quatreChemins(f.guardianId);
      } finally {
        vi.useRealTimers();
      }
      // A : scolarité nov-déc-jan 9 000, cantine nov-déc-jan 2 400, photocopie 1 500 (annuelle) ;
      // B : scolarité oct→jan 18 000, piscine 1 000 + 500 + 1 000 + 1 000, inscription 2 000.
      expect(c.seul.total).toBe('36400.00');
      expect(somme(c.seul.tuition)).toBe('27000.00');
      expect(somme(c.seul.services)).toBe('9400.00');
      expect(c.lot).toEqual(c.seul);
      expect(c.detail.total.toFixed(2)).toBe('36400.00');
      expect(c.detail.services).toEqual(c.seul.services);
      expect(c.impayes?.total).toBe('36400.00');
      expect(c.toutes?.total).toBe('36400.00');
      // Aucune échéance mensuelle postérieure à janvier 2026.
      const mensuelles = c.seul.services.filter((l) => l.month !== null);
      expect(mensuelles.every((l) => l.year! * 12 + l.month! <= 2026 * 12 + 1)).toBe(true);
      expect(c.seul.services.filter((l) => l.month === null).map((l) => l.service)).toEqual([
        'photocopie',
        'inscription',
      ]);
    });

    it('⚠ la remise s’applique APRÈS les services ; « annuler toute la dette » les couvre aussi', async () => {
      const guardianId = await parent(tag('remise'));
      // 27 000 de scolarité + 9 000 de piscine + 2 000 d'inscription = 38 000.
      await inscrire({ guardianId, services: ['piscine'] });
      await inS(() =>
        debts.grantWriteOff({ guardianId, academicYearId: yearS, amount: '30000.00', reason: 'accord' }, ACTOR),
      );

      const c = await quatreChemins(guardianId);
      // Remise après la somme : 38 000 − 30 000. (Avant les services, on lirait 11 000.)
      expect(c.seul).toMatchObject({ beforeWriteOffs: '38000.00', writtenOff: '30000.00', total: '8000.00' });
      expect(c.lot).toEqual(c.seul);
      expect(c.detail.beforeWriteOffs).toBe('38000.00');
      expect(c.detail.total.toFixed(2)).toBe('8000.00');
      expect(c.impayes?.total).toBe('8000.00');
      expect(c.toutes?.total).toBe('8000.00');

      await inS(() => debts.grantWriteOff({ guardianId, clearsAll: true, reason: 'tout' }, ACTOR));
      const t = await quatreChemins(guardianId);
      expect(t.seul).toMatchObject({ total: '0.00', beforeWriteOffs: '38000.00', writtenOff: '38000.00', clearsAll: true });
      expect(t.lot).toEqual(t.seul);
      expect(t.detail.total.toFixed(2)).toBe('0.00');
      expect(t.impayes).toBeUndefined();
      expect(t.toutes).toBeUndefined();
    });

    it('une scolarité gratuite doit encore ses services, et les portes les voient ; une inscription annulée ne doit rien', async () => {
      const guardianId = await parent(tag('gratuit'));
      // Scolarité gratuite ; inscription 2 000 + docteur 300 × 9 = 4 700.
      const { studentId } = await inscrire({ guardianId, isFree: true, services: ['docteur'] });

      const c = await quatreChemins(guardianId);
      expect(c.seul.tuition).toEqual([]);
      expect(c.seul.total).toBe('4700.00');
      expect(c.detail.total.toFixed(2)).toBe('4700.00');
      expect(c.impayes).toMatchObject({ total: '4700.00', months: 0 });
      // La porte de réinscription et celle des examens lisent ce chiffre.
      expect((await inS(() => debts.outstandingAcrossYears(guardianId))).toFixed(2)).toBe('4700.00');

      await owner.query(`UPDATE enrollments SET status = 'cancelled' WHERE student_id = $1`, [studentId]);
      const d = await quatreChemins(guardianId);
      expect(d.seul.services).toEqual([]);
      expect(d.seul.total).toBe('0.00');
      expect(d.lot).toEqual(d.seul);
      expect(d.detail.services).toEqual([]);
      expect(d.detail.total.toFixed(2)).toBe('0.00');
      expect(d.impayes).toBeUndefined();
      expect(d.toutes).toBeUndefined();
    });

    it('les écrans reçoivent les services : fiche (debt/all), réinscription (recherche et candidats), application', async () => {
      // Un groupe à elle, pour que la liste des candidats ne porte que cette famille.
      const { rows: gz } = await owner.query<{ id: string }>(
        `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6ème Dette') RETURNING id`,
        [S.schoolId, level6],
      );
      const t = tag('ecrans');
      const guardianId = await parent(t);
      const { studentId } = await inscrire({ guardianId, groupId: gz[0]!.id, services: ['docteur'] });
      // 27 000 + 2 700 + 2 000 = 31 700, dont 4 700 de services.

      const http = await app.inject({
        method: 'GET',
        url: `/finance/debt/${guardianId}/all`,
        headers: { authorization: `Bearer ${directionRg}`, 'x-school-slug': S.slug },
      });
      expect(http.statusCode, http.body).toBe(200);
      const body = http.json() as { total: string; services: { service: string; month: number | null; outstanding: string }[] };
      expect(body.total).toBe('31700.00');
      expect(somme(body.services)).toBe('4700.00');
      expect(body.services[0]).toMatchObject({ service: 'inscription', month: null, outstanding: '2000.00' });

      const enrolCtl = app.get(EnrollmentController);
      const recherche = await inS(() => enrolCtl.reEnrolSearch(`Parent ${t}`));
      const fam = recherche.families.find((x) => x.guardianId === guardianId)!;
      expect(fam.debt).toBe('31700.00');
      expect(somme(fam.services)).toBe('4700.00');

      const candidats = await inS(() => enrolCtl.reEnrolCandidates(yearS, gz[0]!.id));
      const famC = candidats.families.find((x) => x.guardianId === guardianId)!;
      expect(famC.debt).toBe('31700.00');
      // Le détail sous la famille fait son chiffre, services compris.
      expect(somme(famC.lines.map((l) => ({ outstanding: l.amount })))).toBe('31700.00');
      const nom = await nomDe(studentId);
      expect(famC.lines).toEqual(
        expect.arrayContaining([
          { who: nom, origin: "Frais d'inscription", paid: '0.00', full: '2000.00', amount: '2000.00' },
          { who: nom, origin: 'Docteur (Octobre 2025)', paid: '0.00', full: '300.00', amount: '300.00' },
        ]),
      );

      const parentCtl = app.get(ParentController);
      const req = {
        auth: { userId: guardianId, schoolId: S.schoolId, roles: ['parent'], permissions: [], impersonated: false },
      } as unknown as AuthenticatedRequest;
      const solde = await inS(() => parentCtl.balance(req));
      expect(solde.total).toBe('31700.00');
      const services = solde.services as { outstanding: string; school: { slug: string } }[];
      expect(somme(services)).toBe('4700.00');
      expect(services[0]!.school.slug).toBe(S.slug);
      expect(solde.parEcole[0]).toMatchObject({ total: '31700.00' });
      expect(somme((solde.parEcole[0] as unknown as { services: { outstanding: string }[] }).services)).toBe('4700.00');
    });

    it('une école « famille » : `services: []` sur les quatre chemins, et ses chiffres d’aujourd’hui', async () => {
      const guardianId = await parent(tag('fam-dette'));
      const studentId = await eleve(F.schoolId, tag('fam-dette'), guardianId);
      await inF(() => enrollments.enrol({ studentId, academicYearId: yearF, groupId: groupF }, ACTOR, DIRECTION));

      // 9 × 10 000 de scolarité + 5 000 + 2 000 de frais PAR FAMILLE.
      const seul = await inF(() => debts.forGuardian(guardianId, yearF, START_YEAR));
      expect(seul.services).toEqual([]);
      expect(seul.annualFees.map((f) => f.outstanding)).toEqual(['5000.00', '2000.00']);
      expect(seul.total).toBe('97000.00');
      expect((await inF(() => debts.forGuardians([guardianId], yearF, START_YEAR))).get(guardianId)).toEqual(seul);
      const detail = await inF(() => debts.detailAcrossYears(guardianId));
      expect(detail.services).toEqual([]);
      expect(detail.total.toFixed(2)).toBe('97000.00');
      const ligne = (await inF(() => debts.outstanding(yearF, START_YEAR))).find((l) => l.guardianId === guardianId);
      expect(ligne).toMatchObject({ total: '97000.00', months: 9 });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('10. les rapports : les revenus par service', () => {
    let reports: ReportsService;
    beforeAll(() => {
      reports = app.get(ReportsService);
    });

    /** Le jour et le mois de la base — ceux où tombent `now()` et `created_at`. */
    async function aujourdhui() {
      const { rows } = await owner.query<{ jour: string; m: number; a: number }>(
        `SELECT current_date::text AS jour,
                EXTRACT(MONTH FROM now())::int AS m, EXTRACT(YEAR FROM now())::int AS a`,
      );
      return rows[0]!;
    }

    it('les libellés d’origine : un par service, la photocopie sous son nom d’école', () => {
      expect(SOURCE_LABELS.service_cantine).toBe('Cantine');
      expect(SOURCE_LABELS.service_piscine).toBe('Piscine');
      expect(SOURCE_LABELS.service_docteur).toBe('Docteur');
      expect(SOURCE_LABELS.service_photocopie).toBe(libelleService('photocopie'));
      expect(SOURCE_LABELS.service_inscription).toBe("Frais d'inscription (élève)");
      // Ceux d'aujourd'hui ne bougent pas.
      expect(SOURCE_LABELS.paiement).toBe('Frais scolaires');
      expect(SOURCE_LABELS.frais_annuel).toBe('Frais annuels');
    });

    it('⚠ « Par origine » sépare chaque service ; le journal les décrit ; le mois les compte (income.services)', async () => {
      const { jour, m, a } = await aujourdhui();
      const jourAvant = await inS(() => reports.revenusDuJour(jour));
      const moisAvant = await inS(() => reports.monthly(m, a));

      const { studentId, subs } = await familleJinan('rapport', ['cantine_dejeuner', 'photocopie']);
      const r = await inS(() =>
        collection.encaisserGroupe(
          {
            studentId,
            academicYearId: yearS,
            mois: [{ mois: 10, annee: 2025 }],
            services: [
              { studentServiceId: subs.cantine_dejeuner!, mois: 10, annee: 2025 },
              { studentServiceId: subs.photocopie! },
              { studentServiceId: subs.inscription! },
            ],
            tender: [{ paymentMethodId: especesS, amount: '7300.00' }],
          },
          ACTOR,
        ),
      );

      // Revenue Live → Par origine.
      const jourApres = await inS(() => reports.revenusDuJour(jour));
      const parOrigine = (x: typeof jourApres, s: string) => x.parSource.find((p) => p.source_type === s)?.total ?? '0';
      const delta = (s: string) => ecart(parOrigine(jourApres, s), parOrigine(jourAvant, s));
      expect(delta('paiement')).toBe('3000.00');
      expect(delta('service_cantine')).toBe('800.00');
      expect(delta('service_photocopie')).toBe('1500.00');
      expect(delta('service_inscription')).toBe('2000.00');
      expect(ecart(jourApres.total, jourAvant.total)).toBe('7300.00');
      expect(Object.fromEntries(jourApres.parSource.map((p) => [p.source_type, p.label]))).toMatchObject({
        paiement: 'Frais scolaires',
        service_cantine: 'Cantine',
        service_photocopie: libelleService('photocopie'),
        service_inscription: "Frais d'inscription (élève)",
      });

      // Le mois (ADR-0013 : daté par paid_at) : les services à part, et dans le total.
      const moisApres = await inS(() => reports.monthly(m, a));
      expect(ecart(moisApres.income.services, moisAvant.income.services)).toBe('4300.00');
      expect(ecart(moisApres.income.tuition, moisAvant.income.tuition)).toBe('3000.00');
      expect(ecart(moisApres.income.total, moisAvant.income.total)).toBe('7300.00');
      expect(
        money(moisApres.income.tuition)
          .plus(money(moisApres.income.evening))
          .plus(money(moisApres.income.familyFees))
          .plus(money(moisApres.income.services))
          .toFixed(2),
      ).toBe(moisApres.income.total);
      expect(ecart(moisApres.net, moisAvant.net)).toBe('7300.00');

      // Le journal des transactions : son type, sa description, son auteur.
      const nom = await nomDe(studentId);
      const journal = await inS(() => reports.transactions({ day: jour }));
      const de = (desc: string) => journal.filter((l) => l.description === desc);
      expect(de(`Cantine (déjeuner) : ${nom} (Octobre 2025)`)).toEqual([
        expect.objectContaining({
          direction: 'in', sourceType: 'service_cantine', type: 'Cantine', amount: '800.00',
          method: 'Especes', recordedBy: 'Acteur',
        }),
      ]);
      expect(de(`${libelleService('photocopie')} : ${nom}`)).toEqual([
        expect.objectContaining({
          direction: 'in', sourceType: 'service_photocopie', type: libelleService('photocopie'), amount: '1500.00',
        }),
      ]);
      expect(de(`Frais d'inscription : ${nom}`)).toEqual([
        expect.objectContaining({
          direction: 'in', sourceType: 'service_inscription', type: "Frais d'inscription (élève)", amount: '2000.00',
        }),
      ]);
      expect(de(`Frais scolaires : ${nom} (Octobre 2025)`)).toHaveLength(1);

      // L'annulation : une sortie décrite de même, datée du jour où elle est faite.
      const { rows: pc } = await owner.query<{ id: string }>(
        'SELECT id FROM service_payments WHERE student_service_id = $1 AND receipt_id = $2',
        [subs.cantine_dejeuner, r.receiptId],
      );
      await inS(() => payments.reverseServicePayment(pc[0]!.id, 'erreur de saisie', ACTOR));
      const moisAnnule = await inS(() => reports.monthly(m, a));
      expect(ecart(moisAnnule.income.services, moisApres.income.services)).toBe('-800.00');
      expect(ecart(moisAnnule.income.total, moisApres.income.total)).toBe('-800.00');
      const journal2 = await inS(() => reports.transactions({ day: jour }));
      expect(
        journal2
          .filter((l) => l.description === `Cantine (déjeuner) : ${nom} (Octobre 2025)`)
          .map((l) => [l.direction, l.amount])
          .sort(),
      ).toEqual([['in', '800.00'], ['out', '800.00']]);
      // « Par origine » ne compte que les entrées.
      expect(ecart((await inS(() => reports.revenusDuJour(jour))).total, jourApres.total)).toBe('0.00');
    });

    it('le bilan de l’année contrôle aussi le grand livre des services', async () => {
      const annee = { id: yearS, label: '2025-2026', start_year: 2025, start_month: 10, end_month: 6 };
      const avant = await inS(() => reports.bilanAnneeScolaire(annee));
      const { guardianId, studentId, subs } = await familleJinan('bilan', ['docteur']);
      await inS(() =>
        collection.encaisserGroupe(
          {
            studentId,
            mois: [],
            services: [{ studentServiceId: subs.docteur!, mois: 10, annee: 2025 }],
            tender: [{ paymentMethodId: especesS, amount: '300.00' }],
          },
          ACTOR,
        ),
      );
      const couvert = await inS(() => reports.bilanAnneeScolaire(annee));
      // Une écriture de plus, ventilée : aucun écart.
      expect(couvert.controle.paiements - avant.controle.paiements).toBe(1);
      expect(couvert.controle.sans_ligne).toBe(avant.controle.sans_ligne);
      expect(couvert.controle.ecart_nb).toBe(avant.controle.ecart_nb);
      expect(couvert.controle.ecart_montant).toBe(avant.controle.ecart_montant);

      // Une écriture de service sans ses moyens est VUE.
      await payerService({ id: subs.docteur! }, studentId, guardianId, 11, 2025, '300.00');
      const trou = await inS(() => reports.bilanAnneeScolaire(annee));
      expect(trou.controle.paiements - couvert.controle.paiements).toBe(1);
      expect(trou.controle.sans_ligne - couvert.controle.sans_ligne).toBe(1);
      expect(trou.controle.ecart_nb - couvert.controle.ecart_nb).toBe(1);
      expect(ecart(trou.controle.ecart_montant, couvert.controle.ecart_montant)).toBe('300.00');
    });

    it('« le dernier mois actif » voit un encaissement de service', async () => {
      const { guardianId, studentId, subs } = await familleJinan('recent', ['piscine']);
      // Daté plus tard que tout autre mouvement de l'école.
      const { rows: rc } = await owner.query<{ id: string }>(
        `INSERT INTO receipts (school_id, academic_year_id, guardian_id, receipt_number, amount)
         VALUES ($1, $2, $3, 'FSJ-RECENT-1', 1000) RETURNING id`,
        [S.schoolId, yearS, guardianId],
      );
      await owner.query(
        `INSERT INTO service_payments
           (school_id, student_service_id, student_id, academic_year_id, calendar_month,
            calendar_year, amount, receipt_number, receipt_id, paid_at)
         VALUES ($1, $2, $3, $4, 12, 2025, 1000, 'FSJ-RECENT-1', $5, '2031-03-10T12:00:00Z')`,
        [S.schoolId, subs.piscine, studentId, yearS, rc[0]!.id],
      );
      expect(await inS(() => reports.mostRecentActivity())).toEqual({ month: 3, year: 2031 });
      // Et son mois le compte.
      expect((await inS(() => reports.monthly(3, 2031))).income).toMatchObject({ services: '1000.00', total: '1000.00' });
    });

    it('une école « famille » : income.services vaut 0, son journal et son bilan sont ceux d’aujourd’hui', async () => {
      const { jour, m, a } = await aujourdhui();
      const avant = await inF(() => reports.monthly(m, a));
      // Un encaissement d'aujourd'hui : octobre (10 000) et les frais d'inscription de la famille (5 000).
      const guardianId = await parent(tag('fam-rapport'));
      const studentId = await eleve(F.schoolId, tag('fam-rapport'), guardianId);
      await inF(() => enrollments.enrol({ studentId, academicYearId: yearF, groupId: groupF }, ACTOR, DIRECTION));
      await inF(() =>
        collection.encaisserGroupe(
          {
            studentId,
            mois: [{ mois: 10, annee: 2025 }],
            fraisInscription: true,
            tender: [{ paymentMethodId: especesF, amount: '15000.00' }],
          },
          ACTOR,
        ),
      );

      const mois = await inF(() => reports.monthly(m, a));
      expect(mois.income.services).toBe('0.00');
      expect(ecart(mois.income.tuition, avant.income.tuition)).toBe('10000.00');
      expect(ecart(mois.income.familyFees, avant.income.familyFees)).toBe('5000.00');
      expect(ecart(mois.income.total, avant.income.total)).toBe('15000.00');
      expect(
        money(mois.income.tuition).plus(money(mois.income.evening)).plus(money(mois.income.familyFees)).toFixed(2),
      ).toBe(mois.income.total);
      const nom = await nomDe(studentId);
      const journal = await inF(() => reports.transactions({ day: jour }));
      expect(journal.filter((l) => l.description === `Frais scolaires : ${nom} (Octobre 2025)`)).toEqual([
        expect.objectContaining({ direction: 'in', sourceType: 'paiement', type: 'Frais scolaires', amount: '10000.00', recordedBy: 'Acteur' }),
      ]);
      expect(journal.some((l) => l.sourceType.startsWith('service_'))).toBe(false);
      const bilan = await inF(() =>
        reports.bilanAnneeScolaire({ id: yearF, label: '2025-2026', start_year: 2025, start_month: 10, end_month: 6 }),
      );
      const { rows } = await owner.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM payments WHERE academic_year_id = $1',
        [yearF],
      );
      expect(bilan.controle.paiements).toBe(rows[0]!.n);
      expect(bilan.controle.ecart_nb).toBe(0);
    });
  });
});
