import { NextResponse } from 'next/server';
import { clearSession, readRefreshToken } from '@/lib/session';
import { currentSlug } from '@/lib/tenant';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Logout as a native form post, for the same reason login is one (ADR-0011):
 * a redirect racing its own `Set-Cookie` leaves the browser holding a session
 * the server has already revoked.
 */
export async function POST(request: Request) {
  // Même contrôle d'origine que la connexion : un formulaire soumis depuis un
  // autre site ne ferme pas la session du bureau.
  const hoteDemande = request.headers.get('host') ?? 'localhost:3000';
  const protoDemande = request.headers.get('x-forwarded-proto') ?? 'http';
  const origine = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  const memeOrigine = origine
    ? origine.toLowerCase() === `${protoDemande}://${hoteDemande}`.toLowerCase()
    : site === null || site === 'same-origin' || site === 'none';
  if (!memeOrigine) return NextResponse.redirect(`${protoDemande}://${hoteDemande}/login?erreur=origine`, { status: 303 });

  const slug = await currentSlug();

  // Revoke server-side BEFORE dropping the browser's copy. Clearing the cookie
  // alone would leave a valid 90-day refresh token alive — logout that only logs
  // you out locally is not logout.
  const refreshToken = await readRefreshToken(slug);
  if (refreshToken) {
    await fetch(`${API}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(slug ? { 'X-School-Slug': slug } : {}),
      },
      body: JSON.stringify({ refreshToken }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => undefined);
  }
  await clearSession(slug);

  // Built from the Host header, never from `request.url`, which is 0.0.0.0 when
  // the dev server binds to every interface.
  const host = request.headers.get('host') ?? 'localhost:3000';
  // Son `deconnexion.php` : `?deconnexion=1` → « Vous avez été déconnecté avec succès. »
  const proto = request.headers.get('x-forwarded-proto') ?? 'http';
  return NextResponse.redirect(`${proto}://${host}/login?deconnexion=1`, { status: 303 });
}
