import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { sessionsServiceForPool, type SessionsService } from '../src/auth/sessions.service.js';
import { hashRefreshToken } from '../src/auth/tokens.js';

/**
 * Refresh-token rotation and reuse detection — a Phase 1 exit criterion.
 *
 * Runs against a real database: reuse detection depends on a unique constraint
 * and on state that survives between calls, neither of which a mock has.
 */

let pool: pg.Pool;
let sessions: SessionsService;
let userId: string;
let schoolId: string;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  sessions = sessionsServiceForPool(pool);

  const school = await pool.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('sess', 'Sessions', 'SES')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('sessions@test', 'x', 'Session User') RETURNING id`,
  );
  userId = user.rows[0]!.id;
});

afterAll(async () => {
  await pool?.end();
});

describe('refresh token rotation', () => {
  it('issues a token that is stored only as a hash', async () => {
    const issued = await sessions.issue(userId, schoolId);
    const { rows } = await pool.query(
      'SELECT token_hash FROM refresh_tokens WHERE token_hash = $1',
      [hashRefreshToken(issued.refreshToken)],
    );
    expect(rows).toHaveLength(1);

    // The token itself must appear nowhere in the table.
    const raw = await pool.query('SELECT 1 FROM refresh_tokens WHERE token_hash = $1', [
      issued.refreshToken,
    ]);
    expect(raw.rows).toHaveLength(0);
  });

  it('rotates: a new token is issued in the same family', async () => {
    const first = await sessions.issue(userId, schoolId);
    const second = await sessions.rotate(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.familyId).toBe(first.familyId);
    expect(second.userId).toBe(userId);
    expect(second.schoolId).toBe(schoolId);
  });

  it('lets the new token rotate again', async () => {
    const a = await sessions.issue(userId, schoolId);
    const b = await sessions.rotate(a.refreshToken);
    const c = await sessions.rotate(b.refreshToken);
    expect(c.familyId).toBe(a.familyId);
  });

  it('⚠ REUSE: presenting an already-rotated token revokes the WHOLE family', async () => {
    const first = await sessions.issue(userId, schoolId);
    const second = await sessions.rotate(first.refreshToken);

    // The thief presents the stolen, already-rotated token.
    await expect(sessions.rotate(first.refreshToken)).rejects.toThrow(/réutilisée/i);

    // The legitimate holder's newer token must now be dead too. Revoking only
    // the presented one would leave the thief's copy live.
    await expect(sessions.rotate(second.refreshToken)).rejects.toThrow(/(révoquée|révoquées)/i);

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM refresh_tokens
        WHERE family_id = $1 AND revoked_at IS NULL`,
      [first.familyId],
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('records why a family was revoked', async () => {
    const first = await sessions.issue(userId, schoolId);
    await sessions.rotate(first.refreshToken);
    await expect(sessions.rotate(first.refreshToken)).rejects.toThrow();

    const { rows } = await pool.query<{ revoked_reason: string }>(
      'SELECT DISTINCT revoked_reason FROM refresh_tokens WHERE family_id = $1',
      [first.familyId],
    );
    expect(rows[0]!.revoked_reason).toBe('refresh_token_reuse_detected');
  });

  it('does not touch other families when one is revoked', async () => {
    const compromised = await sessions.issue(userId, schoolId);
    const otherDevice = await sessions.issue(userId, schoolId);

    await sessions.rotate(compromised.refreshToken);
    await expect(sessions.rotate(compromised.refreshToken)).rejects.toThrow();

    // A theft on one device must not log the user out of every other device.
    const stillGood = await sessions.rotate(otherDevice.refreshToken);
    expect(stillGood.familyId).toBe(otherDevice.familyId);
  });

  it('rejects an unknown token', async () => {
    await expect(sessions.rotate('not-a-real-token')).rejects.toThrow(/invalid/i);
  });

  it('rejects an expired token', async () => {
    const issued = await sessions.issue(userId, schoolId);
    await pool.query(
      `UPDATE refresh_tokens SET expires_at = now() - interval '1 day' WHERE token_hash = $1`,
      [hashRefreshToken(issued.refreshToken)],
    );
    await expect(sessions.rotate(issued.refreshToken)).rejects.toThrow(/expirée/i);
  });

  it('rejects a token after explicit logout', async () => {
    const issued = await sessions.issue(userId, schoolId);
    await sessions.revokeOne(issued.refreshToken);
    await expect(sessions.rotate(issued.refreshToken)).rejects.toThrow(/(révoquée|révoquées)/i);
  });

  it('logout-everywhere kills every live session for the user', async () => {
    await sessions.issue(userId, schoolId);
    await sessions.issue(userId, schoolId);
    const revoked = await sessions.revokeAllForUser(userId);
    expect(revoked).toBeGreaterThan(0);

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM refresh_tokens
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });
});
