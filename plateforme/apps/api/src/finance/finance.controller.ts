import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Logger,
} from '@nestjs/common';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { money as montant, toStorage } from '@elourwa/shared';
import { PaymentsService } from './payments.service.js';
import { CollectionService } from './collection.service.js';
import { ConcessionsService } from './concessions.service.js';
import { DebtService } from './debt.service.js';
import { ExamAccessService } from '../exams/exam-access.service.js';
import { NotificationsService } from '../parent/notifications.service.js';
import { ExpensesService } from './expenses.service.js';
import { FeesService } from './fees.service.js';
import { AcademicYearService } from '../academic/academic-year.service.js';
import {
  RequirePermission,
  RequireRole,
  type AuthenticatedRequest,
} from '../auth/permissions.guard.js';

const uuid = z.string().uuid();
// Money crosses the wire as a STRING. A JSON number would already have lost
// precision by the time it arrived.
const money = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a decimal string');

@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermission('finance.consulter', 'finance.encaisser')
  list(@Query('includeInactive') includeInactive?: string) {
    return this.payments.methods(includeInactive === 'true');
  }

  /**
   * ⚠ ADDING OR DISABLING A MEANS IS THE DIRECTION'S, NOT THE TILL'S. It changes
   * what every future collection can be recorded as; El Ourwa guards the same
   * panel with `est_comptable()` inverted.
   */
  @Post()
  @RequirePermission('finance.dette')
  @RequireRole('super_admin', 'admin')
  add(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ name: z.string().trim().min(2).max(60) }).parse(raw ?? {});
    return this.payments.addMethod(body.name, request.auth!.userId);
  }

  @Post(':id/toggle')
  @RequirePermission('finance.dette')
  @RequireRole('super_admin', 'admin')
  toggle(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.payments.toggleMethod(uuid.parse(id), request.auth!.userId);
  }
}

@Controller('finance')
export class FinanceController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(CollectionService) private readonly collection: CollectionService,
    @Inject(ConcessionsService) private readonly concessions: ConcessionsService,
    @Inject(DebtService) private readonly debts: DebtService,
    @Inject(ExamAccessService) private readonly examAccess: ExamAccessService,
    @Inject(FeesService) private readonly fees: FeesService,
    @Inject(AcademicYearService) private readonly years: AcademicYearService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  @Post('payments')
  @RequirePermission('finance.encaisser')
  async record(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        studentId: uuid,
        academicYearId: uuid,
        calendarMonth: z.coerce.number().int().min(1).max(12),
        calendarYear: z.coerce.number().int().min(2000).max(2100),
        amount: money,
        tender: z
          .array(z.object({ paymentMethodId: uuid, amount: money, reference: z.string().trim().max(60).optional().nullable() }))
          .min(1, 'Record how the money arrived'),
        paperReference: z.string().trim().max(60).optional(),
      })
      .parse(raw ?? {});
    const result = await this.payments.record(body, request.auth!.userId);

    /**
     * ⚠ THE RATCHET FIRES HERE, at the till.
     *
     * "This family was up to date during term 2" can only be recorded while it
     * is true — the debt balance is updated in place and keeps no history. It
     * must not wait for the family to log in either: they may never do so, and
     * the term they paid for would be lost.
     *
     * Never allowed to fail the payment. The money is banked; a missed ratchet
     * write is recoverable on the next page view, an aborted receipt is not.
     */
    await this.examAccess
      .afterCollection(await this.guardianOf(body.studentId), body.academicYearId)
      .catch(journaliserRatchet);

    return result;
  }

  /** The family a payment belongs to, for the exam-access ratchet. */
  private async guardianOf(studentId: string): Promise<string | null> {
    return this.payments.guardianOf(studentId);
  }

  @Post('payments/:id/reverse')
  @RequirePermission('finance.encaisser')
  @RequireRole('super_admin', 'admin')
  reverse(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ reason: z.string().trim().min(3).max(255) }).parse(raw ?? {});
    return this.payments.reverse(uuid.parse(id), body.reason, request.auth!.userId);
  }

  /** `confirmer_paiement` de gestion_caisse.php : un mois, des moyens, ses refus. */
  /** La fenêtre d'encaissement d'une (ré)inscription — `encaissement_fenetre()`. */
  @Get('caisse/encaissement-inscription/:studentId')
  @RequirePermission('finance.encaisser', 'scolarite.inscrire', 'scolarite.reinscrire')
  fenetreInscription(@Param('studentId') studentId: string, @Query('academicYearId') academicYearId?: string) {
    return this.collection.fenetreInscription(uuid.parse(studentId), academicYearId ? uuid.parse(academicYearId) : undefined);
  }

  /**
   * UN SEUL REÇU pour les mois cochés et les frais annuels cochés (0040) —
   * inscription, réinscription et caisse passent tous ici.
   */
  @Post('caisse/encaissement')
  @RequirePermission('finance.encaisser', 'scolarite.inscrire', 'scolarite.reinscrire')
  async encaisserGroupe(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        studentId: uuid,
        academicYearId: uuid.optional(),
        mois: z.array(z.object({ mois: z.coerce.number().int().min(1).max(12), annee: z.coerce.number().int().min(2000).max(2100) })).max(12),
        // Des booléens réels : `z.coerce.boolean()` ferait de « false » un vrai.
        fraisInscription: z.boolean().optional(),
        fraisPhotocopie: z.boolean().optional(),
        // École « services » (ADR-0073, §7) : les échéances de service cochées —
        // un service annuel sans mois. Au plus soixante : trois mensuels actifs
        // (une cantine, la piscine, le docteur) sur douze mois et deux annuels
        // font 38 lignes ; la marge couvre une formule arrêtée puis reprise.
        services: z
          .array(
            z.object({
              studentServiceId: uuid,
              mois: z.coerce.number().int().min(1).max(12).optional(),
              annee: z.coerce.number().int().min(2000).max(2100).optional(),
            }),
          )
          .max(60)
          .optional(),
        tender: z.array(z.object({ paymentMethodId: uuid, amount: money, reference: z.string().trim().max(60).optional().nullable() })).min(1).max(20),
      })
      .parse(raw ?? {});
    const result = await this.collection.encaisserGroupe(body, request.auth!.userId);
    // `examens_apres_encaissement()` : la dette vient de changer.
    await this.examAccess.afterCollection(result.guardianId, result.academicYearId).catch(journaliserRatchet);
    return result;
  }

  @Get('receipt-group/:id')
  @RequirePermission('finance.consulter', 'finance.encaisser', 'scolarite.inscrire', 'scolarite.reinscrire')
  receiptGroup(@Param('id') id: string) {
    return this.payments.receiptGroup(uuid.parse(id));
  }

  /** Son `encaissement_encaisser()` : scolarité du mois + frais annexes, un seul total. */
  @Post('caisse/encaissement-inscription')
  @RequirePermission('finance.encaisser', 'scolarite.inscrire', 'scolarite.reinscrire')
  encaisserInscription(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        studentId: uuid,
        periode: z.string().regex(/^\d{4}-\d{1,2}$/).or(z.literal('')).default(''),
        fraisInscription: z.string().trim().optional(),
        fraisPhotocopie: z.string().trim().optional(),
        tender: z.array(z.object({ paymentMethodId: uuid, amount: money, reference: z.string().trim().max(60).optional().nullable() })).min(1),
      })
      .parse(raw ?? {});
    return this.collection.encaisserInscription(body, request.auth!.userId);
  }

  @Post('caisse/paiement')
  @RequirePermission('finance.encaisser')
  async caissePaiement(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        studentId: uuid,
        mois: z.coerce.number().int().min(1).max(12),
        annee: z.coerce.number().int().min(2020).max(2100),
        tender: z.array(z.object({ paymentMethodId: uuid, amount: money, reference: z.string().trim().max(60).optional().nullable() })).max(20),
      })
      .parse(raw ?? {});
    const result = await this.collection.confirmerPaiement(body, request.auth!.userId);
    // `examens_apres_encaissement()` : la dette vient de changer.
    const guardianId = await this.guardianOf(body.studentId);
    const yearId = await this.payments.yearOfPayment(result.id).catch(() => null);
    if (guardianId && yearId) {
      await this.examAccess.afterCollection(guardianId, yearId).catch(journaliserRatchet);
    }
    return result;
  }

  /** `payer_frais_annuel` de gestion_caisse.php. */
  @Post('annual-fees/:guardianId/pay')
  @RequirePermission('finance.encaisser')
  payerFraisAnnuel(
    @Param('guardianId') guardianId: string,
    @Body() raw: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = z
      .object({
        academicYearId: uuid,
        kind: z.enum(['enrolment', 'photocopy']),
        montant: money,
        tender: z.array(z.object({ paymentMethodId: uuid, amount: money, reference: z.string().trim().max(60).optional().nullable() })).max(20),
      })
      .parse(raw ?? {});
    return this.collection.payerFraisAnnuel(
      { guardianId: uuid.parse(guardianId), ...body },
      request.auth!.userId,
    );
  }

  /** La dette d'une famille TOUTES ANNÉES CONFONDUES — `obtenir_dette_parent_detaillee($db, $pid)` sans année. */
  @Get('debt/:guardianId/all')
  @RequirePermission('finance.consulter', 'finance.dette')
  async debtAll(@Param('guardianId') guardianId: string) {
    const d = await this.debts.detailAcrossYears(uuid.parse(guardianId));
    return {
      tuition: d.tuition,
      // Ses `dettes_diverses` : les créances des familles ET les frais annuels
      // non réglés de l'année ouverte (bloc B bis).
      misc: d.misc,
      annualFees: d.annualFees,
      // École « services » (§6) : les échéances de service dues, comprises
      // dans `total` ; [] dans une école « famille ».
      services: d.services,
      beforeWriteOffs: d.beforeWriteOffs,
      writtenOff: d.writtenOff,
      total: d.total.toFixed(2),
    };
  }

  /** The family's debt, itemised. Never a bare total — a parent will ask why. */
  @Get('debt/:guardianId')
  @RequirePermission('finance.consulter', 'finance.dette')
  async debt(@Param('guardianId') guardianId: string, @Query('academicYearId') yearId?: string) {
    const year = yearId ? await this.years.byId(uuid.parse(yearId)) : await this.years.defaultView();
    if (!year) return { guardianId, tuition: [], annualFees: [], services: [], total: '0.00' };
    return this.debts.forGuardian(uuid.parse(guardianId), year.id, year.start_year);
  }

  /** Families who owe — El Ourwa's `impayes`. */
  @Get('outstanding')
  @RequirePermission('finance.consulter', 'finance.dette')
  async outstanding(@Query('academicYearId') yearId?: string) {
    // `annee_id=toutes` : les dettes de toutes les années additionnées.
    if (yearId === 'toutes') return { families: await this.debts.outstanding(null, null) };
    const year = yearId ? await this.years.byId(uuid.parse(yearId)) : await this.years.defaultView();
    if (!year) return { families: [] };
    return { families: await this.debts.outstanding(year.id, year.start_year) };
  }

  /** The Caisse landing table — search by pupil, correspondent, matricule, phone. */
  @Get('correspondents')
  @RequirePermission('finance.consulter', 'finance.encaisser')
  async correspondents(
    @Query('q') q?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('academicYearId') yearId?: string,
  ) {
    const academicYear = yearId
      ? await this.years.byId(uuid.parse(yearId))
      : await this.years.defaultView();
    if (!academicYear) return [];

    return this.debts.correspondents({
      q,
      unpaidMonth: month ? z.coerce.number().int().min(1).max(12).parse(month) : undefined,
      unpaidYear: year ? z.coerce.number().int().min(2000).max(2100).parse(year) : undefined,
      academicYearId: academicYear.id,
    });
  }

  // ── Dettes diverses ───────────────────────────────────────────────────────

  @Get('misc-debts')
  @RequirePermission('finance.consulter', 'finance.dette')
  miscDebts(@Query('includeSettled') includeSettled?: string) {
    return this.debts.allMiscDebts(includeSettled === 'true');
  }

  @Post('misc-debts')
  @RequirePermission('finance.dette')
  @RequireRole('super_admin', 'admin')
  createMiscDebt(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        debtorName: z.string().trim().min(2).max(150),
        guardianId: uuid.optional(),
        studentId: uuid.optional(),
        phone: z.string().trim().max(20).optional(),
        months: z.coerce.number().int().min(1).max(60).optional(),
        total: money,
        reason: z.string().trim().max(255).optional(),
        // Ses trois colonnes (migration 0026). L'année reste facultative :
        // une créance reprise dont personne ne connaît l'année s'affiche « — »
        // plutôt que sous une année devinée.
        startYear: z.coerce.number().int().min(2000).max(2100).optional(),
        kind: z.enum(['arriere', 'facture']).optional(),
        invoiceSource: z.coerce.number().int().min(1).optional(),
      })
      .parse(raw ?? {});
    return this.debts.createMiscDebt(body, request.auth!.userId);
  }

  @Post('misc-debts/:id/repay')
  @RequirePermission('finance.encaisser', 'finance.dette')
  repayMiscDebt(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    // Son `lire_lignes_paiement(true, 0)` : le montant est la somme des moyens.
    const body = z
      .object({ tender: z.array(z.object({ paymentMethodId: uuid, amount: money, reference: z.string().trim().max(60).optional().nullable() })).max(20) })
      .parse(raw ?? {});
    return this.debts.repayMiscDebt(uuid.parse(id), body.tender, request.auth!.userId);
  }

  /** `dette.php` — sa liste des débiteurs (les dettes sans foyer), avec `?q=`. */
  @Get('misc-debts/debiteurs')
  @RequirePermission('finance.dette', 'finance.encaisser')
  debiteurs(@Query('q') q?: string) {
    return this.debts.debiteurs(String(q ?? '').slice(0, 100));
  }

  /** `dette.php?dette_id=` — le profil d'une dette et son historique. */
  @Get('misc-debts/:id')
  @RequirePermission('finance.dette', 'finance.encaisser')
  miscDebtProfile(@Param('id') id: string) {
    return this.debts.miscDebtProfile(uuid.parse(id));
  }

  /** Le reçu « REMB-… » — `print_recu_remb`. */
  @Get('misc-debt-repayments/:id/receipt')
  @RequirePermission('finance.dette', 'finance.encaisser')
  miscDebtRepaymentReceipt(@Param('id') id: string) {
    return this.debts.miscDebtRepaymentReceipt(uuid.parse(id));
  }

  /**
   * CORRIGER UNE CRÉANCE — `dette_modifier`.
   *
   * ⚠ NOT `finance.dette` ALONE. Creating a créance and repaying one are counter
   * work; moving the remaining balance of one by hand is the direction's, exactly
   * as its `$peut_autoriser` gate says — the same gate that guards « Autoriser
   * une réinscription malgré la dette » on the same screen.
   */
  @Post('misc-debts/:id/correct')
  @RequirePermission('scolarite.niveaux')
  correctMiscDebt(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = z
      .object({
        // ⚠ Le motif est obligatoire : « Le motif est obligatoire. » Un solde
        // qui a changé sans raison attachée est la ligne sur laquelle un
        // vérificateur s'arrête.
        remaining: money,
        reason: z.string().trim().min(3).max(255),
      })
      .parse(raw ?? {});
    return this.debts.correctMiscDebt(
      uuid.parse(id),
      body.remaining,
      body.reason,
      request.auth!.userId,
    );
  }

  /**
   * ANNULER UNE CRÉANCE — `dette_annuler`. Non destructive: "la ligne est
   * conservee, son solde tombe a 0 et le motif est enregistre."
   */
  @Post('misc-debts/:id/cancel')
  @RequirePermission('scolarite.niveaux')
  cancelMiscDebt(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = z.object({ reason: z.string().trim().min(3).max(255) }).parse(raw ?? {});
    return this.debts.cancelMiscDebt(uuid.parse(id), body.reason, request.auth!.userId);
  }

  /** Grant a write-off — a `remise`, not a discount. Direction's decision. */
  @Post('write-offs')
  @RequirePermission('finance.dette')
  @RequireRole('super_admin', 'admin')
  async writeOff(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        guardianId: uuid,
        academicYearId: uuid.optional(),
        amount: money.optional(),
        clearsAll: z.boolean().optional(),
        // Son `motif` est facultatif (`$motif ?: null`).
        reason: z.string().trim().max(500).optional(),
      })
      .parse(raw ?? {});

    const result = await this.debts.grantWriteOff(body, request.auth!.userId);

    // A write-off can settle a family outright, and v16 fires the exam ratchet
    // here for exactly that reason: the debt has just changed, and waiting for
    // the family to log in would cost them the term they were forgiven.
    await this.examAccess
      .afterCollection(body.guardianId, body.academicYearId)
      .catch(journaliserRatchet);

    return result;
  }

  @Post('write-offs/:id/revoke')
  @RequirePermission('finance.dette')
  @RequireRole('super_admin', 'admin')
  revokeWriteOff(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = z.object({ reason: z.string().trim().max(500).optional() }).parse(raw ?? {});
    return this.debts.revokeWriteOff(uuid.parse(id), body.reason ?? '', request.auth!.userId);
  }

  @Get('write-offs/:guardianId')
  @RequirePermission('finance.consulter', 'finance.dette')
  writeOffs(@Param('guardianId') guardianId: string) {
    return this.debts.writeOffsFor(uuid.parse(guardianId));
  }

  /**
   * ENCAISSER UN RÈGLEMENT / AVANCE — a lump sum against a whole family.
   *
   * The debt first, oldest month first, then forward into the rest of the year.
   * The caller names no month and no child: that is the point of the button.
   */
  @Post('collection/global')
  @RequirePermission('finance.encaisser')
  async collectGlobal(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        guardianId: uuid,
        academicYearId: uuid,
        tender: z
          .array(z.object({ paymentMethodId: uuid, amount: money, reference: z.string().trim().max(60).optional().nullable() }))
          .min(1, 'Indiquez comment la somme est arrivée'),
        paperReference: z.string().trim().max(60).optional(),
      })
      .parse(raw ?? {});

    const result = await this.collection.payGlobal(body, request.auth!.userId);

    // The debt has just changed, so the ratchet fires here as it does at the
    // till: a family that no longer owes anything keeps the term they are in.
    await this.examAccess
      .afterCollection(body.guardianId, body.academicYearId)
      .catch(journaliserRatchet);

    return result;
  }

  // ── Exemptions et réductions ──────────────────────────────────────────────
  //
  // ⚠ ALL OF THESE ARE THE DIRECTION'S, NOT THE TILL'S, and `finance.dette` is
  // what says so — the same permission that guards a remise. El Ourwa refuses
  // the accountant outright and, importantly, tells them where to go instead:
  // "Les réductions sont réservées à l'administration. Soumettez une demande de
  // réduction depuis « Demandes »." A refusal that only says no leaves somebody
  // stuck; this one has a next step, and Demandes is a real queue.

  @Get('concessions/:studentId')
  @RequirePermission('finance.consulter', 'finance.dette')
  concessionsFor(@Param('studentId') studentId: string) {
    return this.concessions.forStudent(uuid.parse(studentId));
  }

  /** Exempter un élève — totale, or one named month. */
  @Post('concessions/exemptions')
  @RequirePermission('finance.dette')
  @RequireRole('super_admin', 'admin')
  exempt(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        studentId: uuid,
        kind: z.enum(['full', 'monthly']),
        calendarMonth: z.coerce.number().int().min(1).max(12).optional(),
        calendarYear: z.coerce.number().int().min(2000).max(2100).optional(),
        reason: z.string().trim().max(255).optional(),
      })
      .parse(raw ?? {});

    if (body.kind === 'full') {
      return this.concessions.exemptStudent(
        body.studentId,
        body.reason ?? null,
        request.auth!.userId,
      );
    }
    if (!body.calendarMonth || !body.calendarYear) {
      throw new BadRequestException('Une exemption mensuelle doit nommer un mois.');
    }
    return this.concessions.exemptMonth(
      {
        studentId: body.studentId,
        calendarMonth: body.calendarMonth,
        calendarYear: body.calendarYear,
        reason: body.reason ?? null,
      },
      request.auth!.userId,
    );
  }

  /**
   * MODIFIER LE FRAIS MENSUEL — the negotiated rate for one child.
   *
   * ⚠ Writes the ENROLMENT, not the cached student column El Ourwa writes and
   * its own debt query then ignores. Only months with nothing paid against them
   * are re-priced.
   */
  @Post('concessions/monthly-fee')
  @RequirePermission('finance.dette')
  @RequireRole('super_admin', 'admin')
  changeFee(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        studentId: uuid,
        academicYearId: uuid,
        amount: money,
        reason: z.string().trim().max(255).optional(),
      })
      .parse(raw ?? {});
    return this.concessions.changeMonthlyFee(
      { ...body, reason: body.reason ?? null },
      request.auth!.userId,
    );
  }

  /** Annuler l'exemption automatique — the month becomes due. */
  @Post('concessions/restore-month')
  @RequirePermission('finance.dette')
  @RequireRole('super_admin', 'admin')
  async restoreMonth(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        studentId: uuid,
        academicYearId: uuid,
        calendarMonth: z.coerce.number().int().min(1).max(12),
        calendarYear: z.coerce.number().int().min(2000).max(2100),
      })
      .parse(raw ?? {});
    await this.concessions.restoreMonth(body, request.auth!.userId);
    return { restored: true };
  }

  /**
   * RÉTABLIR L'EXEMPTION AUTOMATIQUE — the inverse of `restore-month`, which
   * did not exist. A month made billable by mistake stayed billable for ever.
   */
  @Post('concessions/re-exempt-month')
  @RequirePermission('finance.dette')
  @RequireRole('super_admin', 'admin')
  async reExemptMonth(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        studentId: uuid,
        academicYearId: uuid,
        calendarMonth: z.coerce.number().int().min(1).max(12),
        calendarYear: z.coerce.number().int().min(2000).max(2100),
      })
      .parse(raw ?? {});
    await this.concessions.reExemptMonth(body, request.auth!.userId);
    return { exempt: true };
  }

  @Delete('concessions/exemptions/:id')
  @RequirePermission('finance.dette')
  @RequireRole('super_admin', 'admin')
  async liftExemption(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    await this.concessions.liftExemption(uuid.parse(id), request.auth!.userId);
    return { lifted: true };
  }

  /** Appliquer une réduction — one month costs less. */
  @Post('concessions/discounts')
  @RequirePermission('finance.dette')
  @RequireRole('super_admin', 'admin')
  async discount(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        studentId: uuid,
        calendarMonth: z.coerce.number().int().min(1).max(12),
        calendarYear: z.coerce.number().int().min(2000).max(2100),
        amount: money,
        reason: z.string().trim().max(255).optional(),
      })
      .parse(raw ?? {});

    await this.concessions.applyDiscount(
      { ...body, reason: body.reason ?? null },
      request.auth!.userId,
    );
    return { applied: true };
  }

  @Delete('concessions/discounts/:studentId/:year/:month')
  @RequirePermission('finance.dette')
  @RequireRole('super_admin', 'admin')
  async removeDiscount(
    @Param('studentId') studentId: string,
    @Param('year') year: string,
    @Param('month') month: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.concessions.removeDiscount(
      uuid.parse(studentId),
      z.coerce.number().int().min(1).max(12).parse(month),
      z.coerce.number().int().min(2000).max(2100).parse(year),
      request.auth!.userId,
    );
    return { removed: true };
  }

  /**
   * The family's profile header — its children, this year, with their real rate.
   *
   * Separate from the debt because a child who owes nothing still belongs on
   * the screen: "3 enfants inscrits" is the figure the operator checks the
   * moment a parent sits down.
   */
  /**
   * LA FICHE DE CHAQUE ENFANT — every month of the year, per child.
   *
   * ⚠ The substance of the caisse screen: what each month cost, whether it was
   * paid, its receipt, and what to do about it if it was not.
   */
  @Get('ledger/:guardianId')
  @RequirePermission('finance.consulter', 'finance.encaisser')
  async ledger(@Param('guardianId') guardianId: string, @Query('academicYearId') yearId?: string) {
    const year = yearId ? await this.years.byId(uuid.parse(yearId)) : await this.years.defaultView();
    if (!year) return { children: [] };
    return this.debts.familyLedger(uuid.parse(guardianId), year.id);
  }

  @Get('family/:guardianId')
  @RequirePermission('finance.consulter', 'finance.encaisser')
  async family(@Param('guardianId') guardianId: string, @Query('academicYearId') yearId?: string) {
    const year = yearId ? await this.years.byId(uuid.parse(yearId)) : await this.years.defaultView();
    if (!year) return { children: [], monthlyTotal: '0.00', freeCount: 0 };

    const id = uuid.parse(guardianId);
    const [children, guardian, years] = await Promise.all([
      this.debts.childrenInSchool(id, year.id),
      // ⚠ The screen has to NAME the family before it takes money from them.
      this.debts.guardianCard(id),
      this.debts.yearsForGuardian(id, year.id),
    ]);
    // Règle 6 : jamais un `number` pour de l'argent, même pour une somme d'entiers.
    const monthlyTotal = toStorage(
      children.reduce((acc, c) => acc.plus(montant(c.fee)), new Decimal(0)),
    );
    return {
      guardian,
      years,
      children,
      monthlyTotal,
      freeCount: children.filter((c) => c.free).length,
      year: { id: year.id, label: year.label, startYear: year.start_year },
    };
  }

  /**
   * THE COLLECTION WINDOW — what it should show before anyone types in it.
   *
   * `includes/encaissement_inscription.php`. The month, both annexe fees and
   * the "Total attendu" come from one place so the screen and the posting can
   * never disagree about what is owed.
   */
  @Get('collection/:studentId')
  @RequirePermission('finance.encaisser')
  async collectionQuote(
    @Param('studentId') studentId: string,
    @Query('academicYearId') yearId?: string,
  ) {
    const year = yearId ? await this.years.byId(uuid.parse(yearId)) : await this.years.defaultView();
    if (!year) return null;
    return this.collection.quote(uuid.parse(studentId), year.id);
  }

  /**
   * Take the money.
   *
   * ⚠ ONE TOTAL, THREE DEBTS. The service splits it — annexe fees first, the
   * remainder to the month — because imputing all of it to the tuition month
   * inflates the month by money that is not its own.
   */
  @Post('collection')
  @RequirePermission('finance.encaisser')
  async collect(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        studentId: uuid,
        academicYearId: uuid,
        calendarMonth: z.coerce.number().int().min(1).max(12),
        calendarYear: z.coerce.number().int().min(2000).max(2100),
        fees: z
          .object({ enrolment: money.optional(), photocopy: money.optional() })
          .partial()
          .default({}),
        tender: z
          .array(z.object({ paymentMethodId: uuid, amount: money, reference: z.string().trim().max(60).optional().nullable() }))
          .min(1, 'Indiquez comment la somme est arrivée'),
        paperReference: z.string().trim().max(60).optional(),
      })
      .parse(raw ?? {});

    const result = await this.collection.collect(body, request.auth!.userId);

    // The ratchet, outside the collection's transaction and never able to fail
    // it. El Ourwa calls `examens_apres_encaissement()` here for the same
    // reason: the money is banked, and a missed ratchet write is recoverable on
    // the next page view where an aborted receipt is not.
    await this.examAccess
      .afterCollection(await this.guardianOf(body.studentId), body.academicYearId)
      .catch(journaliserRatchet);

    return result;
  }

  @Get('annual-fees/:guardianId')
  @RequirePermission('finance.consulter', 'finance.encaisser')
  async annualFees(@Param('guardianId') guardianId: string, @Query('academicYearId') yearId?: string) {
    const year = yearId ? await this.years.byId(uuid.parse(yearId)) : await this.years.defaultView();
    if (!year) return { fees: [] };
    const fees = await this.fees.annualFeesDue(uuid.parse(guardianId), year.id, year.start_year);
    return {
      fees: fees.map((f) => ({
        kind: f.kind,
        label: f.label,
        scale: f.scale.toFixed(2),
        paid: f.paid.toFixed(2),
        remaining: f.remaining.toFixed(2),
        exempt: f.exempt,
      })),
    };
  }

  /**
   * LES VERSEMENTS DE FRAIS ANNUELS — its "Paiements des frais annuels" fold,
   * with the receipt number the family will be asked for.
   */
  @Get('annual-fees/:guardianId/payments')
  @RequirePermission('finance.consulter', 'finance.encaisser')
  async annualFeePayments(
    @Param('guardianId') guardianId: string,
    @Query('academicYearId') yearId?: string,
  ) {
    const year = yearId ? await this.years.byId(uuid.parse(yearId)) : await this.years.defaultView();
    if (!year) return { payments: [] };
    return { payments: await this.fees.paymentsFor(uuid.parse(guardianId), year.id) };
  }

  /**
   * ⚠ WAIVING A FEE AND SETTING ITS AMOUNT ARE BOTH BEHIND `finance.dette`,
   * never `finance.encaisser`. El Ourwa gates them on `$peut_administrer_frais`
   * — the till takes money, it does not decide who stops owing it. Written
   * positively: its older guard was `!est_comptable()`, "everyone except the
   * accountant", which a secretary walked straight through.
   */
  @Post('annual-fees/:guardianId/exempt')
  @RequirePermission('finance.dette')
  @RequireRole('super_admin', 'admin')
  async exemptAnnualFee(
    @Param('guardianId') guardianId: string,
    @Body() raw: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = z
      .object({ kind: z.enum(['enrolment', 'photocopy']), academicYearId: uuid.optional() })
      .parse(raw ?? {});
    const year = body.academicYearId
      ? await this.years.byId(body.academicYearId)
      : await this.years.defaultView();
    if (!year) throw new BadRequestException('Aucune année scolaire.');
    await this.fees.exempt(uuid.parse(guardianId), body.kind, year.id, request.auth!.userId);
    return { exempt: true };
  }

  @Post('annual-fees/:guardianId/remove-exemption')
  @RequirePermission('finance.dette')
  @RequireRole('super_admin', 'admin')
  async removeAnnualFeeExemption(
    @Param('guardianId') guardianId: string,
    @Body() raw: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = z
      .object({ kind: z.enum(['enrolment', 'photocopy']), academicYearId: uuid.optional() })
      .parse(raw ?? {});
    const year = body.academicYearId
      ? await this.years.byId(body.academicYearId)
      : await this.years.defaultView();
    if (!year) throw new BadRequestException('Aucune année scolaire.');
    await this.fees.removeExemption(
      uuid.parse(guardianId), body.kind, year.id, request.auth!.userId,
    );
    return { exempt: false };
  }

  /** CONFIGURER LES MONTANTS — its `configurer_frais_annuels`. */
  @Post('annual-fees/scale')
  @RequirePermission('finance.dette')
  @RequireRole('super_admin', 'admin')
  async setAnnualFeeScale(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        // ⚠ A STRING. `z.coerce.number()` here would turn 1500.50 into a float
        // and hand a rounding error to every family in the school.
        enrolment: z.string().trim().optional(),
        photocopy: z.string().trim().optional(),
        academicYearId: uuid.optional(),
      })
      .parse(raw ?? {});
    const year = body.academicYearId
      ? await this.years.byId(body.academicYearId)
      : await this.years.defaultView();
    if (!year) throw new BadRequestException('Aucune année scolaire.');

    if (body.enrolment !== undefined && body.enrolment !== '') {
      await this.fees.setScale('enrolment', year.start_year, body.enrolment, request.auth!.userId);
    }
    if (body.photocopy !== undefined && body.photocopy !== '') {
      await this.fees.setScale('photocopy', year.start_year, body.photocopy, request.auth!.userId);
    }
    return { saved: true };
  }

  /**
   * Till consistency: tender lines must sum to their payment.
   * Measured, not assumed — a gap makes every report wrong and says nothing.
   */
  /**
   * NOTIFIER LES IMPAYÉS — a payment reminder for one month.
   *
   * ⚠ Behind `finance.encaisser`: it is the till's job to chase what the till
   * is owed. It is also irreversible — a message cannot be recalled — so the
   * screen says how many families it will reach before it is pressed.
   */
  @Post('notify-unpaid')
  @RequirePermission('finance.encaisser')
  notifyUnpaid(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        academicYearId: uuid,
        calendarMonth: z.coerce.number().int().min(1).max(12),
        calendarYear: z.coerce.number().int().min(2000).max(2100),
      })
      .parse(raw ?? {});
    return this.debts.notifyUnpaid(body, request.auth!.userId, (tx, n) =>
      this.notifications.notifier(tx, {
        guardianId: n.guardianId,
        studentId: n.studentId,
        academicYearId: body.academicYearId,
        kind: 'info',
        souche: 'notif_rappel',
        params: { eleve: n.eleve, mois: n.mois },
        route: 'profil',
      }),
    );
  }

  /**
   * LE REÇU — the document a family keeps.
   *
   * ⚠ THE FICHE LINKED TO THIS AND THE LINK WAS DEAD. Every month card carries
   * a "Reçu" button and there was no route behind it.
   */
  @Get('receipt/:paymentId')
  @RequirePermission('finance.consulter', 'finance.encaisser')
  async receipt(@Param('paymentId') paymentId: string) {
    const id = uuid.parse(paymentId);
    return { ...(await this.payments.receipt(id)), receiptId: await this.payments.receiptOf(id) };
  }

  /**
   * LE REÇU D'UN FRAIS ANNUEL — its `print_recu_annuel`, a second document.
   *
   * ⚠ An annual fee belongs to the FAMILY. Printing it on a month's receipt
   * template would name a child, and the paper would then read as though the
   * enrolment fee had been settled for that one child and was still owed for
   * their brother.
   */
  @Get('receipt/annual/:id')
  @RequirePermission('finance.consulter', 'finance.encaisser')
  annualReceipt(@Param('id') id: string) {
    return this.payments.annualFeeReceipt(uuid.parse(id));
  }

  @Get('till-check')
  @RequirePermission('finance.consulter', 'finance.rapport')
  tillCheck() {
    return this.payments.tillConsistency();
  }
}

/**
 * Expenses — money out that is not salary.
 *
 * Behind `finance.depenser`, which is deliberately narrower than
 * `finance.encaisser`: taking money in and paying money out are different
 * authorities, and the secretary holds neither.
 */
@Controller('expenses')
export class ExpensesController {
  constructor(@Inject(ExpensesService) private readonly expenses: ExpensesService) {}

  /** L'historique entier et le total — `depenses.php` ne filtre rien. */
  @Get()
  @RequirePermission('finance.consulter', 'finance.depenser', 'finance.rapport')
  list() {
    return this.expenses.list();
  }

  /** Le bon de dépense « DEP-000123 » — le bloc `print_bon`. */
  @Get(':id/receipt')
  @RequirePermission('finance.consulter', 'finance.depenser', 'finance.rapport')
  receipt(@Param('id') id: string) {
    return this.expenses.receipt(uuid.parse(id));
  }

  /** Son action `ajouter` : montant, description, et les moyens qui doivent l'égaler. */
  @Post()
  @RequirePermission('finance.depenser')
  async record(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        amount: money,
        description: z.string().trim().min(1).max(2000),
        tender: z.array(z.object({ paymentMethodId: uuid, amount: money, reference: z.string().trim().max(60).optional().nullable() })).max(20),
      })
      .parse(raw ?? {});
    return this.expenses.record(body, request.auth!.userId);
  }

  /**
   * ⚠ ANNULER UNE DÉPENSE EST UN GESTE DE DIRECTION. `depenses.php` refuse le
   * comptable en toutes lettres : « La suppression d'une dépense est réservée à
   * l'administration. » Celui qui sort l'argent de la caisse ne décide pas seul
   * d'effacer la trace de l'avoir sorti — chez lui c'est une suppression, chez
   * nous une écriture inverse (règle 7), mais l'autorité en jeu est la même.
   */
  @Post(':id/reverse')
  @RequirePermission('finance.depenser')
  @RequireRole('super_admin', 'admin')
  reverse(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ reason: z.string().trim().min(3).max(255) }).parse(raw ?? {});
    return this.expenses.reverse(
      z.string().uuid().parse(id),
      body.reason,
      request.auth!.userId,
    );
  }
}

/**
 * Le cliquet des examens ne fait jamais échouer un encaissement — mais son
 * échec est ÉCRIT : cinq `.catch(() => undefined)` faisaient disparaître, sans
 * une ligne, la raison pour laquelle une famille payée restait sans résultats.
 */
function journaliserRatchet(error: unknown): undefined {
  new Logger('FinanceController').error('cliquet des examens raté après un encaissement', error instanceof Error ? error.stack : String(error));
  return undefined;
}
