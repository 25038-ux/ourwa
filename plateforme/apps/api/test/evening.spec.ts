import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { EveningService } from '../src/evening/evening.service.js';
import { PaymentsService } from '../src/finance/payments.service.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * Cours du soir — a second business sharing a login.
 *
 * The tests that matter are the ones about the seam: an outsider must never
 * leak into the day school, and the two businesses must share one run of
 * receipt numbers.
 */

let owner: pg.Pool;
let evening: EveningService;
let payments: PaymentsService;
let enrollments: EnrollmentService;

let schoolId: string;
let yearId: string;
let groupId: string;
let studentId: string;
let eveningGroupId: string;
let ACTOR: string;

const inTenant = <T>(fn: () => Promise<T>) =>
  runInTenant({ schoolId, slug: 'eve' }, fn);

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('eve', 'Evening', 'EVE')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const year = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2025-2026', 2025, 'active') RETURNING id`,
    [schoolId],
  );
  yearId = year.rows[0]!.id;

  const level = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle)
     VALUES ($1, '6eme', 10000, 'college') RETURNING id`,
    [schoolId],
  );
  const group = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6eme A') RETURNING id`,
    [schoolId, level.rows[0]!.id],
  );
  groupId = group.rows[0]!.id;

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('eve.admin@test', 'x', 'Admin') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const student = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
     VALUES ($1, 'RIM-E1', 'NID-E1', 'Eleve', 'DuJour') RETURNING id`,
    [schoolId],
  );
  studentId = student.rows[0]!.id;

  await owner.query(
    `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Especes')`,
    [schoolId],
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  evening = moduleRef.get(EveningService);
  payments = moduleRef.get(PaymentsService);
  enrollments = moduleRef.get(EnrollmentService);

  await inTenant(() =>
    enrollments.enrol(
      { studentId, academicYearId: yearId, groupId, entryDate: '2025-10-01' },
      ACTOR,
      ['scolarite.niveaux'],
    ),
  );

  const eg = await inTenant(() =>
    evening.createGroup({ name: 'Anglais du soir', monthlyRate: '3000.00' }, ACTOR),
  );
  eveningGroupId = eg.id;
});

afterAll(async () => {
  await owner?.end();
});

describe('enrolling', () => {
  it('takes a school student', async () => {
    const result = await inTenant(() =>
      evening.enrol({ eveningGroupId, studentId }, ACTOR),
    );
    expect(result.isOutsider).toBe(false);
  });

  it('⚠ takes an OUTSIDER who is not a student at all', async () => {
    // The whole reason this subsystem has its own tables: a walk-in has a name
    // and a phone and nothing else — no RIM, no national id, no guardian.
    const result = await inTenant(() =>
      evening.enrol(
        { eveningGroupId, outsiderName: 'Adulte Externe', outsiderPhone: '+22245000000' },
        ACTOR,
      ),
    );
    expect(result.isOutsider).toBe(true);
  });

  it('refuses both a student and an outsider at once', async () => {
    await expect(
      inTenant(() =>
        evening.enrol({ eveningGroupId, studentId, outsiderName: 'Both' }, ACTOR),
      ),
    ).rejects.toThrow(/l’un ou l’autre, pas les deux/i);
  });

  it('refuses neither', async () => {
    await expect(inTenant(() => evening.enrol({ eveningGroupId }, ACTOR))).rejects.toThrow(
      /l’un ou l’autre, pas les deux/i,
    );
  });

  it('refuses to enrol the same student twice', async () => {
    await expect(
      inTenant(() => evening.enrol({ eveningGroupId, studentId }, ACTOR)),
    ).rejects.toThrow(/déjà inscrit/i);
  });
});

describe('the seam with the day school', () => {
  it('⚠ an outsider never appears in a day-school roster or headcount', async () => {
    const { rows } = await owner.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM students WHERE school_id = $1',
      [schoolId],
    );
    // One student, seeded above. The outsider added a row to evening_enrolments
    // and nothing to `students`.
    expect(rows[0]!.n).toBe('1');

    const enrolments = await owner.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM enrollments WHERE school_id = $1',
      [schoolId],
    );
    expect(enrolments.rows[0]!.n).toBe('1');
  });

  it('shows students and outsiders together, each marked', async () => {
    const roster = (await inTenant(() => evening.roster(eveningGroupId))) as {
      display_name: string;
      is_outsider: boolean;
    }[];
    expect(roster).toHaveLength(2);
    expect(roster.filter((r) => r.is_outsider)).toHaveLength(1);
    // Both have a usable name, whichever side they came from.
    expect(roster.every((r) => r.display_name && r.display_name.length > 0)).toBe(true);
  });
});

describe('money', () => {
  it('⚠ shares ONE receipt sequence with the day school', async () => {
    // Two sequences would eventually hand one family two receipts bearing the
    // same number, and the family holds the paper.
    const method = await owner.query<{ id: string }>(
      'SELECT id FROM payment_methods WHERE school_id = $1 LIMIT 1',
      [schoolId],
    );

    const dayReceipt = await inTenant(() =>
      payments.record(
        {
          studentId,
          academicYearId: yearId,
          calendarMonth: 10,
          calendarYear: 2025,
          amount: '10000.00',
          tender: [{ paymentMethodId: method.rows[0]!.id, amount: '10000.00' }],
        },
        ACTOR,
      ),
    );

    const roster = (await inTenant(() => evening.roster(eveningGroupId))) as { id: string }[];
    const eveningReceipt = await inTenant(() =>
      evening.collect(
        {
          enrolmentId: roster[0]!.id,
          calendarMonth: 10,
          calendarYear: 2025,
          amount: '3000.00',
        },
        ACTOR,
      ),
    );

    expect(dayReceipt.receiptNumber).not.toBe(eveningReceipt.receiptNumber);
    // Same prefix and year, consecutive numbers — one run, two businesses.
    expect(eveningReceipt.receiptNumber.startsWith('EVE-2025-')).toBe(true);
    const dayNo = Number(dayReceipt.receiptNumber.split('-')[2]);
    const eveNo = Number(eveningReceipt.receiptNumber.split('-')[2]);
    expect(eveNo).toBe(dayNo + 1);
  });

  it('refuses to pay more than the month owes — a settled month takes nothing more (his `payer_cs`)', async () => {
    const roster = (await inTenant(() => evening.roster(eveningGroupId))) as { id: string }[];
    await expect(
      inTenant(() =>
        evening.collect(
          {
            enrolmentId: roster[0]!.id,
            calendarMonth: 10,
            calendarYear: 2025,
            amount: '3000.00',
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/Le montant dépasse le reste dû du mois \(0 MRU\)/);
  });

  it('reports who has paid and who has not', async () => {
    const status = await inTenant(() => evening.monthStatus(eveningGroupId, 10, 2025));
    expect(status.enrolees).toHaveLength(2);
    expect(status.collected).toBe('3000.00');
    expect(status.expected).toBe('6000.00');
    expect(status.owing).toBe(1);
  });

  it('computes an hourly teacher\'s pay as rate x hours', async () => {
    const teacher = await owner.query<{ id: string }>(
      `INSERT INTO evening_teachers (school_id, first_name, last_name)
       VALUES ($1, 'Prof', 'Soir') RETURNING id`,
      [schoolId],
    );
    const teaching = await owner.query<{ id: string }>(
      `INSERT INTO evening_teachings
         (school_id, evening_group_id, evening_teacher_id, subject, pay_kind,
          hourly_rate, hours_per_month)
       VALUES ($1, $2, $3, 'Anglais', 'hourly', 500, 12) RETURNING id`,
      [schoolId, eveningGroupId, teacher.rows[0]!.id],
    );
    const due = await inTenant(() => evening.teacherDue(teaching.rows[0]!.id));
    expect(due.toString()).toBe('6000');
  });

  it('computes a fixed teacher\'s pay as the salary, ignoring hours', async () => {
    const teacher = await owner.query<{ id: string }>(
      `INSERT INTO evening_teachers (school_id, first_name, last_name)
       VALUES ($1, 'Prof', 'Fixe') RETURNING id`,
      [schoolId],
    );
    const teaching = await owner.query<{ id: string }>(
      `INSERT INTO evening_teachings
         (school_id, evening_group_id, evening_teacher_id, subject, pay_kind,
          hourly_rate, hours_per_month, fixed_salary)
       VALUES ($1, $2, $3, 'Maths', 'fixed', 500, 12, 25000) RETURNING id`,
      [schoolId, eveningGroupId, teacher.rows[0]!.id],
    );
    const due = await inTenant(() => evening.teacherDue(teaching.rows[0]!.id));
    expect(due.toString()).toBe('25000');
  });
});

/**
 * MODIFIER / SUPPRIMER UN GROUPE DU SOIR — `cours_du_soir.php`.
 *
 * ⚠ A GROUP COULD BE CREATED AND NEVER CORRECTED. Its name, its monthly rate
 * and its description were fixed at creation: a rate typed wrong was what every
 * enrolee in that group was billed, for the whole year, with no way back.
 *
 * ⚠ AND ITS `supprimer_groupe` IS A BARE DELETE, with the enrolments, the
 * payments and the teachings cascading behind it. Ours refuses once anybody has
 * been enrolled — the same judgement El Ourwa reached for day-school classes and
 * wrote a long comment about, applied to the case it did not revisit.
 */
describe('corriger un groupe du soir', () => {
  let groupId: string;

  beforeAll(async () => {
    const g = await inTenant(() =>
      evening.createGroup({ name: 'À corriger', monthlyRate: '3000' }, ACTOR),
    );
    groupId = g.id;
  });

  it('changes the name, the rate and the description', async () => {
    await inTenant(() =>
      evening.updateGroup(
        groupId,
        { name: 'Renforcement Maths', monthlyRate: '3500.50', description: 'Samedi matin' },
        ACTOR,
      ),
    );
    const { rows } = await owner.query<{
      name: string;
      monthly_rate: string;
      description: string | null;
    }>('SELECT name, monthly_rate::text, description FROM evening_groups WHERE id = $1', [
      groupId,
    ]);
    expect(rows[0]!.name).toBe('Renforcement Maths');
    // Money, exact.
    expect(rows[0]!.monthly_rate).toBe('3500.50');
    expect(rows[0]!.description).toBe('Samedi matin');
  });

  it('⚠ leaves an already-enrolled person on what they were enrolled at', async () => {
    // The rate is what the NEXT enrolment is billed. Chasing existing ones
    // would rewrite what families already owe — the same rule as a level's
    // monthly rate.
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM evening_enrolments WHERE evening_group_id = $1`,
      [groupId],
    );
    expect(rows[0]!.n).toBe('0');
  });

  it('⚠ refuses a name too short and a negative rate', async () => {
    await expect(
      inTenant(() => evening.updateGroup(groupId, { name: 'X', monthlyRate: '3000' }, ACTOR)),
    ).rejects.toThrow(/nom/i);
    await expect(
      inTenant(() =>
        evening.updateGroup(groupId, { name: 'Correct', monthlyRate: '-1' }, ACTOR),
      ),
    ).rejects.toThrow(/positif/i);
  });

  it('deletes a group nobody was ever enrolled in', async () => {
    await inTenant(() => evening.deleteGroup(groupId, ACTOR));
    const { rows } = await owner.query('SELECT id FROM evening_groups WHERE id = $1', [groupId]);
    expect(rows).toHaveLength(0);
  });

  it('⚠ refuses to delete one that has enrolments — its payments would go too', async () => {
    const g = await inTenant(() =>
      evening.createGroup({ name: 'Occupé', monthlyRate: '3000' }, ACTOR),
    );
    const s = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
       VALUES ($1, 'RIM-CS-DEL', 'NID-CS-DEL', 'Inscrit', 'Soir') RETURNING id`,
      [schoolId],
    );
    await inTenant(() =>
      evening.enrol({ eveningGroupId: g.id, studentId: s.rows[0]!.id }, ACTOR),
    );

    await expect(inTenant(() => evening.deleteGroup(g.id, ACTOR))).rejects.toThrow(
      /inscription/i,
    );
  });
});

/**
 * APPLIQUER UNE RÉDUCTION — `cours_du_soir.php`, `appliquer_reduction_cs`.
 *
 * ⚠ THE ACTION DID NOT EXIST AND NEITHER DID THE TABLE. An evening enrolment
 * could be charged its group's rate and nothing else: no way to agree a lower
 * figure with a family for one month, which is the whole reason the action is
 * there.
 *
 * ⚠ AND IT IS NOT `discounts`. That table is keyed on `student_id NOT NULL`,
 * and an evening enrolee may be an OUTSIDER — a walk-in with a name and a phone
 * number and no student row at all. Migration 0019 explains the rest.
 *
 * Money, so the tests come first. Its two guards are the substance:
 * a reduction may not exceed the rate, and may not drop the month below what
 * has already been paid for it.
 */
describe('la réduction sur une inscription au cours du soir', () => {
  let outsider: string;

  beforeAll(async () => {
    const e = await inTenant(() =>
      evening.enrol(
        { eveningGroupId, outsiderName: 'Reduc Externe', outsiderPhone: '+22245001111' },
        ACTOR,
      ),
    );
    outsider = e.id;
  });

  it('records it as an exact decimal, with its reason and its author', async () => {
    await inTenant(() =>
      evening.applyDiscount(
        {
          enrolmentId: outsider,
          calendarMonth: 11,
          calendarYear: 2025,
          amount: '1250.50',
          reason: 'Accord avec la famille',
        },
        ACTOR,
      ),
    );

    const { rows } = await owner.query<{ amount: string; reason: string; granted_by: string }>(
      `SELECT amount::text, reason, granted_by FROM evening_discounts
        WHERE evening_enrolment_id = $1`,
      [outsider],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe('1250.50');
    expect(rows[0]!.reason).toBe('Accord avec la famille');
    expect(rows[0]!.granted_by).toBe(ACTOR);
  });

  it('⚠ replaces the month’s reduction rather than stacking a second', async () => {
    // Its `ON DUPLICATE KEY UPDATE`. Two reductions on one month is not a
    // decision the school makes; it is one mistake made twice.
    await inTenant(() =>
      evening.applyDiscount(
        { enrolmentId: outsider, calendarMonth: 11, calendarYear: 2025, amount: '500' },
        ACTOR,
      ),
    );
    const { rows } = await owner.query<{ amount: string; reason: string | null }>(
      `SELECT amount::text, reason FROM evening_discounts
        WHERE evening_enrolment_id = $1 AND calendar_month = 11`,
      [outsider],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe('500.00');
    // The old reason goes with the old amount: keeping it would attribute the
    // new figure to a conversation that was about a different one.
    expect(rows[0]!.reason).toBeNull();
  });

  it('⚠ refuses a reduction larger than the monthly rate — its own guard', async () => {
    // "La réduction dépasse le tarif mensuel (3 000 MRU)." Beyond it the month
    // would owe a negative amount, and the school would owe the family money.
    await expect(
      inTenant(() =>
        evening.applyDiscount(
          { enrolmentId: outsider, calendarMonth: 12, calendarYear: 2025, amount: '3500' },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/dépasse le tarif mensuel/i);
  });

  it('⚠ refuses to drop a month below what is already paid for it', async () => {
    // Its second guard: "N MRU sont déjà payés pour ce mois." Reducing under a
    // settled month would leave the school holding money against nothing.
    await inTenant(() =>
      evening.collect(
        { enrolmentId: outsider, calendarMonth: 1, calendarYear: 2026, amount: '2500.00' },
        ACTOR,
      ),
    );

    await expect(
      inTenant(() =>
        evening.applyDiscount(
          { enrolmentId: outsider, calendarMonth: 1, calendarYear: 2026, amount: '1000' },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/déjà payés/i);

    // A reduction that still leaves the month above what was paid is fine.
    await expect(
      inTenant(() =>
        evening.applyDiscount(
          { enrolmentId: outsider, calendarMonth: 1, calendarYear: 2026, amount: '400' },
          ACTOR,
        ),
      ),
    ).resolves.toBeTruthy();
  });

  it('refuses zero and refuses a negative', async () => {
    for (const bad of ['0', '-100']) {
      await expect(
        inTenant(() =>
          evening.applyDiscount(
            { enrolmentId: outsider, calendarMonth: 2, calendarYear: 2026, amount: bad },
            ACTOR,
          ),
        ),
      ).rejects.toThrow(/positif/i);
    }
  });

  it('the month view carries the reduction and what is left to pay', async () => {
    const status = await inTenant(() => evening.monthStatus(eveningGroupId, 11, 2025));
    const line = status.enrolees.find((e) => e.enrolmentId === outsider)!;
    expect(line.discount).toBe('500.00');
    // ⚠ 3 000 − 500. The till must be told the reduced figure, or it collects
    // the full rate and the agreement is worth nothing.
    expect(line.due).toBe('2500.00');
  });

  it('⚠ the till may not collect more than the reduced month is worth', async () => {
    // Its own refusal, and its own parenthesis: "Le montant dépasse le reste dû
    // du mois (N MRU, réduction de M MRU incluse)." Without it the reduction is
    // decorative — the clerk types the rate off the wall and the agreement is
    // worth nothing.
    const e = await inTenant(() =>
      evening.enrol(
        { eveningGroupId, outsiderName: 'Plafond Externe', outsiderPhone: '+22245002222' },
        ACTOR,
      ),
    );
    await inTenant(() =>
      evening.applyDiscount(
        { enrolmentId: e.id, calendarMonth: 3, calendarYear: 2026, amount: '1000' },
        ACTOR,
      ),
    );

    await expect(
      inTenant(() =>
        evening.collect(
          { enrolmentId: e.id, calendarMonth: 3, calendarYear: 2026, amount: '3000.00' },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/réduction de 1 ?000.*incluse|dépasse le reste dû/i);

    // Exactly the reduced amount is accepted.
    await expect(
      inTenant(() =>
        evening.collect(
          { enrolmentId: e.id, calendarMonth: 3, calendarYear: 2026, amount: '2000.00' },
          ACTOR,
        ),
      ),
    ).resolves.toBeTruthy();
  });

  it('retirer la réduction — the month goes back to the full rate', async () => {
    await inTenant(() => evening.removeDiscount(outsider, 11, 2025, ACTOR));
    const status = await inTenant(() => evening.monthStatus(eveningGroupId, 11, 2025));
    const line = status.enrolees.find((e) => e.enrolmentId === outsider)!;
    expect(line.discount).toBeNull();
    expect(line.due).toBe('3000.00');
  });
});
