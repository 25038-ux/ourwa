import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { ReferenceService } from '../src/academic/reference.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * GÉRER LES NIVEAUX — the inline edits on `gerer_niveaux.php`.
 *
 * Its levels table is not a list, it is a row of small forms: the monthly rate,
 * the pass mark and the fondamental flag are each edited in place behind their
 * own ✓ button. Two of those three are money and grades, so the tests come
 * first.
 *
 * ⚠ THE PASS MARK IS ALWAYS OUT OF 20 EVEN WHEN THE SUBJECTS ARE NOT. A
 * fondamental level marks each subject on its own scale — /50, /30 — and its
 * screen still labels the threshold "Seuil d'admission (/20)". Mixing the two
 * would read 10/20 as 10/50 and pass an entire level that failed.
 */

let owner: pg.Pool;
let reference: ReferenceService;
let schoolId: string;
let yearId: string;
let priorYearId: string;
let levelId: string;
let emptyLevelId: string;
let groupId: string;
let emptyGroupId: string;
let subjectId: string;
let ADMIN: string;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'niv' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('niv', 'Niveaux', 'NIV')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const ys = await owner.query<{ id: string; start_year: number }>(
    `INSERT INTO academic_years (school_id, label, start_year, status) VALUES
       ($1, '2025-2026', 2025, 'closed'), ($1, '2026-2027', 2026, 'active')
     RETURNING id, start_year`,
    [schoolId],
  );
  priorYearId = ys.rows.find((r) => r.start_year === 2025)!.id;
  yearId = ys.rows.find((r) => r.start_year === 2026)!.id;

  const levels = await owner.query<{ id: string; name: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order) VALUES
       ($1, '3AF', 12000, 'fondamental', 30), ($1, 'Vide', 9000, 'college', 40)
     RETURNING id, name`,
    [schoolId],
  );
  levelId = levels.rows.find((r) => r.name === '3AF')!.id;
  emptyLevelId = levels.rows.find((r) => r.name === 'Vide')!.id;

  const groups = await owner.query<{ id: string; name: string }>(
    `INSERT INTO groups (school_id, level_id, name, capacity) VALUES
       ($1, $2, '3AF A', 30), ($1, $2, '3AF B', 30)
     RETURNING id, name`,
    [schoolId, levelId],
  );
  groupId = groups.rows.find((r) => r.name === '3AF A')!.id;
  emptyGroupId = groups.rows.find((r) => r.name === '3AF B')!.id;

  const subject = await owner.query<{ id: string }>(
    `INSERT INTO subjects (school_id, level_id, name, coefficient, max_score)
     VALUES ($1, $2, 'Sciences', 2, 20) RETURNING id`,
    [schoolId, levelId],
  );
  subjectId = subject.rows[0]!.id;

  const admin = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('niv.admin@test', 'x', 'Niveaux Admin') RETURNING id`,
  );
  ADMIN = admin.rows[0]!.id;

  // Two children this year, three last year — the "évolution des effectifs"
  // table compares exactly this.
  const students = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, rim, national_id, first_name, last_name) VALUES
       ($1, 'RIM-N1', 'NID-N1', 'A', 'Un'), ($1, 'RIM-N2', 'NID-N2', 'B', 'Deux'),
       ($1, 'RIM-N3', 'NID-N3', 'C', 'Trois')
     RETURNING id`,
    [schoolId],
  );
  for (const [i, s] of students.rows.entries()) {
    await owner.query(
      `INSERT INTO enrollments (school_id, student_id, academic_year_id, group_id, status)
       VALUES ($1, $2, $3, $4, 'enrolled')`,
      [schoolId, s.id, priorYearId, groupId],
    );
    if (i < 2) {
      await owner.query(
        `INSERT INTO enrollments (school_id, student_id, academic_year_id, group_id, status)
         VALUES ($1, $2, $3, $4, 'enrolled')`,
        [schoolId, s.id, yearId, groupId],
      );
    }
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  reference = moduleRef.get(ReferenceService);
});

afterAll(async () => {
  await owner?.end();
});

describe('le tarif mensuel du niveau', () => {
  it('stores it as an exact decimal string, never a float', async () => {
    await inTenant(() => reference.setLevelRate(levelId, '12500.50', ADMIN));
    const { rows } = await owner.query<{ monthly_rate: string }>(
      'SELECT monthly_rate FROM levels WHERE id = $1',
      [levelId],
    );
    expect(rows[0]!.monthly_rate).toBe('12500.50');
  });

  it('refuses a negative rate — its own check, "le tarif doit être positif"', async () => {
    await expect(inTenant(() => reference.setLevelRate(levelId, '-1', ADMIN))).rejects.toThrow(
      /positif/i,
    );
  });

  it('leaves already-enrolled children on the fee they were admitted at', async () => {
    // ⚠ The rate is a DEFAULT for the next admission, not a retroactive edit.
    // El Ourwa's UPDATE touches `niveaux` alone; `etudiants.frais_mensuel` is
    // copied at admission and never chased afterwards. Changing that would
    // silently rewrite what families already owe.
    const before = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM enrollments WHERE group_id = $1`,
      [groupId],
    );
    await inTenant(() => reference.setLevelRate(levelId, '99000', ADMIN));
    const after = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM enrollments e
        WHERE e.group_id = $1 AND e.monthly_fee = 99000`,
      [groupId],
    );
    expect(before.rows[0]!.n).not.toBe('0');
    expect(after.rows[0]!.n).toBe('0');
    await inTenant(() => reference.setLevelRate(levelId, '12000', ADMIN));
  });
});

describe('le seuil d’admission', () => {
  it('accepts a quarter-point threshold and keeps its scale', async () => {
    await inTenant(() => reference.setLevelPassMark(levelId, '9.75', ADMIN));
    const { rows } = await owner.query<{ pass_mark: string }>(
      'SELECT pass_mark FROM levels WHERE id = $1',
      [levelId],
    );
    expect(rows[0]!.pass_mark).toBe('9.75');
  });

  it('refuses anything outside 0–20, whatever the subjects are marked on', async () => {
    for (const bad of ['-0.25', '20.5', '50']) {
      await expect(
        inTenant(() => reference.setLevelPassMark(levelId, bad, ADMIN)),
      ).rejects.toThrow(/entre 0 et 20/i);
    }
  });

  it('refuses an empty threshold rather than falling back to a global one', async () => {
    // Its own message: "Indiquez un seuil entre 0 et 20 pour ce niveau."
    await expect(inTenant(() => reference.setLevelPassMark(levelId, '', ADMIN))).rejects.toThrow(
      /Indiquez un seuil/i,
    );
  });
});

describe('le barème d’une matière', () => {
  it('accepts /50 and keeps it exact', async () => {
    await inTenant(() => reference.setSubjectMaxScore(subjectId, '50', ADMIN));
    const { rows } = await owner.query<{ max_score: string }>(
      'SELECT max_score FROM subjects WHERE id = $1',
      [subjectId],
    );
    expect(rows[0]!.max_score).toBe('50.00');
  });

  it('refuses a scale outside 1–99 — its own bounds', async () => {
    for (const bad of ['0', '0.5', '100']) {
      await expect(
        inTenant(() => reference.setSubjectMaxScore(subjectId, bad, ADMIN)),
      ).rejects.toThrow(/entre 1 et 99/i);
    }
    await inTenant(() => reference.setSubjectMaxScore(subjectId, '20', ADMIN));
  });
});

describe('basculer « fondamental »', () => {
  it('flips the flag and reports the new state', async () => {
    const first = await inTenant(() => reference.toggleFondamental(levelId, ADMIN));
    const second = await inTenant(() => reference.toggleFondamental(levelId, ADMIN));
    expect(first.isFondamental).toBe(!second.isFondamental);
  });
});

describe('supprimer — ce qui est refusé', () => {
  it('refuses to delete a level that still has groups', async () => {
    await expect(inTenant(() => reference.deleteLevel(levelId, ADMIN))).rejects.toThrow(/groupe/i);
  });

  it('deletes a level with no group and no child', async () => {
    await inTenant(() => reference.deleteLevel(emptyLevelId, ADMIN));
    const { rows } = await owner.query('SELECT id FROM levels WHERE id = $1', [emptyLevelId]);
    expect(rows).toHaveLength(0);
  });

  it('refuses to delete a class that has ever been enrolled into', async () => {
    // ⚠ El Ourwa deleted the class AND ITS CHILDREN — notes, paiements,
    // absences — until it stopped itself. Its refusal is the ported behaviour.
    await expect(inTenant(() => reference.deleteGroup(groupId, ADMIN))).rejects.toThrow(
      /inscription/i,
    );
    const { rows } = await owner.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM enrollments WHERE group_id = $1',
      [groupId],
    );
    expect(rows[0]!.n).toBe('5'); // three last year, two this year — all intact
  });

  it('deletes a class that was never used', async () => {
    await inTenant(() => reference.deleteGroup(emptyGroupId, ADMIN));
    const { rows } = await owner.query('SELECT id FROM groups WHERE id = $1', [emptyGroupId]);
    expect(rows).toHaveLength(0);
  });
});

describe('le détail d’un niveau', () => {
  it('counts this year’s children per class and last year’s beside them', async () => {
    const detail = await inTenant(() => reference.levelDetail(levelId, yearId));
    const a = detail.groups.find((g) => g.name === '3AF A')!;
    expect(a.headcount).toBe(2);
    expect(a.previous).toBe(3);
    // ⚠ Its "Évolution" column: −1, and it has to read as a loss, not as "1".
    expect(a.delta).toBe(-1);
  });

  it('says “pas de données N-1” rather than 0 when there is no prior year', async () => {
    // A first year has nothing to compare against. Zero would read as
    // "everyone left", which is a different and alarming statement.
    const detail = await inTenant(() => reference.levelDetail(levelId, priorYearId));
    const a = detail.groups.find((g) => g.name === '3AF A')!;
    expect(a.previous).toBeNull();
    expect(a.delta).toBeNull();
  });
});
