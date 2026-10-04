import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { PayrollService } from '../src/payroll/payroll.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * Staff, teacher and parent accounts — El Ourwa's `creer_utilisateur.php`,
 * `ajouter_staff.php`, `comptes_*.php` and `reinitialiser_mdp.php`.
 *
 * A login and the personnel record that goes with it are created together: an
 * account with no record cannot be paid, and a record with no account cannot
 * sign in.
 */

let owner: pg.Pool;
let accounts: AccountsService;
let payroll: PayrollService;
let auth: AuthService;

let schoolId: string;
let otherSchoolId: string;
let ACTOR: string;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'acc' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const schools = await owner.query<{ id: string; slug: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES
       ('acc', 'Accounts', 'ACC'), ('acc-other', 'Accounts Other', 'ACO')
     RETURNING id, slug`,
  );
  schoolId = schools.rows.find((r) => r.slug === 'acc')!.id;
  otherSchoolId = schools.rows.find((r) => r.slug === 'acc-other')!.id;

  await owner.query(
    `INSERT INTO roles (code, label, is_system, sort_order) VALUES
       ('admin', 'Administrateur', true, 2),
       ('comptable', 'Comptable', true, 10),
       ('secretaire', 'Secrétaire', true, 11),
       ('collecteur_absence', 'Collecteur', true, 12),
       ('professeur', 'Professeur', true, 20),
       ('parent', 'Parent', true, 30)
     ON CONFLICT (code) DO NOTHING`,
  );

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('acc.admin@test', 'x', 'Directeur') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  accounts = moduleRef.get(AccountsService);
  payroll = moduleRef.get(PayrollService);
  auth = moduleRef.get(AuthService);
});

afterAll(async () => {
  await owner?.end();
});

describe('creating an accountant', () => {
  let userId: string;
  let staffId: string;
  let password: string;

  it('creates the login and the staff record together', async () => {
    const made = await inTenant(() =>
      accounts.create(
        {
          role: 'comptable',
          firstName: 'Vatimetou',
          lastName: 'Mint Ely',
          sex: 'F',
          email: 'acc.comptable@test',
          salary: '62000.00',
          hiredOn: '2024-09-01',
        },
        ACTOR,
      ),
    );
    userId = made.userId;
    staffId = made.personnelId;
    password = made.temporaryPassword;

    expect(made.roles).toEqual(['comptable']);
    // Handed over once, never stored in clear.
    expect(password).toMatch(/^\S{10}$/);

    const { rows } = await owner.query<{ role_title: string; salary: string; user_id: string }>(
      'SELECT role_title, salary::text, user_id FROM staff WHERE id = $1',
      [staffId],
    );
    // The job title defaults from the role rather than being left blank.
    expect(rows[0]!.role_title).toBe('Comptable');
    expect(rows[0]!.salary).toBe('62000.00');
    expect(rows[0]!.user_id).toBe(userId);
  });

  it('the new account can actually sign in, and is forced to change', async () => {
    const { rows } = await owner.query<{ must_change_password: boolean }>(
      'SELECT must_change_password FROM users WHERE id = $1',
      [userId],
    );
    expect(rows[0]!.must_change_password).toBe(true);

    // The generated password verifies — proof it was hashed, not mangled.
    await expect(
      auth.changeOwnPassword(userId, password, 'Un-Choix-Fort2', 'Un-Choix-Fort2', '127.0.0.1'),
    ).resolves.toBeUndefined();
  });

  it('appears on the payroll immediately, because the record exists', async () => {
    const page = await inTenant(() => payroll.staffPay('staff', 4, 2021));
    const row = page.lignes.find((r) => r.id === staffId);
    expect(row).toBeTruthy();
    expect(row!.gain).toBe('62000.00');
  });

  it('refuses a duplicate email rather than making a second account', async () => {
    await expect(
      inTenant(() =>
        accounts.create(
          {
            role: 'secretaire',
            firstName: 'Autre',
            lastName: 'Personne',
            email: 'acc.comptable@test',
          },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/possède déjà un compte/i);
  });

  it('refuses an account with no way to sign in', async () => {
    await expect(
      inTenant(() =>
        accounts.create({ role: 'secretaire', firstName: 'Sans', lastName: 'Contact' }, ACTOR),
      ),
    ).rejects.toThrow(/email ou d’un (numéro de )?téléphone/i);
  });
});

describe('roles', () => {
  it('stacks extra roles onto a non-teacher', async () => {
    const made = await inTenant(() =>
      accounts.create(
        {
          role: 'secretaire',
          firstName: 'Khadijetou',
          lastName: 'Mint Sidi',
          phone: '+22248000001',
          extraRoles: ['collecteur_absence', 'comptable'],
        },
        ACTOR,
      ),
    );
    expect(made.roles.sort()).toEqual(['collecteur_absence', 'comptable', 'secretaire']);
  });

  /**
   * ⚠ CET ÉCRAN N'OFFRE QUE QUATRE RÔLES, ET N'EMPORTE PAS LES AUTRES.
   *
   * `comptes_staffs.php` coche Administrateur, Comptable, Secrétaire et
   * Collecteur d'absence. Ni `super_admin` — on ne se donne pas les pleins
   * pouvoirs depuis l'écran des comptes du personnel — ni `professeur`, qui a
   * sa propre page.
   *
   * Mais `setRoles` efface tout avant de réinsérer. Réduire la liste à quatre
   * cases SANS ceci aurait retiré en silence le rôle d'un super administrateur
   * au premier enregistrement, et personne ne l'aurait vu avant qu'il perde
   * l'accès. Écrit après avoir failli livrer exactement cela.
   */
  it('⚠ garde les rôles que l’écran n’offre pas', async () => {
    const made = await inTenant(() =>
      accounts.create(
        {
          role: 'secretaire',
          firstName: 'Aminetou',
          lastName: 'Mint Preserve',
          phone: '+22248000009',
        },
        ACTOR,
      ),
    );

    // Un rôle hors liste, posé directement comme le ferait une autre page.
    await owner.query(
      `INSERT INTO user_school_roles (user_id, school_id, role_id)
       SELECT $1, $2, id FROM roles WHERE code = 'professeur'`,
      [made.userId, schoolId],
    );

    // L'écran n'enregistre que ce qu'il montre.
    const after = await inTenant(() =>
      accounts.setRoles(made.userId, ['comptable'], ACTOR),
    );

    expect(after.roles.sort()).toEqual(['comptable', 'professeur']);

    const { rows } = await owner.query<{ code: string }>(
      `SELECT r.code FROM user_school_roles usr JOIN roles r ON r.id = usr.role_id
        WHERE usr.user_id = $1 AND usr.school_id = $2 ORDER BY r.code`,
      [made.userId, schoolId],
    );
    expect(rows.map((r) => r.code)).toEqual(['comptable', 'professeur']);
  });

  it('⚠ refuses to stack roles onto a TEACHER', async () => {
    // El Ourwa's rule, kept with its reason: a teacher's account carries a
    // teaching record, not a pile of administrative functions.
    const made = await inTenant(() =>
      accounts.create(
        {
          role: 'professeur',
          firstName: 'Moussa',
          lastName: 'Ould Baba',
          phone: '+22248000002',
          extraRoles: ['comptable', 'secretaire'],
          employment: 'interim',
          hourlyRate: '500.00',
        },
        ACTOR,
      ),
    );
    expect(made.roles).toEqual(['professeur']);
  });

  it('⚠ zeroes the pay field that does not apply', async () => {
    // An interim teacher must not carry a stale flat salary from a previous
    // contract: `teacherReferencePay` branches on `employment`, and a leftover
    // salary would be paid the moment somebody flipped them to permanent.
    const { rows } = await owner.query<{ salary: string; hourly_rate: string }>(
      `SELECT salary::text, hourly_rate::text FROM teachers
        WHERE school_id = $1 AND last_name = 'Ould Baba'`,
      [schoolId],
    );
    expect(rows[0]!.salary).toBe('0.00');
    expect(rows[0]!.hourly_rate).toBe('500.00');
  });

  it('refuses to leave an account with no role at all', async () => {
    const { rows } = await owner.query<{ id: string }>(
      "SELECT id FROM users WHERE email = 'acc.comptable@test'",
    );
    await expect(inTenant(() => accounts.setRoles(rows[0]!.id, [], ACTOR))).rejects.toThrow(
      /au moins un rôle/i,
    );
  });

  it('replaces the whole set rather than adding to it', async () => {
    const { rows } = await owner.query<{ id: string }>(
      "SELECT id FROM users WHERE email = 'acc.comptable@test'",
    );
    await inTenant(() => accounts.setRoles(rows[0]!.id, ['secretaire'], ACTOR));

    const { rows: held } = await owner.query<{ code: string }>(
      `SELECT r.code FROM user_school_roles usr
         JOIN roles r ON r.id = usr.role_id
        WHERE usr.user_id = $1 AND usr.school_id = $2`,
      [rows[0]!.id, schoolId],
    );
    expect(held.map((r) => r.code)).toEqual(['secretaire']);
  });
});

describe('resetting somebody else’s password', () => {
  let userId: string;

  beforeAll(async () => {
    const { rows } = await owner.query<{ id: string }>(
      "SELECT id FROM users WHERE email = 'acc.comptable@test'",
    );
    userId = rows[0]!.id;
  });

  it('issues a new one, forces a change and kills every session', async () => {
    // Give them a live session first, so revocation has something to revoke.
    await owner.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES ($1, gen_random_uuid(), 'live-token-hash', now() + interval '1 day')`,
      [userId],
    );

    const reset = await inTenant(() => accounts.resetPassword(userId, ACTOR));
    expect(reset.temporaryPassword).toMatch(/^\S{10}$/);

    const { rows } = await owner.query<{ must_change_password: boolean }>(
      'SELECT must_change_password FROM users WHERE id = $1',
      [userId],
    );
    expect(rows[0]!.must_change_password).toBe(true);

    // A reset answers a lost or shared password. Leaving the old sessions alive
    // would defeat the point entirely.
    const { rows: live } = await owner.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
    expect(Number(live[0]!.n)).toBe(0);
  });

  it('⚠ refuses to reset an account that belongs to another school', async () => {
    // `users` is a PLATFORM table. Without the ownership check an administrator
    // of one branch could reset the password of anyone on the platform.
    const outsider = await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('acc.outsider@test', 'x', 'Outsider') RETURNING id`,
    );
    await expect(
      inTenant(() => accounts.resetPassword(outsider.rows[0]!.id, ACTOR)),
    ).rejects.toThrow(/Compte introuvable dans cette école/i);
  });
});

describe('suspending an account', () => {
  it('revokes the sessions too, or suspension means nothing until the token expires', async () => {
    const made = await inTenant(() =>
      accounts.create(
        {
          role: 'collecteur_absence',
          firstName: 'Sidi',
          lastName: 'Ould Cheikh',
          phone: '+22248000003',
        },
        ACTOR,
      ),
    );
    await owner.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES ($1, gen_random_uuid(), 'suspend-token-hash', now() + interval '1 day')`,
      [made.userId],
    );

    await inTenant(() => accounts.setActive(made.userId, false, ACTOR));

    const { rows } = await owner.query<{ active: boolean }>(
      'SELECT active FROM users WHERE id = $1',
      [made.userId],
    );
    expect(rows[0]!.active).toBe(false);

    const { rows: live } = await owner.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
      [made.userId],
    );
    expect(Number(live[0]!.n)).toBe(0);
  });
});

describe('the lists', () => {
  it('shows staff with their roles and account state', async () => {
    const staff = await inTenant(() => accounts.listStaff());
    expect(staff.length).toBeGreaterThan(0);
    const accountant = staff.find((s: any) => s.last_name === 'Mint Ely')!;
    expect(accountant.email).toBe('acc.comptable@test');
    expect(Array.isArray(accountant.roles)).toBe(true);
  });

  it('shows teachers with their assignment count', async () => {
    const teachers = await inTenant(() => accounts.listTeachers());
    const t = teachers.find((r: any) => r.last_name === 'Ould Baba')!;
    expect(t.employment).toBe('interim');
    expect(t.assignments).toBe(0);
  });

  it('⚠ sees nothing belonging to another school', async () => {
    const staff = await runInTenant({ schoolId: otherSchoolId, slug: 'acc-other' }, () =>
      accounts.listStaff(),
    );
    expect(staff).toHaveLength(0);
  });
});

/**
 * METTRE À JOUR LA RÉMUNÉRATION — `gerer_professeurs.php`, `mettre_a_jour_tarif`.
 *
 * ⚠ ITS HANDLER ZEROES THE OTHER SIDE, and ours did not. El Ourwa writes
 * `SET salaire = :s, prix_par_heure = 0` for a permanent teacher and
 * `SET prix_par_heure = :t, salaire = 0` for an intérimaire. Ours used COALESCE
 * on both columns, so a teacher moved from permanent to intérimaire kept a
 * monthly salary sitting in the row beside their new hourly rate.
 *
 * `teacherReferencePay` branches on `employment`, so the stale figure is not
 * paid today — and that is exactly what makes it dangerous. It is a live money
 * column holding a number that belongs to a contract the person no longer has,
 * waiting for the first report that sums the column.
 */
describe('la rémunération d’un professeur', () => {
  let teacherId: string;

  beforeAll(async () => {
    const t = await owner.query<{ id: string }>(
      `INSERT INTO teachers (school_id, first_name, last_name, employment, salary, hourly_rate)
       VALUES ($1, 'Tarif', 'Essai', 'permanent', 55000, 0) RETURNING id`,
      [schoolId],
    );
    teacherId = t.rows[0]!.id;
  });

  it('⚠ moving to intérimaire clears the monthly salary', async () => {
    await inTenant(() =>
      accounts.updateTeacher(
        teacherId,
        { employment: 'interim', hourlyRate: '450.50' },
        ACTOR,
      ),
    );

    const { rows } = await owner.query<{ salary: string; hourly_rate: string }>(
      'SELECT salary::text, hourly_rate::text FROM teachers WHERE id = $1',
      [teacherId],
    );
    expect(rows[0]!.hourly_rate).toBe('450.50');
    expect(rows[0]!.salary).toBe('0.00');
  });

  it('⚠ and moving back to permanent clears the hourly rate', async () => {
    await inTenant(() =>
      accounts.updateTeacher(teacherId, { employment: 'permanent', salary: '60000' }, ACTOR),
    );

    const { rows } = await owner.query<{ salary: string; hourly_rate: string }>(
      'SELECT salary::text, hourly_rate::text FROM teachers WHERE id = $1',
      [teacherId],
    );
    expect(rows[0]!.salary).toBe('60000.00');
    expect(rows[0]!.hourly_rate).toBe('0.00');
  });

  it('leaves both alone when the contract is not being changed', async () => {
    // A phone number correction must not silently zero a salary.
    await inTenant(() => accounts.updateTeacher(teacherId, { phone: '+22245000999' }, ACTOR));

    const { rows } = await owner.query<{ salary: string; phone: string }>(
      'SELECT salary::text, phone FROM teachers WHERE id = $1',
      [teacherId],
    );
    expect(rows[0]!.salary).toBe('60000.00');
    expect(rows[0]!.phone).toBe('+22245000999');
  });
});

/**
 * CHANGER L'IDENTIFIANT — `comptes_parents.php`, `comptes_profs.php`,
 * `comptes_staffs.php` and `modifier_profil.php` all carry it.
 *
 * ⚠ NOTHING IN THE APPLICATION COULD CHANGE A LOGIN IDENTIFIER. A parent's
 * telephone IS their identifier here, and telephone numbers change: a lost SIM,
 * a new operator, a number written down wrong at the counter in October. Any of
 * those locked a family out of their own account permanently, and the only
 * remedy was editing the database.
 *
 * ⚠ AND THE SESSION MUST GO WITH IT. Changing how somebody signs in while
 * leaving their old sessions live means the identifier that was replaced still
 * works — which is the whole point when the reason for the change is that the
 * number is now somebody else's.
 */
describe('changer l’identifiant', () => {
  let userId: string;
  let otherId: string;

  beforeAll(async () => {
    const u = await owner.query<{ id: string }>(
      `INSERT INTO users (phone, password_hash, full_name)
       VALUES ('+22245001111', 'x', 'Famille Ident') RETURNING id`,
    );
    userId = u.rows[0]!.id;
    await owner.query(
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, 'RIM-IDENT', 'NID-IDENT', 'Enfant', 'Ident')`,
      [schoolId, userId],
    );

    const o = await owner.query<{ id: string }>(
      `INSERT INTO users (phone, password_hash, full_name)
       VALUES ('+22245002222', 'x', 'Autre Famille') RETURNING id`,
    );
    otherId = o.rows[0]!.id;
    await owner.query(
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, 'RIM-IDENT2', 'NID-IDENT2', 'Autre', 'Ident')`,
      [schoolId, otherId],
    );
  });

  it('changes the telephone a family signs in with — stored canonical, eight digits', async () => {
    await inTenant(() => accounts.setIdentifier(userId, { phone: '+222 45 00 33 33' }, ACTOR));
    const { rows } = await owner.query<{ phone: string }>(
      'SELECT phone FROM users WHERE id = $1',
      [userId],
    );
    expect(rows[0]!.phone).toBe('45003333');
  });

  it('⚠ refuses a number another account already uses', async () => {
    // Its own message. Two accounts on one number means one of them cannot sign
    // in, and nothing on screen would say which.
    await expect(
      inTenant(() => accounts.setIdentifier(userId, { phone: '+22245002222' }, ACTOR)),
    ).rejects.toThrow(/déjà/i);
  });

  it('⚠ refuses anything that is not a Mauritanian number', async () => {
    for (const bad of ['12345', 'abc', '12345678', '+33612345678']) {
      await expect(
        inTenant(() => accounts.setIdentifier(userId, { phone: bad }, ACTOR)),
      ).rejects.toThrow(/Numéro mauritanien attendu/);
    }
  });

  it('⚠ refuses to leave an account with no way in at all', async () => {
    // ⚠ Clearing the only identifier does not lock the door — it REMOVES it.
    // The row survives and nobody can ever sign in to that account again.
    //
    // Empty is removal, not invalidity: an account may legitimately drop its
    // telephone and keep signing in by email. It is losing BOTH that is
    // refused.
    await owner.query('UPDATE users SET email = NULL WHERE id = $1', [userId]);
    await expect(
      inTenant(() => accounts.setIdentifier(userId, { phone: '' }, ACTOR)),
    ).rejects.toThrow(/email ou.*téléphone/i);
  });

  it('changes an email, and lowercases it', async () => {
    // An identifier that differs by case is a second account waiting to happen.
    await inTenant(() =>
      accounts.setIdentifier(userId, { email: '  Famille.Ident@Test.MR ' }, ACTOR),
    );
    const { rows } = await owner.query<{ email: string }>(
      'SELECT email FROM users WHERE id = $1',
      [userId],
    );
    expect(rows[0]!.email).toBe('famille.ident@test.mr');
  });

  it('⚠ refuses an account that belongs to no one in this school', async () => {
    const stranger = await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('etranger@ailleurs.test', 'x', 'Étranger') RETURNING id`,
    );
    await expect(
      inTenant(() =>
        accounts.setIdentifier(stranger.rows[0]!.id, { phone: '+22245009999' }, ACTOR),
      ),
    ).rejects.toThrow(/introuvable/i);
  });
});

/**
 * « CET IDENTIFIANT EXISTE DÉJÀ » — seulement quand c'est vrai (18/09), et le
 * parcours complet du mot de passe : créer → se connecter avec le provisoire
 * → le changer → se déconnecter → se reconnecter avec le nouveau.
 */
describe('l’identifiant et le mot de passe, de bout en bout', () => {
  const CTX = { ip: '127.0.0.1', userAgent: 'vitest' };

  it('créer un compte, se connecter avec le mot de passe provisoire, le changer, se reconnecter', async () => {
    const r = await inTenant(() =>
      accounts.create(
        { role: 'secretaire', firstName: 'Mariem', lastName: 'Diallo', username: 'mariem.acc', password: 'Provisoire-9x' },
        ACTOR,
      ),
    );
    expect(r.attached).toBe(false);
    expect(r.temporaryPassword).toBe('Provisoire-9x');
    const first = await inTenant(() => auth.login('mariem.acc', 'Provisoire-9x', 'acc', CTX));
    expect(first.accessToken).toBeTruthy();
    expect(first.user.mustChangePassword).toBe(true);
    await inTenant(() => auth.changeOwnPassword(r.userId, 'Provisoire-9x', 'Mon-Nouveau-Mdp7', 'Mon-Nouveau-Mdp7', '127.0.0.1'));
    // l'ancien ne passe plus, le nouveau passe — casse et espaces de l'identifiant tolérés
    await expect(inTenant(() => auth.login('mariem.acc', 'Provisoire-9x', 'acc', CTX))).rejects.toThrow();
    const again = await inTenant(() => auth.login('  Mariem.ACC ', 'Mon-Nouveau-Mdp7', 'acc', CTX));
    expect(again.accessToken).toBeTruthy();
    expect(again.user.mustChangePassword).toBe(false);
  });

  it('refuse le même identifiant dans la même école, avec la raison', async () => {
    await expect(
      inTenant(() =>
        accounts.create({ role: 'comptable', firstName: 'Autre', lastName: 'Personne', username: 'MARIEM.acc', password: 'Provisoire-9x' }, ACTOR),
      ),
    ).rejects.toThrow(/existe déjà dans cette école/);
  });

  it('un identifiant pris dans une AUTRE école n’est pas un conflit : le compte est rattaché, son mot de passe intact', async () => {
    const r = await runInTenant({ schoolId: otherSchoolId, slug: 'acc-other' }, () =>
      accounts.create({ role: 'comptable', firstName: 'Mariem', lastName: 'Diallo', username: 'mariem.acc', password: 'Ignore-Moi-1' }, ACTOR),
    );
    expect(r.attached).toBe(true);
    expect(r.temporaryPassword).toBeNull();
    // même compte, un rôle dans chaque école, et toujours le mot de passe qu'elle connaît
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(DISTINCT school_id)::text AS n FROM user_school_roles WHERE user_id = $1`,
      [r.userId],
    );
    expect(rows[0]!.n).toBe('2');
    const la = await runInTenant({ schoolId: otherSchoolId, slug: 'acc-other' }, () => auth.login('mariem.acc', 'Mon-Nouveau-Mdp7', 'acc-other', CTX));
    expect(la.accessToken).toBeTruthy();
  });

  it('⚠ un compte rattaché ailleurs ne se réinitialise ni ne se suspend d’ici — c’est la console', async () => {
    // Mariem est comptable dans les deux écoles : la branche « acc-other » n'a
    // pas à connaître son nouveau mot de passe, ni à la couper de l'autre école.
    const { rows } = await owner.query<{ id: string }>("SELECT id FROM users WHERE username = 'mariem.acc'");
    const id = rows[0]!.id;
    await expect(
      runInTenant({ schoolId: otherSchoolId, slug: 'acc-other' }, () => accounts.resetPassword(id, ACTOR)),
    ).rejects.toThrow(/autre école.*console/i);
    await expect(
      runInTenant({ schoolId: otherSchoolId, slug: 'acc-other' }, () => accounts.setActive(id, false, ACTOR)),
    ).rejects.toThrow(/autre école.*console/i);
    const { rows: encore } = await owner.query<{ active: boolean }>('SELECT active FROM users WHERE id = $1', [id]);
    expect(encore[0]!.active).toBe(true);
  });

  it('⚠ un administrateur de la plateforme ne se rattache pas à une école', async () => {
    await owner.query(
      `INSERT INTO users (username, password_hash, full_name, is_platform_admin) VALUES ('console.admin', 'x', 'Console', true)`,
    );
    await expect(
      inTenant(() => accounts.create({ role: 'admin', firstName: 'C', lastName: 'A', username: 'console.admin', password: 'Ignore-Moi-1' }, ACTOR)),
    ).rejects.toThrow(/administrateur de la plateforme/i);
  });

  it('⚠ les rôles ne s’attribuent qu’à un compte d’ici, et seulement ceux de l’écran', async () => {
    const { rows } = await owner.query<{ id: string }>("SELECT id FROM users WHERE username = 'console.admin'");
    await expect(inTenant(() => accounts.setRoles(rows[0]!.id, ['admin'], ACTOR))).rejects.toThrow(/plateforme/i);
    const { rows: c } = await owner.query<{ id: string }>("SELECT id FROM users WHERE email = 'acc.comptable@test'");
    await expect(inTenant(() => accounts.setRoles(c[0]!.id, ['super_admin'], ACTOR))).rejects.toThrow(/ne s’attribue pas/i);
  });

  it('refuse un identifiant qui est le téléphone ou l’e-mail d’un autre compte', async () => {
    await owner.query(`INSERT INTO users (email, phone, password_hash, full_name) VALUES ('tel.acc@test', '22990011', 'x', 'Un parent')`);
    await expect(
      inTenant(() => accounts.create({ role: 'secretaire', firstName: 'X', lastName: 'Y', username: '22990011', password: 'Provisoire-9x' }, ACTOR)),
    ).rejects.toThrow(/e-mail ou le téléphone d’un autre compte/);
  });
});

/**
 * « Comptes du personnel » : un compte qui n'a QU'UN RÔLE ici, sans fiche de
 * personnel (le compte de direction posé à l'installation, les comptes de
 * démonstration, un compte rattaché par la console). La page le liste — elle
 * part des rôles — et « Mot de passe » / « Désactiver » répondaient « Compte
 * introuvable dans cette école. » : la vérification ne cherchait qu'une fiche
 * (personnel, professeur, correspondant). Signalé par Jinan le 04/10/2026.
 */
describe('un compte qui n’a qu’un rôle ici, sans fiche de personnel', () => {
  let id: string;

  beforeAll(async () => {
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO users (username, password_hash, full_name) VALUES ('role.seul', 'x', 'Agent Sans Fiche') RETURNING id`,
    );
    id = rows[0]!.id;
    await owner.query(
      `INSERT INTO user_school_roles (user_id, school_id, role_id)
       SELECT $1, $2, id FROM roles WHERE code = 'secretaire'`,
      [id, schoolId],
    );
  });

  it('la liste le montre, avec une fonction de personnel — pas « Professeur »', async () => {
    const liste = await inTenant(() => accounts.listComptesPersonnel());
    const c = liste.find((x) => x.id === id);
    expect(c).toBeDefined();
    expect(c!.fonction).toBe('Personnel administratif');
    expect(c!.est_professeur).toBe(false);
  });

  it('« Mot de passe » le réinitialise', async () => {
    const r = await inTenant(() => accounts.resetPassword(id, ACTOR));
    expect(r.temporaryPassword).toMatch(/^\S{10}$/);
  });

  it('« Désactiver » puis « Activer »', async () => {
    await inTenant(() => accounts.setActive(id, false, ACTOR));
    const { rows: a } = await owner.query<{ active: boolean }>('SELECT active FROM users WHERE id = $1', [id]);
    expect(a[0]!.active).toBe(false);
    await inTenant(() => accounts.setActive(id, true, ACTOR));
    const { rows: b } = await owner.query<{ active: boolean }>('SELECT active FROM users WHERE id = $1', [id]);
    expect(b[0]!.active).toBe(true);
  });

  it('⚠ toujours pas un compte d’une autre école', async () => {
    await expect(
      runInTenant({ schoolId: otherSchoolId, slug: 'acc-other' }, () => accounts.resetPassword(id, ACTOR)),
    ).rejects.toThrow(/Compte introuvable dans cette école/i);
    await expect(
      runInTenant({ schoolId: otherSchoolId, slug: 'acc-other' }, () => accounts.setActive(id, false, ACTOR)),
    ).rejects.toThrow(/Compte introuvable dans cette école/i);
  });
});
