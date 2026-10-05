import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { PayrollService } from './payroll.service.js';
import { estDateIso } from '../common/dates.js';
import {
  RequirePermission,
  RequireRole,
  type AuthenticatedRequest,
} from '../auth/permissions.guard.js';

const uuid = z.string().uuid();
const money = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a decimal string');
const payeeKind = z.enum(['staff', 'teacher']);
const month = z.coerce.number().int().min(1).max(12);
const year = z.coerce.number().int().min(2000).max(2100);

/**
 * Payroll, loans and withdrawals.
 *
 * Every route here is behind `finance.salaires`. It is the one permission that
 * exposes what colleagues earn, so it is deliberately narrow: the accountant and
 * the super administrator hold it, the administrator does not.
 */
@Controller('payroll')
/**
 * ⚠ `finance.consulter` EN SECOND, ET C'EST LE COMPTABLE QUI PASSE PAR LÀ.
 *
 * `paiement_staff.php` et `dette.php` sont gardées par `require_finance_page()`,
 * dont le cœur est `est_admin_complet()` — vrai dès qu'on détient
 * `finance.consulter`. Et AUCUNE de leurs actions ne refuse le comptable : ni
 * `payer_salaire`, ni `retirer_admin`, ni `creer_pret`, ni `rembourser`.
 * `finance.salaires` y est déclarée, distribuée, et jamais lue — comme
 * `finance.dette`.
 *
 * Nous l'appliquions réellement, si bien que le comptable ne pouvait ni payer un
 * salaire ni enregistrer un retrait, alors que c'est son travail chez lui. Les
 * deux permissions ensemble décrivent exactement l'ensemble qu'`est_admin_complet()`
 * laisse entrer : le super administrateur et le comptable.
 *
 * Ce qui reste fermé au comptable l'est par sa propre garde : les fiches de
 * porteurs de fonds (`@RequireRole`), les plafonds chiffrés (retirés de la
 * réponse), et le tarif d'un professeur — `gerer_professeurs.php` est gardée par
 * `require_staff_admin()`, qui ne l'admet pas.
 */
@RequirePermission('finance.salaires', 'finance.consulter')
export class PayrollController {
  constructor(@Inject(PayrollService) private readonly payroll: PayrollService) {}

  @Get('payees')
  payees() {
    return this.payroll.payees();
  }

  /**
   * `paiement_staff.php?type=…&mois=…&annee=…` — la page entière, calculée.
   * `type` ∈ {staff, profs, admins}, défaut staff, comme chez lui.
   */
  @Get('staff-pay')
  staffPay(
    @Query('type') type: string | undefined,
    @Query('mois') mois: string | undefined,
    @Query('annee') annee: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const t = ['staff', 'profs', 'admins'].includes(type ?? '') ? type! : 'staff';
    const m = month.safeParse(mois);
    return this.payroll.staffPay(
      t as 'staff' | 'profs' | 'admins',
      m.success ? m.data : null,
      year.parse(annee),
      request.auth!.roles,
    );
  }

  /** `payer_salaire` : le montant est la somme des moyens de paiement. */
  @Post('salaries')
  paySalary(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        payeeKind,
        payeeId: uuid,
        calendarMonth: month,
        calendarYear: year,
        note: z.string().trim().max(255).optional(),
        tender: z.array(z.object({ paymentMethodId: uuid, amount: money, reference: z.string().trim().max(60).optional().nullable() })).max(20),
      })
      .parse(raw ?? {});
    return this.payroll.paySalary(body, request.auth!.userId);
  }

  /** Le reçu « SAL-000123 » — le bloc `print_recu_salaire`. */
  @Get('salaries/:id/receipt')
  salaryReceipt(@Param('id') id: string) {
    return this.payroll.salaryReceipt(uuid.parse(id));
  }

  /** Ce que le formulaire « Prêt au personnel » de `dette.php` affiche. */
  @Get('loans/form')
  loanFormData() {
    return this.payroll.loanFormData();
  }

  /** « Prêts en cours & soldés » — le tableau complet de `dette.php`, échéanciers compris. */
  @Get('loans')
  allLoans() {
    return this.payroll.allLoans();
  }

  /** Le contrat de prêt « PRET-000123 » — `print_recu_pret`. */
  @Get('loans/:id/contract')
  loanContract(@Param('id') id: string) {
    return this.payroll.loanContract(uuid.parse(id));
  }

  @Get('loans/:kind/:payeeId')
  loans(@Param('kind') kind: string, @Param('payeeId') payeeId: string) {
    return this.payroll.loansFor(payeeKind.parse(kind), uuid.parse(payeeId));
  }

  /** `creer_pret` : les mois cochés, et la remise des fonds par moyens de paiement. */
  @Post('loans')
  grantLoan(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        payeeKind,
        payeeId: uuid,
        principal: money,
        months: z
          .array(
            z.object({
              month: z.coerce.number().int().min(1).max(12),
              year: z.coerce.number().int().min(2000).max(2100),
            }),
          )
          .max(60),
        reason: z.string().trim().max(255).optional(),
        tender: z.array(z.object({ paymentMethodId: uuid, amount: money, reference: z.string().trim().max(60).optional().nullable() })).max(20),
      })
      .parse(raw ?? {});
    return this.payroll.grantLoan(body, request.auth!.userId);
  }

  /** `avance_pret` : le montant est la somme des moyens de paiement. */
  @Post('loans/:id/repay')
  repayLoan(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({ tender: z.array(z.object({ paymentMethodId: uuid, amount: money, reference: z.string().trim().max(60).optional().nullable() })).max(20) })
      .parse(raw ?? {});
    return this.payroll.repayLoan(uuid.parse(id), body.tender, request.auth!.userId);
  }

  /** Le reçu d'avance « PRT-… » — `print_recu_avance`. */
  @Get('loan-repayments/:id/receipt')
  loanRepaymentReceipt(@Param('id') id: string) {
    return this.payroll.loanRepaymentReceipt(uuid.parse(id));
  }

  @Get('fund-holders')
  fundHolders(
    @Query('month') m: string,
    @Query('year') y: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.payroll.fundHolders(month.parse(m), year.parse(y), request.auth!.roles);
  }

  /**
   * AJOUTER / CORRIGER / BASCULER UN PORTEUR DE FONDS.
   *
   * ⚠ RÉSERVÉ À L'ADMINISTRATION, comme sa page : « Gestion (ajout, limite,
   * activation) : administration uniquement. » Le comptable VOIT le tableau —
   * il enregistre les retraits — et ne touche ni aux plafonds ni aux fiches.
   * Sa colonne « Gestion » est d'ailleurs masquée pour lui.
   */
  @Post('fund-holders')
  @RequirePermission('finance.depenser')
  @RequireRole('super_admin', 'admin')
  addFundHolder(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        fullName: z.string().trim().min(3).max(150),
        phone: z.string().trim().max(30).optional(),
        monthlyLimit: money,
      })
      .parse(raw ?? {});
    return this.payroll.addFundHolder(body, request.auth!.userId);
  }

  @Post('fund-holders/:id')
  @RequirePermission('finance.depenser')
  @RequireRole('super_admin', 'admin')
  updateFundHolder(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = z
      .object({ monthlyLimit: money, phone: z.string().trim().max(30).optional() })
      .parse(raw ?? {});
    return this.payroll.updateFundHolder(uuid.parse(id), body, request.auth!.userId);
  }

  @Post('fund-holders/:id/toggle')
  @RequirePermission('finance.depenser')
  @RequireRole('super_admin', 'admin')
  toggleFundHolder(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.payroll.toggleFundHolder(uuid.parse(id), request.auth!.userId);
  }

  /** LE RAPPORT DES RETRAITS — journalier, mensuel ou annuel. */
  @Get('withdrawals/report')
  withdrawalReport(
    @Query('rapport') rapport?: string,
    @Query('date') date?: string,
    @Query('mois') mois?: string,
    @Query('annee') annee?: string,
  ) {
    const kind = rapport === 'jour' || rapport === 'annee' ? rapport : 'mois';
    const now = new Date();
    return this.payroll.withdrawalReport({
      kind,
      date: estDateIso(date) ? date : now.toISOString().slice(0, 10),
      month: mois ? month.parse(mois) : now.getMonth() + 1,
      year: annee ? year.parse(annee) : now.getFullYear(),
    });
  }

  @Post('withdrawals')
  withdraw(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        fundHolderId: uuid,
        calendarMonth: month,
        calendarYear: year,
        reason: z.string().trim().max(255).optional(),
        tender: z.array(z.object({ paymentMethodId: uuid, amount: money, reference: z.string().trim().max(60).optional().nullable() })).max(20),
      })
      .parse(raw ?? {});
    return this.payroll.withdraw(body, request.auth!.userId, request.auth!.roles);
  }

  /** Le reçu de retrait — le bloc `print_recu_retrait` d'`administrateurs.php`. */
  @Get('withdrawals/:id/receipt')
  withdrawalReceipt(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.payroll.withdrawalReceipt(uuid.parse(id), request.auth!.roles);
  }
}
