import { Body, Controller, Delete, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { EveningService } from './evening.service.js';
import {
  RequirePermission,
  RequireRole,
  type AuthenticatedRequest,
} from '../auth/permissions.guard.js';

const uuid = z.string().uuid();
const money = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a decimal string');

@Controller('evening')
export class EveningController {
  constructor(@Inject(EveningService) private readonly evening: EveningService) {}

  @Get('groups')
  @RequirePermission('finance.consulter', 'scolarite.groupes')
  groups() {
    return this.evening.groups();
  }

  /**
   * Un professeur externe — someone who teaches evening classes only.
   *
   * ⚠ Behind the same permission as the rest of the evening school, not
   * `comptes.professeurs`: this is not hiring, and an external tutor never
   * reaches the payroll or the staff headcount.
   */
  @Post('teachers')
  @RequirePermission('scolarite.groupes')
  createExternalTeacher(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        firstName: z.string().trim().min(1).max(80),
        lastName: z.string().trim().min(1).max(80),
        phone: z.string().trim().max(40).optional(),
      })
      .parse(raw ?? {});
    return this.evening.createExternalTeacher(body, request.auth!.userId);
  }

  @Get('teachers/external')
  @RequirePermission('scolarite.groupes', 'finance.salaires')
  externalTeachers() {
    return this.evening.externalTeachers();
  }

  @Post('groups')
  @RequirePermission('scolarite.groupes')
  createGroup(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        name: z.string().trim().min(2).max(80),
        monthlyRate: money,
        description: z.string().trim().max(255).optional(),
      })
      .parse(raw ?? {});
    return this.evening.createGroup(body, request.auth!.userId);
  }

  /**
   * LES MOIS OÙ CE GROUPE TOURNE — `cs_groupe_mois`.
   *
   * ⚠ THE TABLE EXISTED AND THE GUARD READ IT; NOTHING COULD SET IT. An evening
   * group is not bound to the school year — it may run three months and stop —
   * and no teacher salary is due for a month outside its list. With no way to
   * write the list, every group was implicitly "all year", which is the fallback
   * rather than the answer.
   *
   * ⚠ AN EMPTY LIST MEANS EVERY MONTH, and that is its rule, not an oversight:
   * `$mois_ok = empty($mois_grp) ? true : in_array(...)`. A group nobody has
   * configured must not become unpayable.
   */
  /**
   * ASSIGNER UN PROFESSEUR — its `assigner_prof`.
   *
   * ⚠ Behind `scolarite.groupes` — the same right that creates an evening group
   * and sets its billable months — because this decides a salary and belongs
   * with the rest of the evening school's administration.
   */
  @Post('teachings')
  @RequirePermission('scolarite.groupes')
  assignTeacher(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        eveningGroupId: uuid,
        teacherId: uuid.optional(),
        eveningTeacherId: uuid.optional(),
        subject: z.string().max(80),
        payKind: z.enum(['hourly', 'fixed']),
        // ⚠ Strings. hours × rate is what a teacher is paid.
        hourlyRate: z.string().optional(),
        hoursPerMonth: z.coerce.number().int().min(0).max(400).optional(),
        fixedSalary: z.string().optional(),
      })
      .parse(raw ?? {});
    return this.evening.assignTeacher(body, request.auth!.userId);
  }

  @Delete('teachings/:id')
  @RequirePermission('scolarite.groupes')
  async removeTeaching(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    await this.evening.removeTeaching(uuid.parse(id), request.auth!.userId);
    return { removed: true };
  }

  /**
   * APPLIQUER UNE RÉDUCTION — its `appliquer_reduction_cs`.
   *
   * ⚠ NOT THE TILL'S. El Ourwa refuses it to the accountant in so many words —
   * "Les réductions sont réservées à l'administration" — and the reason is the
   * same one that keeps write-offs away from the counter: lowering what a family
   * owes is a decision, and taking their money is a task.
   */
  @Post('discounts')
  @RequirePermission('finance.dette')
  @RequireRole('super_admin', 'admin')
  applyDiscount(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        enrolmentId: uuid,
        calendarMonth: z.coerce.number().int().min(1).max(12),
        calendarYear: z.coerce.number().int().min(2000).max(2100),
        // ⚠ A STRING. A reduction is money.
        amount: money,
        reason: z.string().trim().max(200).optional(),
      })
      .parse(raw ?? {});
    return this.evening.applyDiscount(body, request.auth!.userId);
  }

  /** RETIRER LA RÉDUCTION — its `retirer_reduction_cs`. */
  @Delete('discounts/:enrolmentId/:year/:month')
  @RequirePermission('finance.dette')
  @RequireRole('super_admin', 'admin')
  async removeDiscount(
    @Param('enrolmentId') enrolmentId: string,
    @Param('year') year: string,
    @Param('month') month: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.evening.removeDiscount(
      uuid.parse(enrolmentId),
      z.coerce.number().int().min(1).max(12).parse(month),
      z.coerce.number().int().min(2000).max(2100).parse(year),
      request.auth!.userId,
    );
    return { removed: true };
  }

  /**
   * ANNULER UN PAIEMENT DE PROFESSEUR — its `annuler_paiement_prof_cs`.
   *
   * ⚠ Behind `finance.salaires`, the same right that made the payment. El Ourwa
   * refuses it to the accountant; here the accountant does not hold that
   * permission at all (ADR: the separation the school drew).
   *
   * ⚠ AND IT IS A REVERSING ENTRY, not a delete — see migration 0019. The
   * reason is required: an unexplained cancellation of a salary is the one
   * entry an auditor will ask about.
   */
  @Post('teacher-payments/:id/reverse')
  @RequirePermission('finance.salaires')
  reverseTeacherPayment(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = z.object({ reason: z.string().trim().min(3).max(200) }).parse(raw ?? {});
    return this.evening.reverseTeacherPayment(uuid.parse(id), body.reason, request.auth!.userId);
  }

  /** PROFESSEURS ASSIGNÉS — the group's own table. */
  @Get('groups/:id/teachings')
  @RequirePermission('finance.consulter', 'scolarite.groupes')
  teachingsForGroup(@Param('id') id: string) {
    return this.evening.teachingsForGroup(uuid.parse(id));
  }

  // ── La grille des créneaux ──────────────────────────────────

  /** L'EMPLOI DU TEMPS D'UN GROUPE — sa « Grille des créneaux ». */
  @Get('groups/:id/timetable')
  @RequirePermission('finance.consulter', 'scolarite.groupes')
  timetable(@Param('id') id: string) {
    return this.evening.timetable(uuid.parse(id));
  }

  /**
   * POSER UN CRÉNEAU — `placer_creneau`.
   *
   * ⚠ LA MATIÈRE ET L'ENSEIGNANT SONT VÉRIFIÉS CONTRE LE GROUPE PAR LE SERVICE,
   * pas ici : le schéma ne peut pas dire « l'une des matières de ce groupe »,
   * c'est une requête. Le zod ne garantit donc que la forme.
   */
  @Post('groups/:id/timetable')
  @RequirePermission('scolarite.groupes')
  placeSlot(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        dayOfWeek: z.coerce.number().int().min(1).max(7),
        slot: z.coerce.number().int().min(1).max(7),
        subject: z.string().trim().max(80).optional(),
        eveningTeachingId: uuid.optional(),
      })
      .parse(raw ?? {});
    return this.evening.placeSlot(
      { eveningGroupId: uuid.parse(id), ...body },
      request.auth!.userId,
    );
  }

  /** LIBÉRER UN CRÉNEAU — `effacer_creneau`. « Créneau libéré. » */
  @Post('groups/:id/timetable/clear')
  @RequirePermission('scolarite.groupes')
  clearSlot(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        dayOfWeek: z.coerce.number().int().min(1).max(7),
        slot: z.coerce.number().int().min(1).max(7),
      })
      .parse(raw ?? {});
    return this.evening.clearSlot(
      uuid.parse(id),
      body.dayOfWeek,
      body.slot,
      request.auth!.userId,
    );
  }

  /** MODIFIER UN GROUPE — its `modifier_groupe`. */
  @Post('groups/:id')
  @RequirePermission('scolarite.groupes')
  updateGroup(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        name: z.string().max(80),
        // ⚠ A STRING. This is what every enrolee in the group is billed.
        monthlyRate: z.string().trim(),
        description: z.string().max(400).optional(),
      })
      .parse(raw ?? {});
    return this.evening.updateGroup(uuid.parse(id), body, request.auth!.userId);
  }

  /**
   * SUPPRIMER UN GROUPE — refused once anybody has been enrolled, because its
   * enrolments, payments and teachings all cascade behind the delete.
   */
  @Delete('groups/:id')
  @RequirePermission('scolarite.groupes')
  async deleteGroup(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    await this.evening.deleteGroup(uuid.parse(id), request.auth!.userId);
    return { deleted: true };
  }

  @Get('groups/:id/months')
  @RequirePermission('finance.consulter', 'scolarite.groupes')
  months(@Param('id') id: string, @Query('year') year?: string) {
    return this.evening.groupMonths(
      uuid.parse(id),
      z.coerce.number().int().min(2000).max(2100).parse(year ?? new Date().getFullYear()),
    );
  }

  @Post('groups/:id/months')
  @RequirePermission('scolarite.groupes')
  setMonths(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = z
      .object({
        calendarYear: z.coerce.number().int().min(2000).max(2100),
        months: z.array(z.coerce.number().int().min(1).max(12)),
      })
      .parse(raw ?? {});
    return this.evening.setGroupMonths(
      uuid.parse(id),
      body.calendarYear,
      body.months,
      request.auth!.userId,
    );
  }

  /** Sa fiche de groupe : inscrits, payé et réduction de chaque mois de l'année civile. */
  @Get('groups/:id/detail')
  @RequirePermission('finance.consulter', 'finance.encaisser', 'scolarite.groupes', 'scolarite.inscrire')
  detail(@Param('id') id: string, @Query('year') year: string) {
    return this.evening.groupDetail(uuid.parse(id), z.coerce.number().int().min(2020).max(2100).parse(year));
  }

  @Get('students-index')
  @RequirePermission('scolarite.inscrire', 'scolarite.groupes')
  etudiantsIndex() {
    return this.evening.etudiantsIndex();
  }

  @Get('payments/:id/receipt')
  @RequirePermission('finance.consulter', 'finance.encaisser')
  paymentReceipt(@Param('id') id: string) {
    return this.evening.paymentReceipt(uuid.parse(id));
  }

  @Get('teacher-payments/:id/receipt')
  @RequirePermission('finance.consulter', 'finance.encaisser', 'finance.salaires')
  teacherPaymentReceipt(@Param('id') id: string) {
    return this.evening.teacherPaymentReceipt(uuid.parse(id));
  }

  @Get('groups/:id/roster')
  @RequirePermission('finance.consulter', 'scolarite.groupes')
  roster(@Param('id') id: string) {
    return this.evening.roster(uuid.parse(id));
  }

  @Get('groups/:id/month')
  @RequirePermission('finance.consulter', 'finance.encaisser')
  month(
    @Param('id') id: string,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return this.evening.monthStatus(
      uuid.parse(id),
      z.coerce.number().int().min(1).max(12).parse(month),
      z.coerce.number().int().min(2000).max(2100).parse(year),
    );
  }

  /** Enrol a school student, or an outside person who is not one. */
  @Post('enrolments')
  @RequirePermission('scolarite.inscrire', 'scolarite.groupes')
  enrol(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        eveningGroupId: uuid,
        studentId: uuid.optional(),
        outsiderName: z.string().trim().min(2).max(150).optional(),
        outsiderPhone: z.string().trim().max(40).optional(),
        outsiderSex: z.enum(['M', 'F']).optional(),
      })
      .parse(raw ?? {});
    return this.evening.enrol(body, request.auth!.userId);
  }

  @Post('payments')
  @RequirePermission('finance.encaisser')
  collect(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        enrolmentId: uuid,
        calendarMonth: z.coerce.number().int().min(1).max(12),
        calendarYear: z.coerce.number().int().min(2000).max(2100),
        amount: money,
        paperReference: z.string().trim().max(60).optional(),
        tender: z
          .array(z.object({ paymentMethodId: uuid, amount: money, reference: z.string().trim().max(60).optional().nullable() }))
          .optional(),
      })
      .parse(raw ?? {});
    return this.evening.collect(body, request.auth!.userId);
  }

  // ── Paiement des Professeurs ─────────────────────────────────────────

  /**
   * The second tab of `cours_du_soir.php`, for one month.
   *
   * Behind `finance.depenser`, not `finance.encaisser`: taking money in and
   * paying it out are different authorities, and this pays people.
   */
  @Get('teachers/payroll')
  @RequirePermission('finance.depenser', 'finance.consulter')
  teacherPayroll(@Query('month') month: string, @Query('year') year: string) {
    const m = z.coerce.number().int().min(1).max(12).parse(month);
    const y = z.coerce.number().int().min(2000).max(2100).parse(year);
    return this.evening.teacherPayroll(m, y);
  }

  @Post('teachers/payments')
  @RequirePermission('finance.depenser')
  payTeacher(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        eveningTeachingId: uuid,
        calendarMonth: z.coerce.number().int().min(1).max(12),
        calendarYear: z.coerce.number().int().min(2000).max(2100),
        tender: z
          .array(z.object({ paymentMethodId: uuid, amount: money, reference: z.string().trim().max(60).optional().nullable() }))
          .min(1, 'Indiquez comment la somme est sortie'),
      })
      .parse(raw ?? {});
    return this.evening.payTeacher(body, request.auth!.userId);
  }
}
