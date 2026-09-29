/**
 * QUI PEUT APPELER CETTE API — the allowed origins.
 *
 * ⚠ IT WAS `origin: (origin, cb) => cb(null, true)` — EVERY origin accepted,
 * WITH `credentials: true`. Any page on the internet could make authenticated
 * requests against this API using a signed-in staff member's browser: open a
 * tab, and that tab can read a school's students, its debts and its payroll.
 *
 * The comment excused it as a development convenience — every `*.localhost`
 * subdomain is a school, so the origin varies per branch. That part is true and
 * is why this is a predicate rather than a fixed list. What was wrong is that
 * the predicate said yes to everything, in production as well.
 *
 * Three rules, in order:
 *
 *   1. No origin at all — a server-to-server call, curl, or a mobile app. There
 *      is no browser to protect and no cookie to ride, so it passes. The
 *      Flutter app arrives this way.
 *   2. Development: any `*.localhost` on any port, and nothing else.
 *   3. Production: the configured domain and its subdomains, from
 *      `ALLOWED_ORIGIN_SUFFIX`. Each branch is a subdomain, so one suffix
 *      covers every school without listing them.
 *
 * Anything else is refused, and refusing is a real refusal: the browser gets no
 * `Access-Control-Allow-Origin` header and drops the response.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  env: { suffix?: string; dev: boolean },
): boolean {
  // (1) Not a browser. Nothing to protect against here — the request carries
  // whatever credentials it was given deliberately, not ones a page borrowed.
  if (!origin) return true;

  let host: string;
  let protocol: string;
  try {
    const url = new URL(origin);
    host = url.hostname;
    protocol = url.protocol;
  } catch {
    // An origin that will not parse is not one we can vouch for.
    return false;
  }

  // (2) Development: the *.localhost branches, and localhost itself.
  if (env.dev && (host === 'localhost' || host.endsWith('.localhost'))) {
    return true;
  }

  // (3) Production: the configured domain and its subdomains, https only.
  //
  // ⚠ The dot matters. Testing `host.endsWith('elourwa.com')` would also accept
  // `evil-elourwa.com`, which somebody can register.
  const suffix = env.suffix?.trim();
  if (!suffix) return false;
  if (protocol !== 'https:') return false;

  return host === suffix || host.endsWith(`.${suffix}`);
}

/** Read the policy from the environment once, at boot. */
export function corsEnv(): { suffix?: string; dev: boolean } {
  return {
    suffix: process.env.ALLOWED_ORIGIN_SUFFIX,
    dev: process.env.NODE_ENV !== 'production',
  };
}
