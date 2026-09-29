import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { ReferenceService } from '../src/academic/reference.service.js';
import { PayrollService } from '../src/payroll/payroll.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * GÉRER LES PROFESSEURS — assigning a teacher to a group and a subject.
 *
 * `gerer_professeurs.php`. Written before the feature because the per-assignment
 * rate feeds payroll: an intérimaire's month is Σ (hours × 4 × rate), and the
 * rate on the assignment is the one that counts.
 *
 * ⚠ THERE WAS NO WAY TO CREATE A TEACHING AT ALL. Every teaching in the system
 * came from the seed, which means a real school could not have added a class to
 * a teacher after go-live — and the timetable, the mark sheet and the payroll
 * all hang off these rows.
 */

let owner: pg.Pool;
let reference: ReferenceService;
let payroll: PayrollService;

let schoolId: string;
let yearId: string;
let oldYearId: string;
let groupId: string;
let subjectId: string;
let otherSubjectId: string;
let ACTOR: string;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'ens' }, fn);
}

async function teacher(tag: string, employment: 'permanent' | 'interim', rate = '0', salary = '0') {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO teachers (school_id, first_name, last_name, employment, hourly_rate, salary)
     VALUES ($1, $2, 'Prof', $3, $4, $5) RETURNING id`,
    [schoolId, tag, employment, rate, salary],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('ens', 'Enseignements', 'ENS')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const years = await owner.query<{ id: string; status: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2025-2026', 2025, 'active'), ($1, '2024-2025', 2024, 'closed')
     RETURNING id, status`,
    [schoolId],
  );
  yearId = years.rows.find((r) => r.status === 'active')!.id;
  oldYearId = years.rows.find((r) => r.status === 'closed')!.id;

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

  const subjects = await owner.query<{ id: string; name: string }>(
    `INSERT INTO subjects (school_id, name, coefficient, max_score)
     VALUES ($1, 'Maths', 3, 20), ($1, 'Physique', 2, 20) RETURNING id, name`,
    [schoolId],
  );
  subjectId = subjects.rows.find((r) => r.name === 'Maths')!.id;
  otherSubjectId = subjects.rows.find((r) => r.name === 'Physique')!.id;

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('ens.admin@test', 'x', 'Direction') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  reference = moduleRef.get(ReferenceService);
  payroll = moduleRef.get(PayrollService);
});

afterAll(async () => {
  await owner?.end();
});

describe('assigner', () => {
  it('creates the teaching and carries its year', async () => {
    // ⚠ THE YEAR IS THE POINT. El Ourwa shipped this without it and records what
    // happened: "Une affectation sans année restait donc invisible partout" —
    // because the mark-entry screen filters strictly on the year being viewed,
    // and that filter is deliberate.
    const t = await teacher('Annee', 'permanent', '0', '50000');
    const created = await inTenant(() =>
      reference.assignTeaching(
        { teacherId: t, groupId, subjectId, academicYearId: yearId, hoursPerWeek: '6' },
        ACTOR,
      ),
    );

    const { rows } = await owner.query<{ academic_year_id: string; hours_per_week: string }>(
      `SELECT academic_year_id, hours_per_week::text FROM teachings WHERE id = $1`,
      [created.id],
    );
    expect(rows[0]!.academic_year_id).toBe(yearId);
    expect(rows[0]!.hours_per_week).toBe('6.0');
  });

  it('refuses the same teacher, group and subject twice in a year', async () => {
    const t = await teacher('Doublon', 'permanent');
    const input = {
      teacherId: t,
      groupId,
      subjectId,
      academicYearId: yearId,
      hoursPerWeek: '4',
    };
    await inTenant(() => reference.assignTeaching(input, ACTOR));
    await expect(inTenant(() => reference.assignTeaching(input, ACTOR))).rejects.toThrow(
      /existe déjà/i,
    );
  });

  it('⚠ refuses hours outside 0.5 to 40', async () => {
    // Its own bounds and its own sentence. Forty hours a week is already more
    // than anyone teaches; the upper bound catches a slipped decimal point.
    const t = await teacher('Heures', 'permanent');
    for (const hours of ['0', '0.2', '41']) {
      await expect(
        inTenant(() =>
          reference.assignTeaching(
            { teacherId: t, groupId, subjectId, academicYearId: yearId, hoursPerWeek: hours },
            ACTOR,
          ),
        ),
      ).rejects.toThrow(/0\.5|40/);
    }
  });
});

describe('the rate on the assignment', () => {
  it('⚠ is what an intérimaire is paid, not the teacher default', async () => {
    // The rate depends on the LEVEL taught: a teacher may earn more for a
    // leaving year than for a first year, and the assignment is where that
    // lives.
    const t = await teacher('Taux', 'interim', '400');
    await inTenant(() =>
      reference.assignTeaching(
        {
          teacherId: t,
          groupId,
          subjectId,
          academicYearId: yearId,
          hoursPerWeek: '5',
          hourlyRate: '900',
        },
        ACTOR,
      ),
    );

    // 5 × 4 × 900 = 18 000, NOT 5 × 4 × 400.
    const pay = await inTenant(() => payroll.teacherReferencePay(t));
    expect(pay.gross.toFixed(2)).toBe('18000.00');
  });

  it('falls back to the teacher’s rate when the assignment names none', async () => {
    // ⚠ NULL means "use the teacher's rate". It does not mean zero — a teacher
    // whose assignment left the box empty must not be paid nothing.
    const t = await teacher('Defaut', 'interim', '500');
    await inTenant(() =>
      reference.assignTeaching(
        { teacherId: t, groupId, subjectId, academicYearId: yearId, hoursPerWeek: '3' },
        ACTOR,
      ),
    );

    const pay = await inTenant(() => payroll.teacherReferencePay(t));
    expect(pay.gross.toFixed(2)).toBe('6000.00'); // 3 × 4 × 500
  });

  it('ignores a negative rate rather than paying a negative salary', async () => {
    const t = await teacher('Negatif', 'interim', '300');
    await inTenant(() =>
      reference.assignTeaching(
        {
          teacherId: t,
          groupId,
          subjectId,
          academicYearId: yearId,
          hoursPerWeek: '2',
          hourlyRate: '-100',
        },
        ACTOR,
      ),
    );
    // Treated as unset, so the teacher's own rate applies: 2 × 4 × 300.
    const pay = await inTenant(() => payroll.teacherReferencePay(t));
    expect(pay.gross.toFixed(2)).toBe('2400.00');
  });

  it('leaves a permanent teacher on their salary whatever the hours', async () => {
    const t = await teacher('Permanent', 'permanent', '0', '75000');
    await inTenant(() =>
      reference.assignTeaching(
        {
          teacherId: t,
          groupId,
          subjectId,
          academicYearId: yearId,
          hoursPerWeek: '20',
          hourlyRate: '1000',
        },
        ACTOR,
      ),
    );
    const pay = await inTenant(() => payroll.teacherReferencePay(t));
    expect(pay.gross.toFixed(2)).toBe('75000.00');
    // The hours are still counted — the payslip shows them even when the pay
    // does not depend on them.
    expect(pay.monthlyHours.toFixed(1)).toBe('80.0');
  });
});

describe('reporter les affectations', () => {
  it('⚠ carries last year’s assignments into the open year', async () => {
    // A new school year has no assignments at all. That is correct — they are
    // dated — but until they exist the mark-entry screen has no subject to
    // offer and looks broken, and recreating them for dozens of classes by hand
    // is not realistic.
    const t = await teacher('Report', 'permanent', '0', '40000');
    await owner.query(
      `INSERT INTO teachings
         (school_id, academic_year_id, teacher_id, group_id, subject_id, hours_per_week, hourly_rate)
       VALUES ($1, $2, $3, $4, $5, 7, 650), ($1, $2, $3, $4, $6, 3, NULL)`,
      [schoolId, oldYearId, t, groupId, subjectId, otherSubjectId],
    );

    const result = await inTenant(() => reference.carryForwardTeachings(yearId, ACTOR));
    expect(result.copied).toBeGreaterThanOrEqual(2);

    const { rows } = await owner.query<{ subject_id: string; hours: string; rate: string | null }>(
      `SELECT subject_id, hours_per_week::text AS hours, hourly_rate::text AS rate
         FROM teachings WHERE teacher_id = $1 AND academic_year_id = $2
        ORDER BY hours_per_week DESC`,
      [t, yearId],
    );
    expect(rows).toHaveLength(2);
    // Hours AND the per-assignment rate come across: they are the terms the
    // teacher agreed, not a detail of last year.
    expect(rows[0]!.hours).toBe('7.0');
    expect(rows[0]!.rate).toBe('650.00');
    expect(rows[1]!.rate).toBeNull();
  });

  it('⚠ never duplicates a subject — only the assignment rows', async () => {
    const before = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM subjects WHERE school_id = $1`,
      [schoolId],
    );
    await inTenant(() => reference.carryForwardTeachings(yearId, ACTOR));
    const after = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM subjects WHERE school_id = $1`,
      [schoolId],
    );
    // The catalogue is global and stays untouched; carrying assignments forward
    // twice must not leave the school with two "Maths".
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it('is safe to run twice — it skips what is already there', async () => {
    const first = await inTenant(() => reference.carryForwardTeachings(yearId, ACTOR));
    const second = await inTenant(() => reference.carryForwardTeachings(yearId, ACTOR));
    expect(second.copied).toBe(0);
    expect(second.skipped).toBeGreaterThanOrEqual(first.copied);
  });
});

describe('removing an assignment', () => {
  it('drops the row and leaves the subject and group alone', async () => {
    const t = await teacher('Retrait', 'permanent');
    const created = await inTenant(() =>
      reference.assignTeaching(
        { teacherId: t, groupId, subjectId, academicYearId: yearId, hoursPerWeek: '2' },
        ACTOR,
      ),
    );

    await inTenant(() => reference.removeTeaching(created.id, ACTOR));

    const gone = await owner.query(`SELECT 1 FROM teachings WHERE id = $1`, [created.id]);
    expect(gone.rows).toHaveLength(0);
    const subject = await owner.query(`SELECT 1 FROM subjects WHERE id = $1`, [subjectId]);
    expect(subject.rows).toHaveLength(1);
  });

  /*
   * ⚠ SUPPRIMER UNE ASSIGNATION EFFAÇAIT SES NOTES, EN SILENCE.
   *
   * `grades.teaching_id` est en `ON DELETE CASCADE`. Une secrétaire qui retire
   * en octobre une assignation saisie par erreur emportait avec elle tout un
   * trimestre de notes, pour toute la classe, sans que rien ne le dise : la
   * confirmation du navigateur ne parle que de l'assignation.
   *
   * ⚠ ET LE RAISONNEMENT ÉTAIT DÉJÀ ÉCRIT, UNE FONCTION PLUS LOIN.
   * `deleteSubject` porte ceci : « our FK cascades, so without it deleting a
   * subject would silently delete every teaching of it — and with them every
   * mark, since grades hang off the teaching. » `deleteLevel` et `deleteGroup`
   * se gardent aussi. Seule la porte qui mène le plus directement au dégât ne
   * se gardait pas.
   *
   * Des notes. Le test d'abord (règle 15).
   */
  it('⚠ refuse de supprimer une assignation qui porte des notes', async () => {
    const t = await teacher('Notee', 'permanent');
    const created = await inTenant(() =>
      reference.assignTeaching(
        { teacherId: t, groupId, subjectId, academicYearId: yearId, hoursPerWeek: '2' },
        ACTOR,
      ),
    );

    const eleve = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
       VALUES ($1, 'RIM-NOTEE', 'NID-NOTEE', 'Marieme', 'Notee') RETURNING id`,
      [schoolId],
    );
    await owner.query(
      `INSERT INTO grades
         (school_id, student_id, teaching_id, academic_year_id, term, kind, sequence_no, score)
       VALUES ($1, $2, $3, $4, 1, 'coursework', 1, 12.50)`,
      [schoolId, eleve.rows[0]!.id, created.id, yearId],
    );

    await expect(inTenant(() => reference.removeTeaching(created.id, ACTOR))).rejects.toThrow(
      /note/i,
    );

    // ⚠ ET LE REFUS N'A RIEN DÉTRUIT — c'est le point : un refus qui laisse
    // derrière lui la moitié du dégât ne vaut pas mieux que pas de refus.
    const encore = await owner.query('SELECT 1 FROM teachings WHERE id = $1', [created.id]);
    expect(encore.rows).toHaveLength(1);
    const notes = await owner.query('SELECT 1 FROM grades WHERE teaching_id = $1', [created.id]);
    expect(notes.rows).toHaveLength(1);
  });

  it('la supprime encore volontiers quand aucune note ne pend', async () => {
    const t = await teacher('Vierge', 'permanent');
    const created = await inTenant(() =>
      reference.assignTeaching(
        { teacherId: t, groupId, subjectId: otherSubjectId, academicYearId: yearId, hoursPerWeek: '2' },
        ACTOR,
      ),
    );
    await inTenant(() => reference.removeTeaching(created.id, ACTOR));
    const gone = await owner.query('SELECT 1 FROM teachings WHERE id = $1', [created.id]);
    expect(gone.rows).toHaveLength(0);
  });
});

/**
 * MODIFIER UNE ASSIGNATION — `gerer_professeurs.php`, `modifier_heures` and
 * `mettre_a_jour_tarif`.
 *
 * ⚠ AN ASSIGNMENT COULD BE CREATED AND DELETED AND NEVER CORRECTED. There was no
 * endpoint to change the hours or the rate on an existing one — so a teacher
 * given 4 h/week by mistake had to be unassigned and reassigned, and between the
 * two the class had no teaching at all: the mark-entry screen offers nothing,
 * the timetable cells lose their subject, and the payroll counts zero.
 *
 * ⚠ AND `heures_par_semaine` IS MONEY. An intérimaire is paid hours × rate, so
 * one figure typed here decides a salary. Its own bounds are 0 < h ≤ 40; a
 * negative per-assignment rate is treated as unset rather than stored, so nobody
 * is ever paid a negative salary by a slipped minus sign.
 */
describe('corriger une assignation', () => {
  let teachingId: string;

  beforeAll(async () => {
    const t = await owner.query<{ id: string }>(
      `SELECT id FROM teachings WHERE academic_year_id = $1 LIMIT 1`,
      [yearId],
    );
    teachingId = t.rows[0]!.id;
  });

  it('changes the hours, exactly', async () => {
    await inTenant(() => reference.updateTeaching(teachingId, { hoursPerWeek: '6' }, ACTOR));
    const { rows } = await owner.query<{ hours_per_week: string }>(
      'SELECT hours_per_week::text FROM teachings WHERE id = $1',
      [teachingId],
    );
    expect(Number(rows[0]!.hours_per_week)).toBe(6);
  });

  it('⚠ refuses zero and refuses more than a week can hold', async () => {
    // Zero hours is not an assignment, it is a deletion wearing a disguise —
    // and it pays an intérimaire nothing while the class still looks staffed.
    for (const bad of ['0', '-1', '41']) {
      await expect(
        inTenant(() => reference.updateTeaching(teachingId, { hoursPerWeek: bad }, ACTOR)),
      ).rejects.toThrow(/heures/i);
    }
  });

  it('sets a per-assignment rate, and keeps it exact', async () => {
    await inTenant(() =>
      reference.updateTeaching(teachingId, { hoursPerWeek: '6', hourlyRate: '1250.75' }, ACTOR),
    );
    const { rows } = await owner.query<{ hourly_rate: string }>(
      'SELECT hourly_rate::text FROM teachings WHERE id = $1',
      [teachingId],
    );
    expect(rows[0]!.hourly_rate).toBe('1250.75');
  });

  it('⚠ an empty rate means “the teacher’s own”, and is not zero', async () => {
    // NULL and 0 are different answers: one defers to the teacher's rate, the
    // other pays nothing for those hours.
    await inTenant(() =>
      reference.updateTeaching(teachingId, { hoursPerWeek: '6', hourlyRate: '' }, ACTOR),
    );
    const { rows } = await owner.query<{ hourly_rate: string | null }>(
      'SELECT hourly_rate::text FROM teachings WHERE id = $1',
      [teachingId],
    );
    expect(rows[0]!.hourly_rate).toBeNull();
  });

  it('⚠ a negative rate is treated as unset, never stored', async () => {
    await inTenant(() =>
      reference.updateTeaching(teachingId, { hoursPerWeek: '6', hourlyRate: '-500' }, ACTOR),
    );
    const { rows } = await owner.query<{ hourly_rate: string | null }>(
      'SELECT hourly_rate::text FROM teachings WHERE id = $1',
      [teachingId],
    );
    expect(rows[0]!.hourly_rate).toBeNull();
  });
});
