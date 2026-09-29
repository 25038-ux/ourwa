import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { ConcessionsService } from '../src/finance/concessions.service.js';
import { DebtService } from '../src/finance/debt.service.js';
import { NotificationsService } from '../src/parent/notifications.service.js';
import { CollectionService } from '../src/finance/collection.service.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * NOTIFIER LES IMPAYÉS — `gestion_caisse.php`, action `notifier_impayes`.
 *
 * A reminder to every family whose child has an unpaid month.
 *
 * ⚠ WRITTEN FIRST BECAUSE IT TELLS PEOPLE THEY OWE MONEY. Sending that to the
 * wrong family is not a display bug: it is an accusation, and it cannot be
 * withdrawn once the phone has buzzed.
 */

let owner: pg.Pool;
let debts: DebtService;
let notifications: NotificationsService;
// Ce que le contrôleur passe : la notification (fil + poussée) dans la transaction.
const notifier = (tx: Parameters<NotificationsService['notifier']>[0], n: { guardianId: string; studentId: string; eleve: string; mois: string }) =>
  notifications.notifier(tx, { guardianId: n.guardianId, studentId: n.studentId, academicYearId: null, kind: 'info', souche: 'notif_rappel', params: { eleve: n.eleve, mois: n.mois }, route: 'profil' });
let collection: CollectionService;
let enrollments: EnrollmentService;

let schoolId: string;
let thisYear: string;
let lastYear: string;
let groupId: string;
let cashId: string;
let ACTOR: string;

const DIRECTION = ['scolarite.niveaux'];
const START_YEAR = 2019;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'rappel' }, fn);
}

async function pupil(tag: string, yearId = thisYear) {
  const g = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', $2) RETURNING id`,
    [`rappel.${tag}@test`, `Parent ${tag}`],
  );
  const guardianId = g.rows[0]!.id;
  const s = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5, 'Rappel') RETURNING id`,
    [schoolId, guardianId, `RIM-${tag}`, `NID-${tag}`, tag],
  );
  const studentId = s.rows[0]!.id;

  if (yearId === thisYear) {
    await inTenant(() =>
      enrollments.enrol(
        { studentId, academicYearId: yearId, groupId, entryDate: `${START_YEAR}-10-01` },
        ACTOR,
        DIRECTION,
      ),
    );
  } else {
    const level = await owner.query<{ level_id: string }>(
      'SELECT level_id FROM groups WHERE id = $1',
      [groupId],
    );
    await owner.query(
      `INSERT INTO enrollments
         (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee)
       VALUES ($1, $2, $3, $4, $5, 'enrolled', 10000)`,
      [schoolId, studentId, yearId, groupId, level.rows[0]!.level_id],
    );
  }
  return { guardianId, studentId };
}

async function notifiedFor(subject: string): Promise<string[]> {
  const { rows } = await owner.query<{ guardian_id: string }>(
    `SELECT DISTINCT guardian_id FROM messages WHERE subject = $1`,
    [subject],
  );
  return rows.map((r) => r.guardian_id);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('rappel', 'Rappels', 'RPL')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const years = await owner.query<{ id: string; status: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2019-2020', $2, 'active'), ($1, '2017-2018', $3, 'closed')
     RETURNING id, status`,
    [schoolId, START_YEAR, START_YEAR - 2],
  );
  thisYear = years.rows.find((r) => r.status === 'active')!.id;
  lastYear = years.rows.find((r) => r.status === 'closed')!.id;

  const level = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle)
     VALUES ($1, '1ere', 10000, 'lycee') RETURNING id`,
    [schoolId],
  );
  const group = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '1ere A') RETURNING id`,
    [schoolId, level.rows[0]!.id],
  );
  groupId = group.rows[0]!.id;

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('rappel.admin@test', 'x', 'La direction') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const method = await owner.query<{ id: string }>(
    `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Especes') RETURNING id`,
    [schoolId],
  );
  cashId = method.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  debts = moduleRef.get(DebtService);
  notifications = moduleRef.get(NotificationsService);
  collection = moduleRef.get(CollectionService);
  enrollments = moduleRef.get(EnrollmentService);
});

afterAll(async () => {
  await owner?.end();
});

describe('who gets told', () => {
  it('reaches a family whose month is unpaid', async () => {
    const { guardianId } = await pupil('doit');
    const result = await inTenant(() =>
      debts.notifyUnpaid(
        { academicYearId: thisYear, calendarMonth: 10, calendarYear: START_YEAR },
        ACTOR,
        notifier,
      ),
    );
    expect(result.sent).toBeGreaterThan(0);
    expect(await notifiedFor('Rappel de paiement')).toContain(guardianId);
  });

  it('⚠ does NOT reach a family whose child left the school', async () => {
    // El Ourwa's query joins no enrolment and filters no year, so it reminds the
    // families of children who left years ago that they owe this month. Telling
    // somebody they owe money for a class their child no longer attends is not
    // a display bug. See docs/DECISIONS.md.
    const stays = await pupil('reste');
    const gone = await pupil('parti', lastYear);

    await inTenant(() =>
      debts.notifyUnpaid(
        { academicYearId: thisYear, calendarMonth: 11, calendarYear: START_YEAR },
        ACTOR,
        notifier,
      ),
    );

    const told = await notifiedFor('Rappel de paiement');
    expect(told).toContain(stays.guardianId);
    expect(told).not.toContain(gone.guardianId);
  });

  it('⚠ does NOT reach a family whose child is exempted', async () => {
    const { guardianId, studentId } = await pupil('exempt');
    await owner.query(
      `INSERT INTO exemptions (school_id, student_id, kind, granted_by)
       VALUES ($1, $2, 'full', $3)`,
      [schoolId, studentId, ACTOR],
    );

    await inTenant(() =>
      debts.notifyUnpaid(
        { academicYearId: thisYear, calendarMonth: 12, calendarYear: START_YEAR },
        ACTOR,
        notifier,
      ),
    );
    expect(await notifiedFor('Rappel de paiement')).not.toContain(guardianId);
  });

  it('does not reach a family whose month is exempted on its own', async () => {
    const { guardianId, studentId } = await pupil('moisexempt');
    await owner.query(
      `INSERT INTO exemptions
         (school_id, student_id, kind, calendar_month, calendar_year, granted_by)
       VALUES ($1, $2, 'monthly', 1, $3, $4)`,
      [schoolId, studentId, START_YEAR + 1, ACTOR],
    );

    await inTenant(() =>
      debts.notifyUnpaid(
        { academicYearId: thisYear, calendarMonth: 1, calendarYear: START_YEAR + 1 },
        ACTOR,
        notifier,
      ),
    );
    expect(await notifiedFor('Rappel de paiement')).not.toContain(guardianId);
  });

  it('⚠ does not reach a family who has already paid that month', async () => {
    const { guardianId, studentId } = await pupil('paye');
    await inTenant(() =>
      collection.collect(
        {
          studentId,
          academicYearId: thisYear,
          calendarMonth: 2,
          calendarYear: START_YEAR + 1,
          fees: {},
          tender: [{ paymentMethodId: cashId, amount: '10000.00' }],
        },
        ACTOR,
        notifier,
      ),
    );

    await inTenant(() =>
      debts.notifyUnpaid(
        { academicYearId: thisYear, calendarMonth: 2, calendarYear: START_YEAR + 1 },
        ACTOR,
        notifier,
      ),
    );
    expect(await notifiedFor('Rappel de paiement')).not.toContain(guardianId);
  });

  it('⚠ nor a family who has PART-paid — El Ourwa’s rule, kept', async () => {
    // `NOT EXISTS (SELECT 1 FROM paiements …)` treats any payment as settling
    // the month. A family who has started paying is not chased. That is a
    // plausible courtesy rather than an obvious defect, so rule 26 applies and
    // the behaviour stands — but the screen says so, rather than leaving an
    // operator to assume the reminder went out.
    const { guardianId, studentId } = await pupil('partiel');
    await inTenant(() =>
      collection.collect(
        {
          studentId,
          academicYearId: thisYear,
          calendarMonth: 3,
          calendarYear: START_YEAR + 1,
          fees: {},
          tender: [{ paymentMethodId: cashId, amount: '1000.00' }],
        },
        ACTOR,
        notifier,
      ),
    );

    await inTenant(() =>
      debts.notifyUnpaid(
        { academicYearId: thisYear, calendarMonth: 3, calendarYear: START_YEAR + 1 },
        ACTOR,
        notifier,
      ),
    );
    expect(await notifiedFor('Rappel de paiement')).not.toContain(guardianId);
  });
});

describe('what it says', () => {
  it('names the child and the month, in El Ourwa’s words', async () => {
    const { guardianId } = await pupil('libelle');
    await inTenant(() =>
      debts.notifyUnpaid(
        { academicYearId: thisYear, calendarMonth: 4, calendarYear: START_YEAR + 1 },
        ACTOR,
        notifier,
      ),
    );

    const { rows } = await owner.query<{ body: string }>(
      `SELECT body FROM messages WHERE guardian_id = $1 AND subject = 'Rappel de paiement'`,
      [guardianId],
    );
    expect(rows[0]!.body).toContain('libelle Rappel');
    expect(rows[0]!.body).toContain('Avril');
    expect(rows[0]!.body).toContain('Merci de régulariser');
  });

  it('reports how many correspondents were reached', async () => {
    const result = await inTenant(() =>
      debts.notifyUnpaid(
        { academicYearId: thisYear, calendarMonth: 5, calendarYear: START_YEAR + 1 },
        ACTOR,
        notifier,
      ),
    );
    expect(typeof result.sent).toBe('number');
    expect(result.month).toBe('Mai');
  });
});
