import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { TimetableService } from '../src/timetable/timetable.service.js';
import { ExpulsionsService } from '../src/discipline/expulsions.service.js';
import { AdmissionsService } from '../src/admissions/admissions.service.js';
import { PayrollService } from '../src/payroll/payroll.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * The weekly timetable, the expulsion register, and teacher hourly pay.
 *
 * Teacher pay is money, so it is test-first and the ×4 is asserted literally —
 * it is El Ourwa's rule, and a future reader who "fixes" it to a real week count
 * should have to delete an assertion that says why not.
 */

let owner: pg.Pool;
let timetable: TimetableService;
let expulsions: ExpulsionsService;
let admissions: AdmissionsService;
let payroll: PayrollService;

let schoolId: string;
let ACTOR: string;
let groupA: string;
let groupB: string;
let yearId: string;
let interimTeacher: string;
let permanentTeacher: string;
let teachingA: string;
let teachingB: string;
let CASH: string;

const DIRECTION = ['scolarite.niveaux', 'scolarite.inscrire'];

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'tt' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix)
     VALUES ('tt', 'Timetable', 'TTB') RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  await owner.query(
    `INSERT INTO roles (code, label, is_system, sort_order)
     VALUES ('parent', 'Parent', true, 30) ON CONFLICT (code) DO NOTHING`,
  );

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('tt.admin@test', 'x', 'Directeur') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const cash = await owner.query<{ id: string }>(
    `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Espèces') RETURNING id`,
    [schoolId],
  );
  CASH = cash.rows[0]!.id;

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
  const groups = await owner.query<{ id: string; name: string }>(
    `INSERT INTO groups (school_id, level_id, name)
     VALUES ($1, $2, '6eme A'), ($1, $2, '6eme B') RETURNING id, name`,
    [schoolId, level.rows[0]!.id],
  );
  groupA = groups.rows.find((r) => r.name === '6eme A')!.id;
  groupB = groups.rows.find((r) => r.name === '6eme B')!.id;

  const subject = await owner.query<{ id: string }>(
    `INSERT INTO subjects (school_id, level_id, name, coefficient, max_score)
     VALUES ($1, $2, 'Mathématiques', 4, 20) RETURNING id`,
    [schoolId, level.rows[0]!.id],
  );

  // An interim teacher with a default rate of 500/h, and a permanent one on a
  // flat salary. Both exist because the rule branches on `employment`.
  const teachers = await owner.query<{ id: string; employment: string }>(
    `INSERT INTO teachers (school_id, first_name, last_name, employment, hourly_rate, salary)
     VALUES ($1, 'Moussa', 'Ould Baba', 'interim', 500, 0),
            ($1, 'Aicha', 'Mint Ely', 'permanent', 0, 45000)
     RETURNING id, employment`,
    [schoolId],
  );
  interimTeacher = teachers.rows.find((r) => r.employment === 'interim')!.id;
  permanentTeacher = teachers.rows.find((r) => r.employment === 'permanent')!.id;

  // 6 h/week to 6eme A at the teacher's default rate; 4 h/week to 6eme B at an
  // assignment rate of 750 — the level taught can change the rate.
  const teachings = await owner.query<{ id: string; group_id: string }>(
    `INSERT INTO teachings
       (school_id, academic_year_id, teacher_id, group_id, subject_id, hours_per_week, hourly_rate)
     VALUES ($1, $2, $3, $4, $5, 6, NULL),
            ($1, $2, $3, $6, $5, 4, 750)
     RETURNING id, group_id`,
    [schoolId, yearId, interimTeacher, groupA, subject.rows[0]!.id, groupB],
  );
  teachingA = teachings.rows.find((r) => r.group_id === groupA)!.id;
  teachingB = teachings.rows.find((r) => r.group_id === groupB)!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  timetable = moduleRef.get(TimetableService);
  expulsions = moduleRef.get(ExpulsionsService);
  admissions = moduleRef.get(AdmissionsService);
  payroll = moduleRef.get(PayrollService);
});

afterAll(async () => {
  await owner?.end();
});

describe('teacher pay follows El Ourwa exactly', () => {
  it('⚠ pays an interim teacher hours × 4 × the ASSIGNMENT rate', async () => {
    // 6 h/wk × 4 × 500 (teacher default, assignment rate NULL) = 12 000
    // 4 h/wk × 4 × 750 (assignment rate overrides)             = 12 000
    //                                                    total = 24 000
    //
    // The ×4 is a FIXED multiplier, not the weeks in the month. Every month pays
    // four weeks whether it has four or five. Changing it would quietly give
    // every interim teacher a raise in the long months.
    const ref = await inTenant(() => payroll.teacherReferencePay(interimTeacher));
    expect(ref.employment).toBe('interim');
    expect(ref.gross.toFixed(2)).toBe('24000.00');
    expect(ref.monthlyHours.toFixed(1)).toBe('40.0');
  });

  it('a NULL assignment rate means the teacher rate, never zero', async () => {
    // Proven by the sum above: were NULL read as 0, the total would be 12 000.
    const ref = await inTenant(() => payroll.teacherReferencePay(interimTeacher));
    expect(ref.gross.toFixed(2)).not.toBe('12000.00');
  });

  it('pays a permanent teacher their flat salary, ignoring their hours', async () => {
    const ref = await inTenant(() => payroll.teacherReferencePay(permanentTeacher));
    expect(ref.gross.toFixed(2)).toBe('45000.00');
  });

  it('pays an interim teacher what they teach, not their empty salary column', async () => {
    const paid = await inTenant(() =>
      payroll.paySalary(
        {
          payeeKind: 'teacher',
          payeeId: interimTeacher,
          calendarMonth: 5,
          calendarYear: 2021,
          tender: [{ paymentMethodId: CASH, amount: '24000.00' }],
        },
        ACTOR,
      ),
    );
    // The salary column holds 0. Reading it would have paid them nothing.
    expect(paid.gross).toBe('24000.00');
    expect(paid.net).toBe('24000.00');
  });

  it('refuses a teacher with neither a salary nor any assignment', async () => {
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO teachers (school_id, first_name, last_name, employment, hourly_rate, salary)
       VALUES ($1, 'Sans', 'Cours', 'interim', 0, 0) RETURNING id`,
      [schoolId],
    );
    await expect(
      inTenant(() =>
        payroll.paySalary(
          {
            payeeKind: 'teacher',
            payeeId: rows[0]!.id,
            calendarMonth: 5,
            calendarYear: 2021,
            tender: [{ paymentMethodId: CASH, amount: '1.00' }],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/Aucun salaire de référence défini pour ce bénéficiaire/);
  });

  it('shows the same figure on the payroll list as on the payslip', async () => {
    const page = await inTenant(() => payroll.staffPay('profs', 6, 2021));
    const row = page.lignes.find((r) => r.id === interimTeacher)!;
    expect(row.gain).toBe('24000.00');
    expect(row.situation).toBe('interim');
    expect(row.fonction).toBe('Professeur');
  });
});

describe('the weekly timetable', () => {
  it('places a lesson and reads it back', async () => {
    await inTenant(() =>
      timetable.assign({ groupId: groupA, teachingId: teachingA, dayOfWeek: 1, slot: 1 }, ACTOR),
    );
    const week = await inTenant(() => timetable.forGroup(groupA));
    expect(week).toHaveLength(1);
    expect(week[0]!.subject).toBe('Mathématiques');
  });

  it('replaces whatever was in the cell rather than stacking on it', async () => {
    await inTenant(() =>
      timetable.assign({ groupId: groupA, teachingId: teachingA, dayOfWeek: 1, slot: 1 }, ACTOR),
    );
    const week = await inTenant(() => timetable.forGroup(groupA));
    expect(week).toHaveLength(1);
  });

  it('lets one teacher be in two classes at the same time — El Ourwa does not check', async () => {
    // `placer` verifies the teaching belongs to the group and the subject's
    // weekly quota, nothing else. A clash is not refused there, so not here.
    const placed = await inTenant(() =>
      timetable.assign({ groupId: groupB, teachingId: teachingB, dayOfWeek: 1, slot: 1 }, ACTOR),
    );
    expect(placed.id).toBeTruthy();
    await inTenant(() => timetable.clear(groupB, 1, 1, ACTOR));
  });

  it('allows the same teacher in a different slot', async () => {
    const placed = await inTenant(() =>
      timetable.assign({ groupId: groupB, teachingId: teachingB, dayOfWeek: 1, slot: 2 }, ACTOR),
    );
    expect(placed.id).toBeTruthy();
  });

  it('refuses a lesson placed in another class’s timetable, in his words', async () => {
    await expect(
      inTenant(() =>
        timetable.assign(
          { groupId: groupA, teachingId: teachingB, dayOfWeek: 3, slot: 1 },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/^Enseignement invalide pour ce groupe\.$/);
  });

  it('gives a teacher their own week across every class', async () => {
    const week = await inTenant(() => timetable.forTeacher(interimTeacher));
    expect(week).toHaveLength(2);
    expect(week.map((r: any) => r.group_name).sort()).toEqual(['6eme A', '6eme B']);
  });

  it('clears a cell', async () => {
    const cleared = await inTenant(() => timetable.clear(groupB, 1, 2, ACTOR));
    expect(cleared.cleared).toBe(1);
    expect(await inTenant(() => timetable.forGroup(groupB))).toHaveLength(0);
  });
});

describe('the expulsion register', () => {
  const NNI = 'NNI-EXP-1';
  const RIM = 'RIM-EXP-1';
  let blockId: string;

  it('blocks by identity, and admission refuses before writing anything', async () => {
    const block = await inTenant(() =>
      expulsions.expel(
        { nationalId: NNI, rim: RIM, firstName: 'Sidi', lastName: 'Ould Cheikh', reason: 'Violence répétée' },
        ACTOR,
      ),
    );
    blockId = block.id;

    await expect(
      inTenant(() =>
        admissions.admit(
          {
            firstName: 'Sidi',
            lastName: 'Ould Cheikh',
            rim: RIM,
            nationalId: NNI,
            newGuardian: { fullName: 'Un parent', phone: '+22247000001', initialPassword: 'Ecole-2026' },
          },
          ACTOR,
          DIRECTION,
        ),
      ),
    // Sa phrase (`inscrire_etudiant.php`) : « Inscription refusée : ce NNI ou
    // ce RIM appartient à un étudiant exclu/expulsé. »
    ).rejects.toThrow(/étudiant exclu\/expulsé/i);

    // ⚠ Nothing was written. A check that ran after the insert would leave the
    // child behind even when the admission was refused.
    const { rows } = await owner.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM students WHERE rim = $1 AND school_id = $2',
      [RIM, schoolId],
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('refuses to block the same identity twice', async () => {
    await expect(
      inTenant(() =>
        expulsions.expel(
          { nationalId: NNI, rim: RIM, firstName: 'Sidi', lastName: 'Ould Cheikh' },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/déjà bloquée/i);
  });

  it('lifting is recorded, not deleted, and re-admission then works', async () => {
    await inTenant(() => expulsions.lift(blockId, 'Décision de la direction', ACTOR));

    // The row survives: "was this child ever expelled" is a question the school
    // will be asked, and DELETE cannot answer it.
    const { rows } = await owner.query<{ lift_reason: string; lifted_at: Date }>(
      'SELECT lift_reason, lifted_at FROM expulsions WHERE id = $1',
      [blockId],
    );
    expect(rows[0]!.lift_reason).toBe('Décision de la direction');
    expect(rows[0]!.lifted_at).not.toBeNull();

    const admitted = await inTenant(() =>
      admissions.admit(
        {
          firstName: 'Sidi',
          lastName: 'Ould Cheikh',
          rim: RIM,
          nationalId: NNI,
          newGuardian: { fullName: 'Un parent', phone: '+22247000002', initialPassword: 'Ecole-2026' },
        },
        ACTOR,
        DIRECTION,
      ),
    );
    expect(admitted.studentId).toBeTruthy();
  });

  it('a lifted block leaves the live list but stays in the history', async () => {
    // `list()` rend maintenant `{ rows, nextCursor }` : sa recherche est passée
    // en SQL et sa pagination par curseur, parce qu'elle ramenait 200 lignes
    // pour en filtrer vingt-cinq dans le navigateur.
    expect((await inTenant(() => expulsions.list({ includeLifted: false }))).rows).toHaveLength(0);
    expect(
      (await inTenant(() => expulsions.list({ includeLifted: true }))).rows.length,
    ).toBeGreaterThan(0);
  });

  it('⚠ cherche en SQL, et un joker de LIKE ne devient pas un joker', async () => {
    // `%` et `_` sont des jokers : sans échappement, chercher « % » rendrait
    // tout le registre — sur l'écran dont la question est « qui est bloqué ».
    const tout = await inTenant(() => expulsions.list({ includeLifted: true }));
    expect(tout.rows.length).toBeGreaterThan(0);

    const joker = await inTenant(() => expulsions.list({ includeLifted: true, q: '%' }));
    expect(joker.rows).toHaveLength(0);
  });

  it('pagine par curseur, sans OFFSET', async () => {
    const page = await inTenant(() => expulsions.list({ includeLifted: true, limit: 1 }));
    expect(page.rows).toHaveLength(1);
    if (page.nextCursor) {
      const suite = await inTenant(() =>
        expulsions.list({ includeLifted: true, limit: 1, cursor: page.nextCursor! }),
      );
      // La page suivante ne répète pas la précédente.
      expect(suite.rows[0]?.id).not.toBe(page.rows[0]?.id);
    }
  });
});

/**
 * ⚠ A SUBJECT MAY NOT FILL MORE CELLS THAN ITS WEEKLY LOAD PAYS FOR.
 *
 * `floor(heures_par_semaine / 2)` — each cell is a period of roughly two hours
 * (8h-9h45, 10h-11h45, 12h-14h), so four hours a week earns two cells. I did
 * not know this rule existed until reading the header of `emploi_du_temps.php`;
 * without it a timetable can be built that the syllabus does not pay for, and
 * nothing downstream would object.
 */
describe('the weekly load limits how often a subject appears', () => {
  it('allows floor(hours / 2) cells and refuses the next', async () => {
    const { rows } = await owner.query<{ id: string }>(
      `UPDATE teachings SET hours_per_week = 4 WHERE id = $1 RETURNING id`,
      [teachingA],
    );
    expect(rows).toHaveLength(1);

    // 4 hours a week -> two cells.
    await inTenant(() =>
      timetable.assign({ groupId: groupA, dayOfWeek: 1, slot: 1, teachingId: teachingA }, ACTOR),
    );
    await inTenant(() =>
      timetable.assign({ groupId: groupA, dayOfWeek: 2, slot: 1, teachingId: teachingA }, ACTOR),
    );

    await expect(
      inTenant(() =>
        timetable.assign({ groupId: groupA, dayOfWeek: 3, slot: 1, teachingId: teachingA }, ACTOR),
      ),
    ).rejects.toThrow(/Limite atteinte pour cette matière \(2\/2 cases\)/);
  });

  it('counts every cell of the subject, the one being replaced included — his `$deja`', async () => {
    // His modal only opens on an EMPTY cell, so a replacement never happens
    // from the screen; when it does, the count is the grid's and is refused.
    await expect(
      inTenant(() =>
        timetable.assign({ groupId: groupA, dayOfWeek: 2, slot: 1, teachingId: teachingA }, ACTOR),
      ),
    ).rejects.toThrow(/Limite atteinte pour cette matière \(2\/2 cases\)/);
  });

  it('⚠ always allows at least one, whatever the load says', async () => {
    // An unset or fractional `hours_per_week` must not silently bar a subject
    // from the grid entirely.
    await owner.query('DELETE FROM timetable_slots WHERE group_id = $1', [groupA]);
    await owner.query('UPDATE teachings SET hours_per_week = 0 WHERE id = $1', [teachingA]);

    await expect(
      inTenant(() =>
        timetable.assign({ groupId: groupA, dayOfWeek: 4, slot: 2, teachingId: teachingA }, ACTOR),
      ),
    ).resolves.toBeTruthy();

    await expect(
      inTenant(() =>
        timetable.assign({ groupId: groupA, dayOfWeek: 5, slot: 2, teachingId: teachingA }, ACTOR),
      ),
    ).rejects.toThrow(/Limite atteinte/);
  });
});

/** ✓ VALIDER ET PUBLIER L'EMPLOI DU TEMPS — `emploi_du_temps.php`, `valider`. */
describe('publier l’emploi du temps', () => {
  it('notifies every family with a child in the class, once each', async () => {
    const students = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, rim, national_id, first_name, last_name) VALUES
         ($1, 'RIM-EDT-1', 'NID-EDT-1', 'A', 'Un'),
         ($1, 'RIM-EDT-2', 'NID-EDT-2', 'B', 'Deux')
       RETURNING id`,
      [schoolId],
    );
    const guardian = await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('edt.parent@test', 'x', 'Parent EDT') RETURNING id`,
    );
    const guardianId = guardian.rows[0]!.id;

    // ⚠ TWO CHILDREN, ONE HOUSEHOLD. A family with siblings in the same class
    // must be told once, not twice — the same message twice reads as two
    // different timetables.
    for (const s of students.rows) {
      await owner.query('UPDATE students SET guardian_id = $1 WHERE id = $2', [guardianId, s.id]);
      await owner.query(
        `INSERT INTO enrollments (school_id, student_id, academic_year_id, group_id, status)
         VALUES ($1, $2, $3, $4, 'enrolled')`,
        [schoolId, s.id, yearId, groupA],
      );
    }

    /*
     * ⚠ CE TEST HÉRITAIT SA GRILLE DU TEST PRÉCÉDENT, et vitest 3 a changé
     * l'ordre des fichiers : il a échoué deux fois sur « La grille est vide »
     * en suite complète, et passait seul. Une dépendance à l'ordre n'est pas
     * une intermittence, c'est un test qui ne dit pas ce qu'il croit dire —
     * celui-ci porte sur QUI est notifié, pas sur ce qu'un autre a laissé.
     *
     * Il pose donc sa propre case, et `ON CONFLICT DO NOTHING` la rend
     * idempotente quelle que soit la grille trouvée.
     */
    await owner.query(
      `INSERT INTO timetable_slots (school_id, group_id, day_of_week, slot, teaching_id)
       VALUES ($1, $2, 3, 3, $3)
       ON CONFLICT DO NOTHING`,
      [schoolId, groupA, teachingA],
    );

    // ⚠ COMPTER PAR ÉCOLE, JAMAIS GLOBALEMENT. Cette assertion portait sur
    // toute la table : dès qu'un AUTRE fichier de test publiait un emploi du
    // temps avant celui-ci, elle échouait — et l'ordre des fichiers change
    // quand on en ajoute un. Le test devenait rouge sans qu'aucun code n'ait
    // bougé, ce qui apprend à ignorer les échecs.
    const before = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM notifications
        WHERE kind = 'timetable' AND school_id = $1`,
      [schoolId],
    );
    expect(before.rows[0]!.n).toBe('0');

    const result = await inTenant(() => timetable.publish(groupA, yearId, ACTOR));
    expect(result.notified).toBe(1);

    const { rows } = await owner.query<{ i18n_key: string; i18n_params: { groupe?: string } }>(
      `SELECT i18n_key, i18n_params FROM notifications
        WHERE kind = 'timetable' AND guardian_id = $1`,
      [guardianId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.i18n_key).toBe('notif_emploi');
    // Its own label: "6ème / 6ème A" — the level AND the class, because a
    // parent with children in two levels needs to know which one this is.
    expect(rows[0]!.i18n_params.groupe).toContain('/');
  });

  it('⚠ leaves a cancelled enrolment out', async () => {
    const s = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
       VALUES ($1, 'RIM-EDT-3', 'NID-EDT-3', 'C', 'Trois') RETURNING id`,
      [schoolId],
    );
    const g = await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('edt.parti@test', 'x', 'Parent Parti') RETURNING id`,
    );
    await owner.query('UPDATE students SET guardian_id = $1 WHERE id = $2', [
      g.rows[0]!.id, s.rows[0]!.id,
    ]);
    await owner.query(
      `INSERT INTO enrollments (school_id, student_id, academic_year_id, group_id, status)
       VALUES ($1, $2, $3, $4, 'cancelled')`,
      [schoolId, s.rows[0]!.id, yearId, groupA],
    );

    await inTenant(() => timetable.publish(groupA, yearId, ACTOR));

    const { rows } = await owner.query(
      `SELECT id FROM notifications WHERE kind = 'timetable' AND guardian_id = $1`,
      [g.rows[0]!.id],
    );
    // A family whose child has left is not told about that class's timetable.
    expect(rows).toHaveLength(0);
  });

  it('publishes an empty grid too — El Ourwa has no guard', async () => {
    await owner.query('DELETE FROM timetable_slots WHERE group_id = $1', [groupB]);
    const r = await inTenant(() => timetable.publish(groupB, yearId, ACTOR));
    expect(r.label).toMatch(/6eme B$/);
  });

  it('lists one teaching per subject, the latest — his SQL_ENS_COURANTS', async () => {
    const ens = await inTenant(() => timetable.enseignementsCourants(groupA));
    const subjects = ens.map((e) => e.subject_id);
    expect(new Set(subjects).size).toBe(subjects.length);
    expect(ens.every((e) => typeof e.hours_per_week === 'string')).toBe(true);
  });
});
