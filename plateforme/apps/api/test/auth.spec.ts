import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PermissionsService } from '../src/auth/permissions.service.js';
import { hashPassword } from '../src/auth/passwords.js';

/** Phase 1 exit criteria, exercised end to end against a real database. */

let owner: pg.Pool;
let auth: AuthService;
let permissions: PermissionsService;

const CTX = { ip: '10.0.0.1', userAgent: 'vitest' };
const PASSWORD = 'dev12345';

const ROLE_PERMS: Record<string, string[]> = {
  super_admin: ['finance.encaisser', 'finance.rapport', 'scolarite.inscrire', 'notes.saisir'],
  comptable: ['finance.encaisser', 'finance.rapport'],
  secretaire: ['scolarite.inscrire', 'notes.saisir'],
  professeur: ['notes.consulter'],
  parent: [],
};

let nourId: string;
let rissalaId: string;

async function makeUser(email: string, hash: string) {
  const { rows } = await owner.query<{ id: string }>(
    'INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id',
    [email, hash, email],
  );
  return rows[0]!.id;
}

async function grant(userId: string, schoolId: string, roleCode: string) {
  await owner.query(
    `INSERT INTO user_school_roles (user_id, school_id, role_id)
     SELECT $1, $2, id FROM roles WHERE code = $3`,
    [userId, schoolId, roleCode],
  );
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const schools = await owner.query<{ id: string; slug: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES
       ('nour', 'Ecole Nour', 'NOUR'), ('rissala', 'Ecole Rissala', 'RIS')
     RETURNING id, slug`,
  );
  nourId = schools.rows.find((r) => r.slug === 'nour')!.id;
  rissalaId = schools.rows.find((r) => r.slug === 'rissala')!.id;

  for (const [code, perms] of Object.entries(ROLE_PERMS)) {
    const { rows } = await owner.query<{ id: string }>(
      // Idempotent because `roles` is GLOBAL — no school_id — so it is one
      // catalogue shared by every spec in the suite. A plain INSERT here means
      // whichever file runs second dies on the unique code, and which one that
      // is depends on the runner's scheduling.
      `INSERT INTO roles (code, label, is_system) VALUES ($1, $1, true)
       ON CONFLICT (code) DO UPDATE SET is_system = true
       RETURNING id`,
      [code],
    );
    for (const p of perms) {
      await owner.query(
        `INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [rows[0]!.id, p],
      );
    }
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  auth = moduleRef.get(AuthService);
  permissions = moduleRef.get(PermissionsService);
});

afterAll(async () => {
  await owner?.end();
});

describe('login', () => {
  it('signs in a staff user and returns their permissions for that school', async () => {
    const id = await makeUser('comptable@nour.test', await hashPassword(PASSWORD));
    await grant(id, nourId, 'comptable');

    const result = await auth.login('comptable@nour.test', PASSWORD, 'nour', CTX);

    expect(result.school?.slug).toBe('nour');
    expect(result.roles).toEqual(['comptable']);
    expect(result.permissions.sort()).toEqual(['finance.encaisser', 'finance.rapport']);
    expect(result.accessToken.split('.')).toHaveLength(3);
    expect(result.refreshToken).toBeTruthy();
  });

  it('⚠ écrit `last_login_at` — son `derniere_connexion = NOW()` — sinon « Dernière connexion » lit « Jamais » pour tout le monde', async () => {
    const id = await makeUser('horodate@nour.test', await hashPassword(PASSWORD));
    await grant(id, nourId, 'comptable');
    const avant = await owner.query<{ t: string | null }>('SELECT last_login_at::text AS t FROM users WHERE id = $1', [id]);
    expect(avant.rows[0]!.t).toBeNull();

    await auth.login('horodate@nour.test', PASSWORD, 'nour', CTX);

    const apres = await owner.query<{ recent: boolean }>(
      "SELECT last_login_at > now() - interval '1 minute' AS recent FROM users WHERE id = $1",
      [id],
    );
    expect(apres.rows[0]!.recent).toBe(true);
  });

  it('gives each role exactly its own permissions, and no more', async () => {
    for (const [code, expected] of Object.entries(ROLE_PERMS)) {
      const email = `role-${code}@nour.test`;
      const id = await makeUser(email, await hashPassword(PASSWORD));
      await grant(id, nourId, code);
      const result = await auth.login(email, PASSWORD, 'nour', CTX);
      expect(result.permissions.sort(), code).toEqual([...expected].sort());
    }
  });

  it('unions permissions when a user holds two roles', async () => {
    const id = await makeUser('both@nour.test', await hashPassword(PASSWORD));
    await grant(id, nourId, 'comptable');
    await grant(id, nourId, 'secretaire');

    const result = await auth.login('both@nour.test', PASSWORD, 'nour', CTX);
    expect(result.permissions.sort()).toEqual([
      'finance.encaisser',
      'finance.rapport',
      'notes.saisir',
      'scolarite.inscrire',
    ]);
  });

  it('refuses a user who belongs to another school', async () => {
    const id = await makeUser('outsider@rissala.test', await hashPassword(PASSWORD));
    await grant(id, rissalaId, 'comptable');

    // Right password, wrong branch. Must fail, and must not say why.
    await expect(auth.login('outsider@rissala.test', PASSWORD, 'nour', CTX)).rejects.toThrow(
      /Identifiant ou mot de passe incorrect/i,
    );

    // The same account works where it belongs.
    const ok = await auth.login('outsider@rissala.test', PASSWORD, 'rissala', CTX);
    expect(ok.school?.slug).toBe('rissala');
  });

  it('records failed attempts in the audit log', async () => {
    const { rows } = await owner.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_log WHERE action = 'login_failed'",
    );
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
  });

  it('⚠ un parent entre avec son numéro tel qu’il le tape — sa « recherche tolérante »', async () => {
    // `tenter_connexion_parent()` compare la version normalisée des deux côtés :
    // le numéro enregistré « 22 12 34 56 » et la saisie « 22123456 » (ou l'inverse).
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO users (phone, password_hash, full_name) VALUES ('22 12 34 56', $1, 'Parent Tolérant') RETURNING id`,
      [await hashPassword(PASSWORD)],
    );
    await grant(rows[0]!.id, nourId, 'parent');
    const a = await auth.login('22123456', PASSWORD, 'nour', CTX, true);
    expect(a.roles).toEqual(['parent']);
    const b = await auth.login('(22) 12-34-56', PASSWORD, 'nour', CTX, true);
    expect(b.roles).toEqual(['parent']);
  });

  it('⚠ l’espace des familles refuse avec SA phrase : « Numéro ou mot de passe incorrect. »', async () => {
    await expect(auth.login('22123456', 'faux', 'nour', CTX, true)).rejects.toThrow(
      /^Numéro ou mot de passe incorrect\.$/,
    );
    await expect(auth.login('22123456', 'faux', 'nour', CTX)).rejects.toThrow(
      /^Identifiant ou mot de passe incorrect\.$/,
    );
    await owner.query('DELETE FROM login_attempts');
  });

  it('gives the same error for a wrong password and a missing account', async () => {
    const a = await auth
      .login('comptable@nour.test', 'wrong', 'nour', CTX)
      .catch((e: Error) => e.message);
    const b = await auth
      .login('ghost@nour.test', 'wrong', 'nour', CTX)
      .catch((e: Error) => e.message);
    // Different messages would be a user-enumeration oracle.
    expect(a).toBe(b);
  });

  it('lets one account hold roles in two schools', async () => {
    const id = await makeUser('parent.multi@test', await hashPassword(PASSWORD));
    await grant(id, nourId, 'professeur');
    await grant(id, rissalaId, 'professeur');

    const atNour = await auth.login('parent.multi@test', PASSWORD, 'nour', CTX);
    const atRissala = await auth.login('parent.multi@test', PASSWORD, 'rissala', CTX);

    expect(atNour.user.id).toBe(atRissala.user.id); // one account
    expect(atNour.school?.id).not.toBe(atRissala.school?.id); // two scopes
  });
});

describe('legacy bcrypt hashes', () => {
  it('logs in a bcrypt user and silently upgrades them to Argon2id', async () => {
    const legacy = bcrypt.hashSync(PASSWORD, 10).replace('$2a$', '$2y$');
    const id = await makeUser('legacy@nour.test', legacy);
    await grant(id, nourId, 'secretaire');

    const before = await owner.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [id],
    );
    expect(before.rows[0]!.password_hash.startsWith('$2y$')).toBe(true);

    const result = await auth.login('legacy@nour.test', PASSWORD, 'nour', CTX);
    expect(result.user.id).toBe(id);

    const after = await owner.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [id],
    );
    expect(after.rows[0]!.password_hash.startsWith('$argon2id$')).toBe(true);

    // The upgraded hash must still let them in.
    await expect(auth.login('legacy@nour.test', PASSWORD, 'nour', CTX)).resolves.toBeTruthy();
  });

  it('audits the upgrade', async () => {
    const { rows } = await owner.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_log WHERE action = 'password_hash_upgraded'",
    );
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
  });
});

describe('refresh re-reads authority', () => {
  it('drops a permission revoked since the token was issued', async () => {
    const id = await makeUser('revoked@nour.test', await hashPassword(PASSWORD));
    await grant(id, nourId, 'comptable');

    const first = await auth.login('revoked@nour.test', PASSWORD, 'nour', CTX);
    expect(first.permissions).toContain('finance.encaisser');

    // The administration removes the role.
    await owner.query('DELETE FROM user_school_roles WHERE user_id = $1', [id]);

    // The next refresh must reflect that immediately, not at next login.
    const refreshed = await auth.refresh(first.refreshToken, CTX);
    expect(refreshed.permissions).toEqual([]);
    expect(refreshed.roles).toEqual([]);
  });
});

describe('permission resolution', () => {
  it('scopes permissions to the school they were granted in', async () => {
    const id = await makeUser('scoped@test', await hashPassword(PASSWORD));
    await grant(id, nourId, 'super_admin');

    const atNour = await permissions.forUserInSchool(id, nourId);
    const atRissala = await permissions.forUserInSchool(id, rissalaId);

    expect(atNour.has('finance.encaisser')).toBe(true);
    expect(atRissala.size).toBe(0);
  });
});

/**
 * MODIFIER MON NOM — `modifier_profil.php`, `changer_nom`.
 *
 * ⚠ NOBODY COULD CORRECT THEIR OWN NAME. `modifier_profil.php` offers three
 * things — nom, identifiant, mot de passe — and ours offered one. A name typed
 * wrong when the account was created was on every receipt that person recorded,
 * every audit line, and the bulletin footer, for ever.
 *
 * ⚠ AND IT IS NOT A PERMISSION QUESTION. This is your own row; the guard is
 * that it acts on the token's user id and takes no id from the caller.
 */
describe('modifier mon nom', () => {
  let selfId: string;

  beforeAll(async () => {
    const u = await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('nom.propre@test', 'x', 'Mal Ecrit') RETURNING id`,
    );
    selfId = u.rows[0]!.id;
  });

  it('changes it, trimmed', async () => {
    await auth.changeOwnName(selfId, '  Mohamed  ', ' Ould Ahmed ', null, '127.0.0.1');
    const { rows } = await owner.query<{ full_name: string }>(
      'SELECT full_name FROM users WHERE id = $1',
      [selfId],
    );
    expect(rows[0]!.full_name).toBe('Mohamed Ould Ahmed');
  });

  it('⚠ refuses an empty name', async () => {
    // A blank name is not a correction; it makes every receipt that person
    // recorded read as having been recorded by nobody.
    for (const bad of ['', '   ']) {
      await expect(auth.changeOwnName(selfId, bad, 'Nom', null, '127.0.0.1')).rejects.toThrow(
        /obligatoire/i,
      );
    }
  });

  it('⚠ refuses one longer than the column, its own limit', async () => {
    await expect(
      auth.changeOwnName(selfId, 'x'.repeat(101), 'Nom', null, '127.0.0.1'),
    ).rejects.toThrow(/100/);
  });
});
