/**
 * QUAND RENOUVELER LE JETON D'ACCÈS.
 *
 * ⚠ THE WEB APP NEVER RENEWED IT. The access token lives 15 minutes; the refresh
 * token is written into a cookie at login and kept for 90 days — and nothing in
 * the application ever redeemed it. `/auth/refresh` existed, with rotation and
 * reuse-detection, and no caller. So every director, secretary and accountant
 * was returned to the login page a quarter of an hour into their work, mid-form,
 * with whatever they had typed gone.
 *
 * ⚠ AND RENEWING IS NOT FREE. Refresh tokens ROTATE: presenting an old one
 * revokes the whole family, which is exactly the protection that makes a stolen
 * token useless. Renewing on every request would turn two parallel page loads
 * into a revocation and log the user out of everything. So the caller asks this
 * first, and only renews when the answer is yes.
 *
 * Shared, not web-only: the Flutter parent app has the same problem and needs
 * the same answer — a parent who opens the app should stay signed in.
 */

/**
 * How long before expiry to renew.
 *
 * Two minutes: long enough that a page which takes a while to render still has a
 * live token when its last query goes out, short enough that a fifteen-minute
 * token is renewed roughly once per fifteen minutes rather than constantly.
 */
export const REFRESH_MARGIN_SECONDS = 120;

/**
 * The `exp` claim of a JWT, in seconds, or null when it cannot be read.
 *
 * ⚠ THE SIGNATURE IS NOT VERIFIED AND THIS IS NOT PROOF OF ANYTHING. It decides
 * WHEN to ask for a new token, nothing more: the API verifies for real on every
 * request. A forged `exp` can only make us renew early or late, and neither
 * grants access to anything.
 */
export function accessTokenExpiry(token: string | undefined | null): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    /**
     * ⚠ `atob`, NOT `Buffer`. The only caller is the web app's middleware, which
     * runs on the Edge runtime — and this package is bundled for the browser
     * besides. Node's `Buffer` is not part of either contract, and reaching for
     * it here also broke `pnpm -r typecheck`, since `@elourwa/shared` carries no
     * Node types and should not need any.
     *
     * base64url is base64 with two characters swapped and the padding dropped;
     * `atob` wants base64. And `atob` yields a BINARY string, so a payload
     * carrying a name with an accent has to be put back through UTF-8 rather
     * than read byte for byte.
     */
    const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
    const json = new TextDecoder().decode(
      Uint8Array.from(binary, (c) => c.charCodeAt(0)),
    );
    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      ? payload.exp
      : null;
  } catch {
    return null;
  }
}

/**
 * True when the token should be renewed now.
 *
 * ⚠ UNREADABLE IS NOT FRESH. A missing or corrupted cookie answers true, so it
 * is replaced rather than carried until it fails — treating it as fresh is how
 * one bad cookie becomes a login page the user cannot get past.
 */
export function needsRefresh(
  token: string | undefined | null,
  nowSeconds: number,
): boolean {
  const exp = accessTokenExpiry(token);
  if (exp === null) return true;
  return exp - nowSeconds <= REFRESH_MARGIN_SECONDS;
}
