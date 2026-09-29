import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * CREATING A SUPER ADMINISTRATEUR.
 *
 * El Ourwa's `creer_utilisateur.php` asks a second question once "Administrateur"
 * is chosen — its `champ-palier`:
 *
 *   restreint → Administrateur — accès complet SAUF la finance
 *   complet   → Super Administrateur — accès TOTAL (finance incluse)
 *
 * Our form could only ever make the first. `super_admin` existed in the database
 * and nothing in the interface could create one.
 *
 * ⚠ BUT THIS IS A PRIVILEGE-ESCALATION SURFACE AND THE TEST COMES FIRST. An
 * `admin` deliberately CANNOT see finance. If an admin can create a super_admin,
 * they can create one, sign in as it, and see finance — the restriction becomes
 * a suggestion. Only somebody who already holds the tier may hand it out.
 */

let owner: pg.Pool;
let accounts: AccountsService;

let schoolId: string;
let superAdminId: string;
let adminId: string;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'priv' }, fn);
}

/** A user holding one role in this school. */
async function userWithRole(tag: string, code: string): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ($1, 'x', $2) RETURNING id`,
    [`priv.${tag}@test`, `User ${tag}`],
  );
  const userId = rows[0]!.id;
  await owner.query(
    `INSERT INTO user_school_roles (school_id, user_id, role_id)
     SELECT $1, $2, r.id FROM roles r WHERE r.code = $3`,
    [schoolId, userId, code],
  );
  return userId;
}

async function rolesOf(userId: string): Promise<string[]> {
  const { rows } = await owner.query<{ code: string }>(
    `SELECT r.code FROM user_school_roles usr
       JOIN roles r ON r.id = usr.role_id
      WHERE usr.user_id = $1 AND usr.school_id = $2
      ORDER BY r.code`,
    [userId, schoolId],
  );
  return rows.map((r) => r.code);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('priv', 'Privileges', 'PRV')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  // The role catalogue, idempotently: several specs seed it and the suite order
  // is not fixed, so ON CONFLICT is what keeps them from tripping over each
  // other.
  await owner.query(
    `INSERT INTO roles (code, label, is_system, sort_order) VALUES
       ('super_admin', 'Super administrateur', true, 1),
       ('admin', 'Administrateur', true, 2),
       ('comptable', 'Comptable', true, 10),
       ('secretaire', 'Secrétaire', true, 11)
     ON CONFLICT (code) DO NOTHING`,
  );

  superAdminId = await userWithRole('super', 'super_admin');
  adminId = await userWithRole('admin', 'admin');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  accounts = moduleRef.get(AccountsService);
});

afterAll(async () => {
  await owner?.end();
});

describe('a super administrateur may create another', () => {
  it('creates the account with the super_admin role', async () => {
    const created = await inTenant(() =>
      accounts.create(
        {
          role: 'super_admin',
          firstName: 'Nouveau',
          lastName: 'Directeur',
          email: 'priv.new-super@test',
        },
        superAdminId,
      ),
    );

    expect(await rolesOf(created.userId)).toContain('super_admin');
  });
});

describe('⚠ an administrateur may NOT', () => {
  it('refuses to let an admin create a super_admin', async () => {
    // The whole point of the `restreint` tier is that it cannot reach finance.
    // If an admin can mint a super_admin, they can sign in as it and reach
    // finance — and the tier stops meaning anything.
    await expect(
      inTenant(() =>
        accounts.create(
          {
            role: 'super_admin',
            firstName: 'Tentative',
            lastName: 'Escalade',
            email: 'priv.escalade@test',
          },
          adminId,
        ),
      ),
    ).rejects.toThrow(/super administrateur|réservé/i);
  });

  it('still lets an admin create an ordinary administrateur', async () => {
    // The refusal is about the TIER, not about creating accounts at all.
    const created = await inTenant(() =>
      accounts.create(
        {
          role: 'admin',
          firstName: 'Ordinaire',
          lastName: 'Admin',
          email: 'priv.ordinary@test',
        },
        adminId,
      ),
    );
    expect(await rolesOf(created.userId)).toEqual(['admin']);
  });

  it('⚠ cannot smuggle it in as an extra role either', async () => {
    // The main role is checked; the stacked ones must be too, or the guard is
    // one field wide.
    await expect(
      inTenant(() =>
        accounts.create(
          {
            role: 'secretaire',
            firstName: 'Par',
            lastName: 'Cumul',
            email: 'priv.stacked@test',
            extraRoles: ['super_admin'] as never,
          },
          adminId,
        ),
      ),
    ).rejects.toThrow();
  });
});
