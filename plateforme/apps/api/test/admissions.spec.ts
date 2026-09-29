import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AdmissionsService } from '../src/admissions/admissions.service.js';
import { ExpensesService } from '../src/finance/expenses.service.js';
import { SearchService } from '../src/search/search.service.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * Admissions, expenses and search.
 *
 * Expenses are money, so they are test-first like every other figure. Admissions
 * are not money directly, but they create the record every fee is later attached
 * to — a duplicated child is a duplicated debt.
 */

let owner: pg.Pool;
let admissions: AdmissionsService;
let expenses: ExpensesService;
let search: SearchService;
let reports: ReportsService;
let auth: AuthService;

let schoolId: string;
let otherSchoolId: string;
let ACTOR: string;
let yearId: string;
let groupId: string;
let otherGroupId: string;
let CASH: string;
const DIRECTION = ['scolarite.niveaux', 'scolarite.inscrire'];

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'adm' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const schools = await owner.query<{ id: string; slug: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES
       ('adm', 'Admissions', 'ADM'), ('adm-other', 'Admissions Other', 'ADO')
     RETURNING id, slug`,
  );
  schoolId = schools.rows.find((r) => r.slug === 'adm')!.id;
  otherSchoolId = schools.rows.find((r) => r.slug === 'adm-other')!.id;

  // The role catalogue is seeded by `packages/db/src/seed.ts`, which the API
  // suite does not run. Without a `parent` role a guardian account is created
  // that cannot sign in — the service now refuses rather than doing that, so
  // the fixture has to provide the world the service expects.
  await owner.query(
    `INSERT INTO roles (code, label, is_system, sort_order)
     VALUES ('parent', 'Parent', true, 30) ON CONFLICT (code) DO NOTHING`,
  );

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('adm.secretary@test', 'x', 'Secrétaire') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

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
  const otherLevel = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle)
     VALUES ($1, '5eme', 12000, 'college') RETURNING id`,
    [schoolId],
  );
  const groups = await owner.query<{ id: string; name: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES
       ($1, $2, '6eme A'), ($1, $2, '6eme B'), ($1, $3, '5eme A')
     RETURNING id, name`,
    [schoolId, level.rows[0]!.id, otherLevel.rows[0]!.id],
  );
  groupId = groups.rows.find((r) => r.name === '6eme A')!.id;
  otherGroupId = groups.rows.find((r) => r.name === '6eme B')!.id;

  const cash = await owner.query<{ id: string }>(
    `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Espèces') RETURNING id`,
    [schoolId],
  );
  CASH = cash.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  admissions = moduleRef.get(AdmissionsService);
  expenses = moduleRef.get(ExpensesService);
  search = moduleRef.get(SearchService);
  reports = moduleRef.get(ReportsService);
  auth = moduleRef.get(AuthService);
});

afterAll(async () => {
  await owner?.end();
});

describe('admitting a child', () => {
  let firstStudent: string;
  let familyId: string;

  it('creates the child and the family together, and enrols in one call', async () => {
    const result = await inTenant(() =>
      admissions.admit(
        {
          firstName: 'Aminetou',
          lastName: 'Mint Sidi',
          rim: 'RIM-0001',
          nationalId: 'NNI-0001',
          sex: 'F',
          placeOfBirth: 'Toujounine',
          newGuardian: { fullName: 'Sidi Ould Ahmed', phone: '+22245000001', initialPassword: 'Ecole-2026' },
          academicYearId: yearId,
          groupId,
        },
        ACTOR,
        DIRECTION,
      ),
    );

    firstStudent = result.studentId;
    familyId = result.guardianId!;
    expect(result.enrolmentId).toBeTruthy();
    // Handed over once, never stored in clear — the one the office typed (his « Mot de passe initial * »).
    expect(result.temporaryPassword).toBe('Ecole-2026');

    /**
     * ⚠ Toujounine is a PLACE OF BIRTH — a moughataa of Nouakchott — and never
     * a branch.
     *
     * This assertion said ADDRESS until 2026-09-02, following a note in
     * CLAUDE.md that was wrong: `etudiants` in El Ourwa has no address column,
     * and these names live in `lieu_naissance`. The reference data settles it —
     * after nkt, Arafat, Ksar and Toujounine comes Guerou, which is in Assaba,
     * 300 km away: a sensible birthplace and an impossible address for a child
     * attending school here.
     */
    const { rows } = await owner.query<{ place_of_birth: string; school_id: string }>(
      'SELECT place_of_birth, school_id FROM students WHERE id = $1',
      [firstStudent],
    );
    expect(rows[0]!.place_of_birth).toBe('Toujounine');
    expect(rows[0]!.school_id).toBe(schoolId);
  });

  it('gives the new family a parent role in THIS school, or they cannot sign in', async () => {
    const { rows } = await owner.query<{ code: string }>(
      `SELECT r.code FROM user_school_roles usr
         JOIN roles r ON r.id = usr.role_id
        WHERE usr.user_id = $1 AND usr.school_id = $2`,
      [familyId, schoolId],
    );
    expect(rows.map((r) => r.code)).toContain('parent');
  });

  it('builds the month schedule, so the child is billable immediately', async () => {
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM enrollment_months em
         JOIN enrollments e ON e.id = em.enrollment_id
        WHERE e.student_id = $1`,
      [firstStudent],
    );
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
  });

  it('refuses a second child with the same RIM at this school', async () => {
    await expect(
      inTenant(() =>
        admissions.admit(
          {
            firstName: 'Autre',
            lastName: 'Enfant',
            rim: 'RIM-0001',
            nationalId: 'NNI-9999',
            newGuardian: { fullName: 'Quelqu un', phone: '+22245009999', initialPassword: 'Ecole-2026' },
          },
          ACTOR,
          DIRECTION,
        ),
      ),
    ).rejects.toThrow(/RIM/i);
  });

  it('refuses a second child with the same NNI at this school', async () => {
    await expect(
      inTenant(() =>
        admissions.admit(
          {
            firstName: 'Autre',
            lastName: 'Enfant',
            rim: 'RIM-8888',
            nationalId: 'NNI-0001',
            newGuardian: { fullName: 'Quelqu un', phone: '+22245008888', initialPassword: 'Ecole-2026' },
          },
          ACTOR,
          DIRECTION,
        ),
      ),
    ).rejects.toThrow(/NNI/i);
  });

  it('⚠ allows the SAME identity numbers at a different school', async () => {
    // Both uniques are scoped (school_id, …) on purpose: a family moving between
    // branches must not be rejected by the branch they are moving to.
    await owner.query(
      `INSERT INTO academic_years (school_id, label, start_year, status)
       VALUES ($1, '2020-2021', 2020, 'active')`,
      [otherSchoolId],
    );
    const elsewhere = await runInTenant({ schoolId: otherSchoolId, slug: 'adm-other' }, () =>
      admissions.admit(
        {
          firstName: 'Aminetou',
          lastName: 'Mint Sidi',
          rim: 'RIM-0001',
          nationalId: 'NNI-0001',
          newGuardian: { fullName: 'Sidi Ould Ahmed', phone: '+22245000002', initialPassword: 'Ecole-2026' },
        },
        ACTOR,
        DIRECTION,
      ),
    );
    expect(elsewhere.studentId).toBeTruthy();
    expect(elsewhere.studentId).not.toBe(firstStudent);
  });

  it('attaches a sibling to the existing family rather than making a second one', async () => {
    const sibling = await inTenant(() =>
      admissions.admit(
        {
          firstName: 'Mohamed',
          lastName: 'Ould Sidi',
          rim: 'RIM-0002',
          nationalId: 'NNI-0002',
          guardianId: familyId,
          academicYearId: yearId,
          groupId,
        },
        ACTOR,
        DIRECTION,
      ),
    );
    expect(sibling.guardianId).toBe(familyId);
    // No account was created, so nothing to hand over.
    expect(sibling.temporaryPassword).toBeNull();

    const { rows } = await owner.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM students WHERE guardian_id = $1 AND school_id = $2',
      [familyId, schoolId],
    );
    expect(Number(rows[0]!.n)).toBe(2);
  });

  it('refuses to both attach and create a family', async () => {
    await expect(
      inTenant(() =>
        admissions.admit(
          {
            firstName: 'X',
            lastName: 'Y',
            rim: 'RIM-0003',
            nationalId: 'NNI-0003',
            guardianId: familyId,
            newGuardian: { fullName: 'Deux fois', phone: '+22245000003', initialPassword: 'Ecole-2026' },
          },
          ACTOR,
          DIRECTION,
        ),
      ),
    ).rejects.toThrow(/pas les deux/i);
  });

  it('refuses a family with neither an email nor a phone to sign in with', async () => {
    await expect(
      inTenant(() =>
        admissions.admit(
          {
            firstName: 'X',
            lastName: 'Y',
            rim: 'RIM-0004',
            nationalId: 'NNI-0004',
            newGuardian: { fullName: 'Sans contact', initialPassword: 'Ecole-2026' },
          },
          ACTOR,
          DIRECTION,
        ),
      ),
    // Le téléphone du parent est son identifiant dans l'application des
    // familles, qui n'accepte qu'un numéro mauritanien : sa phrase.
    ).rejects.toThrow(/Numéro mauritanien attendu/);
  });

  it('moves a child between groups of the same level', async () => {
    const { rows } = await owner.query<{ id: string }>(
      'SELECT id FROM enrollments WHERE student_id = $1',
      [firstStudent],
    );
    const moved = await inTenant(() =>
      admissions.moveToGroup(rows[0]!.id, otherGroupId, ACTOR),
    );
    expect(moved.group).toBe('6eme B');
  });

  it('⚠ refuses a move that would change LEVEL — that is a re-enrolment', async () => {
    const { rows: enr } = await owner.query<{ id: string }>(
      'SELECT id FROM enrollments WHERE student_id = $1',
      [firstStudent],
    );
    const { rows: g } = await owner.query<{ id: string }>(
      "SELECT id FROM groups WHERE name = '5eme A' AND school_id = $1",
      [schoolId],
    );
    await expect(
      inTenant(() => admissions.moveToGroup(enr[0]!.id, g[0]!.id, ACTOR)),
    ).rejects.toThrow(/autre niveau/i);
  });
});

describe('expenses — depenses.php', () => {
  let expenseId: string;

  it('records money out as a string, numbered DEP-000001, and shows up in the month it left', async () => {
    const spent = await inTenant(() =>
      expenses.record(
        {
          amount: '12500.50',
          description: 'Fournitures',
          tender: [{ paymentMethodId: CASH, amount: '12500.50' }],
        },
        ACTOR,
      ),
    );
    expenseId = spent.id;
    expect(spent.amount).toBe('12500.50');
    expect(typeof spent.amount).toBe('string');
    expect(spent.receiptNumber).toBe('DEP-000001');

    // Dated by when the money left (ADR-0013): put it in November 2020.
    await owner.query(`UPDATE expenses SET spent_at = '2020-11-12T10:00:00Z' WHERE id = $1`, [expenseId]);
    const report = await inTenant(() => reports.monthly(11, 2020));
    expect(report.outgoings.expenses).toBe('12500.50');
  });

  it('refuses a zero expense with its words', async () => {
    await expect(
      inTenant(() =>
        expenses.record(
          { amount: '0.00', description: 'Rien', tender: [{ paymentMethodId: CASH, amount: '0.00' }] },
          ACTOR,
        ),
      ),
    ).rejects.toThrow('Le montant doit être supérieur à 0.');
  });

  it('lists the whole history with the tender summary, and the total', async () => {
    const page = await inTenant(() => expenses.list());
    const row = page.depenses.find((d) => d.id === expenseId)!;
    expect(row.moyens).toBe('Espèces 12 501');
    expect(row.numero).toBe('DEP-000001');
    expect(page.total).toBe('12500.50');
  });

  it('prints the bon de dépense', async () => {
    const bon = await inTenant(() => expenses.receipt(expenseId));
    expect(bon.numero).toBe('DEP-000001');
    expect(bon.description).toBe('Fournitures');
    expect(bon.moyens).toEqual([{ moyen: 'Espèces', montant: '12500.50', reference: null }]);
  });

  it('« supprime » with a negating entry, leaves the original untouched, and hides both', async () => {
    await inTenant(() => expenses.reverse(expenseId, 'Double saisie', ACTOR));

    const { rows } = await owner.query<{ amount: string; reversed: boolean }>(
      'SELECT amount, reversed FROM expenses WHERE id = $1',
      [expenseId],
    );
    expect(rows[0]!.amount).toBe('12500.50');
    expect(rows[0]!.reversed).toBe(true);

    // The reversal lands in the month it was MADE (ADR-0013). November keeps
    // its original entry; the negation belongs to today.
    const november = await inTenant(() => reports.monthly(11, 2020));
    expect(november.outgoings.expenses).toBe('12500.50');

    // And the screen no longer shows either line — his DELETE, without a DELETE.
    const page = await inTenant(() => expenses.list());
    expect(page.depenses.find((d) => d.id === expenseId)).toBeUndefined();
    expect(page.depenses.some((d) => d.description.startsWith('Annulation'))).toBe(false);
    expect(page.total).toBe('0.00');
  });

  it('refuses to reverse a reversal, and to reverse twice', async () => {
    const { rows } = await owner.query<{ id: string }>(
      'SELECT id FROM expenses WHERE amount < 0 AND school_id = $1 LIMIT 1',
      [schoolId],
    );
    await expect(
      inTenant(() => expenses.reverse(rows[0]!.id, 'Encore', ACTOR)),
    ).rejects.toThrow(/elle-même une annulation/i);
    await expect(
      inTenant(() => expenses.reverse(expenseId, 'Encore', ACTOR)),
    ).rejects.toThrow(/déjà été supprimée/i);
  });

  it('sees nothing from another school', async () => {
    const elsewhere = await runInTenant({ schoolId: otherSchoolId, slug: 'adm-other' }, () =>
      expenses.list(),
    );
    expect(elsewhere.depenses).toHaveLength(0);
  });
});

describe('global search', () => {
  // Son `recherche.php` : nom, prénom, matricule, nom du correspondant, téléphone
  // du correspondant (en chiffres). Ni le RIM ni le NNI — ce sont des pièces
  // d'identité, pas des identifiants de recherche chez lui.
  it('finds a child by name, by matricule and by the guardian’s phone digits', async () => {
    const byName = await inTenant(() => search.search('Aminetou'));
    expect(byName.students.length).toBeGreaterThan(0);

    const matricule = byName.students.find((s) => s.first_name === 'Aminetou')!.matricule as string;
    expect(matricule).toMatch(/^ET/);
    const byMatricule = await inTenant(() => search.search(matricule));
    expect(byMatricule.students.length).toBe(1);

    const byPhone = await inTenant(() => search.search('45 00 00 01'));
    expect(byPhone.students.length).toBeGreaterThan(0);
  });

  it('finds a family’s children by the guardian’s name', async () => {
    const found = await inTenant(() => search.search('Sidi Ould Ahmed'));
    expect(found.students.length).toBeGreaterThan(0);
  });

  it('⚠ "global" means across record kinds, never across schools', async () => {
    // The same child exists at adm-other. Searching from this school must
    // find ONLY its own.
    const here = await inTenant(() => search.search('Aminetou'));
    expect(here.students.length).toBeGreaterThan(0);

    const there = await runInTenant({ schoolId: otherSchoolId, slug: 'adm-other' }, () =>
      search.search('Aminetou'),
    );
    expect(there.students.length).toBeGreaterThan(0);
    const ici = new Set(here.students.map((s) => s.id));
    expect(there.students.some((s) => ici.has(s.id))).toBe(false);
  });

  it('finds nothing for a term that matches nothing', async () => {
    const empty = await inTenant(() => search.search('zzzzzzzz'));
    expect(empty.total).toBe(0);
  });
});

describe('changing your own password', () => {
  let userId: string;

  beforeAll(async () => {
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('adm.pwd@test', $1, 'Password Tester') RETURNING id`,
      // Argon2id hash of "originalpw" is produced at runtime below instead.
      ['x'],
    );
    userId = rows[0]!.id;
    const { hashPassword } = await import('../src/auth/passwords.js');
    await owner.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
      userId,
      await hashPassword('originalpw'),
    ]);
  });

  it('refuses a wrong current password, even when already signed in', async () => {
    // An unattended session at the cash desk must not be enough to lock the
    // real owner out of their own account.
    await expect(
      auth.changeOwnPassword(userId, 'notmypassword', 'brandnewpw', 'brandnewpw', '127.0.0.1'),
    ).rejects.toThrow(/incorrect/i);
  });

  it('⚠ judges the policy BEFORE the identity — its order', async () => {
    // `changer_mdp` in modifier_profil.php: wrong old password, then
    // `valider_mot_de_passe()`, then the confirmation, then « différent de
    // l'ancien ». A weak password repeated is refused for being weak.
    await expect(
      auth.changeOwnPassword(userId, 'originalpw', 'originalpw', 'originalpw', '127.0.0.1'),
    ).rejects.toThrow(/3 types de caractères/);
  });

  it('refuses a confirmation that does not match, in its words', async () => {
    await expect(
      auth.changeOwnPassword(userId, 'originalpw', 'Un-Meilleur-Mot2', 'Un-Autre-Mot3', '127.0.0.1'),
    ).rejects.toThrow(/ne correspondent pas/);
  });

  it('refuses a password under eight characters, in its own words', async () => {
    await expect(
      auth.changeOwnPassword(userId, 'originalpw', 'short', 'short', '127.0.0.1'),
    ).rejects.toThrow(/au moins 8 caractères/);
  });

  it('⚠ refuses eight characters of a single kind', async () => {
    // The case the old length-only rule let through, and the reason the forced
    // change was a formality: "aaaaaaaa" satisfied it and cleared the flag.
    await expect(
      auth.changeOwnPassword(userId, 'originalpw', 'aaaaaaaa', 'aaaaaaaa', '127.0.0.1'),
    ).rejects.toThrow(/3 types de caractères/);
  });

  it('changes it, clears the forced-change flag and revokes every session', async () => {
    await owner.query('UPDATE users SET must_change_password = true WHERE id = $1', [userId]);
    await auth.changeOwnPassword(userId, 'originalpw', 'Un-Meilleur-Mot2', 'Un-Meilleur-Mot2', '127.0.0.1');

    const { rows } = await owner.query<{ must_change_password: boolean }>(
      'SELECT must_change_password FROM users WHERE id = $1',
      [userId],
    );
    expect(rows[0]!.must_change_password).toBe(false);

    const { rows: live } = await owner.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
    expect(Number(live[0]!.n)).toBe(0);
  });

  it('refuses a new password identical to the old one, once the policy is met', async () => {
    await expect(
      auth.changeOwnPassword(userId, 'Un-Meilleur-Mot2', 'Un-Meilleur-Mot2', 'Un-Meilleur-Mot2', '127.0.0.1'),
    ).rejects.toThrow(/différent de l.ancien/i);
  });

  it('⚠ spares the session that made the change, and revokes the others', async () => {
    const { sessionsServiceForPool } = await import('../src/auth/sessions.service.js');
    const sessions = sessionsServiceForPool(owner);
    const gardee = await sessions.issue(userId, null, { ip: '10.0.0.1', userAgent: 'test' });
    const autre = await sessions.issue(userId, null, { ip: '10.0.0.2', userAgent: 'test' });
    await auth.changeOwnPassword(
      userId, 'Un-Meilleur-Mot2', 'Encore-Un-Mot4', 'Encore-Un-Mot4', '127.0.0.1', gardee.refreshToken,
    );
    const { rows } = await owner.query<{ h: string; revoked: boolean }>(
      'SELECT token_hash AS h, revoked_at IS NOT NULL AS revoked FROM refresh_tokens WHERE user_id = $1',
      [userId],
    );
    const { hashRefreshToken } = await import('../src/auth/tokens.js');
    expect(rows.find((r) => r.h === hashRefreshToken(gardee.refreshToken))!.revoked).toBe(false);
    expect(rows.find((r) => r.h === hashRefreshToken(autre.refreshToken))!.revoked).toBe(true);
  });
});

/**
 * LE MOT DE PASSE INITIAL DU CORRESPONDANT.
 *
 * ⚠ EL OURWA LETS THE OFFICE CHOOSE IT. `inscrire_etudiant.php` carries a field
 * labelled "Mot de passe initial *" with the placeholder "≥ 8 car., 3 types",
 * and its own header says why: "L'admin choisit le mot de passe initial du
 * parent (changé ensuite par le parent)." A clerk standing at the counter reads
 * it aloud to a family who will not write it down; a random `Kx7_pQ2v` cannot be
 * said over a desk.
 *
 * Ours generated one and offered no field, so the counter could not do the thing
 * its screen exists to do.
 *
 * ⚠ THE ONE DIFFERENCE, AND IT ONLY EVER MAKES THE PASSWORD STRONGER: leaving
 * the box empty still generates one, rather than refusing the form. El Ourwa
 * marks the field required. Filled, the behaviour is identical; empty, ours
 * produces a random password where theirs produces an error — and no clerk ever
 * gets a weaker outcome from the difference.
 */
describe('le mot de passe initial du correspondant', () => {
  it('uses the one the office typed', async () => {
    const result = await inTenant(() =>
      admissions.admit(
        {
          firstName: 'Khadija',
          lastName: 'Mint Ely',
          rim: 'RIM-PW-1',
          nationalId: 'NNI-PW-1',
          newGuardian: {
            fullName: 'Ely Ould Ahmed',
            phone: '+22245000701',
            initialPassword: 'Ecole-2026',
          },
        },
        ACTOR,
        DIRECTION,
      ),
    );
    expect(result.temporaryPassword).toBe('Ecole-2026');

    // Stored hashed, never in clear — the handover is the only place it exists.
    const { rows } = await owner.query<{ password_hash: string; must_change_password: boolean }>(
      'SELECT password_hash, must_change_password FROM users WHERE id = $1',
      [result.guardianId],
    );
    expect(rows[0]!.password_hash).not.toContain('Ecole-2026');
    // ⚠ Chosen by the office is still a password the family did not pick.
    expect(rows[0]!.must_change_password).toBe(true);
  });

  it('⚠ refuses a weak one — the same policy as everywhere else', async () => {
    await expect(
      inTenant(() =>
        admissions.admit(
          {
            firstName: 'Faible',
            lastName: 'Essai',
            rim: 'RIM-PW-2',
            nationalId: 'NNI-PW-2',
            newGuardian: {
              fullName: 'Parent Faible',
              phone: '+22245000702',
              initialPassword: 'aaaaaaaa',
            },
          },
          ACTOR,
          DIRECTION,
        ),
      ),
    ).rejects.toThrow(/3 types de caractères/);

    // ⚠ AND NOTHING WAS WRITTEN. The refusal happens inside the transaction, so
    // a rejected password cannot leave a child behind with no family.
    const { rows } = await owner.query('SELECT id FROM students WHERE rim = $1', ['RIM-PW-2']);
    expect(rows).toHaveLength(0);
  });

  it('refuses an empty box — his « Mot de passe initial * » is required', async () => {
    await expect(
      inTenant(() =>
        admissions.admit(
          {
            firstName: 'Sans',
            lastName: 'Saisie',
            rim: 'RIM-PW-3',
            nationalId: 'NNI-PW-3',
            newGuardian: { fullName: 'Parent Généré', phone: '+22245000703' },
          },
          ACTOR,
          DIRECTION,
        ),
      ),
    ).rejects.toThrow(/au moins 8 caractères/);
  });

  it('attaches to the family whose phone already has an account — « Parent déjà existant — étudiant rattaché »', async () => {
    const result = await inTenant(() =>
      admissions.admit(
        {
          firstName: 'Cadet',
          lastName: 'Saisie',
          rim: 'RIM-PW-4',
          nationalId: 'NNI-PW-4',
          newGuardian: { fullName: 'Parent Deja La', phone: '+22245000001', initialPassword: 'Ecole-2026' },
        },
        ACTOR,
        DIRECTION,
      ),
    );
    expect(result.parentDejaExistant).toBe(true);
    expect(result.temporaryPassword).toBeNull();
  });
});
