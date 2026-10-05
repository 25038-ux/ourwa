import { Body, Controller, Delete, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { AccountsService, ASSIGNABLE_ROLES } from './accounts.service.js';
import { RequirePermission, RequireRole, type AuthenticatedRequest } from '../auth/permissions.guard.js';
import { estDateIso } from '../common/dates.js';

const uuid = z.string().uuid();
const money = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a decimal string');

/**
 * Staff, teacher and parent accounts.
 *
 * The three `comptes.*` permissions are separate on purpose: whoever manages
 * parent logins does not thereby manage the accountant's.
 */
@Controller('accounts')
export class AccountsController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}

  @Get('staff')
  @RequirePermission('comptes.staff')
  staff() {
    return this.accounts.listStaff();
  }

  /** `comptes_staffs.php` — tout le personnel de direction, professeurs compris. */
  @Get('comptes-personnel')
  @RequirePermission('comptes.staff')
  comptesPersonnel() {
    return this.accounts.listComptesPersonnel();
  }

  @Get('teachers')
  @RequirePermission('comptes.professeurs')
  teachers() {
    return this.accounts.listTeachers();
  }

  /** Le catalogue des rôles et leurs descriptions — `comptes_staffs.php`. */
  @Get('roles')
  @RequirePermission('comptes.staff', 'comptes.professeurs')
  roles() {
    return this.accounts.listRoles();
  }

  @Get('parents')
  @RequirePermission('comptes.parents')
  parents(
    @Query('q') q?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.accounts.listParents({
      q,
      cursor,
      // « abc » partait en NaN jusqu'à la requête SQL (500) : un entier, ou rien.
      limit: /^\d{1,4}$/.test(limit ?? '') ? Number(limit) : undefined,
    });
  }

  /**
   * AJOUTER UNE FICHE DE PERSONNEL — `ajouter_staff.php`, sans compte.
   * À ne pas confondre avec `POST /accounts`, qui crée un login.
   */
  @Post('staff')
  @RequirePermission('comptes.staff')
  addStaff(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        firstName: z.string().trim().min(1).max(80),
        lastName: z.string().trim().min(1).max(80),
        jobTitle: z.string().trim().min(1).max(80),
        sex: z.enum(['M', 'F']).optional(),
        phone: z.string().trim().max(40).optional(),
        salary: money,
        hiredOn: z.string().date(),
        // Les mois civils où ce membre est payé ; absent = les douze.
        paidMonths: z.array(z.coerce.number().int().min(1).max(12)).max(12).optional(),
      })
      .parse(raw ?? {});
    return this.accounts.addStaff(body, request.auth!.userId);
  }

  /** Create a login and the personnel record that goes with it. */
  @Post()
  @RequirePermission('comptes.staff', 'comptes.professeurs')
  create(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        role: z.enum(ASSIGNABLE_ROLES),
        firstName: z.string().trim().min(1).max(80),
        lastName: z.string().trim().min(1).max(80),
        sex: z.enum(['M', 'F']).optional(),
        phone: z.string().trim().min(6).max(40).optional(),
        email: z.string().trim().email().max(120).optional(),
        username: z.string().trim().max(100).optional(),
        password: z.string().max(200).optional(),
        extraRoles: z.array(z.string().trim().max(40)).max(5).optional(),
        jobTitle: z.string().trim().max(80).optional(),
        salary: money.optional(),
        hiredOn: z.string().date().optional(),
        employment: z.enum(['permanent', 'interim']).optional(),
        hourlyRate: money.optional(),
      })
      .parse(raw ?? {});
    return this.accounts.create(body, request.auth!.userId);
  }

  /**
   * RÉINITIALISER UN MOT DE PASSE — le SEUL chemin qui en existe encore.
   *
   * ⚠ SUPER ADMINISTRATEUR, ET PERSONNE D'AUTRE. Décision du propriétaire
   * (2026-09-04), plus stricte que les deux états précédents : il y avait ici
   * trois permissions que le secrétariat et la comptabilité détiennent, et à
   * côté un libre-service « Mot de passe oublié ? » qui n'exigeait personne.
   * El Ourwa ouvre son `reinitialiser_mdp.php` à `require_staff_admin()`
   * (super_admin OU admin) ; nous nous arrêtons au super.
   *
   * ⚠ `@RequireRole` S'AJOUTE À `@RequirePermission`, il ne le remplace pas :
   * le garde exige les deux. La permission dit quel écran ouvre la porte, le
   * rôle dit qui peut la franchir.
   */
  @Post('users/:id/reset-password')
  @RequirePermission('comptes.staff', 'comptes.professeurs', 'comptes.parents')
  @RequireRole('super_admin')
  reset(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    // `comptes_parents.php` : l'administrateur tape le nouveau mot de passe.
    const body = z.object({ password: z.string().max(200).optional() }).parse(raw ?? {});
    return this.accounts.resetPassword(uuid.parse(id), request.auth!.userId, body.password);
  }

  /**
   * CHANGER L'IDENTIFIANT — the way a person signs in.
   *
   * ⚠ Behind the same permissions as the reset: whoever may hand out a password
   * may correct the number it goes with. A parent whose telephone changes is
   * otherwise locked out for good.
   */
  @Post('users/:id/identifier')
  @RequirePermission('comptes.parents', 'comptes.professeurs', 'comptes.staff')
  async setIdentifier(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = z
      .object({
        // Each is optional; an ABSENT field is left alone, an empty one is
        // cleared. The service refuses to leave an account with neither.
        phone: z.string().max(40).optional(),
        email: z.string().max(160).optional(),
      })
      .parse(raw ?? {});
    await this.accounts.setIdentifier(uuid.parse(id), body, request.auth!.userId);
    return { updated: true };
  }

  /**
   * LE NOM DU CORRESPONDANT, corrigé depuis le dossier de la famille (décision
   * du propriétaire, 20/09). Le téléphone et l'e-mail passent par
   * `users/:id/identifier` (ils sont l'identifiant de connexion) ; ici le nom
   * seulement — et seulement pour un correspondant d'ici.
   */
  /**
   * L'IDENTIFIANT D'UN CORRESPONDANT depuis le dossier de la famille : la
   * même règle que `users/:id/identifier`, mais SEULEMENT pour un compte qui
   * est correspondant ici — l'admission n'a pas à toucher l'identifiant d'un
   * agent ou d'un administrateur.
   */
  @Post('guardians/:id/identifier')
  @RequirePermission('scolarite.inscrire', 'scolarite.reinscrire', 'comptes.parents')
  async identifiantCorrespondant(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ phone: z.string().max(40).optional(), email: z.string().max(160).optional() }).parse(raw ?? {});
    await this.accounts.setIdentifier(uuid.parse(id), body, request.auth!.userId, { correspondantSeulement: true });
    return { updated: true };
  }

  /**
   * LES NUMÉROS SUPPLÉMENTAIRES D'UNE FAMILLE (0041) : lus et gérés depuis
   * « Comptes des parents » et le dossier de la famille, par ceux qui peuvent
   * déjà y changer l'identifiant.
   */
  @Get('guardians/:id/phones')
  @RequirePermission('scolarite.inscrire', 'scolarite.reinscrire', 'comptes.parents')
  async telephones(@Param('id') id: string) {
    return { phones: await this.accounts.telephonesDe(uuid.parse(id)) };
  }

  @Post('guardians/:id/phones')
  @RequirePermission('scolarite.inscrire', 'scolarite.reinscrire', 'comptes.parents')
  async ajouterTelephone(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ phone: z.string().trim().min(6).max(40), label: z.string().max(40).optional() }).parse(raw ?? {});
    await this.accounts.ajouterTelephone(uuid.parse(id), body, request.auth!.userId);
    return { added: true };
  }

  @Delete('guardians/:id/phones/:phone')
  @RequirePermission('scolarite.inscrire', 'scolarite.reinscrire', 'comptes.parents')
  async retirerTelephone(@Param('id') id: string, @Param('phone') phone: string, @Req() request: AuthenticatedRequest) {
    await this.accounts.retirerTelephone(uuid.parse(id), phone, request.auth!.userId);
    return { removed: true };
  }

  @Post('guardians/:id/name')
  @RequirePermission('scolarite.inscrire', 'scolarite.reinscrire', 'comptes.parents')
  async renommerCorrespondant(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ fullName: z.string().trim().min(2).max(120) }).parse(raw ?? {});
    await this.accounts.renommerCorrespondant(uuid.parse(id), body.fullName, request.auth!.userId);
    return { updated: true };
  }

  /** Son action `modifier` — prénom, nom, téléphone, fonction. */
  @Post('users/:id/identity')
  @RequirePermission('comptes.staff')
  updateIdentity(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        prenom: z.string().trim().min(1).max(100),
        nom: z.string().trim().min(1).max(100),
        telephone: z.string().trim().max(20).optional(),
        fonction: z.string().trim().max(100).optional(),
      })
      .parse(raw ?? {});
    return this.accounts.updateIdentity(
      uuid.parse(id),
      { prenom: body.prenom, nom: body.nom, telephone: body.telephone || null, fonction: body.fonction ?? '' },
      request.auth!.userId,
    );
  }

  /** Son action `identifiant` — le nom de connexion. */
  @Post('users/:id/username')
  @RequirePermission('comptes.staff')
  setUsername(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ identifiant: z.string().max(200) }).parse(raw ?? {});
    return this.accounts.setUsername(uuid.parse(id), body.identifiant, request.auth!.userId);
  }

  @Post('users/:id/active')
  @RequirePermission('comptes.staff', 'comptes.professeurs', 'comptes.parents')
  setActive(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ active: z.boolean() }).parse(raw ?? {});
    return this.accounts.setActive(uuid.parse(id), body.active, request.auth!.userId);
  }

  @Post('users/:id/roles')
  @RequirePermission('comptes.staff')
  setRoles(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({ roles: z.array(z.string().trim().min(2).max(40)).min(1).max(6) })
      .parse(raw ?? {});
    return this.accounts.setRoles(uuid.parse(id), body.roles, request.auth!.userId);
  }

  /** Le « Supprimer » de `ajouter_staff.php`. */
  @Delete('staff/:id')
  @RequirePermission('comptes.staff')
  deleteStaff(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.accounts.deleteStaff(uuid.parse(id), request.auth!.userId);
  }

  @Post('staff/:id')
  @RequirePermission('comptes.staff')
  updateStaff(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        jobTitle: z.string().trim().max(80).optional(),
        salary: money.optional(),
        phone: z.string().trim().max(40).optional(),
        hiredOn: z.string().date().optional(),
        isActive: z.boolean().optional(),
        paidMonths: z.array(z.coerce.number().int().min(1).max(12)).max(12).optional(),
      })
      .parse(raw ?? {});
    return this.accounts.updateStaff(uuid.parse(id), body, request.auth!.userId);
  }

  @Post('teachers/:id')
  @RequirePermission('comptes.professeurs')
  updateTeacher(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        phone: z.string().trim().max(40).optional(),
        employment: z.enum(['permanent', 'interim']).optional(),
        salary: money.optional(),
        hourlyRate: money.optional(),
      })
      .parse(raw ?? {});
    return this.accounts.updateTeacher(uuid.parse(id), body, request.auth!.userId);
  }

  /** Login history, scoped to people who belong to this school. */
  /** LES CONNEXIONS D'UN JOUR — `historique.php`, ses deux onglets. */
  @Get('connection-history')
  @RequirePermission('journal.consulter')
  connectionHistory(@Query('jour') jour?: string, @Query('tab') tab?: string) {
    const day = estDateIso(jour) ? jour : new Date().toISOString().slice(0, 10);
    return this.accounts.connectionHistory({
      day,
      tab: tab === 'parent' ? 'parent' : 'staff',
    });
  }
}
