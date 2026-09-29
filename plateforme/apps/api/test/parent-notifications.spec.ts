import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { NotificationsService } from '../src/parent/notifications.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LE FLUX DE NOTIFICATIONS DU PARENT — `api/parent/notifications.php`.
 *
 * ⚠ THE TABLE WAS WRITE-ONLY. `notifications` has been filled since homework
 * shipped — an exercise sent, and now a timetable published — and NOTHING in the
 * system ever read a row back. No endpoint, no screen, no badge. So a school
 * sent an exercise to thirty families and thirty families were never told.
 *
 * ⚠ AND THE EXAM RATCHET REACHES THE STREAM. El Ourwa withholds notifications of
 * type `note` from a family that may not see exam results — its own reason, kept
 * verbatim because the reasoning is the specification:
 *
 *   "`notifications`.`type` ... ne distingue PAS un devoir d'un examen. Une
 *    notification de type « note » peut donc porter un resultat d'examen, et
 *    rien dans la table ne permet de le savoir. On echoue fermé ... Mieux vaut
 *    retenir l'annonce d'un devoir que laisser filer celle d'un examen — c'est
 *    precisement le levier de recouvrement de l'ecole."
 *
 * Withholding a result is how the school gets paid. A notification saying
 * "Nouvelle note : Mathématiques — 14/20" defeats it just as completely as the
 * bulletin would.
 *
 * Money and grades, so the tests come first.
 */

let owner: pg.Pool;
let notifications: NotificationsService;
let schoolId: string;
let yearId: string;
let priorYearId: string;
let groupId: string;
let payerId: string;
let debtorId: string;
let payerChild: string;
let debtorChild: string;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'pnotif' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('pnotif', 'Notifs', 'PNO')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const ys = await owner.query<{ id: string; start_year: number }>(
    `INSERT INTO academic_years (school_id, label, start_year, status) VALUES
       ($1, '2024-2025', 2024, 'closed'), ($1, '2025-2026', 2025, 'active')
     RETURNING id, start_year`,
    [schoolId],
  );
  priorYearId = ys.rows.find((r) => r.start_year === 2024)!.id;
  yearId = ys.rows.find((r) => r.start_year === 2025)!.id;

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

  const guardians = await owner.query<{ id: string; full_name: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES
       ('pn.payer@test', 'x', 'En Regle'), ('pn.debtor@test', 'x', 'En Dette')
     RETURNING id, full_name`,
  );
  payerId = guardians.rows.find((r) => r.full_name === 'En Regle')!.id;
  debtorId = guardians.rows.find((r) => r.full_name === 'En Dette')!.id;

  const kids = await owner.query<{ id: string; rim: string }>(
    `INSERT INTO students (school_id, rim, national_id, first_name, last_name, guardian_id) VALUES
       ($1, 'RIM-PN-1', 'NID-PN-1', 'A', 'Un', $2),
       ($1, 'RIM-PN-2', 'NID-PN-2', 'B', 'Deux', $3)
     RETURNING id, rim`,
    [schoolId, payerId, debtorId],
  );
  payerChild = kids.rows.find((r) => r.rim === 'RIM-PN-1')!.id;
  debtorChild = kids.rows.find((r) => r.rim === 'RIM-PN-2')!.id;

  for (const [child, fee] of [[payerChild, 0], [debtorChild, 10000]] as const) {
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO enrollments
         (school_id, student_id, academic_year_id, group_id, status, monthly_fee)
       VALUES ($1, $2, $3, $4, 'enrolled', $5) RETURNING id`,
      [schoolId, child, yearId, groupId, fee],
    );
    // ⚠ THE DEBT IS THE MONTHS, not the enrolment's fee. Without a schedule
    // every family looks settled — which is how a test can prove a lock works
    // while unlocking everybody. October 2025 has long elapsed.
    await owner.query(
      `INSERT INTO enrollment_months
         (school_id, enrollment_id, month_order, calendar_month, calendar_year,
          status, amount_due)
       VALUES ($1, $2, 1, 10, 2025, 'billable', $3)`,
      [schoolId, rows[0]!.id, fee],
    );
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  notifications = moduleRef.get(NotificationsService);
});

afterAll(async () => {
  await owner?.end();
});

async function give(
  guardianId: string,
  kind: string,
  key: string,
  academicYearId: string | null = yearId,
) {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO notifications
       (school_id, guardian_id, academic_year_id, kind, i18n_key, i18n_params)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb) RETURNING id`,
    [schoolId, guardianId, academicYearId, kind, key],
  );
  return rows[0]!.id;
}

describe('ce qu’une famille reçoit', () => {
  it('lists its own notifications, newest first, and nobody else’s', async () => {
    await give(payerId, 'homework', 'notif_exercice');
    await give(debtorId, 'homework', 'notif_exercice');

    const mine = await inTenant(() => notifications.forGuardian(payerId, yearId));
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]!.kind).toBe('homework');
    expect(mine.unread).toBe(1);
  });

  it('⚠ leaves out another year’s notifications entirely', async () => {
    // A closed year takes its announcements with it. Otherwise a family sees
    // last June's news beside an otherwise empty space and reads it as current.
    await give(payerId, 'homework', 'notif_exercice', priorYearId);
    const mine = await inTenant(() => notifications.forGuardian(payerId, yearId));
    expect(mine.items.every((n) => n.kind === 'homework')).toBe(true);
    expect(mine.items).toHaveLength(1);
  });

  it('⚠ leaves out notifications attached to no year at all', async () => {
    // Migration 0010 left the pre-existing rows with a NULL year, deliberately:
    // "Existing rows keep NULL and become invisible to parents."
    await give(payerId, 'homework', 'notif_exercice', null);
    const mine = await inTenant(() => notifications.forGuardian(payerId, yearId));
    expect(mine.items).toHaveLength(1);
  });
});

describe('⚠ le verrou des examens s’applique au flux', () => {
  it('withholds a mark notification from a family in debt', async () => {
    await give(debtorId, 'grade', 'notif_note');

    const theirs = await inTenant(() => notifications.forGuardian(debtorId, yearId));
    // The exercise notification from the first test is still there; the mark is
    // not. Withholding results is the school's collection lever, and an
    // announcement carrying "14/20" defeats it as completely as the bulletin.
    expect(theirs.items.some((n) => n.kind === 'grade')).toBe(false);
    expect(theirs.items.some((n) => n.kind === 'homework')).toBe(true);
  });

  it('⚠ the count agrees with the list, or the badge lies', async () => {
    const theirs = await inTenant(() => notifications.forGuardian(debtorId, yearId));
    // El Ourwa counts "SOUS LES MÊMES FILTRES que la liste". A badge saying 2
    // over a list of 1 sends a parent looking for something they are not
    // allowed to see, and then to the office to ask why.
    expect(theirs.unread).toBe(theirs.items.filter((n) => n.readAt === null).length);
  });

  it('delivers the same mark notification to a family that owes nothing', async () => {
    await give(payerId, 'grade', 'notif_note');
    const mine = await inTenant(() => notifications.forGuardian(payerId, yearId));
    expect(mine.items.some((n) => n.kind === 'grade')).toBe(true);
  });
});

describe('marquer comme lu', () => {
  it('marks one, and only for its owner', async () => {
    const id = await give(payerId, 'timetable', 'notif_emploi');

    // ⚠ Another family's id must be REFUSED, not silently no-op. Scoping the
    // UPDATE by guardian would return "0 rows" for both a foreign id and an
    // already-read one, and the two are different answers.
    await expect(inTenant(() => notifications.markRead(id, debtorId))).rejects.toThrow();

    await inTenant(() => notifications.markRead(id, payerId));
    const { rows } = await owner.query<{ read_at: Date | null }>(
      'SELECT read_at FROM notifications WHERE id = $1',
      [id],
    );
    expect(rows[0]!.read_at).not.toBeNull();
  });

  it('marks the whole stream read, under the same filters', async () => {
    // ⚠ "Tout marquer comme lu" must not mark a withheld mark notification
    // read: the family never saw it, and once read it would never resurface
    // when the debt is settled.
    await inTenant(() => notifications.markAllRead(debtorId, yearId));

    const { rows } = await owner.query<{ kind: string; read_at: Date | null }>(
      `SELECT kind, read_at FROM notifications
        WHERE guardian_id = $1 AND academic_year_id = $2`,
      [debtorId, yearId],
    );
    const grade = rows.find((r) => r.kind === 'grade')!;
    expect(grade.read_at).toBeNull();
    expect(rows.filter((r) => r.kind === 'homework').every((r) => r.read_at !== null)).toBe(true);
  });
});
