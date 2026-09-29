import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { EveningService } from '../src/evening/evening.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * PAIEMENT DES PROFESSEURS — the second tab of `cours_du_soir.php`.
 *
 * Written before the service: it pays people (standing rule 15).
 *
 * Evening teachers are paid one of two ways, and the page says which in its own
 * words: "Stable" — a fixed monthly salary — or "Horaire" — an hourly rate times
 * the hours agreed for the month. They are also of two kinds, "Internes" (a
 * teacher of the day school) or "Externes" (someone who exists only for the
 * evening).
 *
 * ⚠ THE GUARD THAT MATTERS IS THE CONFIGURED MONTH. A group runs only in the
 * months the school set up for it. Outside those months no salary is due at
 * all, and El Ourwa refuses in those words: "Ce mois ne fait pas partie des mois
 * configurés pour ce groupe : aucun salaire n'est dû."
 */

let owner: pg.Pool;
let evening: EveningService;

let schoolId: string;
let ACTOR: string;
let cashId: string;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'soir' }, fn);
}

/** A group with its own rate, its own configured months, and one teaching. */
async function group(
  tag: string,
  opts: {
    months?: [number, number][];
    pay: { kind: 'fixed'; salary: string } | { kind: 'hourly'; rate: string; hours: number };
  },
): Promise<{ groupId: string; teachingId: string }> {
  const g = await owner.query<{ id: string }>(
    `INSERT INTO evening_groups (school_id, name, monthly_rate)
     VALUES ($1, $2, '3000') RETURNING id`,
    [schoolId, `Renforcement ${tag}`],
  );
  const groupId = g.rows[0]!.id;

  for (const [m, y] of opts.months ?? []) {
    await owner.query(
      `INSERT INTO evening_group_months (school_id, evening_group_id, calendar_month, calendar_year)
       VALUES ($1, $2, $3, $4)`,
      [schoolId, groupId, m, y],
    );
  }

  const t = await owner.query<{ id: string }>(
    `INSERT INTO evening_teachers (school_id, first_name, last_name)
     VALUES ($1, $2, 'Soir') RETURNING id`,
    [schoolId, tag],
  );

  const teaching = await owner.query<{ id: string }>(
    `INSERT INTO evening_teachings
       (school_id, evening_group_id, evening_teacher_id, subject,
        pay_kind, hourly_rate, hours_per_month, fixed_salary)
     VALUES ($1, $2, $3, 'Maths', $4, $5, $6, $7) RETURNING id`,
    [
      schoolId, groupId, t.rows[0]!.id,
      opts.pay.kind === 'fixed' ? 'fixed' : 'hourly',
      opts.pay.kind === 'hourly' ? opts.pay.rate : '0',
      opts.pay.kind === 'hourly' ? opts.pay.hours : 0,
      opts.pay.kind === 'fixed' ? opts.pay.salary : '0',
    ],
  );

  return { groupId, teachingId: teaching.rows[0]!.id };
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('soir', 'Cours du soir', 'CS')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('soir.admin@test', 'x', 'Direction') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const method = await owner.query<{ id: string }>(
    `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Especes') RETURNING id`,
    [schoolId],
  );
  cashId = method.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  evening = moduleRef.get(EveningService);
});

afterAll(async () => {
  await owner?.end();
});

describe('what a teacher is owed', () => {
  it('a fixed salary is the salary, whatever the hours', async () => {
    const { teachingId } = await group('fixe', {
      pay: { kind: 'fixed', salary: '25000.00' },
    });
    const due = await inTenant(() => evening.teacherDue(teachingId));
    expect(due.toFixed(2)).toBe('25000.00');
  });

  it('an hourly one is the rate times the hours agreed for the month', async () => {
    const { teachingId } = await group('horaire', {
      pay: { kind: 'hourly', rate: '1500.00', hours: 12 },
    });
    const due = await inTenant(() => evening.teacherDue(teachingId));
    expect(due.toFixed(2)).toBe('18000.00');
  });
});

describe('paying them', () => {
  it('records the payment and the means it left by', async () => {
    const { teachingId } = await group('paye', {
      months: [[11, 2025]],
      pay: { kind: 'fixed', salary: '20000.00' },
    });

    const result = await inTenant(() =>
      evening.payTeacher(
        {
          eveningTeachingId: teachingId,
          calendarMonth: 11,
          calendarYear: 2025,
          tender: [{ paymentMethodId: cashId, amount: '20000.00' }],
        },
        ACTOR,
      ),
    );
    expect(result.amount).toBe('20000.00');

    // ⚠ Money OUT. A salary that leaves with no tender line is why the till
    // never balanced before the ledger covered both directions.
    const { rows } = await owner.query<{ direction: string; amount: string }>(
      `SELECT direction, amount::text FROM tender_lines
        WHERE source_type = 'cours_soir_prof' AND source_id = $1`,
      [result.id],
    );
    expect(rows).toEqual([{ direction: 'out', amount: '20000.00' }]);
  });

  it('⚠ allows instalments, and each is its own row', async () => {
    // El Ourwa accumulates onto ONE row (`montant = montant + …`), which loses
    // who paid which half and when. Append-only instead — standing rule 7 — and
    // the "not more than the month" rule lives in the service.
    const { teachingId } = await group('deux', {
      months: [[11, 2025]],
      pay: { kind: 'fixed', salary: '20000.00' },
    });

    await inTenant(() =>
      evening.payTeacher(
        {
          eveningTeachingId: teachingId,
          calendarMonth: 11,
          calendarYear: 2025,
          tender: [{ paymentMethodId: cashId, amount: '12000.00' }],
        },
        ACTOR,
      ),
    );
    await inTenant(() =>
      evening.payTeacher(
        {
          eveningTeachingId: teachingId,
          calendarMonth: 11,
          calendarYear: 2025,
          tender: [{ paymentMethodId: cashId, amount: '8000.00' }],
        },
        ACTOR,
      ),
    );

    const { rows } = await owner.query<{ amount: string }>(
      `SELECT amount::text FROM evening_teacher_payments
        WHERE evening_teaching_id = $1 ORDER BY paid_at`,
      [teachingId],
    );
    expect(rows.map((r) => r.amount)).toEqual(['12000.00', '8000.00']);

    const state = await inTenant(() => evening.teacherMonth(teachingId, 11, 2025));
    expect(state.due).toBe('20000.00');
    expect(state.paid).toBe('20000.00');
    expect(state.remaining).toBe('0.00');
  });
});

describe('what it refuses', () => {
  it('⚠ refuses a month the group was never configured for', async () => {
    // Outside its months the group does not run, so no salary is due at all.
    const { teachingId } = await group('mois', {
      months: [[11, 2025], [12, 2025]],
      pay: { kind: 'fixed', salary: '20000.00' },
    });

    await expect(
      inTenant(() =>
        evening.payTeacher(
          {
            eveningTeachingId: teachingId,
            calendarMonth: 7,
            calendarYear: 2025,
            tender: [{ paymentMethodId: cashId, amount: '20000.00' }],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/mois configurés|aucun salaire/i);
  });

  it('allows any month when the group configures none', async () => {
    // El Ourwa's own fallback: an empty month list means "not configured", not
    // "never runs". Refusing there would stop paying anybody at a school that
    // has not filled the calendar in.
    const { teachingId } = await group('libre', {
      pay: { kind: 'fixed', salary: '9000.00' },
    });

    const result = await inTenant(() =>
      evening.payTeacher(
        {
          eveningTeachingId: teachingId,
          calendarMonth: 3,
          calendarYear: 2025,
          tender: [{ paymentMethodId: cashId, amount: '9000.00' }],
        },
        ACTOR,
      ),
    );
    expect(result.amount).toBe('9000.00');
  });

  it('⚠ refuses to pay more than the month is worth', async () => {
    const { teachingId } = await group('trop', {
      months: [[11, 2025]],
      pay: { kind: 'hourly', rate: '1000.00', hours: 10 },
    });

    await expect(
      inTenant(() =>
        evening.payTeacher(
          {
            eveningTeachingId: teachingId,
            calendarMonth: 11,
            calendarYear: 2025,
            tender: [{ paymentMethodId: cashId, amount: '15000.00' }],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/dépasse|reste/i);
  });

  it('refuses a second payment once the month is settled, naming the total', async () => {
    const { teachingId } = await group('solde', {
      months: [[11, 2025]],
      pay: { kind: 'fixed', salary: '5000.00' },
    });

    await inTenant(() =>
      evening.payTeacher(
        {
          eveningTeachingId: teachingId,
          calendarMonth: 11,
          calendarYear: 2025,
          tender: [{ paymentMethodId: cashId, amount: '5000.00' }],
        },
        ACTOR,
      ),
    );

    await expect(
      inTenant(() =>
        evening.payTeacher(
          {
            eveningTeachingId: teachingId,
            calendarMonth: 11,
            calendarYear: 2025,
            tender: [{ paymentMethodId: cashId, amount: '1000.00' }],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/déjà|intégralement/i);
  });

  it('refuses a teaching with nothing agreed — zero is not a salary', async () => {
    const { teachingId } = await group('zero', {
      months: [[11, 2025]],
      pay: { kind: 'hourly', rate: '0', hours: 0 },
    });

    await expect(
      inTenant(() =>
        evening.payTeacher(
          {
            eveningTeachingId: teachingId,
            calendarMonth: 11,
            calendarYear: 2025,
            tender: [{ paymentMethodId: cashId, amount: '1000.00' }],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow();
  });

  it('refuses a payment with no tender lines', async () => {
    const { teachingId } = await group('sansmoyen', {
      months: [[11, 2025]],
      pay: { kind: 'fixed', salary: '5000.00' },
    });

    await expect(
      inTenant(() =>
        evening.payTeacher(
          {
            eveningTeachingId: teachingId,
            calendarMonth: 11,
            calendarYear: 2025,
            tender: [],
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('the month view the tab is built on', () => {
  it('lists every teaching of the month with what is due, paid and left', async () => {
    const { groupId, teachingId } = await group('vue', {
      months: [[11, 2025]],
      pay: { kind: 'hourly', rate: '2000.00', hours: 8 },
    });

    await inTenant(() =>
      evening.payTeacher(
        {
          eveningTeachingId: teachingId,
          calendarMonth: 11,
          calendarYear: 2025,
          tender: [{ paymentMethodId: cashId, amount: '6000.00' }],
        },
        ACTOR,
      ),
    );

    const rows = await inTenant(() => evening.teacherPayroll(11, 2025));
    const mine = rows.find((r) => r.eveningTeachingId === teachingId);
    expect(mine).toBeDefined();
    expect(mine!.due).toBe('16000.00');
    expect(mine!.paid).toBe('6000.00');
    expect(mine!.remaining).toBe('10000.00');
    expect(mine!.groupId).toBe(groupId);
    // "Externes" — this one exists only for the evening school.
    expect(mine!.internal).toBe(false);
    expect(mine!.payKind).toBe('hourly');
  });

  it('leaves out groups that do not run that month', async () => {
    const { teachingId } = await group('hors', {
      months: [[11, 2025]],
      pay: { kind: 'fixed', salary: '1000.00' },
    });

    const rows = await inTenant(() => evening.teacherPayroll(7, 2025));
    expect(rows.find((r) => r.eveningTeachingId === teachingId)).toBeUndefined();
  });
});

/**
 * ASSIGNER UN PROFESSEUR À UN GROUPE — `cours_du_soir.php`, `assigner_prof`.
 *
 * ⚠ `evening_teachings` WAS READ AND NEVER WRITTEN. The payroll query reads it,
 * the payments hang off it, the professeurs tab is built on it — and **nothing
 * in the application could put a row in**. So the evening payroll page was
 * permanently empty and no evening class could ever have a teacher.
 *
 * ⚠ AND EL OURWA'S OWN HANDLER HAD A MUTE BRANCH, recorded in its source: with
 * no teacher chosen the condition was false, there was no `else`, and the form
 * came back with no message, no error and nothing saved — *« exactement le
 * symptome "je clique Enregistrer et il ne se passe rien" »*. Every refusal here
 * says which field is wrong.
 *
 * Payroll, so the tests come first.
 */
describe('assigner un professeur à un groupe du soir', () => {
  let groupId: string;
  let internalTeacher: string;
  let externalTeacher: string;

  beforeAll(async () => {
    const g = await owner.query<{ id: string }>(
      `INSERT INTO evening_groups (school_id, name, monthly_rate)
       VALUES ($1, 'Assignation', '3000') RETURNING id`,
      [schoolId],
    );
    groupId = g.rows[0]!.id;

    const t = await owner.query<{ id: string }>(
      `INSERT INTO teachers (school_id, first_name, last_name, employment, hourly_rate)
       VALUES ($1, 'Prof', 'DeJour', 'interim', 400) RETURNING id`,
      [schoolId],
    );
    internalTeacher = t.rows[0]!.id;

    const e = await owner.query<{ id: string }>(
      `INSERT INTO evening_teachers (school_id, first_name, last_name)
       VALUES ($1, 'Prof', 'DuSoir') RETURNING id`,
      [schoolId],
    );
    externalTeacher = e.rows[0]!.id;
  });

  it('assigns a day-school teacher, paid by the hour', async () => {
    const { id } = await inTenant(() =>
      evening.assignTeacher(
        {
          eveningGroupId: groupId,
          teacherId: internalTeacher,
          subject: 'Mathématiques',
          payKind: 'hourly',
          hourlyRate: '450.50',
          hoursPerMonth: 12,
        },
        ACTOR,
      ),
    );

    const { rows } = await owner.query<{
      teacher_id: string | null;
      evening_teacher_id: string | null;
      hourly_rate: string;
      fixed_salary: string;
    }>(
      `SELECT teacher_id, evening_teacher_id, hourly_rate::text, fixed_salary::text
         FROM evening_teachings WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.teacher_id).toBe(internalTeacher);
    expect(rows[0]!.evening_teacher_id).toBeNull();
    expect(rows[0]!.hourly_rate).toBe('450.50');
    // ⚠ An hourly teaching carries no fixed salary. Leaving one behind would
    // double-count the moment the pay kind is read.
    expect(rows[0]!.fixed_salary).toBe('0.00');
  });

  it('assigns an evening-only teacher on a fixed salary', async () => {
    const { id } = await inTenant(() =>
      evening.assignTeacher(
        {
          eveningGroupId: groupId,
          eveningTeacherId: externalTeacher,
          subject: 'Physique',
          payKind: 'fixed',
          fixedSalary: '25000',
        },
        ACTOR,
      ),
    );

    const { rows } = await owner.query<{
      teacher_id: string | null;
      fixed_salary: string;
      hourly_rate: string;
      hours_per_month: number;
    }>(
      `SELECT teacher_id, fixed_salary::text, hourly_rate::text, hours_per_month
         FROM evening_teachings WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.teacher_id).toBeNull();
    expect(rows[0]!.fixed_salary).toBe('25000.00');
    // And the other way round: a fixed salary carries no rate and no hours.
    expect(rows[0]!.hourly_rate).toBe('0.00');
    expect(rows[0]!.hours_per_month).toBe(0);
  });

  it('⚠ refuses when no teacher is named — its own mute branch', async () => {
    await expect(
      inTenant(() =>
        evening.assignTeacher(
          { eveningGroupId: groupId, subject: 'Anglais', payKind: 'fixed', fixedSalary: '1' },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/professeur/i);
  });

  it('⚠ refuses BOTH a day teacher and an evening one', async () => {
    // The table's own CHECK is exclusive-or; catching it here says which field
    // to fix instead of surfacing a constraint name.
    await expect(
      inTenant(() =>
        evening.assignTeacher(
          {
            eveningGroupId: groupId,
            teacherId: internalTeacher,
            eveningTeacherId: externalTeacher,
            subject: 'Anglais',
            payKind: 'fixed',
            fixedSalary: '1',
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/l'école, ou externe|un seul/i);
  });

  it('⚠ refuses an empty subject — its own reason', async () => {
    // "Sans matiere, l'affectation n'apparait dans aucun menu de la grille :
    // la placer deviendrait impossible."
    await expect(
      inTenant(() =>
        evening.assignTeacher(
          {
            eveningGroupId: groupId,
            teacherId: internalTeacher,
            subject: '   ',
            payKind: 'hourly',
            hourlyRate: '400',
            hoursPerMonth: 4,
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/matière/i);
  });

  it('lists the group’s teachers with what each is owed a month', async () => {
    const rows = await inTenant(() => evening.teachingsForGroup(groupId));
    const hourly = rows.find((r) => r.subject === 'Mathématiques')!;
    const fixed = rows.find((r) => r.subject === 'Physique')!;

    // 450.50 × 12, as NUMERIC — the figure the school pays.
    expect(hourly.monthlyPay).toBe('5406.00');
    expect(fixed.monthlyPay).toBe('25000.00');
    expect(hourly.internal).toBe(true);
    expect(fixed.internal).toBe(false);
  });

  it('removes one', async () => {
    const rows = await inTenant(() => evening.teachingsForGroup(groupId));
    await inTenant(() => evening.removeTeaching(rows[0]!.id, ACTOR));
    const after = await inTenant(() => evening.teachingsForGroup(groupId));
    expect(after).toHaveLength(rows.length - 1);
  });

  /*
   * ⚠ ET ELLE EFFAÇAIT LES SALAIRES DÉJÀ VERSÉS, EN SILENCE.
   *
   * `evening_teacher_payments.evening_teaching_id` est en `ON DELETE CASCADE`.
   * Retirer l'assignation d'un professeur du soir emportait donc toute trace de
   * ce qu'on lui avait payé — l'argent était sorti de la caisse, et les livres
   * disaient qu'il n'était jamais sorti.
   *
   * C'est exactement ce que le commentaire d'`annuler_paiement_prof_cs`, juste
   * en dessous dans ce même fichier, reproche à El Ourwa : « the money left the
   * drawer and the books say it never did ». Le même trou existait ici, par une
   * autre porte, et sans même le geste d'annulation pour l'excuser.
   *
   * Des écritures financières, et elles sont append-only (règle 7).
   */
  it('⚠ refuse de supprimer une assignation déjà payée', async () => {
    const { teachingId } = await group('paye-puis-retire', {
      months: [[11, 2025]],
      pay: { kind: 'fixed', salary: '20000.00' },
    });

    await inTenant(() =>
      evening.payTeacher(
        {
          eveningTeachingId: teachingId,
          calendarMonth: 11,
          calendarYear: 2025,
          tender: [{ paymentMethodId: cashId, amount: '20000.00' }],
        },
        ACTOR,
      ),
    );

    await expect(inTenant(() => evening.removeTeaching(teachingId, ACTOR))).rejects.toThrow(
      /paiement|versé/i,
    );

    // Le refus n'a rien détruit : ni l'assignation, ni le salaire versé.
    const reste = await owner.query(
      'SELECT 1 FROM evening_teachings WHERE id = $1',
      [teachingId],
    );
    expect(reste.rows).toHaveLength(1);
    const paye = await owner.query(
      'SELECT 1 FROM evening_teacher_payments WHERE evening_teaching_id = $1',
      [teachingId],
    );
    expect(paye.rows).toHaveLength(1);
  });
});

/**
 * ANNULER UN PAIEMENT DE PROFESSEUR — `cours_du_soir.php`,
 * `annuler_paiement_prof_cs`.
 *
 * ⚠ EL OURWA DELETES THE ROW AND ITS TENDER LINES WITH IT. `DELETE FROM
 * cs_paiements_profs` then `DELETE FROM paiement_lignes`. So a salary handed
 * over in cash and then cancelled leaves the ledger with no trace that either
 * thing happened: the money left the drawer and the books say it never did.
 *
 * Standing rule 7 — a correction is a reversing entry — and the same shape
 * `salary_payments` has carried since migration 0009.
 */
describe('annuler un paiement de professeur', () => {
  it('writes a NEGATIVE entry and leaves the original standing', async () => {
    const { teachingId } = await group('annul', {
      months: [[11, 2025]],
      pay: { kind: 'fixed', salary: '20000.00' },
    });
    const paid = await inTenant(() =>
      evening.payTeacher(
        {
          eveningTeachingId: teachingId,
          calendarMonth: 11,
          calendarYear: 2025,
          tender: [{ paymentMethodId: cashId, amount: '20000.00' }],
        },
        ACTOR,
      ),
    );

    const reversal = await inTenant(() =>
      evening.reverseTeacherPayment(paid.id, 'Erreur de saisie', ACTOR),
    );
    expect(reversal.amount).toBe('-20000.00');

    const { rows } = await owner.query<{
      amount: string;
      reversed: boolean;
      reverses_id: string | null;
    }>(
      `SELECT amount::text, reversed, reverses_id FROM evening_teacher_payments
        WHERE evening_teaching_id = $1 ORDER BY paid_at`,
      [teachingId],
    );
    expect(rows).toHaveLength(2);
    // ⚠ THE ORIGINAL IS STILL THERE. Deleting it would erase the fact that
    // cash left the drawer.
    expect(rows[0]!.amount).toBe('20000.00');
    expect(rows[0]!.reversed).toBe(true);
    expect(rows[1]!.amount).toBe('-20000.00');
    expect(rows[1]!.reverses_id).toBe(paid.id);
  });

  it('⚠ the month counts neither half, so the salary is payable again', async () => {
    const { rows } = await owner.query<{ id: string }>(
      `SELECT et.id FROM evening_teachings et
         JOIN evening_groups g ON g.id = et.evening_group_id
        WHERE g.name = 'Renforcement annul'`,
    );
    const state = await inTenant(() => evening.teacherMonth(rows[0]!.id, 11, 2025));
    expect(state.paid).toBe('0.00');
    expect(state.remaining).toBe('20000.00');
  });

  it('⚠ the tender ledger records the money coming BACK', async () => {
    // A reversal that leaves no ledger line makes the till short by the amount
    // it just un-paid: the drawer balances against entries, not against intent.
    const { rows } = await owner.query<{ direction: string; amount: string }>(
      `SELECT tl.direction, tl.amount::text
         FROM tender_lines tl
         JOIN evening_teacher_payments p ON p.id = tl.source_id
        WHERE tl.source_type = 'cours_soir_prof' AND p.reverses_id IS NOT NULL`,
    );
    expect(rows).toEqual([{ direction: 'in', amount: '20000.00' }]);
  });

  it('refuses to cancel the same payment twice', async () => {
    const { rows } = await owner.query<{ id: string }>(
      `SELECT id FROM evening_teacher_payments WHERE reversed = true LIMIT 1`,
    );
    await expect(
      inTenant(() => evening.reverseTeacherPayment(rows[0]!.id, 'encore', ACTOR)),
    ).rejects.toThrow(/déjà été annulé/i);
  });

  it('refuses to cancel a cancellation', async () => {
    const { rows } = await owner.query<{ id: string }>(
      `SELECT id FROM evening_teacher_payments WHERE reverses_id IS NOT NULL LIMIT 1`,
    );
    await expect(
      inTenant(() => evening.reverseTeacherPayment(rows[0]!.id, 'non', ACTOR)),
    ).rejects.toThrow(/elle-même une annulation/i);
  });
});
