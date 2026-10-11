import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { verifyAccessToken } from './tokens.js';
import { getJwtKeys } from './keys.js';
import { PermissionsService } from './permissions.service.js';
import { DbService } from '../db/db.service.js';
import type { AuthenticatedRequest } from './permissions.guard.js';

/**
 * ⚠ THE TOKEN SAYS WHO YOU WERE; THE DATABASE SAYS WHO YOU ARE.
 *
 * An access token is signed once and lives fifteen minutes. This guard used to
 * trust everything inside it — roles, permissions, and the mere fact that the
 * account still existed. El Ourwa does not: `est_connecte()` re-reads the
 * account on EVERY request, and its comment says why —
 *
 *   « Désactiver un compte ou réinitialiser son mot de passe — les deux gestes
 *     de réaction à un incident — ne fermaient donc pas la session en cours. »
 *
 * Fifteen minutes is exactly the window an incident response cannot afford:
 * the account of a dismissed accountant, the password of a stolen phone. So,
 * per request, ONE indexed read of `users` and the two small reads that
 * `permissions.php` also does per request:
 *
 *   - the account is still `active` (row 18, `palier_admin()` re-read);
 *   - the SEAL still matches — the first 32 hex characters of the SHA-256 of
 *     the password hash, its `sceau_compte()`. A password change, and every
 *     token minted before it is dead on the next request, not in fifteen
 *     minutes (row 17);
 *   - roles and permissions come from the role table now, not from the
 *     token — a right revoked at 10:00 is gone at 10:00 (row 23).
 *
 * The cost is three primary-key reads per request at one school's volume.
 * The alternative is a fifteen-minute lie.
 */

const PUBLIC_PREFIXES = [
  '/health',
  '/auth/login',
  '/auth/refresh',
  // Révoquer un jeton qu'on tient n'exige pas un jeton d'accès : le site se
  // déconnecte souvent APRÈS l'expiration des quinze minutes — et sans cette
  // ligne, « Déconnexion » laissait le jeton de rafraîchissement vivant 90 jours.
  '/auth/logout',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/school',
  '/platform/schools',
  '/legal',
];

/**
 * ⚠ « VOUS DEVEZ CHANGER VOTRE MOT DE PASSE AVANT DE CONTINUER » — DIT ICI,
 * PLUS SEULEMENT PAR LES ÉCRANS (revue de sécurité du 2026-10-10).
 *
 * Le site (`(app)/layout.tsx`) et l'application (`main.dart`) renvoient un
 * compte encore sur son mot de passe remis vers leur écran de changement ; cette
 * garde, elle, ne lisait jamais `must_change_password`. Un appel direct avec un
 * jeton valide ouvrait donc toutes les routes — et 1 372 comptes de familles
 * étaient dans cet état, sur le même mot de passe de départ.
 *
 * Tant que le drapeau est levé, TOUT est refusé (403, `code` ci-dessous) sauf
 * ce dont les deux écrans de changement ont besoin. La liste a été établie en
 * lisant chaque appel des deux clients, et pas autrement :
 *
 *   LE SITE, sur `/profile?motdepasse=obligatoire`
 *     GET  /auth/me ................ `readSession()` — la coquille, la page, chaque `apiFetch`
 *     GET  /auth/profil ............ « Identité actuelle » de la page
 *     GET  /academic-years ......... le sélecteur d'année de l'en-tête (`page-header.tsx`)
 *     POST /auth/change-password ... `changePasswordAction`
 *
 *   L'APPLICATION, de la connexion à la fin de `ChangePasswordScreen`
 *     GET    /auth/me .............. `restore()` / `reessayer()` : le drapeau redemandé à chaque ouverture
 *     POST   /auth/locale .......... `_onSignedIn` : la langue choisie sur l'écran de connexion
 *     POST   /parent/devices ....... `Push.attacher`, dès la connexion et à chaque ouverture
 *     DELETE /parent/devices ....... `Push.detacher`, avant « Se déconnecter » — offert sur l'écran obligé
 *     POST   /auth/change-password . `changePassword()`
 *
 * Les routes publiques (`/auth/login`, `/auth/refresh`, `/auth/logout`,
 * `/school`, `/legal`) ne passent jamais par ici : se connecter, renouveler sa
 * session et PARTIR restent possibles — un parent qui ne retrouve pas le mot de
 * passe remis ne doit pas être enfermé sur l'écran.
 *
 * ⚠ Méthode ET chemin exacts. Un préfixe ouvrirait `/parent/devices/test` avec
 * `/parent/devices`, et `/academic-years/default` avec `/academic-years`.
 *
 * ⚠ CE QUI N'Y EST PAS, EXPRÈS : `change-name` et `change-identifier`, pourtant
 * sur la même page du site — le mot de passe d'abord ; et les sondages de fond
 * de l'application (`/parent/notifications`, `/parent/messages/unread`), qui
 * lisent déjà la vie de la famille : la tâche de fond avale le refus
 * (`tacheArrierePlan`) et reprend d'elle-même après le changement.
 *
 * Ajouter une ligne ici, c'est rouvrir une route aux 1 372 comptes au mot de
 * passe de départ : `mot-de-passe-oblige-serveur.spec.ts` dit ce que chaque
 * ligne doit à l'un des deux écrans.
 */
const PERMIS_AVANT_LE_CHANGEMENT: ReadonlySet<string> = new Set([
  'GET /auth/me',
  'GET /auth/profil',
  'GET /academic-years',
  'POST /auth/change-password',
  'POST /auth/locale',
  'POST /parent/devices',
  'DELETE /parent/devices',
]);

/** Le code du refus — ce que les clients reconnaissent, la phrase pouvant être traduite. */
export const CODE_MOT_DE_PASSE_A_CHANGER = 'MOT_DE_PASSE_A_CHANGER';

/** Son `tout_correspondant_doit_changer` (`includes/i18n.php`), au mot près. */
const PHRASE_MOT_DE_PASSE_A_CHANGER = 'Vous devez changer votre mot de passe avant de continuer.';

/** Son `sceau_compte()` : `substr(hash('sha256', $hash_mdp), 0, 32)`. */
export function seal(passwordHash: string): string {
  return createHash('sha256').update(passwordHash).digest('hex').slice(0, 32);
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const path = (request.url ?? '').split('?')[0]!;
    if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return true;

    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Session expirée. Reconnectez-vous.');
    }

    let claims;
    try {
      claims = await verifyAccessToken(header.slice(7), getJwtKeys().publicKey);
    } catch {
      throw new UnauthorizedException('Session expirée. Reconnectez-vous.');
    }

    // ── The account, now ──────────────────────────────────────────────────
    const compte = await this.db.registry(async (tx) => {
      const { rows } = await tx.query<{
        active: boolean;
        password_hash: string;
        is_platform_admin: boolean;
        must_change_password: boolean;
      }>(
        // Le drapeau vient de la MÊME lecture que le compte et le sceau : pas un
        // aller-retour de plus par requête.
        'SELECT active, password_hash, is_platform_admin, must_change_password FROM users WHERE id = $1',
        [claims.sub],
      );
      return rows[0];
    });
    if (!compte || !compte.active) {
      throw new UnauthorizedException('Session fermée : compte désactivé. Reconnectez-vous.');
    }
    // A token minted before the seal existed carries none: it is accepted this
    // once — its own `compte_toujours_valide()` does the same for sessions
    // opened before the seal was added — and every token issued from now on
    // carries one.
    if (claims.seal && claims.seal !== seal(compte.password_hash)) {
      throw new UnauthorizedException(
        'Session fermée : identifiants modifiés. Reconnectez-vous.',
      );
    }

    // ── Le mot de passe remis, pas encore remplacé ────────────────────────
    // Après le sceau : une session fermée reste un 401 (« reconnectez-vous »),
    // jamais ce 403. Avant les droits : rien d'autre n'est lu pour un refus.
    if (
      compte.must_change_password &&
      !PERMIS_AVANT_LE_CHANGEMENT.has(`${(request.method ?? '').toUpperCase()} ${path}`)
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: CODE_MOT_DE_PASSE_A_CHANGER,
        message: PHRASE_MOT_DE_PASSE_A_CHANGER,
      });
    }

    // ── The rights, now ───────────────────────────────────────────────────
    let roles: string[] = [];
    let permissions: string[] = [];
    let ecolesFamille: { id: string; slug: string; name: string; nameAr: string | null }[] | undefined;
    if (claims.espace === 'parent') {
      // Une session de famille : le rôle `parent` est relu dans TOUTES les
      // écoles du compte, à chaque requête. Plus aucune école : plus de session.
      ecolesFamille = await this.permissions.ecolesDeFamille(claims.sub);
      if (ecolesFamille.length === 0) {
        throw new UnauthorizedException('Session fermée : ce compte n’est plus rattaché à une école.');
      }
      roles = ['parent'];
    } else if (claims.schoolId) {
      [roles, permissions] = await Promise.all([
        this.permissions.rolesForUserInSchool(claims.sub, claims.schoolId),
        this.permissions.forUserInSchool(claims.sub, claims.schoolId).then((s) => [...s]),
      ]);
      // A platform admin inside a branch keeps the token's rights: they were
      // granted for the visit, not held as a role in the branch.
      if (claims.impersonated && compte.is_platform_admin) {
        roles = claims.roles ?? [];
        permissions = claims.permissions ?? [];
      }
    } else if (compte.is_platform_admin) {
      roles = claims.roles ?? [];
      permissions = claims.permissions ?? [];
    }

    request.auth = {
      userId: claims.sub,
      schoolId: claims.schoolId,
      roles,
      permissions,
      impersonated: claims.impersonated ?? false,
      isPlatformAdmin: compte.is_platform_admin,
      ...(ecolesFamille ? { ecolesFamille } : {}),
    };
    return true;
  }
}
