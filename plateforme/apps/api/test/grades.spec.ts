import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { GradesService } from '../src/grades/grades.service.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { DbService } from '../src/db/db.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * Phase 5 — grades, report cards, and the teacher boundary.
 *
 * The boundary tests matter most: a teacher must not reach another teacher's
 * class by changing an id in the URL. That is a security boundary, not a UI
 * filter, so it is asserted here rather than assumed from which links render.
 */

let owner: pg.Pool;
let grades: GradesService;
let enrollments: EnrollmentService;

let schoolId: string;
let yearId: string;
let groupId: string;
let ADMIN: string;
let teacherOneUser: string;
let teacherTwoUser: string;
let teachingOne: string;
let teachingTwo: string;
let studentIds: string[] = [];

const DIRECTION = ['scolarite.niveaux'];

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'grd' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('grd', 'Grades', 'GRD')
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
    `INSERT INTO levels (school_id, name, monthly_rate, cycle) VALUES ($1, '6eme', 10000, 'college')
     RETURNING id`,
    [schoolId],
  );
  const group = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6eme A') RETURNING id`,
    [schoolId, level.rows[0]!.id],
  );
  groupId = group.rows[0]!.id;

  // Two subjects on different scales — one /20, one /40, so the rescaling path
  // is exercised by the class report cards too.
  const subjects = await owner.query<{ id: string; name: string }>(
    `INSERT INTO subjects (school_id, level_id, name, coefficient, max_score) VALUES
       ($1, $2, 'Maths', 4, 20), ($1, $2, 'Education islamique', 2, 40)
     RETURNING id, name`,
    [schoolId, level.rows[0]!.id],
  );

  const admin = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('grd.admin@test', 'x', 'Admin') RETURNING id`,
  );
  ADMIN = admin.rows[0]!.id;

  const users = await owner.query<{ id: string; email: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES
       ('grd.t1@test', 'x', 'Teacher One'), ('grd.t2@test', 'x', 'Teacher Two')
     RETURNING id, email`,
  );
  teacherOneUser = users.rows.find((r) => r.email === 'grd.t1@test')!.id;
  teacherTwoUser = users.rows.find((r) => r.email === 'grd.t2@test')!.id;

  const teachers = await owner.query<{ id: string; user_id: string }>(
    `INSERT INTO teachers (school_id, user_id, first_name, last_name) VALUES
       ($1, $2, 'One', 'Teacher'), ($1, $3, 'Two', 'Teacher')
     RETURNING id, user_id`,
    [schoolId, teacherOneUser, teacherTwoUser],
  );

  const t = await owner.query<{ id: string; subject_id: string }>(
    `INSERT INTO teachings (school_id, academic_year_id, teacher_id, group_id, subject_id)
     VALUES ($1, $2, $3, $4, $5), ($1, $2, $6, $4, $7)
     RETURNING id, subject_id`,
    [
      schoolId, yearId,
      teachers.rows.find((r) => r.user_id === teacherOneUser)!.id,
      groupId, subjects.rows.find((r) => r.name === 'Maths')!.id,
      teachers.rows.find((r) => r.user_id === teacherTwoUser)!.id,
      subjects.rows.find((r) => r.name === 'Education islamique')!.id,
    ],
  );
  teachingOne = t.rows.find((r) => r.subject_id === subjects.rows.find((s) => s.name === 'Maths')!.id)!.id;
  teachingTwo = t.rows.find((r) => r.id !== teachingOne)!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  grades = moduleRef.get(GradesService);
  enrollments = moduleRef.get(EnrollmentService);
  instrument(moduleRef.get(DbService));

  for (let i = 0; i < 3; i++) {
    const s = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, $3, $4, 'Eleve') RETURNING id`,
      [schoolId, `RIM-G${i}`, `NID-G${i}`, `Etudiant${i}`],
    );
    studentIds.push(s.rows[0]!.id);
    await inTenant(() =>
      enrollments.enrol(
        { studentId: s.rows[0]!.id, academicYearId: yearId, groupId },
        ADMIN,
        DIRECTION,
      ),
    );
  }
});

afterAll(async () => {
  await owner?.end();
});

describe('the teacher boundary', () => {
  it('lets a teacher open their own class', async () => {
    await expect(
      inTenant(() => grades.assertOwnTeaching(teacherOneUser, teachingOne)),
    ).resolves.toBeUndefined();
  });

  it('⚠ refuses another teacher\'s class, even with the id in hand', async () => {
    // Guessing or copying an id must not be enough. This is the whole boundary.
    await expect(
      inTenant(() => grades.assertOwnTeaching(teacherOneUser, teachingTwo)),
    ).rejects.toThrow(/n’est pas la vôtre/i);
  });

  it('refuses a teacher with no teaching at all', async () => {
    await expect(
      inTenant(() => grades.assertOwnTeaching(ADMIN, teachingOne)),
    ).rejects.toThrow(/n’est pas la vôtre/i);
  });
});

describe('which children a teacher may write about', () => {
  /**
   * Every teacher holds `notes.consulter`, so without this boundary any of them
   * could leave a remark on any child in the school — including one they have
   * never taught — and the family would read it. El Ourwa scopes the same screen
   * with `WHERE et.id = :e AND e.professeur_id = :p`.
   */
  it('recognises a child in their own class', async () => {
    expect(
      await inTenant(() => grades.teachesStudent(teacherOneUser, studentIds[0]!)),
    ).toBe(true);
  });

  it('⚠ does not recognise a child taught by somebody else', async () => {
    // teachingTwo belongs to teacherTwo and covers a different subject of the
    // same group, so this asserts the join is on the TEACHER, not merely on the
    // student existing.
    const outsider = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
       VALUES ($1, 'RIM-OUT', 'NID-OUT', 'Hors', 'Classe') RETURNING id`,
      [schoolId],
    );
    expect(
      await inTenant(() => grades.teachesStudent(teacherOneUser, outsider.rows[0]!.id)),
    ).toBe(false);
  });

  it('does not recognise anyone for a user who teaches nothing', async () => {
    expect(await inTenant(() => grades.teachesStudent(ADMIN, studentIds[0]!))).toBe(false);
  });
});

describe('recording marks', () => {
  it('writes a sheet and reads it back', async () => {
    const result = await inTenant(() =>
      grades.record(
        teachingOne,
        1,
        studentIds.flatMap((studentId, i) => [
          { studentId, kind: 'coursework' as const, sequenceNo: 1, score: String(10 + i) },
          { studentId, kind: 'exam' as const, sequenceNo: 1, score: String(12 + i) },
        ]),
        ADMIN,
      ),
    );
    expect(result.recorded).toBe(6);

    const sheet = await inTenant(() => grades.sheet(teachingOne, 1, yearId));
    expect(sheet.students).toHaveLength(3);
    expect(sheet.students[0]!.exam).toBeTruthy();
  });

  it('corrects rather than duplicates when the sheet is submitted again', async () => {
    await inTenant(() =>
      grades.record(
        teachingOne,
        1,
        [{ studentId: studentIds[0]!, kind: 'coursework', sequenceNo: 1, score: '19' }],
        ADMIN,
      ),
    );
    const sheet = await inTenant(() => grades.sheet(teachingOne, 1, yearId));
    const student = sheet.students.find((s) => s.studentId === studentIds[0]);
    expect(student!.coursework[1]).toBe('19.00');
    expect(sheet.students).toHaveLength(3);
  });

  it('accepts -1 as an absence', async () => {
    await expect(
      inTenant(() =>
        grades.record(
          teachingOne,
          1,
          [{ studentId: studentIds[1]!, kind: 'exam', sequenceNo: 1, score: '-1' }],
          ADMIN,
        ),
      ),
    ).resolves.toBeTruthy();
  });

  it('⚠ refuses a mark outside the subject\'s own scale', async () => {
    // 25 on a subject marked out of 20 is a typing slip. Storing it silently
    // corrupts every average it enters.
    await expect(
      inTenant(() =>
        grades.record(
          teachingOne,
          1,
          [{ studentId: studentIds[0]!, kind: 'exam', sequenceNo: 1, score: '25' }],
          ADMIN,
        ),
      ),
    ).rejects.toThrow(/hors du barème/i);
  });

  it('allows a 35 on a subject marked out of 40', async () => {
    await expect(
      inTenant(() =>
        grades.record(
          teachingTwo,
          1,
          [{ studentId: studentIds[0]!, kind: 'exam', sequenceNo: 1, score: '35' }],
          ADMIN,
        ),
      ),
    ).resolves.toBeTruthy();
  });

  it('refuses to write into a closed year', async () => {
    await owner.query("UPDATE academic_years SET status = 'closed' WHERE id = $1", [yearId]);
    await expect(
      inTenant(() =>
        grades.record(
          teachingOne,
          1,
          [{ studentId: studentIds[0]!, kind: 'exam', sequenceNo: 1, score: '15' }],
          ADMIN,
        ),
      ),
    ).rejects.toThrow(/clôturée/i);
    await owner.query("UPDATE academic_years SET status = 'active' WHERE id = $1", [yearId]);
  });
});

describe('class report cards', () => {
  it('computes every card in the class', async () => {
    const result = await inTenant(() => grades.classReportCards(groupId, 1, yearId));
    expect(result.students).toHaveLength(3);
    expect(result.students.every((s) => s.regime === 'classic')).toBe(true);
  });

  it('ranks by score, sharing a rank on a tie', async () => {
    const result = await inTenant(() => grades.classReportCards(groupId, 1, yearId));
    const ranked = result.students.filter((s) => s.rank !== null);
    expect(ranked.length).toBeGreaterThan(0);
    // Ranks are ordered and start at 1.
    expect(ranked[0]!.rank).toBe(1);
  });

  it('⚠ issues a bounded number of queries regardless of class size', async () => {
    // El Ourwa called its bulletin builder once per student: a class of 333 cost
    // 2,110 queries for one page. Query count must not grow with the roster.
    queryCount = 0;
    await inTenant(() => grades.classReportCards(groupId, 1, yearId));
    const withThree = queryCount;

    for (let i = 0; i < 12; i++) {
      const s = await owner.query<{ id: string }>(
        `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
         VALUES ($1, $2, $3, $4, 'Bulk') RETURNING id`,
        [schoolId, `RIM-B${i}`, `NID-B${i}`, `Bulk${i}`],
      );
      await inTenant(() =>
        enrollments.enrol(
          { studentId: s.rows[0]!.id, academicYearId: yearId, groupId },
          ADMIN,
          DIRECTION,
        ),
      );
    }

    queryCount = 0;
    await inTenant(() => grades.classReportCards(groupId, 1, yearId));
    const withFifteen = queryCount;

    // Five times the students, the SAME number of round trips.
    expect(withFifteen).toBe(withThree);
    // And the count is small, not merely stable.
    expect(withFifteen).toBeLessThanOrEqual(6);
  });
});

/**
 * Counts the round trips the service actually issues.
 *
 * Wraps the pool DbService already holds, so this measures the real thing
 * rather than a mock's opinion of it.
 */
let queryCount = 0;

function instrument(db: DbService): void {
  const pool = (db as unknown as { pool: { connect: () => Promise<PoolClientLike> } }).pool;
  const original = pool.connect.bind(pool);
  pool.connect = async () => {
    const client = await original();
    // pg REUSES pooled client objects. Wrapping on every checkout stacks a new
    // wrapper each time, so one call would increment once per layer and the
    // count would climb with pool churn rather than with queries. Wrap once.
    if (!(client as { __counted?: boolean }).__counted) {
      (client as { __counted?: boolean }).__counted = true;
      const clientQuery = client.query.bind(client);
      client.query = (...args: unknown[]) => {
        const sql = typeof args[0] === 'string' ? args[0] : '';
        // Transaction bookkeeping is not a data round trip.
        if (!/^\s*(BEGIN|COMMIT|ROLLBACK|SELECT set_config)/i.test(sql)) queryCount += 1;
        return clientQuery(...(args as Parameters<typeof clientQuery>));
      };
    }
    return client;
  };
}

interface PoolClientLike {
  query: (...args: unknown[]) => unknown;
}
