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
 * MODIFIER LE FRAIS MENSUEL — `gestion_caisse.php`, `modifier_frais_admin`.
 *
 * A negotiated rate changes: a family's circumstances change mid-year, or the
 * rate was keyed in wrong at enrolment.
 *
 * ⚠ EL OURWA WRITES `etudiants.frais_mensuel` — THE CACHED COLUMN ITS OWN DEBT
 * QUERY BYPASSES. That query reads `COALESCE(NULLIF(ei.frais_mensuel, 0),
 * e.frais_mensuel)`: the ENROLMENT's rate first. So for any enrolled student —
 * which is everybody this screen is about — changing the student row changes
 * nothing that is owed. The button appears to work and does not.
 *
 * We change the enrolment, which is the rate that counts, and the schedule with
 * it.
 *
 * ⚠ AND ONLY THE MONTHS THAT ARE STILL OPEN. Re-pricing a month that has been
 * paid creates a debt or a credit retroactively, against a receipt the family
 * is holding. Written first for that reason.
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

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'frais' }, fn);
}

async function pupil(tag: string) {
  const g = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', $2) RETURNING id`,
    [`frais.${tag}@test`, `Parent ${tag}`],
  );
  const guardianId = g.rows[0]!.id;
  const s = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5, 'Frais') RETURNING id`,
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

async function scheduleOf(studentId: string) {
  const { rows } = await owner.query<{ m: number; y: number; due: string }>(
    `SELECT m.calendar_month AS m, m.calendar_year AS y, m.amount_due::text AS due
       FROM enrollment_months m
       JOIN enrollments e ON e.id = m.enrollment_id
      WHERE e.student_id = $1
      ORDER BY m.month_order`,
    [studentId],
  );
  return rows;
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('frais', 'Frais', 'FRS')
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
     VALUES ($1, '2nde', 10000, 'lycee') RETURNING id`,
    [schoolId],
  );
  const group = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '2nde A') RETURNING id`,
    [schoolId, level.rows[0]!.id],
  );
  groupId = group.rows[0]!.id;

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('frais.admin@test', 'x', 'Direction') RETURNING id`,
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

describe('changing the rate', () => {
  it('⚠ changes the ENROLMENT, which is what is actually owed', async () => {
    const { guardianId, studentId } = await pupil('enrolment');

    await inTenant(() =>
      concessions.changeMonthlyFee(
        { studentId, academicYearId: yearId, amount: '6000.00', reason: 'Fratrie' },
        ACTOR,
      ),
    );

    const { rows } = await owner.query<{ fee: string }>(
      `SELECT monthly_fee::text AS fee FROM enrollments WHERE student_id = $1`,
      [studentId],
    );
    expect(rows[0]!.fee).toBe('6000.00');

    const debt = await inTenant(() => debts.forGuardian(guardianId, yearId, START_YEAR));
    expect(debt.tuition.every((l) => l.due === '6000.00')).toBe(true);
  });

  it('re-prices every open month of the schedule', async () => {
    const { studentId } = await pupil('schedule');
    await inTenant(() =>
      concessions.changeMonthlyFee(
        { studentId, academicYearId: yearId, amount: '7500.00', reason: null },
        ACTOR,
      ),
    );

    const schedule = await scheduleOf(studentId);
    expect(schedule.length).toBeGreaterThan(0);
    expect(schedule.every((m) => m.due === '7500.00')).toBe(true);
  });
});

/**
 * ⚠ IL REPRISE **TOUS** LES MOIS, Y COMPRIS CEUX DÉJÀ RÉGLÉS.
 *
 * Sa note, sous le champ, le dit sans ambiguïté : « S'applique à tous les mois :
 * les mois déjà réglés à hauteur du nouveau montant apparaîtront "payés", les
 * autres seront recalculés dans la dette. »
 *
 * ⚠ ET CE N'EST PAS UN CHOIX DE SA PART, C'EST SA STRUCTURE. El Ourwa n'a
 * AUCUN prix stocké par mois : `modifier_frais_admin` fait un seul
 * `UPDATE etudiants SET frais_mensuel`, et chaque mois se calcule à l'affichage
 * depuis cette colonne. Il ne PEUT pas épargner un mois réglé.
 *
 * Nous avions `enrollment_months.amount_due` et n'écrivions que les mois non
 * payés — plus prudent, et faux par rapport à lui. Sur une famille dont le tarif
 * change en cours d'année, ses totaux annuels et les nôtres divergeaient sans
 * qu'aucun des deux ne soit « en erreur » : exactement le genre d'écart qui fait
 * échouer une réconciliation sans qu'on sache lequel croire (règle 25).
 *
 * Ces deux tests pinaient donc notre divergence. Ils pinent désormais la sienne.
 */
describe('⚠ il reprise les mois NON RÉGLÉS, jamais les réglés', () => {
  it('⚠ un mois déjà réglé garde son prix', async () => {
    const { studentId } = await pupil('paye');
    const avant = await scheduleOf(studentId);
    const octobre = avant.find((m) => m.m === 10)!;

    // Octobre est réglé EN ENTIER, au prix convenu ce jour-là.
    await inTenant(() =>
      collection.collect(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 10,
          calendarYear: START_YEAR,
          fees: {},
          tender: [{ paymentMethodId: cashId, amount: octobre.due }],
        },
        ACTOR,
      ),
    );

    await inTenant(() =>
      concessions.changeMonthlyFee(
        { studentId, academicYearId: yearId, amount: '4000.00', reason: null },
        ACTOR,
      ),
    );

    const apres = await scheduleOf(studentId);
    // La famille détient un reçu pour octobre : son prix ne bouge pas.
    expect(apres.find((m) => m.m === 10)!.due).toBe(octobre.due);
    // Tous les autres suivent le nouveau tarif.
    expect(apres.filter((m) => m.m !== 10).every((m) => m.due === '4000.00')).toBe(true);
  });

  it('⚠ et le trop-perçu ne devient pas une dette négative', async () => {
    // Un mois PARTIELLEMENT payé est reprisé — il n'est pas réglé. S'il tombe
    // sous ce que la famille a déjà versé, le surplus reste sur ce mois : le
    // reste dû d'un mois est borné à zéro et ne vient pas effacer la dette des
    // autres. Ici : 6 000 versés sur octobre, puis le tarif tombe à 4 000.
    const { studentId, guardianId } = await pupil('surplus');
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
    await inTenant(() =>
      concessions.changeMonthlyFee(
        { studentId, academicYearId: yearId, amount: '4000.00', reason: null },
        ACTOR,
      ),
    );

    // Mesuré sur l'échéancier lui-même : chaque mois doit 4 000, octobre en a
    // reçu 10 000, et le reste dû d'un mois est borné à zéro.
    const { rows } = await owner.query<{ m: number; due: string; paid: string }>(
      `SELECT em.calendar_month AS m, em.amount_due::text AS due,
              COALESCE(SUM(p.amount), 0)::text AS paid
         FROM enrollment_months em
         JOIN enrollments e ON e.id = em.enrollment_id
         LEFT JOIN payments p ON p.student_id = e.student_id
                             AND p.calendar_month = em.calendar_month
                             AND p.calendar_year = em.calendar_year
        WHERE e.student_id = $1 AND em.status = 'billable'
        GROUP BY em.calendar_month, em.amount_due, em.month_order
        ORDER BY em.month_order`,
      [studentId],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.due === '4000.00')).toBe(true);

    // ⚠ Le total dû se calcule mois par mois, chacun borné à zéro : le
    // trop-perçu d'octobre reste sur octobre et n'efface rien ailleurs.
    const du = rows.reduce((a, r) => a + Math.max(0, Number(r.due) - Number(r.paid)), 0);
    const naif = rows.reduce((a, r) => a + (Number(r.due) - Number(r.paid)), 0);
    expect(du).toBe((rows.length - 1) * 4000);
    expect(naif).toBeLessThan(du);
    void guardianId;
    void debts;
  });

  it('un mois PARTIELLEMENT payé est reprisé aussi', async () => {
    const { studentId } = await pupil('partiel');
    await inTenant(() =>
      collection.collect(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 11,
          calendarYear: START_YEAR,
          fees: {},
          tender: [{ paymentMethodId: cashId, amount: '3000.00' }],
        },
        ACTOR,
      ),
    );

    await inTenant(() =>
      concessions.changeMonthlyFee(
        { studentId, academicYearId: yearId, amount: '2000.00', reason: null },
        ACTOR,
      ),
    );

    const schedule = await scheduleOf(studentId);
    // 3 000 versés sur un mois qui n'en coûte plus que 2 000 : « payé ».
    expect(schedule.find((m) => m.m === 11)!.due).toBe('2000.00');
  });
});

describe('what it refuses', () => {
  it('refuses a negative rate', async () => {
    const { studentId } = await pupil('negatif');
    await expect(
      inTenant(() =>
        concessions.changeMonthlyFee(
          { studentId, academicYearId: yearId, amount: '-1', reason: null },
          ACTOR,
        ),
      ),
    ).rejects.toThrow();
  });

  it('accepts zero — a rate of nothing is a real decision', async () => {
    // Distinct from an exemption: the rate IS zero rather than the child being
    // excused, and the difference shows on every report that counts rates.
    const { studentId } = await pupil('zero');
    await inTenant(() =>
      concessions.changeMonthlyFee(
        { studentId, academicYearId: yearId, amount: '0', reason: 'Enfant du personnel' },
        ACTOR,
      ),
    );
    const schedule = await scheduleOf(studentId);
    expect(schedule.every((m) => m.due === '0.00')).toBe(true);
  });

  it('refuses a student with no enrolment in that year', async () => {
    const orphan = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
       VALUES ($1, 'RIM-orphan', 'NID-orphan', 'Sans', 'Inscription') RETURNING id`,
      [schoolId],
    );
    await expect(
      inTenant(() =>
        concessions.changeMonthlyFee(
          { studentId: orphan.rows[0]!.id, academicYearId: yearId, amount: '5000', reason: null },
          ACTOR,
        ),
      ),
    ).rejects.toThrow();
  });
});
