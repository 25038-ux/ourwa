import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { validatePassword } from '@elourwa/shared';
import { PlatformService } from './platform.service.js';
import { ConsoleGuard } from './console.guard.js';
import { clientIp } from '../auth/client-ip.js';
import type { AuthenticatedRequest } from '../auth/permissions.guard.js';

/**
 * ⚠ ITS POLICY, NOT JUST A LENGTH. `z.string().min(8)` accepted "aaaaaaaa";
 * El Ourwa's `valider_mot_de_passe()` also requires three of four character
 * classes. Shared so every place that sets a password asks the same question —
 * a policy enforced on one screen and not another is not a policy.
 */
const motDePasse = (max: number) =>
  z
    .string()
    .max(max)
    .superRefine((value, ctx) => {
      const problem = validatePassword(value);
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    });

const uuid = z.string().uuid();

/**
 * The platform console, at admin.<domain>.
 *
 * Every handler asserts platform-admin status inside the service. There is no
 * permission decorator here on purpose: branch permissions are a different
 * order of authority and must not be able to open these doors.
 */
@UseGuards(ConsoleGuard)
@UseGuards(ConsoleGuard)
@Controller('platform')
export class PlatformConsoleController {
  constructor(@Inject(PlatformService) private readonly platform: PlatformService) {}

  @Get('branches')
  branches(@Req() request: AuthenticatedRequest) {
    return this.platform.listBranches(request.auth!.userId);
  }

  @Post('branches')
  create(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        slug: z.string().trim().toLowerCase().min(2).max(31),
        name: z.string().trim().min(2).max(120),
        nameAr: z.string().trim().max(120).optional(),
        currency: z.string().length(3).optional(),
        locale: z.enum(['fr', 'ar']).optional(),
        themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        logoEmoji: z.string().max(8).optional(),
        receiptPrefix: z.string().trim().max(8).optional(),
      })
      .parse(raw ?? {});
    return this.platform.createBranch(body, request.auth!.userId);
  }

  @Post('branches/:id/admin')
  appoint(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        email: z.string().email(),
        fullName: z.string().trim().min(2).max(120),
        password: motDePasse(400),
      })
      .parse(raw ?? {});
    return this.platform.appointAdmin(uuid.parse(id), body, request.auth!.userId);
  }

  /** Enter a branch. Time-boxed, audited, and through normal RLS. */
  @Post('branches/:id/enter')
  enter(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.platform.enterBranch(uuid.parse(id), request.auth!.userId, clientIp(request));
  }

  @Post('branches/:id/leave')
  async leave(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    await this.platform.leaveBranch(uuid.parse(id), request.auth!.userId, clientIp(request));
    return { ok: true };
  }

  /**
   * LA FACTURATION — élèves × tarif, per branch and per class.
   *
   * ⚠ Its console exists to answer this and ours could not. What a branch
   * COLLECTS is the school's business; what it OWES the platform is a different
   * number entirely.
   */
  /**
   * Suspendre ou réouvrir une branche — la commande que la console affichait
   * sans l'avoir. Voir `setBranchActive`.
   */
  @Post('branches/:id/active')
  setActive(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ active: z.boolean() }).parse(raw ?? {});
    return this.platform.setBranchActive(uuid.parse(id), body.active, request.auth!.userId);
  }

  @Get('billing')
  billing(@Req() request: AuthenticatedRequest) {
    return this.platform.billing(request.auth!.userId);
  }

  /**
   * Change the per-pupil tariff. Audited — it bills every branch.
   *
   * ⚠ Une CHAÎNE décimale, jamais `z.coerce.number()` : c'est un montant, et
   * le faire passer par un flottant avant même de l'écrire est le premier
   * endroit où un centime disparaît (règle 6).
   */
  @Post('tariff')
  async setTariff(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        amount: z
          .string()
          .trim()
          .regex(/^\d{1,7}(\.\d{1,2})?$/, 'Le tarif doit être un montant.'),
      })
      .parse(raw ?? {});
    await this.platform.setPerStudentTariff(body.amount, request.auth!.userId);
    return { tariff: body.amount };
  }

  @Get('finance')
  finance(@Req() request: AuthenticatedRequest) {
    return this.platform.combinedFinance(request.auth!.userId);
  }

  /** Le cumul de toutes les branches : aujourd'hui, le mois, l'année. */
  @Get('tableau-bord')
  tableauBord(
    @Req() request: AuthenticatedRequest,
    @Query('mois') m?: string,
    @Query('annee') a?: string,
  ) {
    const now = new Date();
    const mois = z.coerce.number().int().min(1).max(12).parse(m ?? now.getMonth() + 1);
    const annee = z.coerce.number().int().min(2000).max(2100).parse(a ?? now.getFullYear());
    return this.platform.tableauBord(request.auth!.userId, mois, annee);
  }

  @Get('admins')
  admins(@Req() request: AuthenticatedRequest) {
    return this.platform.listPlatformAdmins(request.auth!.userId);
  }

  @Post('admins')
  createAdmin(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        fullName: z.string().max(200),
        identifier: z.string().max(200),
        password: z.string().max(400),
      })
      .parse(raw ?? {});
    return this.platform.createPlatformAdmin(body, request.auth!.userId, clientIp(request as never));
  }

  @Post('admins/:id/active')
  setAdminActive(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ active: z.boolean() }).parse(raw ?? {});
    return this.platform.setPlatformAdminActive(uuid.parse(id), body.active, request.auth!.userId, clientIp(request as never));
  }
}
