import { NextResponse, type NextRequest } from 'next/server';
import { needsRefresh } from '@elourwa/shared/session-expiry';
import { clientIdentityHeaders } from '@/lib/client-identity';
import { COOKIE_PREFIX, cookieName, slugFromHost } from '@/lib/brand';

/**
 * Carry the path — and the year being viewed — into the request headers.
 *
 * A server component cannot read its own path, and the sidebar needs it to mark
 * the active link — which is what El Ourwa does with `$_SERVER['SCRIPT_NAME']`.
 *
 * ⚠ AND THE YEAR SELECTOR IN THE HEADER DID NOTHING AT ALL. It writes
 * `?annee_id=` on every page, and NOT ONE PAGE READ IT — not even the header
 * itself, which always drew the active year as selected. So the control existed,
 * moved the URL, and changed nothing: an operator could pick 2024-2025, watch
 * the page reload unchanged, and read this year's arrears believing they were
 * last year's.
 *
 * That is precisely the failure El Ourwa's own comment on this control records
 * — "L'en-tête affichait 2026-2027 pendant que le profil de la famille restait
 * sur 2025-2026, et cliquer sur l'en-tête ne pouvait rien y changer."
 *
 * ⚠ IT IS FORWARDED AS A HEADER RATHER THAN THREADED THROUGH THIRTY PAGES.
 * `searchParams` reaches a page but not the layout, and the selector lives in
 * the layout's header — so the header could never show what was chosen. One
 * header, set once, readable by any server component: `anneeConsultee()`.
 *
 * ⚠ NOT VALIDATED HERE, AND DELIBERATELY. This is a query parameter — attacker
 * controlled — and the Edge runtime has no database. It is passed on as an
 * opaque string; the API resolves it against `academic_years` for THIS tenant
 * and a year belonging to another school comes back as not found. Filtering on
 * shape in middleware would only give a false sense that it had been checked.
 */
export async function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-pathname', request.nextUrl.pathname);

  const annee = request.nextUrl.searchParams.get('annee_id');
  if (annee) headers.set('x-annee-id', annee);
  else headers.delete('x-annee-id');

  const renewed = await renewSession(request, headers);

  const response = NextResponse.next({ request: { headers } });
  applyRenewal(response, request, renewed);
  applySecurityHeaders(response, request);
  return response;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Renewal =
  | { kind: 'none' }
  | { kind: 'renewed'; slug: string | null; access: string; refresh: string }
  | { kind: 'dead'; slug: string | null };

/**
 * RENOUVELER LA SESSION — the thing nothing in the application ever did.
 *
 * ⚠ THE REFRESH TOKEN WAS WRITTEN AT LOGIN AND NEVER REDEEMED. `/auth/refresh`
 * exists on the API, complete with rotation and reuse-detection, and had no
 * caller anywhere in the web app. The access token lives fifteen minutes. So
 * every director, secretary and accountant was returned to the login screen a
 * quarter of an hour into their work — mid-form, mid-collection, with whatever
 * they had typed gone. The 90-day cookie sat there unused the whole time.
 *
 * ⚠ IT HAS TO HAPPEN IN MIDDLEWARE, and that is not a preference. A Server
 * Component cannot set a cookie in the App Router — `cookies().set()` throws
 * outside an action or a route handler — so the natural place, `apiFetch`'s 401
 * path, cannot store the rotated token. Middleware can, and it runs before the
 * page, so the page renders with the new token rather than after a round trip.
 *
 * ⚠ PREFETCHES ARE SKIPPED, AND THIS IS THE SECURITY POINT. Refresh tokens
 * rotate: presenting a spent one revokes the entire family, which is precisely
 * what makes a stolen token useless. Next speculatively prefetches links, so
 * refreshing on those would put two requests on the same token and revoke the
 * user out of every session they have. Prefetches are speculative and may fail
 * harmlessly; real navigations and server actions are what get renewed.
 *
 * ⚠ AND A NETWORK ERROR IS NOT A DEAD SESSION. Only a 4xx from the API — the
 * token really is spent or revoked — clears the cookies. An API that is briefly
 * down must not log the whole school out.
 */
async function renewSession(request: NextRequest, headers: Headers): Promise<Renewal> {
  // Speculative navigation: never spend a rotation on it.
  if (request.headers.get('next-router-prefetch') === '1') return { kind: 'none' };
  if (request.headers.get('purpose') === 'prefetch') return { kind: 'none' };

  const slug = slugFromHost(
    request.headers.get('x-forwarded-host') ?? request.headers.get('host'),
  );
  const access = request.cookies.get(cookieName(slug, 'access'))?.value;
  const refresh = request.cookies.get(cookieName(slug, 'refresh'))?.value;

  // Nothing to renew with. A visitor with no session is not an error.
  if (!refresh) return { kind: 'none' };
  if (!needsRefresh(access, Math.floor(Date.now() / 1000))) return { kind: 'none' };

  let response: Response;
  try {
    response = await fetch(`${API}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(slug ? { 'X-School-Slug': slug } : {}),
        // La même identité qu'à la connexion, sinon l'empreinte de session
        // ne correspond plus et la famille de jetons est révoquée.
        ...clientIdentityHeaders(request.headers),
      },
      body: JSON.stringify({ refreshToken: refresh }),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // The API is unreachable. Leave the cookies alone: the page will fail on
    // its own terms, and the session survives a restart of the API.
    return { kind: 'none' };
  }

  if (!response.ok) {
    // Spent, revoked, or the family was invalidated by a reuse. Clearing the
    // cookies sends the user to the login page once instead of looping through
    // a session that can never work again.
    return response.status >= 400 && response.status < 500
      ? { kind: 'dead', slug }
      : { kind: 'none' };
  }

  const body = (await response.json()) as { accessToken?: string; refreshToken?: string };
  if (!body.accessToken || !body.refreshToken) return { kind: 'none' };

  // ⚠ Put the new token on THIS request too, or the page that follows renders
  // with the token we just replaced and fails anyway.
  const jar = request.cookies
    .getAll()
    .map((c) =>
      c.name === cookieName(slug, 'access')
        ? `${c.name}=${body.accessToken}`
        : c.name === cookieName(slug, 'refresh')
          ? `${c.name}=${body.refreshToken}`
          : `${c.name}=${c.value}`,
    );
  headers.set('cookie', jar.join('; '));

  return { kind: 'renewed', slug, access: body.accessToken, refresh: body.refreshToken };
}

function applyRenewal(response: NextResponse, request: NextRequest, renewal: Renewal): void {
  if (renewal.kind === 'none') return;

  const secure = process.env.NODE_ENV === 'production';

  if (renewal.kind === 'dead') {
    response.cookies.delete(cookieName(renewal.slug, 'access'));
    response.cookies.delete(cookieName(renewal.slug, 'refresh'));
    return;
  }

  // The same options `writeSession` uses; they must not drift apart, or a
  // renewed cookie outlives or under-lives the one login wrote.
  response.cookies.set(cookieName(renewal.slug, 'access'), renewal.access, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 15,
  });
  response.cookies.set(cookieName(renewal.slug, 'refresh'), renewal.refresh, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 90,
  });
  void request;
}

/**
 * El Ourwa's `includes/security_headers.php`, applied to every response.
 *
 * Its list, kept: framing, sniffing, referrer, the feature policy, and a CSP.
 * Two deliberate changes, both tightening:
 *
 *   - `X-XSS-Protection` is dropped. Every current browser ignores it, and in
 *     the ones that honoured it the filter was itself exploitable — it is a
 *     header that has been actively harmful, not merely obsolete.
 *   - The CSP loses `cdn.jsdelivr.net` and `cdnjs.cloudflare.com`. Those were
 *     there for Chart.js, which El Ourwa loads from a CDN. Nothing here loads
 *     script from another origin, and a script-src that permits a CDN permits
 *     anything that CDN ever serves.
 *
 * ⚠ `'unsafe-inline'` FOR SCRIPT IS GONE, REPLACED BY A PER-REQUEST NONCE.
 *
 * Next inlines its own bootstrap, so a script-src of `'self'` alone breaks the
 * app — which is why this said `'unsafe-inline'` and why the note said it
 * should not. The consequence is not theoretical: `'unsafe-inline'` means any
 * injected `<script>` executes, so the CSP stops defending against the exact
 * attack it exists for.
 *
 * A nonce is the way out. Middleware mints 128 bits per request, puts it in the
 * CSP and in a header the root layout reads, and Next stamps it onto every
 * script it renders. An injected script has no nonce and does not run.
 *
 * ⚠ THE NONCE MUST BE PER REQUEST AND UNGUESSABLE. A fixed one is `'unsafe-
 * inline'` wearing a hat: the attacker reads it from the page they are already
 * injecting into, and puts it on their own tag.
 *
 * `'unsafe-eval'` stays in development only. React Refresh needs it, and a
 * built app never sees it.
 */
function applySecurityHeaders(response: NextResponse, request: NextRequest): void {
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=()',
  );
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');

  if (request.nextUrl.protocol === 'https:') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
  }

  /**
   * ⚠ 128 BITS, FRESH PER REQUEST. A fixed nonce is `'unsafe-inline'` wearing a
   * hat — the attacker reads it off the page they are injecting into.
   *
   * `crypto` is the Web Crypto API, which is what the Edge runtime gives us;
   * `node:crypto` is not available in middleware.
   */
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');

  // The root layout reads this to stamp Next's own inline bootstrap.
  response.headers.set('x-nonce', nonce);

  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      // Development only — see the note above. Never in a built app.
      process.env.NODE_ENV === 'development'
        ? `script-src 'self' 'nonce-${nonce}' 'unsafe-eval' 'strict-dynamic'`
        : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  );

  // An authenticated page must not sit in a shared cache, nor come back from
  // the browser's history after a logout on a machine the office shares.
  const authenticated = request.cookies
    .getAll()
    .some((c) => c.name.startsWith(COOKIE_PREFIX) && c.name.endsWith('_access'));
  if (authenticated) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    response.headers.set('Pragma', 'no-cache');
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|elourwa|favicon.ico).*)'],
};
