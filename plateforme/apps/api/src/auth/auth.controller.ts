import { Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthService } from './auth.service.js';
import { TenantService } from '../tenant/tenant.service.js';
import { clientIp, clientUserAgent, schoolSlugFromTrustedHeader } from './client-ip.js';
import type { AuthenticatedRequest } from './permissions.guard.js';

const loginBody = z.object({
  identifier: z.string().trim().min(1).max(190),
  password: z.string().min(1).max(400),
  /** `parent` : l'espace des familles — ses phrases (`tenter_connexion_parent()`). */
  espace: z.enum(['parent', 'direction']).optional(),
});

const refreshBody = z.object({ refreshToken: z.string().min(10).max(200) });

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(TenantService) private readonly tenants: TenantService,
  ) {}

  /**
   * The school comes from the HOST, never from the body.
   *
   * A body-supplied school would let a caller pick which branch to authenticate
   * against, which is exactly the boundary the subdomain exists to draw.
   */
  private schoolSlug(request: FastifyRequest): string | null {
    // Du serveur web en production aussi — voir TenantInterceptor.
    // En école unique, c'est elle — l'en-tête et l'hôte ne comptent plus.
    return this.tenants.ecoleUnique() ?? schoolSlugFromTrustedHeader(request) ?? this.tenants.slugFromHost(request.headers.host);
  }

  @Post('login')
  async login(@Req() request: FastifyRequest, @Body() raw: unknown) {
    const { identifier, password, espace } = loginBody.parse(raw ?? {});
    // L'espace des familles ne nomme AUCUNE école (une application pour toutes
    // les branches, ADR-0061) : le nom d'hôte de l'API (`api.…`,
    // `….onrender.com`) n'en est pas une et ne doit pas en devenir une.
    return this.auth.login(
      identifier,
      password,
      espace === 'parent' ? null : this.schoolSlug(request),
      { ip: clientIp(request), userAgent: clientUserAgent(request) },
      espace === 'parent',
    );
  }

  @Post('refresh')
  async refresh(@Req() request: FastifyRequest, @Body() raw: unknown) {
    const { refreshToken } = refreshBody.parse(raw ?? {});
    return this.auth.refresh(refreshToken, {
      ip: clientIp(request),
      userAgent: clientUserAgent(request),
    });
  }

  @Post('logout')
  async logout(@Req() request: FastifyRequest, @Body() raw: unknown) {
    const { refreshToken } = refreshBody.parse(raw ?? {});
    await this.auth.logout(refreshToken, clientIp(request));
    return { ok: true };
  }

  @Post('logout-all')
  async logoutAll(@Req() request: AuthenticatedRequest) {
    const revoked = await this.auth.logoutEverywhere(
      request.auth!.userId,
      clientIp(request as FastifyRequest),
    );
    return { ok: true, sessionsRevoked: revoked };
  }

  /*
   * ⚠ IL N'Y A PAS DE « MOT DE PASSE OUBLIÉ », ET C'EST VOULU.
   *
   * `POST /auth/forgot-password` et `POST /auth/reset-password` existaient ici :
   * un libre-service qui envoyait un lien par courriel à qui saisissait un
   * identifiant. Décision du propriétaire (2026-09-04) : seul un SUPER
   * administrateur réinitialise un mot de passe, depuis
   * `POST /accounts/users/:id/reset-password`.
   *
   * Plus strict qu'El Ourwa, qui ouvre `reinitialiser_mdp.php` à
   * `require_staff_admin()` — super_admin OU admin — et n'a de toute façon
   * aucun libre-service. La décision est notée parce qu'un lecteur qui cherche
   * la route de réinitialisation doit trouver pourquoi elle n'est pas là.
   */

  /** « Identité actuelle » de `modifier_profil.php` : identifiant, prénom, nom. */
  @Get('profil')
  async profil(@Req() request: AuthenticatedRequest) {
    return this.auth.profil(request.auth!.userId, request.auth!.schoolId);
  }

  /**
   * MODIFIER MON NOM — `modifier_profil.php`, `changer_nom`. Aucune
   * permission et aucun identifiant d'appelant : la route agit sur
   * l'utilisateur du jeton et ne peut atteindre personne d'autre.
   */
  @Post('change-name')
  async changeName(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ prenom: z.string().max(400), nom: z.string().max(400) }).parse(raw ?? {});
    await this.auth.changeOwnName(
      request.auth!.userId,
      body.prenom,
      body.nom,
      request.auth!.schoolId,
      clientIp(request as unknown as FastifyRequest),
    );
    return { changed: true };
  }

  /**
   * MODIFIER MON IDENTIFIANT — `modifier_profil.php`, `changer_identifiant`.
   * Le mot de passe actuel est ce qui la garde ; `refreshToken` nomme la
   * session à conserver.
   */
  @Post('change-identifier')
  async changeIdentifier(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        newIdentifier: z.string().max(400),
        currentPassword: z.string().max(400),
        refreshToken: z.string().min(10).max(200).optional(),
      })
      .parse(raw ?? {});
    await this.auth.changeOwnIdentifier(
      request.auth!.userId,
      body.newIdentifier,
      body.currentPassword,
      clientIp(request as unknown as FastifyRequest),
      body.refreshToken,
    );
    return { changed: true };
  }

  /**
   * MODIFIER MON MOT DE PASSE — `modifier_profil.php`, `changer_mdp`. Les
   * refus, y compris la politique, sont ceux du service, dans son ordre à lui :
   * rien n'est jugé avant que l'ancien mot de passe soit vérifié.
   */
  @Post('change-password')
  async changePassword(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        currentPassword: z.string().max(400),
        newPassword: z.string().max(400),
        confirmPassword: z.string().max(400).optional(),
        refreshToken: z.string().min(10).max(200).optional(),
        /** `parent` : l'ordre et les phrases de `pages/parent/changer_mdp.php`. */
        espace: z.enum(['parent', 'direction']).optional(),
      })
      .parse(raw ?? {});
    await this.auth.changeOwnPassword(
      request.auth!.userId,
      body.currentPassword,
      body.newPassword,
      body.confirmPassword ?? body.newPassword,
      clientIp(request as FastifyRequest),
      body.refreshToken,
      body.espace === 'parent',
    );
    return { changed: true };
  }

  /** Who am I, and what may I do here? Drives the permission-aware menu. */
  @Get('me')
  async me(@Req() request: AuthenticatedRequest) {
    const auth = request.auth!;
    const identite = await this.auth.identity(auth.userId);
    return {
      id: auth.userId,
      // `userId` kept alongside `id` so an existing caller does not break.
      userId: auth.userId,
      fullName: identite.fullName,
      // Les numéros supplémentaires du compte (0041) : l'application les montre au profil.
      phones: identite.phones,
      /** Ce avec quoi on se connecte — « Mon profil » l'affiche. */
      identifier: identite.identifier,
      /** La langue du compte (`parents.langue` chez lui) — l'application la lit avant d'afficher. */
      locale: identite.locale,
      schoolId: auth.schoolId,
      roles: auth.roles,
      permissions: auth.permissions,
      impersonated: auth.impersonated,
      isPlatformAdmin: auth.isPlatformAdmin ?? false,
      /** Les écoles d'une session de famille (l'application les affiche sur chaque enfant). */
      ecoles: auth.ecolesFamille ?? [],
      /**
       * ⚠ THE FLAG HAS TO TRAVEL WITH THE SESSION, NOT JUST WITH THE LOGIN
       * RESPONSE. It was returned once, at sign-in, and nothing kept it — so
       * every page after that had no idea the password was still the one the
       * office wrote on a slip of paper.
       */
      mustChangePassword: await this.auth.mustChangePassword(auth.userId),
    };
  }

  /**
   * Choisir sa langue. Chez lui `?lang=ar` écrit `parents.langue` quand un
   * parent est connecté ; ici l'application appelle ceci au moment du choix.
   * Deux valeurs et pas une de plus : l'école parle français et arabe.
   */
  /**
   * Supprimer son compte. Le mot de passe est exigé ; ce que « supprimer »
   * veut dire pour une école est expliqué sur `deleteOwnAccount()` et dans la
   * politique de confidentialité.
   */
  @Post('delete-account')
  async deleteAccount(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ currentPassword: z.string().min(1).max(200) }).parse(raw ?? {});
    await this.auth.deleteOwnAccount(
      request.auth!.userId,
      body.currentPassword,
      clientIp(request as FastifyRequest),
    );
    return { deleted: true };
  }

  @Post('locale')
  async locale(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const { locale } = z.object({ locale: z.enum(['fr', 'ar']) }).parse(body);
    await this.auth.setLocale(request.auth!.userId, locale);
    return { locale };
  }
}
