/**
 * LA LIMITE DE DÉBIT — a global per-IP request ceiling.
 *
 * ⚠ THE ONLY RATE LIMITING THIS API HAD WAS THE LOGIN LOCKOUT. `RateLimitService`
 * counts failed sign-ins per account and per IP and locks after five in fifteen
 * minutes, which is the right shape for password guessing and no help at all
 * against anything else: enumerating students, hammering the search, or walking
 * the family list one id at a time all ran unthrottled.
 *
 * ⚠ WRITTEN RATHER THAN INSTALLED, DELIBERATELY. `@fastify/rate-limit` is the
 * obvious answer and it is a real dependency to download, audit and keep — for
 * a single-instance deployment serving one school in Nouakchott, a token bucket
 * in memory does the same job in forty lines. If this ever runs behind more than
 * one process the counter stops being shared and the plugin (backed by Redis)
 * becomes the right call; that is written down here so the decision is visible
 * when it changes rather than rediscovered.
 *
 * Two ceilings, because they protect different things:
 *
 *   per IP   — 300 requests/minute. One office behind one connection makes a
 *              few dozen; a script makes thousands.
 *   per user — 600 requests/minute. Higher, because a signed-in session
 *              legitimately fans out: a page can make a dozen calls, and three
 *              people share an IP in the same office.
 */
export interface Bucket {
  tokens: number;
  resetAt: number;
}

export const IP_PER_MINUTE = 300;
export const USER_PER_MINUTE = 600;
const WINDOW_MS = 60_000;

/**
 * A fixed-window counter.
 *
 * Not a sliding window: at this ceiling the difference is a burst at a minute
 * boundary, which an office cannot produce and a script does not need. Simpler
 * is easier to reason about when it starts refusing real requests.
 */
export class Throttle {
  private readonly buckets = new Map<string, Bucket>();
  /**
   * ⚠ ZERO, NOT `Date.now()`.
   *
   * Seeding this from the wall clock ties the sweep to when the object happened
   * to be constructed: the first call compares an injected or monotonic `now`
   * against a real timestamp, the difference goes negative, and the sweep never
   * runs — the leak this exists to prevent. Zero means the first call always
   * sweeps (an empty map, so it costs nothing) and sets the baseline itself.
   *
   * A test with a fixed clock found this.
   */
  private lastSweep = 0;

  /** Returns true when the request may proceed. */
  take(key: string, limit: number, now = Date.now()): boolean {
    this.sweep(now);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { tokens: limit - 1, resetAt: now + WINDOW_MS });
      return true;
    }
    if (bucket.tokens <= 0) return false;
    bucket.tokens -= 1;
    return true;
  }

  /** When the caller may try again, in seconds. */
  retryAfter(key: string, now = Date.now()): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return 0;
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  }

  /**
   * Drop expired buckets.
   *
   * ⚠ Without this the map is a memory leak keyed on attacker-supplied IPs —
   * the thing being defended against is exactly what fills it. Swept at most
   * once a minute so a flood does not also pay for the cleanup.
   */
  private sweep(now: number): void {
    if (now - this.lastSweep < WINDOW_MS) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  /** For tests and for a health endpoint that wants to say how big it has got. */
  get size(): number {
    return this.buckets.size;
  }
}
