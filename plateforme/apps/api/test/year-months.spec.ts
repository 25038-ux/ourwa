import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AcademicYearService } from '../src/academic/academic-year.service.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LES MOIS PAYABLES D'UNE ANNÉE — `annee_scolaire.php`.
 *
 * ⚠ WE MODELLED A RANGE; IT MODELS A SET. `start_month`/`end_month` can only
 * say "October through June". Its `annee_scolaire_mois` is a row per ticked
 * month, and a whole page exists to tick them: "Sélectionnez les mois de
 * l'année scolaire durant lesquels les parents doivent payer les frais de
 * scolarité".
 *
 * A range cannot express a skipped month. A school that does not bill for
 * Ramadan, or opens late after building works, has no way to say so with two
 * numbers — and EVERY enrolment's schedule is generated from this, so the gap
 * becomes a month of fees invented for every family at once.
 */

let owner: pg.Pool;
let years: AcademicYearService;
let enrollments: EnrollmentService;

let schoolId: string;
let yearId: string;
let closedYearId: string;
let groupId: string;
let ACTOR: string;

const DIRECTION = ['scolarite.niveaux'];
const START = 2019;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'aym' }, fn);
}

async function scheduleOf(tag: string): Promise<number[]> {
  const s = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, $3, $4, 'Aym') RETURNING id`,
    [schoolId, `RIM-${tag}`, `NID-${tag}`, tag],
  );
  await inTenant(() =>
    enrollments.enrol(
      { studentId: s.rows[0]!.id, academicYearId: yearId, groupId, entryDate: `${START}-10-01` },
      ACTOR,
      DIRECTION,
    ),
  );
  const { rows } = await owner.query<{ calendar_month: number }>(
    `SELECT m.calendar_month FROM enrollment_months m
       JOIN enrollments e ON e.id = m.enrollment_id
      WHERE e.student_id = $1 ORDER BY m.month_order`,
    [s.rows[0]!.id],
  );
  return rows.map((r) => r.calendar_month);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('aym', 'Mois', 'AYM') RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const ys = await owner.query<{ id: string; status: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2019-2020', $2, 'active'), ($1, '2016-2017', $3, 'closed')
     RETURNING id, status`,
    [schoolId, START, START - 3],
  );
  yearId = ys.rows.find((r) => r.status === 'active')!.id;
  closedYearId = ys.rows.find((r) => r.status === 'closed')!.id;

  const level = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle)
     VALUES ($1, '6eme', 1000, 'college') RETURNING id`,
    [schoolId],
  );
  const group = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6eme A') RETURNING id`,
    [schoolId, level.rows[0]!.id],
  );
  groupId = group.rows[0]!.id;

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('aym.admin@test', 'x', 'Direction') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  years = moduleRef.get(AcademicYearService);
  enrollments = moduleRef.get(EnrollmentService);
});

afterAll(async () => {
  await owner?.end();
});

describe('with nothing chosen', () => {
  it('⚠ falls back to the range, NOT to no months at all', async () => {
    // The set is an override. Its absence is not a school that bills nothing —
    // a year nobody has configured must keep behaving as it does today.
    const year = await inTenant(() => years.byId(yearId));
    const months = await inTenant(() => years.payableMonthsFor(year));
    expect(months.length).toBe(9);
    expect(months.map((m) => m.month)).toEqual([10, 11, 12, 1, 2, 3, 4, 5, 6]);
  });

  it('and a schedule is built for all nine', async () => {
    expect(await scheduleOf('defaut')).toHaveLength(9);
  });
});

describe('with a month unticked', () => {
  it('⚠ the skipped month is NOT in the payable list', async () => {
    // February off — the case a range cannot express at all.
    await inTenant(() => years.setMonths(yearId, [10, 11, 12, 1, 3, 4, 5, 6], ACTOR));

    const year = await inTenant(() => years.byId(yearId));
    const months = await inTenant(() => years.payableMonthsFor(year));
    expect(months.map((m) => m.month)).toEqual([10, 11, 12, 1, 3, 4, 5, 6]);
    expect(months.map((m) => m.month)).not.toContain(2);
  });

  it('⚠ and no schedule is generated for it, for anyone', async () => {
    // This is the whole point: the generator invents a month of fees for every
    // family at once if it does not read the selection.
    const built = await scheduleOf('sansfevrier');
    expect(built).toHaveLength(8);
    expect(built).not.toContain(2);
  });

  it('reads back exactly what was set', async () => {
    expect(await inTenant(() => years.selectedMonths(yearId))).toEqual([
      1, 3, 4, 5, 6, 10, 11, 12,
    ]);
  });
});

describe('what it refuses', () => {
  it('⚠ refuses a closed year', async () => {
    // The months decide what every family WAS billed. Re-deciding them for a
    // settled year rewrites history that receipts already describe.
    await expect(
      inTenant(() => years.setMonths(closedYearId, [10, 11], ACTOR)),
    ).rejects.toThrow(/clôturée/i);
  });

  it('ignores a month outside 1..12 rather than storing it', async () => {
    const r = await inTenant(() => years.setMonths(yearId, [10, 13, 0, 11], ACTOR));
    expect(r.months).toEqual([10, 11]);
  });

  it('clearing the selection restores the range', async () => {
    await inTenant(() => years.setMonths(yearId, [], ACTOR));
    const year = await inTenant(() => years.byId(yearId));
    expect((await inTenant(() => years.payableMonthsFor(year))).length).toBe(9);
  });
});
