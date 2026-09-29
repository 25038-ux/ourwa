import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from '../src/cors.js';

/**
 * ⚠ CORS WAS `origin: (origin, cb) => cb(null, true)` WITH `credentials: true`.
 *
 * Every origin on the internet accepted, with cookies. Any page a signed-in
 * member of staff opened could read that school's students, debts and payroll
 * from their browser. Listed as F1 in the migration blueprint and confirmed in
 * `main.ts`.
 */
const PROD = { suffix: 'elourwa.com', dev: false };
const DEV = { suffix: undefined, dev: true };

describe('who may call this API', () => {
  it('⚠ refuses an arbitrary origin in production — the case that was open', () => {
    expect(isAllowedOrigin('https://evil.example.com', PROD)).toBe(false);
    expect(isAllowedOrigin('http://attacker.test', PROD)).toBe(false);
  });

  it('accepts the configured domain and every branch subdomain', () => {
    expect(isAllowedOrigin('https://elourwa.com', PROD)).toBe(true);
    expect(isAllowedOrigin('https://nour.elourwa.com', PROD)).toBe(true);
    expect(isAllowedOrigin('https://rissala.elourwa.com', PROD)).toBe(true);
  });

  it('⚠ a lookalike domain is NOT a subdomain', () => {
    // `endsWith('elourwa.com')` without the dot accepts this, and anybody can
    // register it.
    expect(isAllowedOrigin('https://evil-elourwa.com', PROD)).toBe(false);
    expect(isAllowedOrigin('https://notelourwa.com', PROD)).toBe(false);
  });

  it('⚠ refuses plain http in production, even on the right domain', () => {
    expect(isAllowedOrigin('http://nour.elourwa.com', PROD)).toBe(false);
  });

  it('allows the *.localhost branches in development only', () => {
    expect(isAllowedOrigin('http://nour.localhost:3000', DEV)).toBe(true);
    expect(isAllowedOrigin('http://localhost:3000', DEV)).toBe(true);
    // The same origin is refused once NODE_ENV is production.
    expect(isAllowedOrigin('http://nour.localhost:3000', PROD)).toBe(false);
  });

  it('⚠ allows a request with no Origin at all — that is the mobile app', () => {
    // No browser, no cookie to ride. The Flutter app and server-to-server calls
    // arrive this way, and refusing them would break the parent app entirely.
    expect(isAllowedOrigin(undefined, PROD)).toBe(true);
  });

  it('refuses an unparseable origin rather than guessing', () => {
    expect(isAllowedOrigin('not a url', PROD)).toBe(false);
    expect(isAllowedOrigin('://', PROD)).toBe(false);
  });

  it('⚠ refuses everything when no suffix is configured in production', () => {
    // Fails closed. A missing environment variable must not reopen the door.
    expect(isAllowedOrigin('https://nour.elourwa.com', { suffix: undefined, dev: false })).toBe(false);
    expect(isAllowedOrigin('https://elourwa.com', { suffix: '', dev: false })).toBe(false);
  });
});
