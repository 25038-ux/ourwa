import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { clientIdentityHeaders } from '@/lib/client-identity';
import { writeSession } from '@/lib/session';
import { accueilParRole, COOKIE_IDENTIFIANT_SAISI } from '@/lib/accueil';
import { DEPLOIEMENT, slugFromHost } from '@/lib/brand';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Sign in, as a plain HTML form post.
 *
 * Deliberately NOT a Server Action.
 *
 * A Server Action redirect is applied by the client router, which issues the
 * RSC request for the destination in the same breath as the browser is applying
 * the response's `Set-Cookie`. The destination then reads no session and bounces
 * straight back to the login page — intermittently, which is worse than always.
 *
 * A native form post has no such race: the browser commits the cookie, then
 * follows the 303. It also means the login form works with JavaScript disabled
 * or still loading, which matters for an office on a slow connection.
 */
export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const identifier = String(form.get('identifier') ?? '').trim();
  const password = String(form.get('password') ?? '');

  const host = (await headers()).get('host') ?? '';
  // La même règle que le middleware et lib/tenant.ts (une seule copie) ; en
  // école unique, tout hôte est cette école.
  const slug = slugFromHost(host);

  // Built from the Host header, NOT from `request.url`. The dev server binds
  // 0.0.0.0, so `request.url` is `http://0.0.0.0:3000/...` and redirecting there
  // sends the browser somewhere it cannot reach. The Host header is what the
  // browser actually asked for.
  const proto = (await headers()).get('x-forwarded-proto') ?? 'http';
  const base = `${proto}://${host}`;
  // ⚠ CONNEXION FORCÉE (login CSRF) : une page tierce qui soumet ce formulaire
  // avec SES identifiants ferait travailler le bureau sous SON compte. Un
  // formulaire soumis depuis notre propre site porte une Origine égale à
  // l'hôte (ou Sec-Fetch-Site same-origin) ; tout autre est renvoyé à la page.
  const origine = (await headers()).get('origin');
  const site = (await headers()).get('sec-fetch-site');
  const memeOrigine = origine ? origine.toLowerCase() === base.toLowerCase() : site === null || site === 'same-origin' || site === 'none';
  if (!memeOrigine) return NextResponse.redirect(`${base}/login?erreur=origine`, { status: 303 });
  // Son `$erreur` et son `$identifiant_saisi` : la page est rendue de nouveau
  // avec le refus et le champ rempli. Ici la page vient d'une redirection, et
  // l'identifiant lui parvient par un cookie d'une minute plutôt que par
  // l'adresse (jamais de donnée personnelle dans l'URL).
  const back = (reason: string) => {
    const r = NextResponse.redirect(`${base}/login?error=${encodeURIComponent(reason)}`, 303);
    r.cookies.set(COOKIE_IDENTIFIANT_SAISI, identifier.slice(0, 100), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/login',
      maxAge: 60,
    });
    return r;
  };

  if (!identifier || !password) return back('Veuillez remplir tous les champs.');

  try {
    const response = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(slug ? { 'X-School-Slug': slug } : {}),
        ...clientIdentityHeaders(await headers()),
      },
      body: JSON.stringify({ identifier, password }),
      cache: 'no-store',
    });
    const body = (await response.json()) as {
      accessToken?: string;
      refreshToken?: string;
      message?: string;
      user?: { isPlatformAdmin?: boolean };
      school?: { slug: string } | null;
    };

    if (!response.ok || !body.accessToken || !body.refreshToken) {
      // The API is deliberately vague about which half was wrong; passing its
      // message through keeps a real refusal (locked out, too many attempts)
      // legible without inventing detail it withheld.
      return back(body.message ?? 'Identifiant ou mot de passe incorrect.');
    }

    // ⚠ SANS CONSOLE, IL N'Y A PAS DE PLACE POUR UN COMPTE SANS RÔLE ICI. En
    // école unique l'API laisse entrer un administrateur de plateforme dans
    // l'école même sans rôle (c'est sa règle) ; le site, lui, n'a aucune page
    // à lui montrer — chaque page répondrait 403. Refusé à la porte, avec la
    // raison, plutôt qu'un tableau de bord vide.
    if (!DEPLOIEMENT.console && (!body.school || rolesFromToken(body.accessToken).length === 0)) {
      return back('Ce compte n’a aucun rôle dans cette école.');
    }

    // ⚠ SANS CONSOLE, IL N'Y A PAS DE PLACE POUR UN COMPTE SANS RÔLE ICI. En
    // école unique l'API laisse entrer un administrateur de plateforme dans
    // l'école même sans rôle (c'est sa règle) ; le site, lui, n'a aucune page
    // à lui montrer — chaque page répondrait 403. Refusé à la porte, avec la
    // raison, plutôt qu'un tableau de bord vide.
    if (!DEPLOIEMENT.console && (!body.school || rolesFromToken(body.accessToken).length === 0)) {
      return back('Ce compte n’a aucun rôle dans cette école.');
    }

    await writeSession(slug, body.accessToken, body.refreshToken);

    /**
     * Land people on their OWN first screen.
     *
     * El Ourwa's sidebar is per role and its first entry is where that role
     * starts: a teacher's is `professeur/tableau_bord.php`, not the
     * administration's. Sending everyone to `/` showed a teacher the school's
     * headcount and revenue — a page that is not theirs, and whose "Bienvenue"
     * panel then had to explain why half of it was missing.
     *
     * Read from the token rather than fetched: it already carries the roles, and
     * a second round trip to learn them would delay every sign-in.
     */
    // La plateforme n'a pas de rôle d'école : sa console est sa première page.
    const home = !body.school && body.user?.isPlatformAdmin
      ? '/platform'
      : accueilParRole(rolesFromToken(body.accessToken));

    const r = NextResponse.redirect(`${base}${home}`, 303);
    r.cookies.delete({ name: COOKIE_IDENTIFIANT_SAISI, path: '/login' });
    return r;
  } catch {
    return back("Le serveur ne répond pas.");
  }
}

/**
 * The roles inside an access token, without verifying it.
 *
 * Safe here and nowhere else: this decides which page to open, and the page
 * itself is guarded server-side. A forged token buys a redirect to a screen that
 * will refuse the reader anyway.
 */
function rolesFromToken(token: string): string[] {
  try {
    const payload = token.split('.')[1];
    if (!payload) return [];
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      roles?: string[];
    };
    return json.roles ?? [];
  } catch {
    return [];
  }
}
