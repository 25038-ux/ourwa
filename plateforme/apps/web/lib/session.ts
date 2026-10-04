import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentSlug } from './tenant';
import { cookieName } from './brand';
import { headers as nextHeaders } from 'next/headers';
import { clientIdentityHeaders } from './client-identity';

/**
 * The browser session.
 *
 * Tokens live in httpOnly, SameSite=Lax cookies (ARCHITECTURE.md §5) so page
 * scripts cannot read them — an XSS then cannot exfiltrate a session. Every API
 * call is made server-side, so the access token never reaches the browser at all.
 *
 * The cookie name is scoped by school slug: a browser open on two branches at
 * once (which is normal for a platform admin) must not have one session
 * overwrite the other.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface SessionUser {
  id: string;
  /** True while a platform admin is inside a branch. Drives the banner. */
  impersonated?: boolean;
  /** Un administrateur de la plateforme — la console `admin.<domaine>` est à lui. */
  isPlatformAdmin?: boolean;
  fullName: string;
  /** Ce avec quoi cette personne se connecte. « Mon profil » l'affiche. */
  identifier?: string;
  roles: string[];
  permissions: string[];
  schoolId: string | null;
  /**
   * ⚠ Still on the password the office issued. Every page behind the shell
   * refuses to render until it is changed — see `(app)/layout.tsx`.
   */
  mustChangePassword?: boolean;
}

/**
 * ⚠ UNE FOIS PAR REQUÊTE. `apiFetch` relit la session avant CHAQUE appel à
 * l'API, et la relire c'est un aller-retour `/auth/me` (avec, côté API, la
 * lecture du compte et du sceau en base). Une page qui fait six appels en
 * faisait donc douze, plus ceux de la mise en page — et sur un hébergement où
 * la base est à quelques millisecondes, c'est ce qui rendait le site lent.
 * `cache()` de React mémorise le résultat pour la durée du rendu (ou de
 * l'action) en cours ; la requête suivante repart de zéro.
 */
export const readSession = cache(async function readSession(): Promise<
  { accessToken: string; user: SessionUser } | null
> {
  const slug = await currentSlug();
  const jar = await cookies();
  const accessToken = jar.get(cookieName(slug, 'access'))?.value;
  if (!accessToken) return null;

  try {
    const response = await fetch(`${API}/auth/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(slug ? { 'X-School-Slug': slug } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    // ⚠ 401 = session finie ; 5xx ou réseau = l'API ne répond pas. Confondre
    // les deux disait « votre session a expiré » à tout le bureau à chaque
    // redémarrage de l'API — cookies intacts, personne d'averti.
    if (response.status >= 500) {
      console.error(`[session] /auth/me → ${response.status}`);
      etatApi().injoignable = true;
      return null;
    }
    if (!response.ok) return null;
    const user = (await response.json()) as SessionUser;
    return { accessToken, user };
  } catch (error) {
    console.error('[session] /auth/me injoignable :', error instanceof Error ? error.message : error);
    etatApi().injoignable = true;
    return null;
  }
});

/** Par requête (React `cache`) : `readSession()` a-t-elle échoué parce que l'API ne répond pas ? */
const etatApi = cache((): { injoignable: boolean } => ({ injoignable: false }));

export async function writeSession(
  slug: string | null,
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  const jar = await cookies();
  const secure = process.env.NODE_ENV === 'production';
  jar.set(cookieName(slug, 'access'), accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 15,
  });
  jar.set(cookieName(slug, 'refresh'), refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 90,
  });
}

/** The stored refresh token, so logout can revoke it server-side. */
export async function readRefreshToken(slug: string | null): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(cookieName(slug, 'refresh'))?.value;
}

export async function clearSession(slug: string | null): Promise<void> {
  const jar = await cookies();
  jar.delete(cookieName(slug, 'access'));
  jar.delete(cookieName(slug, 'refresh'));
}

/**
 * The session, or a redirect to the login page.
 *
 * ⚠ Every authenticated page calls this ITSELF. In the App Router a layout and
 * the pages beneath it render in PARALLEL, so a `redirect()` in the layout does
 * not prevent the page from running first. Trusting the layout to guard the
 * page meant the dashboard ran with a null session and crashed — and would have
 * leaked whatever it could render before it did.
 */
export async function requireSession(): Promise<{ accessToken: string; user: SessionUser }> {
  const session = await readSession();
  if (!session && etatApi().injoignable) redirect('/login?erreur=api_injoignable');
  // Son `require_role()` sans session : `?erreur=session_expiree`.
  if (!session) redirect('/login?erreur=session_expiree');
  return session;
}

/** Does the signed-in user hold any of these permissions? */
export function can(user: SessionUser | undefined, ...permissions: string[]): boolean {
  if (!user) return false;
  const held = new Set(user.permissions);
  return permissions.some((p) => held.has(p));
}

/**
 * PEUT-IL ADMINISTRER CE QUE L'ÉCOLE RÉCLAME ? — son `$peut_administrer_frais`.
 *
 * `gestion_caisse.php` :
 *
 *   ```php
 *   $peut_administrer_frais = a_role('super_admin') || a_role('admin');
 *   ```
 *
 * ⚠ UN RÔLE, PAS UNE PERMISSION, ET C'EST DÉLIBÉRÉ CHEZ LUI. `finance.dette`
 * existe dans son catalogue et il l'accorde au comptable — mais la chaîne n'est
 * vérifiée nulle part dans tout v16. Fixer un barème, exempter une famille,
 * accorder une remise « relèvent de l'administration, pas de la caisse » : c'est
 * le rôle qui les garde.
 *
 * ⚠ ET SON COMMENTAIRE DIT POURQUOI C'EST ÉCRIT POSITIVEMENT : « L'ancienne
 * garde s'écrivait "!est_comptable()" — donc "tout le monde sauf le comptable" :
 * une secrétaire ou un collecteur d'absence la franchissait. »
 *
 * Elle double la garde du serveur, elle ne la remplace pas : cacher un bouton
 * n'est pas une autorisation. Elle évite seulement d'offrir au comptable des
 * commandes qui le refuseront.
 */
export function peutAdministrerLaDette(user: SessionUser | undefined): boolean {
  if (!user) return false;
  return user.roles.includes('super_admin') || user.roles.includes('admin');
}

/**
 * Call the API as the signed-in user.
 *
 * Server-side only. Throws `ApiError` with the API's own message so a refusal —
 * "this year is closed", "tender lines must match exactly" — reaches the screen
 * intact instead of becoming a generic failure.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Le plus long qu'une action attend l'API (un bulletin de classe, une réinscription en lot tiennent dedans). */
const DELAI_API_MS = 90_000;
/** Un envoi de fichiers part d'un téléphone sur une ligne lente : plus long. */
const DELAI_TELEVERSEMENT_MS = 180_000;

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const slug = await currentSlug();
  const session = await readSession();
  // L'identité de la personne (adresse, navigateur) — l'API ne la croit que
  // d'un mandataire de confiance, et le site en est un. Sans elle, l'audit
  // notait l'adresse du serveur et toutes les actions partageaient un seau.
  const headers: Record<string, string> = {
    ...(slug ? { 'X-School-Slug': slug } : {}),
    ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
    ...clientIdentityHeaders(await nextHeaders()),
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';

  // Une panne réseau (API en redémarrage, socket coupée) est journalisée ICI,
  // une fois pour les 120 actions : sans cela une erreur non-ApiError finissait
  // en « Échec » générique et personne ne savait pourquoi.
  //
  // ⚠ ET JAMAIS SANS FIN (04/10/2026, Jinan : « sometimes some buttons get
  // stuck »). Sans délai, une requête que l'API ne terminait pas (un verrou
  // attendu, une socket à moitié fermée par un redémarrage) laissait l'action
  // serveur suspendue — et avec elle le bouton grisé « en cours », et toutes
  // les actions suivantes de la page, que Next exécute l'une après l'autre.
  // Passé le délai, l'action répond une erreur et le bouton revient.
  const delai = init.body instanceof FormData ? DELAI_TELEVERSEMENT_MS : DELAI_API_MS;
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    cache: 'no-store',
    signal: init.signal ?? AbortSignal.timeout(delai),
  }).catch((error: unknown) => {
    console.error(`[api] ${init.method ?? 'GET'} ${path} injoignable :`, error instanceof Error ? error.message : error);
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      // ⚠ Une écriture a peut-être abouti côté serveur : on ne dit pas « échec ».
      throw new ApiError(
        (init.method ?? 'GET') === 'GET'
          ? 'Le serveur a mis trop de temps à répondre. Réessayez dans un instant.'
          : "Le serveur a mis trop de temps à répondre. L'opération a peut-être abouti : rechargez la page et vérifiez avant de recommencer.",
        504,
      );
    }
    throw new ApiError('Le serveur ne répond pas. Réessayez dans un instant.', 503);
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { message?: string | string[] };
      if (body.message) {
        message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
      }
    } catch {
      /* keep the default */
    }
    /**
     * ⚠ EVERY FAILURE IS LOGGED HERE, WHATEVER THE CALLER DOES WITH IT.
     *
     * Pages call this behind `.catch(() => [])` so one dead panel does not take
     * a whole screen down with it — which is right, and which also means a 500
     * renders as "Aucune transaction enregistrée" and looks like an empty
     * month. That cost a full debugging cycle on Revenue Live: a SQL error in a
     * new query was indistinguishable from a quiet day, because the only thing
     * either produced was an empty table.
     *
     * The catch still swallows. The error is no longer invisible: it is in the
     * server log with its path and status, which is where someone looks when a
     * screen is empty and should not be.
     *
     * A 401 is not logged — an expired session is ordinary, and drowning the
     * log in them is how the log stops being read.
     */
    if (response.status !== 401) {
      console.error(`[api] ${init.method ?? 'GET'} ${path} → ${response.status}: ${message}`);
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
