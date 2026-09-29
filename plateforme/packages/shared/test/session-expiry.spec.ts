import { describe, expect, it } from 'vitest';
import { accessTokenExpiry, needsRefresh, REFRESH_MARGIN_SECONDS } from '../src/session-expiry.js';

/**
 * QUAND FAUT-IL RENOUVELER LE JETON D'ACCÈS ?
 *
 * ⚠ THE WEB APP NEVER RENEWED IT AT ALL. The access token lives 15 minutes, the
 * refresh token is written into a cookie at login and kept for 90 days — and
 * nothing in the application ever redeemed it. So every director, secretary and
 * accountant was thrown back to the login page a quarter of an hour into their
 * work, mid-form, with whatever they had typed gone.
 *
 * ⚠ AND REFRESHING IS NOT FREE. Refresh tokens ROTATE, and presenting an old one
 * revokes the whole family — that is the reuse-detection which exists so a
 * stolen token cannot be replayed. Renewing on every request would therefore
 * turn two parallel page loads into a security incident that logs the user out
 * of everything. So the decision has to be a decision: only when the token is
 * actually near its end.
 *
 * Written before the code, because this is what stands between an office and
 * being locked out of the till.
 */

/** A JWT with the given `exp`, unsigned — only the payload is ever read here. */
function tokenWith(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'ES256' })}.${b64(payload)}.signature`;
}

describe('reading the expiry out of an access token', () => {
  it('reads `exp` as seconds', () => {
    expect(accessTokenExpiry(tokenWith({ sub: 'u', exp: 1_800_000_000 }))).toBe(1_800_000_000);
  });

  it('returns null for anything that is not a readable JWT', () => {
    // ⚠ NULL MEANS "I DO NOT KNOW", and the caller must not read it as "fresh".
    // A malformed cookie that looked fresh would never be renewed and the
    // session would die at fifteen minutes exactly as before.
    for (const bad of ['', 'not-a-token', 'a.b', 'a.b.c', tokenWith({ sub: 'u' })]) {
      expect(accessTokenExpiry(bad)).toBeNull();
    }
  });

  it('does not verify the signature, and must not be trusted as proof', () => {
    // The API verifies. This only decides WHEN to ask for a new token; a forged
    // `exp` can make us refresh early or late, and neither grants anything.
    const forged = tokenWith({ sub: 'someone-else', exp: 9_999_999_999 });
    expect(accessTokenExpiry(forged)).toBe(9_999_999_999);
  });
});

describe('deciding to refresh', () => {
  const NOW = 1_800_000_000;

  it('leaves a token with plenty of life alone', () => {
    // ⚠ Refreshing early is not harmless: rotation means every renewal
    // invalidates the previous refresh token, and two page loads racing on the
    // same one revoke the family.
    expect(needsRefresh(tokenWith({ exp: NOW + 600 }), NOW)).toBe(false);
  });

  it('renews inside the margin, BEFORE the token is dead', () => {
    // Waiting for expiry means the request that discovers it has already failed.
    expect(needsRefresh(tokenWith({ exp: NOW + REFRESH_MARGIN_SECONDS - 1 }), NOW)).toBe(true);
  });

  it('renews an already-expired token', () => {
    expect(needsRefresh(tokenWith({ exp: NOW - 1 }), NOW)).toBe(true);
  });

  it('renews when the token cannot be read at all', () => {
    // Unreadable is not fresh. Treating it as fresh is how a corrupted cookie
    // becomes a login page nobody can get past.
    expect(needsRefresh('rubbish', NOW)).toBe(true);
  });

  it('renews when there is no token', () => {
    expect(needsRefresh(undefined, NOW)).toBe(true);
    expect(needsRefresh('', NOW)).toBe(true);
  });

  it('⚠ the margin is shorter than the token’s own life', () => {
    // If the margin ever reached 15 minutes, every single request would qualify
    // and every request would rotate — the security feature turned into a
    // denial of service against the office.
    expect(REFRESH_MARGIN_SECONDS).toBeLessThan(900);
    expect(REFRESH_MARGIN_SECONDS).toBeGreaterThan(0);
  });
});
