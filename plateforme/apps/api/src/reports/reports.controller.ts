import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { ReportsService } from './reports.service.js';
import { RequirePermission, type AuthenticatedRequest } from '../auth/permissions.guard.js';
import { AcademicYearService } from '../academic/academic-year.service.js';
import { dateIso } from '../common/dates.js';

const month = z.coerce.number().int().min(1).max(12);
const year = z.coerce.number().int().min(2000).max(2100);

@Controller('reports')
export class ReportsController {
  constructor(
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(AcademicYearService) private readonly years: AcademicYearService,
  ) {}

  /**
   * The dashboard's four charts, in one call.
   *
   * Behind `finance.consulter` because that is what gates the charts on the page
   * itself: El Ourwa draws them only `if ($peut_voir_finance)` and shows a
   * "Bienvenue" panel to everyone else.
   */
  @Get('dashboard-charts')
  @RequirePermission('finance.consulter', 'finance.rapport')
  dashboardCharts(@Query('academicYearId') academicYearId: string) {
    return this.reports.dashboardCharts(z.string().uuid().parse(academicYearId));
  }

  /**
   * LE TABLEAU DE BORD — `tableau_bord.php`. Les deux effectifs sont visibles
   * de tout compte d'administration (`require_staff_admin()`) ; les chiffres
   * financiers ne sont rendus qu'à qui peut les voir (`est_admin_complet()`).
   */
  @Get('tableau-bord')
  @RequirePermission(
    'finance.consulter', 'finance.rapport', 'scolarite.groupes', 'scolarite.inscrire',
    'scolarite.reinscrire', 'notes.consulter', 'statistiques.consulter', 'comptes.parents',
  )
  async tableauBord(@Query('academicYearId') academicYearId: string | undefined, @Req() request: AuthenticatedRequest) {
    const tb = await this.reports.tableauBord(academicYearId ? z.string().uuid().parse(academicYearId) : null);
    const perms = request.auth!.permissions;
    const roles = request.auth!.roles;
    const peutVoirFinance = perms.includes('finance.consulter') || roles.includes('super_admin') || roles.includes('comptable');
    if (peutVoirFinance) return { ...tb, peutVoirFinance: true };
    return { annee: tb.annee, totalEtudiants: tb.totalEtudiants, totalProfesseurs: tb.totalProfesseurs, peutVoirFinance: false };
  }

  /**
   * The day's or the month's movements, one row each.
   *
   * `revenue_live.php`'s `table_jour` and `table_mois`. A day is asked for by
   * date; a month by number and year.
   */
  @Get('transactions')
  @RequirePermission('finance.consulter', 'finance.rapport')
  transactions(
    @Query('day') day?: string,
    @Query('month') m?: string,
    @Query('year') y?: string,
  ) {
    return this.reports.transactions({
      day: day ? dateIso.parse(day) : undefined,
      month: m ? month.parse(m) : undefined,
      year: y ? year.parse(y) : undefined,
    });
  }

  /** Les entrées d'un jour, par moyen et par origine — `revenue_live.php`. */
  @Get('jour')
  @RequirePermission('finance.consulter', 'finance.rapport')
  jour(@Query('jour') jour: string) {
    return this.reports.revenusDuJour(dateIso.parse(jour));
  }

  /** « Payé aux professeurs / au staff » du mois. */
  @Get('salaires')
  @RequirePermission('finance.consulter', 'finance.rapport')
  salaires(@Query('month') m: string, @Query('year') y: string) {
    return this.reports.salairesDuMois(month.parse(m), year.parse(y));
  }

  @Get('monthly')
  @RequirePermission('finance.rapport')
  monthly(@Query('month') m: string, @Query('year') y: string) {
    return this.reports.monthly(month.parse(m), year.parse(y));
  }

  @Get('daily')
  @RequirePermission('finance.rapport')
  daily(@Query('month') m: string, @Query('year') y: string) {
    return this.reports.dailyCollections(month.parse(m), year.parse(y));
  }

  @Get('methods')
  @RequirePermission('finance.rapport')
  methods(@Query('month') m: string, @Query('year') y: string) {
    return this.reports.byPaymentMethod(month.parse(m), year.parse(y));
  }

  /** « Synthèse — Année scolaire » et le contrôle de caisse, pour l'année consultée. */
  @Get('bilan-annuel')
  @RequirePermission('finance.rapport')
  async bilanAnnuel(@Query('academicYearId') yearId?: string) {
    const annee = yearId
      ? await this.years.byId(z.string().uuid().parse(yearId))
      : await this.years.defaultView();
    return this.reports.bilanAnneeScolaire(annee ?? null);
  }

  /** MIN/MAX(annee) de `paiements` : les bornes de sa liste d'années. */
  @Get('bornes-annees')
  @RequirePermission('finance.consulter', 'finance.rapport')
  bornesAnnees() {
    return this.reports.bornesAnnees();
  }

  @Get('year-to-date')
  @RequirePermission('finance.rapport')
  yearToDate(@Query('startYear') y: string) {
    return this.reports.yearToDate(year.parse(y));
  }

  /** The last month that has anything in it, for an empty month to point at. */
  @Get('latest')
  @RequirePermission('finance.rapport')
  latest() {
    return this.reports.mostRecentActivity();
  }

  /** The till as it stands right now, watched during the day. */
  @Get('today')
  @RequirePermission('finance.consulter', 'finance.rapport')
  today() {
    return this.reports.today();
  }

  /** Headcount, not money, hence a different permission. */
  @Get('statistics')
  @RequirePermission('statistiques.consulter')
  statistics(@Query('academicYearId') academicYearId: string) {
    return this.reports.statistics(z.string().uuid().parse(academicYearId));
  }
}
