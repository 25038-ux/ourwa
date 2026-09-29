import { describe, expect, it } from 'vitest';
import { Throttle, IP_PER_MINUTE, USER_PER_MINUTE } from '../src/throttle.js';

/**
 * ⚠ THE ONLY RATE LIMITING WAS THE LOGIN LOCKOUT — five failed sign-ins per
 * account. Everything else ran unthrottled: enumerating students, hammering the
 * search, walking the family list one id at a time. Listed as F15.
 */
describe('the request ceiling', () => {
  it('lets a normal burst through', () => {
    const t = new Throttle();
    for (let i = 0; i < IP_PER_MINUTE; i++) {
      expect(t.take('1.2.3.4', IP_PER_MINUTE, 1_000)).toBe(true);
    }
  });

  it('⚠ refuses the request after the limit, in the same window', () => {
    const t = new Throttle();
    for (let i = 0; i < IP_PER_MINUTE; i++) t.take('1.2.3.4', IP_PER_MINUTE, 1_000);
    expect(t.take('1.2.3.4', IP_PER_MINUTE, 1_000)).toBe(false);
  });

  it('opens again in the next window', () => {
    const t = new Throttle();
    for (let i = 0; i <= IP_PER_MINUTE; i++) t.take('1.2.3.4', IP_PER_MINUTE, 1_000);
    expect(t.take('1.2.3.4', IP_PER_MINUTE, 1_000)).toBe(false);
    // A minute later.
    expect(t.take('1.2.3.4', IP_PER_MINUTE, 62_000)).toBe(true);
  });

  it('⚠ one caller being throttled does not throttle another', () => {
    const t = new Throttle();
    for (let i = 0; i <= IP_PER_MINUTE; i++) t.take('flood', IP_PER_MINUTE, 1_000);
    expect(t.take('flood', IP_PER_MINUTE, 1_000)).toBe(false);
    expect(t.take('the-school', IP_PER_MINUTE, 1_000)).toBe(true);
  });

  it('a signed-in session gets the higher ceiling', () => {
    // A page legitimately fans out to a dozen endpoints, and three people share
    // one office connection.
    expect(USER_PER_MINUTE).toBeGreaterThan(IP_PER_MINUTE);
    const t = new Throttle();
    for (let i = 0; i < IP_PER_MINUTE + 1; i++) {
      expect(t.take('user:abc', USER_PER_MINUTE, 1_000)).toBe(true);
    }
  });

  it('says when to come back', () => {
    const t = new Throttle();
    t.take('1.2.3.4', 1, 1_000);
    expect(t.take('1.2.3.4', 1, 1_000)).toBe(false);
    const wait = t.retryAfter('1.2.3.4', 1_000);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);
  });

  it('⚠ does not leak memory on the very traffic it defends against', () => {
    // The map is keyed on attacker-supplied IPs, so a flood is exactly what
    // fills it. Expired buckets have to be dropped.
    const t = new Throttle();
    for (let i = 0; i < 500; i++) t.take(`ip-${i}`, IP_PER_MINUTE, 1_000);
    expect(t.size).toBe(500);
    // One request in a later window sweeps the expired ones.
    t.take('later', IP_PER_MINUTE, 130_000);
    expect(t.size).toBe(1);
  });
});
