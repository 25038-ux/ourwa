import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AcademicYearService } from '../src/academic/academic-year.service.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * Phase 2 business rules, against a real database.
 *
 * These are ported behaviours, not inventions — each one exists because
 * El Ourwa does it, and several exist because El Ourwa got it wrong once and
 * the fix is documented in its source.
 */

let owner: pg.Pool;
let years: AcademicYearService;
let enrollments: EnrollmentService;
let schoolId: string;
let activeYearId: string;
let closedYearId: string;
let lowerGroupId: string;
let higherGroupId: string;
let studentId: string;

let ADMIN: string;
const DIRECTION = ['scolarite.niveaux'];
const CLERK: string[] = [];

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'acad' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('acad', 'Academic', 'ACA')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const ys = await owner.query<{ id: string; start_year: number }>(
    `INSERT INTO academic_years (school_id, label, start_year, status) VALUES
       ($1, '2025-2026', 2025, 'closed'), ($1, '2026-2027', 2026, 'active')
     RETURNING id, start_year`,
    [schoolId],
  );
  closedYearId = ys.rows.find((r) => r.start_year === 2025)!.id;
  activeYearId = ys.rows.find((r) => r.start_year === 2026)!.id;

  const levels = await owner.query<{ id: string; name: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order) VALUES
       ($1, '6eme', 15000, 'college', 10), ($1, '5eme', 18000, 'college', 20)
     RETURNING id, name`,
    [schoolId],
  );
  const lower = levels.rows.find((r) => r.name === '6eme')!.id;
  const higher = levels.rows.find((r) => r.name === '5eme')!.id;

  const groups = await owner.query<{ id: string; name: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6eme A'), ($1, $3, '5eme A')
     RETURNING id, name`,
    [schoolId, lower, higher],
  );
  lowerGroupId = groups.rows.find((r) => r.name === '6eme A')!.id;
  higherGroupId = groups.rows.find((r) => r.name === '5eme A')!.id;

  const admin = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('acad.admin@test', 'x', 'Academic Admin') RETURNING id`,
  );
  ADMIN = admin.rows[0]!.id;

  const student = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
     VALUES ($1, 'RIM-A', 'NID-A', 'Ahmed', 'Ould Mohamed') RETURNING id`,
    [schoolId],
  );
  studentId = student.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  years = moduleRef.get(AcademicYearService);
  enrollments = moduleRef.get(EnrollmentService);
});

afterAll(async () => {
  await owner?.end();
});

describe('a closed year is read-only', () => {
  it('refuses any write to a closed year', async () => {
    await expect(inTenant(() => years.assertWritable(closedYearId))).rejects.toThrow(
      /clôturée.*ne peuvent plus être modifiés/i,
    );
  });

  it('permits writes to the open year', async () => {
    await expect(inTenant(() => years.assertWritable(activeYearId))).resolves.toBeTruthy();
  });

  it('refuses to enrol into a closed year', async () => {
    await expect(
      inTenant(() =>
        enrollments.enrol(
          { studentId, academicYearId: closedYearId, groupId: lowerGroupId },
          ADMIN,
          DIRECTION,
        ),
      ),
    ).rejects.toThrow(/clôturée/i);
  });
});

describe('the month schedule and the rule of the 25th', () => {
  it('bills from the entry month when entry is on or before the 25th', async () => {
    const enrolment = await inTenant(() =>
      enrollments.enrol(
        {
          studentId,
          academicYearId: activeYearId,
          groupId: lowerGroupId,
          entryDate: '2026-11-25',
        },
        ADMIN,
        DIRECTION,
      ),
    );

    const months = (await inTenant(() => enrollments.monthsFor(enrolment.id))) as Array<{
      month_order: number;
      status: string;
      amount_due: string;
    }>;

    expect(months).toHaveLength(9); // October to June
    // October free (before entry), November onward billable.
    expect(months[0]!.status).toBe('free');
    expect(months[0]!.amount_due).toBe('0.00');
    expect(months[1]!.status).toBe('billable');
    expect(months[1]!.amount_due).toBe('15000.00');
  });

  it('bills from the FOLLOWING month when entry is after the 25th', async () => {
    const other = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
       VALUES ($1, 'RIM-B', 'NID-B', 'Late', 'Arrival') RETURNING id`,
      [schoolId],
    );
    const enrolment = await inTenant(() =>
      enrollments.enrol(
        {
          studentId: other.rows[0]!.id,
          academicYearId: activeYearId,
          groupId: lowerGroupId,
          entryDate: '2026-11-26',
        },
        ADMIN,
        DIRECTION,
      ),
    );

    const months = (await inTenant(() => enrollments.monthsFor(enrolment.id))) as Array<{
      month_order: number;
      status: string;
    }>;
    // One day later moves the first billable month from November to December.
    expect(months[1]!.status).toBe('free');
    expect(months[2]!.status).toBe('billable');
  });

  it('keeps a free student free for every month', async () => {
    const other = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
       VALUES ($1, 'RIM-C', 'NID-C', 'Free', 'Student') RETURNING id`,
      [schoolId],
    );
    const enrolment = await inTenant(() =>
      enrollments.enrol(
        {
          studentId: other.rows[0]!.id,
          academicYearId: activeYearId,
          groupId: lowerGroupId,
          isFree: true,
        },
        ADMIN,
        DIRECTION,
      ),
    );
    const months = (await inTenant(() => enrollments.monthsFor(enrolment.id))) as Array<{
      status: string;
      amount_due: string;
    }>;
    expect(months.every((m) => m.status === 'free' && m.amount_due === '0.00')).toBe(true);
  });

  it('is idempotent — re-enrolling does not duplicate months', async () => {
    const before = await inTenant(() =>
      enrollments.enrol(
        { studentId, academicYearId: activeYearId, groupId: lowerGroupId },
        ADMIN,
        DIRECTION,
      ),
    );
    const again = await inTenant(() =>
      enrollments.enrol(
        { studentId, academicYearId: activeYearId, groupId: lowerGroupId },
        ADMIN,
        DIRECTION,
      ),
    );
    expect(again.id).toBe(before.id);
    const months = await inTenant(() => enrollments.monthsFor(before.id));
    expect(months).toHaveLength(9);
  });

  it('treats a negotiated fee as the amount owed, not a discount to claw back', async () => {
    const other = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
       VALUES ($1, 'RIM-D', 'NID-D', 'Negotiated', 'Rate') RETURNING id`,
      [schoolId],
    );
    const enrolment = await inTenant(() =>
      enrollments.enrol(
        {
          studentId: other.rows[0]!.id,
          academicYearId: activeYearId,
          groupId: lowerGroupId,
          monthlyFee: '9000.00',
        },
        ADMIN,
        DIRECTION,
      ),
    );
    const months = (await inTenant(() => enrollments.monthsFor(enrolment.id))) as Array<{
      status: string;
      amount_due: string;
    }>;
    const billable = months.filter((m) => m.status === 'billable');
    // The level's rate is 15000; the agreed 9000 is what is owed. The 6000 gap
    // is never a receivable.
    expect(billable.every((m) => m.amount_due === '9000.00')).toBe(true);
  });
});

describe('the progression rule', () => {
  it('stops a clerk moving a held-back student up a level', async () => {
    const repeater = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
       VALUES ($1, 'RIM-E', 'NID-E', 'Held', 'Back') RETURNING id`,
      [schoolId],
    );
    const id = repeater.rows[0]!.id;

    await owner.query(
      `INSERT INTO enrollments
         (school_id, student_id, academic_year_id, group_id, level_id, status, outcome)
       SELECT $1, $2, $3, g.id, g.level_id, 'archived', 'held_back'
         FROM groups g WHERE g.id = $4`,
      [schoolId, id, closedYearId, lowerGroupId],
    );

    await expect(
      inTenant(() =>
        enrollments.enrol(
          { studentId: id, academicYearId: activeYearId, groupId: higherGroupId },
          ADMIN,
          CLERK,
        ),
      ),
    ).rejects.toThrow(/ajourné.*réservé à la direction/i);
  });

  it('lets them repeat the same level', async () => {
    const { rows } = await owner.query<{ id: string }>(
      "SELECT id FROM students WHERE rim = 'RIM-E'",
    );
    await expect(
      inTenant(() =>
        enrollments.enrol(
          { studentId: rows[0]!.id, academicYearId: activeYearId, groupId: lowerGroupId },
          ADMIN,
          CLERK,
        ),
      ),
    ).resolves.toBeTruthy();
  });

  it('lets the direction override it', async () => {
    const { rows } = await owner.query<{ id: string }>(
      "SELECT id FROM students WHERE rim = 'RIM-E'",
    );
    await expect(
      inTenant(() =>
        enrollments.enrol(
          { studentId: rows[0]!.id, academicYearId: activeYearId, groupId: higherGroupId },
          ADMIN,
          DIRECTION,
        ),
      ),
    ).resolves.toBeTruthy();
  });
});

describe('year closure', () => {
  it('archives enrolments, opens the next year, and deletes nothing', async () => {
    const before = await owner.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM enrollments WHERE academic_year_id = $1",
      [activeYearId],
    );

    const result = await inTenant(() => years.close(activeYearId, ADMIN));
    expect(result.next.label).toBe('2027-2028');
    expect(result.next.status).toBe('active');

    const after = await owner.query<{ n: string; archived: string }>(
      `SELECT count(*)::text AS n,
              count(*) FILTER (WHERE status = 'archived')::text AS archived
         FROM enrollments WHERE academic_year_id = $1`,
      [activeYearId],
    );
    // Same number of rows: archived, not removed.
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    expect(after.rows[0]!.archived).toBe(before.rows[0]!.n);
  });

  it('refuses to close a year twice', async () => {
    await expect(inTenant(() => years.close(activeYearId, ADMIN))).rejects.toThrow(
      /déjà clôturée/i,
    );
  });
});
