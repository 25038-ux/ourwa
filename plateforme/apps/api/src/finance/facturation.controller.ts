import {
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { ExamAccessService } from '../exams/exam-access.service.js';
import {
  RequirePermission,
  RequireRole,
  type AuthenticatedRequest,
} from '../auth/permissions.guard.js';
import { AcademicYearService } from '../academic/academic-year.service.js';
import { TarifsService } from './tarifs.service.js';
import { StudentServicesService } from './student-services.service.js';
import { PaymentsService } from './payments.service.js';
import {
  montantOuVideSchema,
  serviceOptionnelSchema,
  studyModeSchema,
} from './facturation.schemas.js';

const uuid = z.string().uuid();
const mois = z.coerce.number().int().min(1).max(12);
const annee = z.coerce.number().int().min(2000).max(2100);

/**
 * LA FACTURATION « SERVICES » (Jinan) — ADR-0073, docs/specs/jinan-facturation.md.
 *
 * La page « Frais » (§9), les abonnements d'un élève (§4) et le changement de
 * mode d'étude (§2). Chemins complets, parce que deux préfixes cohabitent :
 * `/finance/...` et `/levels/:id/tarifs`, à côté des autres éditions d'un niveau.
 *
 * ⚠ QUI FAIT QUOI (§4), et aucune permission nouvelle — le catalogue est figé
 * (`permission-names.spec.ts`) :
 *
 *   lire les tarifs ............ le personnel qui inscrit, réinscrit ou encaisse
 *   prix et tarifs ............. `scolarite.niveaux` + rôle direction
 *   souscrire depuis la fiche .. `finance.encaisser` (la caisse)
 *   arrêter, exempter, mode .... `finance.dette` + rôle direction, comme les
 *                                exemptions de scolarité : le comptable détient
 *                                `finance.dette`, c'est le rôle qui l'arrête
 *                                (`caisse-direction-only.spec.ts`)
 *   annuler un paiement ........ `finance.encaisser` + rôle direction, comme
 *                                `payments/:id/reverse`
 *
 * L'ENCAISSEMENT des services, lui, n'a pas de route à lui : il passe par le
 * reçu groupé (`POST /finance/caisse/encaissement`, champ `services`), §5.
 *
 * Chaque geste qui change ce qu'une famille doit fait tourner le cliquet des
 * examens (`afterCollection`) une fois la transaction close, sans jamais
 * pouvoir la faire échouer.
 */
@Controller()
export class FacturationController {
  constructor(
    @Inject(TarifsService) private readonly tarifs: TarifsService,
    @Inject(StudentServicesService) private readonly abonnements: StudentServicesService,
    @Inject(AcademicYearService) private readonly years: AcademicYearService,
    @Inject(ExamAccessService) private readonly examAccess: ExamAccessService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}

  /** La page « Frais » : les tarifs des niveaux et les six prix de l'année. */
  @Get('finance/tarifs')
  @RequirePermission(
    'scolarite.niveaux', 'scolarite.inscrire', 'scolarite.reinscrire',
    'finance.encaisser', 'finance.consulter',
  )
  tarifsDeLAnnee(@Query('academicYearId') academicYearId?: string) {
    return this.tarifs.tarifs(academicYearId ? uuid.parse(academicYearId) : undefined);
  }

  /** Les tarifs 8h – 14h, 8h – 17h et les frais d'inscription d'un niveau. */
  @Patch('levels/:id/tarifs')
  @RequirePermission('scolarite.niveaux')
  @RequireRole('super_admin', 'admin')
  setLevelTarifs(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        tarif8h14: montantOuVideSchema.optional(),
        tarif8h17: montantOuVideSchema.optional(),
        fraisInscription: montantOuVideSchema.optional(),
      })
      .parse(raw ?? {});
    return this.tarifs.setLevelTarifs(uuid.parse(id), body, request.auth!.userId);
  }

  /** Les prix des services d'une année : `{ code: montant | '' }`. Année close refusée. */
  @Post('finance/tarifs/services')
  @RequirePermission('scolarite.niveaux')
  @RequireRole('super_admin', 'admin')
  setServicePrices(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        academicYearId: uuid,
        prix: z.record(z.string(), montantOuVideSchema),
      })
      .parse(raw ?? {});
    return this.tarifs.setServicePrices(body, request.auth!.userId);
  }

  /** Les abonnements d'un élève pour une année, mois par mois. */
  @Get('finance/students/:studentId/services')
  @RequirePermission('finance.consulter', 'finance.encaisser', 'scolarite.inscrire', 'scolarite.reinscrire')
  async servicesOf(
    @Param('studentId') studentId: string,
    @Query('academicYearId') academicYearId?: string,
  ) {
    const yearId = academicYearId
      ? uuid.parse(academicYearId)
      : ((await this.years.active()) ?? (await this.years.defaultView()))?.id;
    if (!yearId) return [];
    return this.abonnements.forStudent(uuid.parse(studentId), yearId);
  }

  /** Souscrire un service depuis la fiche — la caisse. */
  @Post('finance/students/:studentId/services')
  @RequirePermission('finance.encaisser')
  async subscribe(
    @Param('studentId') studentId: string,
    @Body() raw: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = z
      .object({
        service: serviceOptionnelSchema,
        academicYearId: uuid.optional(),
        startMonth: mois.optional(),
        startYear: annee.optional(),
      })
      .parse(raw ?? {});
    const result = await this.abonnements.subscribe(
      { ...body, studentId: uuid.parse(studentId) },
      request.auth!.userId,
    );
    await this.cliquet(result.guardianId, result.academicYearId);
    return result;
  }

  /** Arrêter un service à partir d'un mois (défaut : le mois suivant) — direction seule. */
  @Post('finance/student-services/:id/stop')
  @RequirePermission('finance.dette')
  @RequireRole('super_admin', 'admin')
  async stop(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({ fromMonth: mois.optional(), fromYear: annee.optional() })
      .parse(raw ?? {});
    const result = await this.abonnements.stop(uuid.parse(id), body, request.auth!.userId);
    await this.cliquet(result.guardianId, result.academicYearId);
    return result;
  }

  /** Exempter un service (`exempt: true`, défaut) ou lever l'exemption (`false`) — direction seule. */
  @Post('finance/student-services/:id/exempt')
  @RequirePermission('finance.dette')
  @RequireRole('super_admin', 'admin')
  async exempt(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        exempt: z.boolean().optional(),
        reason: z.string().trim().max(255).optional(),
      })
      .parse(raw ?? {});
    const result = await this.abonnements.setExempt(
      uuid.parse(id),
      { exempt: body.exempt ?? true, reason: body.reason ?? null },
      request.auth!.userId,
    );
    await this.cliquet(result.guardianId, result.academicYearId);
    return result;
  }

  /** Changer le mode d'étude en cours d'année : les mois non réglés seulement — direction seule. */
  @Post('finance/concessions/study-mode')
  @RequirePermission('finance.dette')
  @RequireRole('super_admin', 'admin')
  async changeStudyMode(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        studentId: uuid,
        academicYearId: uuid.optional(),
        studyMode: studyModeSchema,
        reason: z.string().trim().max(255).optional(),
      })
      .parse(raw ?? {});
    const result = await this.tarifs.changeStudyMode(body, request.auth!.userId);
    await this.cliquet(result.guardianId, result.academicYearId);
    return result;
  }

  /**
   * Annuler un paiement de service (§5) — la garde de `payments/:id/reverse`,
   * mot pour mot : la caisse encaisse, la direction seule annule (son
   * `annuler_paiement`, `caisse-direction-only.spec.ts`). Une ligne négative, un
   * numéro à elle ; le motif est obligatoire.
   */
  @Post('finance/service-payments/:id/reverse')
  @RequirePermission('finance.encaisser')
  @RequireRole('super_admin', 'admin')
  async reverseServicePayment(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ reason: z.string().trim().min(3).max(255) }).parse(raw ?? {});
    const result = await this.payments.reverseServicePayment(uuid.parse(id), body.reason, request.auth!.userId);
    await this.cliquet(result.guardianId, result.academicYearId);
    return result;
  }

  /** Le cliquet des examens, après la transaction ; ne fait jamais échouer le geste. */
  private async cliquet(guardianId: string | null, academicYearId: string): Promise<void> {
    await this.examAccess.afterCollection(guardianId, academicYearId).catch((error: unknown) => {
      new Logger('FacturationController').error(
        'cliquet des examens raté après un changement de services',
        error instanceof Error ? error.stack : String(error),
      );
    });
  }
}
