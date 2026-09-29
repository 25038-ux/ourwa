import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { ExamAccessService } from '../src/exams/exam-access.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * Exam results, locked term by term against family debt.
 *
 * Ported from El Ourwa v15/v16 — `includes/acces_examens.php` — which the v13
 * source we had been reading does not contain at all.
 *
 * The lock is a RATCHET: a term earned stays earned. These tests walk the exact
 * sequence the legacy file documents, because the sequence IS the rule.
 */

let owner: pg.Pool;
let exams: ExamAccessService;

let schoolId: string;
let yearId: string;
let settledGuardian: string;
let indebtedGuardian: string;
let indebtedStudent: string;
let derogGuardian: string;
let derogStudent: string;
let ACTOR: string;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'exam' }, fn);
}

/** Put a family's earned/closed state directly, to set up a scenario. */
async function earn(guardian: string, term: number) {
  await owner.query(
    `INSERT INTO exam_term_access (school_id, guardian_id, academic_year_id, term, balance_seen)
     VALUES ($1, $2, $3, $4, 0)
     ON CONFLICT (school_id, guardian_id, academic_year_id, term) DO NOTHING`,
    [schoolId, guardian, yearId, term],
  );
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix)
     VALUES ('exam', 'Exams', 'EXM') RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  // A year safely in the past, so every month has elapsed and the debt is real.
  const year = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2020-2021', 2020, 'active') RETURNING id`,
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

  const users = await owner.query<{ id: string; email: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES
       ('exam.actor@test', 'x', 'Directrice'),
       ('exam.settled@test', 'x', 'Famille A jour'),
       ('exam.indebted@test', 'x', 'Famille Endettee'),
       ('exam.derog@test', 'x', 'Famille Derogation')
     RETURNING id, email`,
  );
  ACTOR = users.rows.find((r) => r.email === 'exam.actor@test')!.id;
  settledGuardian = users.rows.find((r) => r.email === 'exam.settled@test')!.id;
  indebtedGuardian = users.rows.find((r) => r.email === 'exam.indebted@test')!.id;
  derogGuardian = users.rows.find((r) => r.email === 'exam.derog@test')!.id;

  // The indebted family has a child enrolled for a year of unpaid months.
  const student = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, 'RIM-EX', 'NID-EX', 'Enfant', 'Endette') RETURNING id`,
    [schoolId, indebtedGuardian],
  );
  indebtedStudent = student.rows[0]!.id;

  const enrolment = await owner.query<{ id: string }>(
    `INSERT INTO enrollments
       (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee)
     VALUES ($1, $2, $3, $4, $5, 'enrolled', 10000) RETURNING id`,
    [schoolId, indebtedStudent, yearId, group.rows[0]!.id, level.rows[0]!.id],
  );
  for (let i = 0; i < 9; i++) {
    const m = ((10 - 1 + i) % 12) + 1;
    const y = 2020 + Math.floor((10 - 1 + i) / 12);
    await owner.query(
      `INSERT INTO enrollment_months
         (school_id, enrollment_id, calendar_month, calendar_year, amount_due, month_order)
       VALUES ($1, $2, $3, $4, 10000, $5)`,
      [schoolId, enrolment.rows[0]!.id, m, y, i + 1],
    );
  }

  // A SECOND indebted family, deliberately kept free of earned terms. Reusing
  // the first made the derogation tests pass on a term that was already open,
  // which measured the fixture rather than the derogation.
  const ds = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, 'RIM-DG', 'NID-DG', 'Enfant', 'Derog') RETURNING id`,
    [schoolId, derogGuardian],
  );
  derogStudent = ds.rows[0]!.id;
  const de = await owner.query<{ id: string }>(
    `INSERT INTO enrollments
       (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee)
     VALUES ($1, $2, $3, $4, $5, 'enrolled', 10000) RETURNING id`,
    [schoolId, derogStudent, yearId, group.rows[0]!.id, level.rows[0]!.id],
  );
  for (let i = 0; i < 9; i++) {
    const m = ((10 - 1 + i) % 12) + 1;
    const y = 2020 + Math.floor((10 - 1 + i) / 12);
    await owner.query(
      `INSERT INTO enrollment_months
         (school_id, enrollment_id, calendar_month, calendar_year, amount_due, month_order)
       VALUES ($1, $2, $3, $4, 10000, $5)`,
      [schoolId, de.rows[0]!.id, m, y, i + 1],
    );
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  exams = moduleRef.get(ExamAccessService);
});

afterAll(async () => {
  await owner?.end();
});

describe('which term a date falls in', () => {
  const year = { start_year: 2020, start_month: 10, end_month: 6 };

  it('splits nine months from October into three terms', () => {
    // Oct Nov Dec | Jan Feb Mar | Apr May Jun
    expect(exams.termOf(year, new Date(2020, 9, 15))).toBe(1);  // October
    expect(exams.termOf(year, new Date(2020, 11, 31))).toBe(1); // December
    expect(exams.termOf(year, new Date(2021, 0, 1))).toBe(2);   // January
    expect(exams.termOf(year, new Date(2021, 2, 20))).toBe(2);  // March
    expect(exams.termOf(year, new Date(2021, 3, 1))).toBe(3);   // April
    expect(exams.termOf(year, new Date(2021, 5, 30))).toBe(3);  // June
  });

  it('is 0 before the year starts — there is nothing to open yet', () => {
    expect(exams.termOf(year, new Date(2020, 8, 30))).toBe(0);
  });

  it('stays 3 after the year ends: the last term remains the useful one', () => {
    expect(exams.termOf(year, new Date(2021, 10, 1))).toBe(3);
  });
});

describe('a family that owes nothing', () => {
  it('sees every term', async () => {
    for (const term of [1, 2, 3]) {
      const seen = await inTenant(() =>
        exams.canSeeExams(settledGuardian, null, yearId, term),
      );
      expect(seen, `term ${term}`).toBe(true);
    }
  });

  it('asked globally, still yes', async () => {
    expect(
      await inTenant(() => exams.canSeeExams(settledGuardian, null, yearId, null)),
    ).toBe(true);
  });
});

describe('a family in debt', () => {
  it('is refused every term', async () => {
    for (const term of [1, 2, 3]) {
      const seen = await inTenant(() =>
        exams.canSeeExams(indebtedGuardian, null, yearId, term),
      );
      expect(seen, `term ${term}`).toBe(false);
    }
  });

  it('⚠ is refused when asked globally, even holding an earned term', async () => {
    // A single earned term is NOT enough to answer the global question. A caller
    // that does not know which term it means must not leak one.
    await earn(indebtedGuardian, 1);
    expect(
      await inTenant(() => exams.canSeeExams(indebtedGuardian, null, yearId, null)),
    ).toBe(false);
  });
});

describe('the ratchet', () => {
  it('⚠ keeps a term that was earned, after the family falls back into debt', async () => {
    // Term 1 was earned above, while the family still owes for the year. This
    // is the whole point of recording it: the fact cannot be recomputed later,
    // because the debt balance is updated in place with no history.
    expect(await inTenant(() => exams.canSeeExams(indebtedGuardian, null, yearId, 1))).toBe(
      true,
    );
    expect(await inTenant(() => exams.canSeeExams(indebtedGuardian, null, yearId, 2))).toBe(
      false,
    );
  });

  it('walks the sequence from the legacy file', async () => {
    // T1 earned, T2 earned, T3 never — arrears returned in term 3.
    await earn(indebtedGuardian, 2);
    const visible = await inTenant(() => exams.visibleTerms(indebtedGuardian, yearId));
    expect(visible).toEqual([1, 2]);
  });
});

describe('the direction closing a term', () => {
  it('⚠ outranks a term the family had earned', async () => {
    await inTenant(() =>
      exams.closeTerm(
        {
          guardianId: indebtedGuardian,
          academicYearId: yearId,
          term: 1,
          reason: 'Chèque sans provision',
        },
        ACTOR,
      ),
    );
    expect(await inTenant(() => exams.canSeeExams(indebtedGuardian, null, yearId, 1))).toBe(
      false,
    );
  });

  it('⚠ outranks a SETTLED DEBT — otherwise "only the direction may close" is empty', async () => {
    await inTenant(() =>
      exams.closeTerm(
        {
          guardianId: settledGuardian,
          academicYearId: yearId,
          term: 2,
          reason: 'Décision de direction',
        },
        ACTOR,
      ),
    );
    // This family owes nothing at all, and is still refused that one term.
    expect(await inTenant(() => exams.canSeeExams(settledGuardian, null, yearId, 2))).toBe(
      false,
    );
    expect(await inTenant(() => exams.canSeeExams(settledGuardian, null, yearId, 3))).toBe(
      true,
    );
  });

  it('⚠ is NOT undone by the next payment that happens along', async () => {
    // openIfSettled must not resurrect a row the direction closed.
    await inTenant(() => exams.openIfSettled(settledGuardian, yearId));
    expect(await inTenant(() => exams.canSeeExams(settledGuardian, null, yearId, 2))).toBe(
      false,
    );
  });

  it('can be reopened deliberately', async () => {
    await inTenant(() =>
      exams.reopenTerm({ guardianId: settledGuardian, academicYearId: yearId, term: 2 }, ACTOR),
    );
    expect(await inTenant(() => exams.canSeeExams(settledGuardian, null, yearId, 2))).toBe(
      true,
    );
  });

  it('refuses to close a term without a reason', async () => {
    await expect(
      inTenant(() =>
        exams.closeTerm(
          { guardianId: settledGuardian, academicYearId: yearId, term: 3, reason: '   ' },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/demande un motif/i);
  });
});

describe('derogations', () => {
  let derogationId: string;

  it('refuses one with no reason: it must be explicable months later', async () => {
    await expect(
      inTenant(() =>
        exams.grantDerogation(
          { guardianId: derogGuardian, academicYearId: yearId, reason: '  ' },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/demande un motif/i);
  });

  it('opens one term for one child', async () => {
    const granted = await inTenant(() =>
      exams.grantDerogation(
        {
          guardianId: derogGuardian,
          studentId: derogStudent,
          academicYearId: yearId,
          term: 3,
          reason: 'Échéancier accepté par la direction',
        },
        ACTOR,
      ),
    );
    derogationId = granted.id;

    expect(
      await inTenant(() =>
        exams.canSeeExams(derogGuardian, derogStudent, yearId, 3),
      ),
    ).toBe(true);
  });

  it('does not leak to another term', async () => {
    expect(
      await inTenant(() => exams.canSeeExams(derogGuardian, derogStudent, yearId, 2)),
    ).toBe(false);
  });

  it('is revoked, never deleted', async () => {
    await inTenant(() => exams.revokeDerogation(derogationId, ACTOR));

    expect(
      await inTenant(() =>
        exams.canSeeExams(derogGuardian, derogStudent, yearId, 3),
      ),
    ).toBe(false);

    // The row survives, because this is an access decision with financial
    // consequences and its history has to outlive an inspection.
    const { rows } = await owner.query<{ revoked_at: string | null; reason: string }>(
      'SELECT revoked_at, reason FROM exam_derogations WHERE id = $1',
      [derogationId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revoked_at).not.toBeNull();
    expect(rows[0]!.reason).toContain('Échéancier');
  });

  it('⚠ an EXPIRED derogation protects nothing', async () => {
    await owner.query(
      `INSERT INTO exam_derogations
         (school_id, guardian_id, academic_year_id, term, reason, granted_by, expires_at)
       VALUES ($1, $2, $3, 2, 'Expirée', $4, now() - interval '1 hour')`,
      [schoolId, derogGuardian, yearId, ACTOR],
    );
    expect(await inTenant(() => exams.canSeeExams(derogGuardian, null, yearId, 2))).toBe(
      false,
    );
  });
});

describe('failing closed', () => {
  it('refuses an unknown family rather than assuming', async () => {
    expect(await inTenant(() => exams.canSeeExams('', null, yearId, 1))).toBe(false);
  });

  it('refuses when there is no year', async () => {
    expect(await inTenant(() => exams.canSeeExams(settledGuardian, null, '', 1))).toBe(false);
  });
});
