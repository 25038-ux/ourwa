import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';
import { hashPassword } from '../src/auth/passwords.js';

/**
 * "VOUS DEVEZ CHANGER VOTRE MOT DE PASSE AVANT DE CONTINUER."
 *
 * ⚠ THE COLUMN EXISTED, THE LOGIN RESPONSE CARRIED IT, AND NOTHING ANYWHERE
 * ACTED ON IT. `must_change_password` was written true by every account
 * creation, returned to both apps, and read by neither — so a temporary
 * password handed out at the counter stayed valid for ever.
 *
 * El Ourwa stops the parent at the door: signing in with `doit_changer_mdp`
 * lands on the password screen and no other page will open. Found by logging in
 * to the local restore, where it did exactly that to me.
 *
 * The flag must clear when — and only when — the password actually changes.
 */

let owner: pg.Pool;
let auth: AuthService;
let schoolId: string;
let userId: string;

const EMAIL = 'mcp.user@test';
const FIRST = 'Temporaire1';
const CHOSEN = 'Rentree2026';

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'mcp' }, fn);
}

async function flag(): Promise<boolean> {
  const { rows } = await owner.query<{ must_change_password: boolean }>(
    'SELECT must_change_password FROM users WHERE id = $1',
    [userId],
  );
  return rows[0]!.must_change_password;
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('mcp', 'MustChange', 'MCP')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const user = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name, must_change_password)
     VALUES ($1, $2, 'Compte neuf', true) RETURNING id`,
    [EMAIL, await hashPassword(FIRST)],
  );
  userId = user.rows[0]!.id;

  await owner.query(
    `INSERT INTO roles (code, label, is_system, sort_order)
     VALUES ('secretaire', 'Secrétaire', true, 11) ON CONFLICT (code) DO NOTHING`,
  );
  await owner.query(
    `INSERT INTO user_school_roles (school_id, user_id, role_id)
     SELECT $1, $2, r.id FROM roles r WHERE r.code = 'secretaire'`,
    [schoolId, userId],
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  auth = moduleRef.get(AuthService);
});

afterAll(async () => {
  await owner?.end();
});

describe('a temporary password', () => {
  it('⚠ signs in, but the response SAYS it must be changed', async () => {
    const result = await inTenant(() =>
      auth.login(EMAIL, FIRST, 'mcp', { ip: '127.0.0.1', userAgent: 'test' }),
    );
    // Signing in has to work — the change screen is reached through a session,
    // not around one.
    expect(result.accessToken).toBeTruthy();
    expect(result.user.mustChangePassword).toBe(true);
  });

  it('is still flagged after signing in — logging in is not changing it', async () => {
    expect(await flag()).toBe(true);
  });
});

describe('changing it', () => {
  it('⚠ refuses a new password that fails the policy', async () => {
    // The forced change must not be satisfiable with "aaaaaaaa": the whole
    // point is to replace a weak issued password with a real one.
    await expect(
      inTenant(() => auth.changeOwnPassword(userId, FIRST, 'aaaaaaaa', 'aaaaaaaa', '127.0.0.1')),
    ).rejects.toThrow(/3 types de caractères|caractères/);
    expect(await flag()).toBe(true);
  });

  it('refuses when the current password is wrong', async () => {
    await expect(
      inTenant(() => auth.changeOwnPassword(userId, 'pas-le-bon', CHOSEN, CHOSEN, '127.0.0.1')),
    ).rejects.toThrow();
    expect(await flag()).toBe(true);
  });

  it('⚠ clears the flag when the password really changes', async () => {
    await inTenant(() => auth.changeOwnPassword(userId, FIRST, CHOSEN, CHOSEN, '127.0.0.1'));
    expect(await flag()).toBe(false);
  });

  it('and the new password is the one that works', async () => {
    const result = await inTenant(() =>
      auth.login(EMAIL, CHOSEN, 'mcp', { ip: '127.0.0.1', userAgent: 'test' }),
    );
    expect(result.user.mustChangePassword).toBe(false);

    await expect(
      inTenant(() =>
        auth.login(EMAIL, FIRST, 'mcp', { ip: '127.0.0.1', userAgent: 'test' }),
      ),
    ).rejects.toThrow();
  });
});
