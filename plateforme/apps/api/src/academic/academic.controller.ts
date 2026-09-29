import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { AcademicYearService } from './academic-year.service.js';
import { DbService } from '../db/db.service.js';
import { DebtService } from '../finance/debt.service.js';
import { EnrollmentService } from './enrollment.service.js';
import { ReferenceService } from './reference.service.js';
import { GradesService } from '../grades/grades.service.js';
import { RequirePermission, type AuthenticatedRequest } from '../auth/permissions.guard.js';
import { servicesOptionnelsSchema, studyModeSchema } from '../finance/facturation.schemas.js';

const uuid = z.string().uuid();
const money = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a decimal amount, as a string');

/**
 * MAY THIS CALLER SEE WHAT A TEACHER IS PAID?
 *
 * ⚠ NOT `finance.salaires` ALONE, and the reason is in El Ourwa's own gating.
 * `gerer_professeurs.php` — the page with the "Salaire mensuel" column and the
 * per-assignment rates — opens with `require_staff_admin()`, which is
 * `require_role(['super_admin', 'admin'])`. So an administrateur restreint SEES
 * teacher pay on their own page, while `finance.salaires` (which they do not
 * hold) governs PAYING it on `paiement_staff.php`. Two different questions
 * about the same money, and El Ourwa answers them separately.
 *
 * `comptes.professeurs` is the permission our catalogue gives to exactly that
 * pair, so it stands in for the role check. The accountant and the secretary
 * hold neither, and El Ourwa refuses them the page outright.
 */
const seesTeacherPay = (permissions: string[]): boolean =>
  permissions.includes('finance.salaires') || permissions.includes('comptes.professeurs');

@Controller('academic-years')
export class AcademicYearController {
  constructor(@Inject(AcademicYearService) private readonly years: AcademicYearService) {}

  @Get()
  list() {
    return this.years.list();
  }

  /** The year the UI should open on — the last one with real data. */
  @Get('default')
  async defaultView() {
    return { year: await this.years.defaultView() };
  }


  @Post()
  @RequirePermission('annees.gerer')
  create(@Body() raw: unknown) {
    const body = z
      .object({
        startYear: z.coerce.number().int().min(2000).max(2100),
        startMonth: z.coerce.number().int().min(1).max(12).optional(),
        endMonth: z.coerce.number().int().min(1).max(12).optional(),
      })
      .parse(raw ?? {});
    return this.years.create(body);
  }

  /** La liste avec les effectifs de chaque année — le tableau d'`annees_scolaires.php`. */
  @Get('with-counts')
  @RequirePermission('annees.gerer')
  listWithCounts() {
    return this.years.listWithCounts();
  }

  /** RENDRE ACTIVE — son action `activer`. */
  @Post(':id/activate')
  @RequirePermission('annees.gerer')
  activate(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.years.activate(uuid.parse(id), request.auth!.userId);
  }

  /** MODIFIER LA PÉRIODE — son action `modifier_mois`. */
  @Post(':id/period')
  @RequirePermission('annees.gerer')
  setPeriod(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        startMonth: z.coerce.number().int().min(1).max(12),
        endMonth: z.coerce.number().int().min(1).max(12),
      })
      .parse(raw ?? {});
    return this.years.setPeriod(
      uuid.parse(id),
      body.startMonth,
      body.endMonth,
      request.auth!.userId,
    );
  }

  @Post(':id/close')
  @RequirePermission('annees.gerer')
  close(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.years.close(uuid.parse(id), request.auth!.userId);
  }
  /**
   * ANNÉE SCOLAIRE — les mois payables, cochés un par un.
   *
   * "Sélectionnez les mois de l'année scolaire durant lesquels les parents
   * doivent payer les frais de scolarité." Behind `annees.gerer`: this decides
   * what every family is billed.
   */
  @Get(':id/months')
  @RequirePermission('annees.gerer', 'finance.consulter')
  async yearMonths(@Param('id') id: string) {
    const yearId = uuid.parse(id);
    const year = await this.years.byId(yearId);
    return {
      // ⚠ `months` is the EFFECTIVE list — the selection where there is one,
      // the range otherwise — and it is what every existing caller reads. The
      // other two are for the screen that edits it.
      months: await this.years.payableMonthsFor(year),
      selected: await this.years.selectedMonths(yearId),
      // What the range alone would give, so the editor can show the default it
      // is overriding rather than an empty grid.
      range: this.years.months(year).map((m) => m.month),
    };
  }

  @Post(':id/months')
  @RequirePermission('annees.gerer')
  setYearMonths(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = z
      .object({ months: z.array(z.coerce.number().int().min(1).max(12)) })
      .parse(raw ?? {});
    return this.years.setMonths(uuid.parse(id), body.months, request.auth!.userId);
  }

}

@Controller()
export class ReferenceController {
  constructor(@Inject(ReferenceService) private readonly reference: ReferenceService) {}

  /**
   * ⚠ THE REFERENCE READS WERE OPEN TO ANYONE WITH A TOKEN, and the `parent`
   * role holds no permissions — so a parent could enumerate the school's
   * levels, classes, subjects, staff and timetable. The parent app calls
   * `/auth/*` and `/parent/*` and nothing else, so closing them costs it
   * nothing.
   *
   * The list is "any staff role", written out rather than inverted: a guard
   * that said "not a parent" would silently admit the next role somebody adds.
   */
  @Get('levels')
  @RequirePermission(
    'scolarite.groupes', 'scolarite.niveaux', 'scolarite.inscrire',
    'scolarite.reinscrire', 'notes.consulter', 'notes.saisir',
    'absences.consulter', 'absences.saisir', 'finance.consulter',
    'exercices.envoyer', 'recherche.globale', 'annees.gerer',
    'statistiques.consulter', 'messagerie.envoyer',
  )
  levels(@Query('academicYearId') academicYearId?: string) {
    return this.reference.levels(academicYearId ? uuid.parse(academicYearId) : undefined);
  }

  /**
   * Everything below its `?niveau_id=` drill-down: the classes with their
   * headcounts and last year's beside them, and the subjects with their
   * coefficients and scales.
   */
  @Get('levels/:id/detail')
  @RequirePermission(
    'scolarite.groupes', 'scolarite.niveaux', 'scolarite.inscrire',
    'scolarite.reinscrire', 'notes.consulter', 'notes.saisir',
    'absences.consulter', 'absences.saisir', 'finance.consulter',
    'exercices.envoyer', 'recherche.globale', 'annees.gerer',
    'statistiques.consulter', 'messagerie.envoyer',
  )
  levelDetail(@Param('id') id: string, @Query('academicYearId') academicYearId: string) {
    return this.reference.levelDetail(uuid.parse(id), uuid.parse(academicYearId));
  }

  /**
   * ⚠ ALL FOUR INLINE EDITS ARE BEHIND `scolarite.niveaux`, WHICH IS THE
   * DIRECTION'S. The monthly rate is what every family in the level will be
   * billed at next admission, and the pass mark decides who repeats a year.
   * Neither belongs to the counter.
   */
  @Patch('levels/:id/rate')
  @RequirePermission('scolarite.niveaux')
  setLevelRate(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ monthlyRate: z.string().trim() }).parse(raw ?? {});
    return this.reference.setLevelRate(uuid.parse(id), body.monthlyRate, request.auth!.userId);
  }

  @Patch('levels/:id/pass-mark')
  @RequirePermission('scolarite.niveaux')
  setPassMark(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    // NOT `money` — an empty string has to reach the service, which answers
    // "Indiquez un seuil entre 0 et 20 pour ce niveau." rather than a schema
    // error nobody at the counter can act on.
    const body = z.object({ passMark: z.string() }).parse(raw ?? {});
    return this.reference.setLevelPassMark(uuid.parse(id), body.passMark, request.auth!.userId);
  }

  @Post('levels/:id/toggle-fondamental')
  @RequirePermission('scolarite.niveaux')
  toggleFondamental(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.reference.toggleFondamental(uuid.parse(id), request.auth!.userId);
  }

  @Delete('levels/:id')
  @RequirePermission('scolarite.niveaux')
  async deleteLevel(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    await this.reference.deleteLevel(uuid.parse(id), request.auth!.userId);
    return { deleted: true };
  }

  @Delete('groups/:id')
  @RequirePermission('scolarite.groupes')
  async deleteGroup(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    await this.reference.deleteGroup(uuid.parse(id), request.auth!.userId);
    return { deleted: true };
  }

  @Post('levels')
  @RequirePermission('scolarite.niveaux')
  createLevel(@Body() raw: unknown) {
    const body = z
      .object({
        name: z.string().trim().min(1).max(40),
        monthlyRate: money,
        cycle: z.enum(['fondamental', 'college', 'lycee', 'autre']),
        isFondamental: z.boolean().optional(),
        passMark: money.optional(),
        sortOrder: z.coerce.number().int().min(0).max(999).optional(),
      })
      .parse(raw ?? {});
    return this.reference.createLevel(body);
  }

  /** Level → groups → headcount, the browser El Ourwa's `gestion_groupes` shows. */
  @Get('hierarchy')
  @RequirePermission(
    'scolarite.groupes', 'scolarite.niveaux', 'scolarite.inscrire',
    'scolarite.reinscrire', 'notes.consulter', 'notes.saisir',
    'absences.consulter', 'absences.saisir', 'finance.consulter',
    'exercices.envoyer', 'recherche.globale', 'annees.gerer',
    'statistiques.consulter', 'messagerie.envoyer',
  )
  hierarchy(@Query('academicYearId') academicYearId: string) {
    return this.reference.hierarchy(uuid.parse(academicYearId));
  }

  @Get('groups')
  @RequirePermission(
    'scolarite.groupes', 'scolarite.niveaux', 'scolarite.inscrire',
    'scolarite.reinscrire', 'notes.consulter', 'notes.saisir',
    'absences.consulter', 'absences.saisir', 'finance.consulter',
    'exercices.envoyer', 'recherche.globale', 'annees.gerer',
    'statistiques.consulter', 'messagerie.envoyer',
  )
  groups(@Query('academicYearId') academicYearId?: string) {
    return this.reference.groups(academicYearId ? uuid.parse(academicYearId) : undefined);
  }

  @Post('groups')
  @RequirePermission('scolarite.groupes')
  createGroup(@Body() raw: unknown) {
    const body = z
      .object({
        name: z.string().trim().min(1).max(40),
        levelId: uuid,
        capacity: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse(raw ?? {});
    return this.reference.createGroup(body);
  }

  @Get('subjects')
  @RequirePermission(
    'scolarite.groupes', 'scolarite.niveaux', 'scolarite.inscrire',
    'scolarite.reinscrire', 'notes.consulter', 'notes.saisir',
    'absences.consulter', 'absences.saisir', 'finance.consulter',
    'exercices.envoyer', 'recherche.globale', 'annees.gerer',
    'statistiques.consulter', 'messagerie.envoyer',
  )
  subjects(@Query('levelId') levelId?: string) {
    return this.reference.subjects(levelId ? uuid.parse(levelId) : undefined);
  }

  @Post('subjects')
  @RequirePermission('scolarite.niveaux')
  createSubject(@Body() raw: unknown) {
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        nameAr: z.string().trim().max(80).optional(),
        levelId: uuid,
        coefficient: z.coerce.number().int().min(1).max(20).optional(),
        maxScore: money.optional(),
      })
      .parse(raw ?? {});
    return this.reference.createSubject(body);
  }

  /** Its `modifier_note_sur` — only offered where a level is fondamental. */
  @Patch('subjects/:id/max-score')
  @RequirePermission('scolarite.niveaux')
  setMaxScore(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ maxScore: z.string().trim() }).parse(raw ?? {});
    return this.reference.setSubjectMaxScore(uuid.parse(id), body.maxScore, request.auth!.userId);
  }

  @Patch('subjects/:id/coefficient')
  @RequirePermission('scolarite.niveaux')
  async setCoefficient(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = z
      .object({ coefficient: z.coerce.number().int().min(1).max(10) })
      .parse(raw ?? {});
    await this.reference.setSubjectCoefficient(
      uuid.parse(id),
      body.coefficient,
      request.auth!.userId,
    );
    return { coefficient: body.coefficient };
  }

  @Delete('subjects/:id')
  @RequirePermission('scolarite.niveaux')
  async deleteSubject(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    await this.reference.deleteSubject(uuid.parse(id), request.auth!.userId);
    return { deleted: true };
  }

  /**
   * ⚠ THE PAY GOES ONLY TO `finance.salaires`. This returned every teacher's
   * hourly rate and salary to anybody with a token — parents included — while
   * `finance.salaires` existed to keep exactly those figures narrow.
   */
  @Get('teachers')
  @RequirePermission(
    'scolarite.groupes', 'scolarite.niveaux', 'scolarite.inscrire',
    'scolarite.reinscrire', 'notes.consulter', 'notes.saisir',
    'absences.consulter', 'absences.saisir', 'finance.consulter',
    'exercices.envoyer', 'recherche.globale', 'annees.gerer',
    'statistiques.consulter', 'messagerie.envoyer',
  )
  teachers(@Req() request: AuthenticatedRequest) {
    return this.reference.teachers(seesTeacherPay(request.auth!.permissions));
  }

  /**
   * ASSIGNER — teacher × group × subject × year.
   *
   * Behind `scolarite.niveaux`: an assignment sets what an intérimaire is paid,
   * so it is the direction's, not the office's.
   */
  @Post('teachings')
  @RequirePermission('scolarite.niveaux')
  assign(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        teacherId: uuid,
        groupId: uuid,
        subjectId: uuid,
        academicYearId: uuid,
        hoursPerWeek: z.string().regex(/^\d+(\.\d)?$/, 'Un nombre d’heures'),
        // Empty means "the teacher's own rate", which is not the same as zero.
        hourlyRate: z.string().optional(),
      })
      .parse(raw ?? {});
    return this.reference.assignTeaching(body, request.auth!.userId);
  }

  /**
   * MODIFIER LES HEURES ET LE TAUX — its `modifier_heures`.
   *
   * ⚠ Behind `scolarite.niveaux` like the assignment itself: hours × rate is
   * what an intérimaire is paid, so it is the direction's and not the office's.
   */
  @Patch('teachings/:id')
  @RequirePermission('scolarite.niveaux')
  updateTeaching(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = z
      .object({
        hoursPerWeek: z.string().trim(),
        // ⚠ NOT `money`. An empty string must reach the service, which reads it
        // as "the teacher's own rate" — a schema rejection here would make the
        // commonest correction impossible.
        hourlyRate: z.string().optional(),
      })
      .parse(raw ?? {});
    return this.reference.updateTeaching(uuid.parse(id), body, request.auth!.userId);
  }

  @Delete('teachings/:id')
  @RequirePermission('scolarite.niveaux')
  async unassign(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    await this.reference.removeTeaching(uuid.parse(id), request.auth!.userId);
    return { removed: true };
  }

  /**
   * REPORTER LES AFFECTATIONS onto the open year.
   *
   * ⚠ Without it a new school year opens with no assignments, so the mark-entry
   * screen has no subject to offer and looks broken — and nobody is going to
   * rebuild dozens of classes by hand in September.
   */
  /** La liste d'un groupe, telle que `gestion_groupes.php` la déplie. */
  @Get('groups/:id/roster')
  @RequirePermission('scolarite.groupes', 'scolarite.inscrire')
  roster(@Param('id') id: string, @Query('academicYearId') academicYearId?: string) {
    return this.reference.rosterForGroup(uuid.parse(id), academicYearId ? uuid.parse(academicYearId) : undefined);
  }

  /**
   * SUPPRIMER UN PROFESSEUR — le « Supprimer » de `gerer_professeurs.php`.
   *
   * ⚠ `comptes.professeurs`, comme le reste de cette page : `require_staff_admin()`
   * n'admet que super_admin et admin, et c'est exactement qui détient cette
   * permission. La garde de fond — refuser quand des notes en dépendent — vit
   * dans le schéma, pas ici.
   */
  @Delete('teachers/:id')
  @RequirePermission('comptes.professeurs')
  deleteTeacher(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.reference.deleteTeacher(uuid.parse(id), request.auth!.userId);
  }

  @Post('teachings/carry-forward')
  @RequirePermission('scolarite.niveaux')
  carryForward(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ academicYearId: uuid }).parse(raw ?? {});
    return this.reference.carryForwardTeachings(body.academicYearId, request.auth!.userId);
  }

  /**
   * One group's teachings, or the whole year's when no group is named.
   *
   * The year-wide form feeds the mark-entry cascade, which narrows in the
   * browser rather than asking again at each step.
   */
  /** `gerer_professeurs.php` — les assignations courantes, toutes années confondues. */
  @Get('teachings/courantes')
  @RequirePermission('scolarite.niveaux', 'comptes.professeurs')
  teachingsCourantes(@Req() request: AuthenticatedRequest) {
    return this.reference.teachingsCourantes(seesTeacherPay(request.auth!.permissions));
  }

  @Get('teachings')
  @RequirePermission(
    'scolarite.groupes', 'scolarite.niveaux', 'scolarite.inscrire',
    'scolarite.reinscrire', 'notes.consulter', 'notes.saisir',
    'absences.consulter', 'absences.saisir', 'finance.consulter',
    'exercices.envoyer', 'recherche.globale', 'annees.gerer',
    'statistiques.consulter', 'messagerie.envoyer',
  )
  teachings(
    @Req() request: AuthenticatedRequest,
    @Query('academicYearId') academicYearId: string,
    @Query('groupId') groupId?: string,
  ) {
    const year = uuid.parse(academicYearId);
    return groupId
      ? this.reference.teachingsForGroup(uuid.parse(groupId), year)
      // ⚠ The year-wide list is the "Assignations existantes" table, and it
      // carries an intérimaire's rate and monthly cost. Same question as the
      // teachers list, same answer.
      : this.reference.teachingsForYear(year, seesTeacherPay(request.auth!.permissions));
  }
}

@Controller('enrollments')
export class EnrollmentController {
  constructor(
    @Inject(EnrollmentService) private readonly enrollments: EnrollmentService,
    @Inject(DbService) private readonly db: DbService,
    @Inject(DebtService) private readonly debts: DebtService,
    @Inject(AcademicYearService) private readonly years: AcademicYearService,
    @Inject(GradesService) private readonly grades: GradesService,
  ) {}

  /**
   * RETIRER UN ÉLÈVE DE SA CLASSE — le « Supprimer » de `gestion_groupes.php`.
   *
   * ⚠ Derrière `scolarite.groupes` (direction), pas `scolarite.inscrire` :
   * inscrire un enfant et le retirer d'une classe ne sont pas la même autorité,
   * et son écran est celui de la gestion des groupes.
   */
  @Post('cancel')
  @RequirePermission('scolarite.groupes')
  cancelEnrolment(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ studentId: uuid, academicYearId: uuid }).parse(raw ?? {});
    return this.enrollments.cancelEnrolment(
      body.studentId,
      body.academicYearId,
      request.auth!.userId,
    );
  }

  @Post()
  @RequirePermission('scolarite.inscrire')
  enrol(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        studentId: uuid,
        academicYearId: uuid,
        groupId: uuid,
        monthlyFee: money.optional(),
        isFree: z.boolean().optional(),
        entryDate: z.string().date().optional(),
        enrolmentFee: money.optional(),
        documentFee: money.optional(),
        suppliesFee: money.optional(),
        // École « services » (ADR-0073) : le service les exige là, les refuse ailleurs.
        studyMode: studyModeSchema.optional(),
        services: servicesOptionnelsSchema.optional(),
      })
      .parse(raw ?? {});
    return this.enrollments.enrol(
      body,
      request.auth!.userId,
      request.auth!.permissions,
      request.auth!.roles,
    );
  }

  /**
   * LA RECHERCHE DE RÉINSCRIPTION — `reinscrire_etudiant.php`.
   *
   * ⚠ IT IS A SEARCH, NOT A LIST. Ours offered a bulk roster with checkboxes;
   * its screen is a search box, because re-enrolment happens one family at a
   * time with the family standing there. You type a child's name, or the
   * parent's, or the phone number on the form in front of you.
   *
   * ⚠ AND THE RESULTS ARE GROUPED BY HOUSEHOLD, with a bug of its own recorded
   * against the flat version: "Une liste plate la repetait sur chaque ligne :
   * une famille de quatre enfants affichait quatre fois 8 000 MRU, et on pouvait
   * croire qu'elle devait 32 000." The debt belongs to the correspondent, so it
   * is stated ONCE per household and never per child.
   *
   * ⚠ EACH CHILD CARRIES LAST YEAR'S DECISION. `refus_progression()` forbids an
   * ajourné being put up a level, so ADMIS or AJOURNÉ has to be visible at the
   * moment the destination class is chosen — not discovered when the save is
   * refused.
   */
  @Get('re-enrol/search')
  @RequirePermission('scolarite.reinscrire')
  async reEnrolSearch(@Query('q') rawQ = '') {
    const q = String(rawQ).trim();
    if (q === '') return { families: [] };

    const digits = q.replace(/\D/g, '');
    const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

    const target = await this.years.enrolmentTarget();

    const rows = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        student_id: string;
        first_name: string;
        last_name: string;
        matricule: string | null;
        guardian_id: string | null;
        guardian_name: string | null;
        guardian_phone: string | null;
        level_name: string | null;
        group_name: string | null;
        outcome: string | null;
        already: boolean;
      }>(
        `SELECT * FROM (
           SELECT DISTINCT ON (s.id)
                s.id AS student_id, s.first_name, s.last_name, s.matricule,
                s.guardian_id, u.full_name AS guardian_name, u.phone AS guardian_phone,
                l.name AS level_name, g.name AS group_name,
                e.outcome::text AS outcome,
                EXISTS (
                  SELECT 1 FROM enrollments cur
                   WHERE cur.student_id = s.id
                     AND cur.academic_year_id = $3
                     AND cur.status <> 'cancelled'
                ) AS already
           FROM students s
           LEFT JOIN users u ON u.id = s.guardian_id
           LEFT JOIN enrollments e ON e.student_id = s.id AND e.status <> 'cancelled'
           LEFT JOIN academic_years y ON y.id = e.academic_year_id
           LEFT JOIN groups g ON g.id = e.group_id
           LEFT JOIN levels l ON l.id = COALESCE(e.level_id, g.level_id)
          WHERE (
                  s.first_name ILIKE $1 ESCAPE '\\'
               OR s.last_name  ILIKE $1 ESCAPE '\\'
               OR (s.first_name || ' ' || s.last_name) ILIKE $1 ESCAPE '\\'
               OR (s.last_name || ' ' || s.first_name) ILIKE $1 ESCAPE '\\'
               OR u.full_name ILIKE $1 ESCAPE '\\'
               OR ($2 <> '' AND replace(replace(replace(
                    coalesce(u.phone, ''), ' ', ''), '-', ''), '+', '') LIKE '%' || $2 || '%')
                )
          -- La derniere inscription : son « ORDER BY ei.annee DESC LIMIT 1 ».
          -- (Un tri sur l'uuid de l'annee ne donnait pas la derniere.)
          ORDER BY s.id, y.start_year DESC NULLS LAST
         ) x
         -- Son ordre de liste : nom, prenom.
         ORDER BY x.last_name, x.first_name
         LIMIT 50`,
        [pattern, digits, target.id],
      );
      return rows;
    });

    // Group into households, and ask for each family's debt ONCE.
    const byGuardian = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.guardian_id ?? `orphan:${r.student_id}`;
      const list = byGuardian.get(key) ?? [];
      list.push(r);
      byGuardian.set(key, list);
    }

    const families = [];
    for (const [key, children] of byGuardian) {
      const guardianId = children[0]!.guardian_id;
      /*
       * ⚠ LE DÉTAIL, PAS SEULEMENT LE TOTAL. Sa modale de réinscription ouvre
       * sur un bandeau rouge qui VENTILE la dette — « Détail scolarité (3 mois
       * impayés) » et « Dettes diverses », chacun dépliable — parce que la
       * question posée devant la famille n'est pas « combien » mais « quoi ».
       * Nous n'envoyions qu'un total, donc la modale ne pouvait rien montrer.
       *
       * Même source que le total, comme sa propre règle l'exige : c'est
       * `detailAcrossYears()` qui répond, et `total` en est la somme.
       */
      const detail = guardianId
        ? await this.debts.detailAcrossYears(guardianId)
        : null;

      families.push({
        guardianId,
        // Son `nom_parent ?: (pid ? 'Correspondant #pid' : 'Sans correspondant')`.
        guardianName: children[0]!.guardian_name ?? (guardianId ? 'Correspondant' : 'Sans correspondant'),
        guardianPhone: children[0]!.guardian_phone,
        // ⚠ Stated once, for the household. Never repeated per child.
        debt: detail ? detail.total.toFixed(2) : '0.00',
        // Les trois sections de sa ventilation.
        tuition: detail?.tuition ?? [],
        misc: detail?.misc ?? [],
        annualFees: detail?.annualFees ?? [],
        // École « services » (§6) : une quatrième, comprise dans `debt` ; [] sinon.
        services: detail?.services ?? [],
        children: children.map((c) => ({
          studentId: c.student_id,
          name: `${c.first_name} ${c.last_name}`.trim(),
          matricule: c.matricule,
          levelName: c.level_name,
          groupName: c.group_name,
          // ADMIS / AJOURNE / en cours — it decides whether a level up is legal.
          outcome: c.outcome,
          alreadyEnrolled: c.already,
        })),
      });
      if (key === '') break;
    }

    // « Foyers endettes en tete : ce sont eux qui demandent une decision. »
    // Puis par nom, sans la casse — son `uasort`.
    families.sort((a, b) => {
      const da = Number(a.debt) > 0.009 ? 0 : 1;
      const dbb = Number(b.debt) > 0.009 ? 0 : 1;
      return da === dbb
        ? a.guardianName.toLowerCase().localeCompare(b.guardianName.toLowerCase(), 'fr')
        : da - dbb;
    });

    return {
      year: { id: target.id, label: target.label, startYear: target.start_year },
      families,
    };
  }

  @Post('re-enrol')
  @RequirePermission('scolarite.reinscrire')
  reEnrol(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        studentId: uuid,
        groupId: uuid,
        monthlyFee: money.optional(),
        entryDate: z.string().date().optional(),
        /**
         * ⚠ Accepting this is not granting it. The service refuses the bypass
         * unless the caller holds the direction's own permission, so a form that
         * sends `true` from the till still gets a refusal — the flag says what
         * was asked for, the permission says what is allowed.
         */
        bypassDebt: z.boolean().optional(),
        // École « services » (ADR-0073) : le mode est obligatoire ; les services
        // cochés sont souscrits avec la réinscription, l'inscription d'office.
        studyMode: studyModeSchema.optional(),
        services: servicesOptionnelsSchema.optional(),
      })
      .parse(raw ?? {});
    return this.enrollments.reEnrol(
      body.studentId,
      body.groupId,
      request.auth!.userId,
      request.auth!.permissions,
      {
        monthlyFee: body.monthlyFee,
        entryDate: body.entryDate,
        bypassDebt: body.bypassDebt,
        ...(body.studyMode ? { studyMode: body.studyMode } : {}),
        ...(body.services ? { services: body.services } : {}),
      },
      request.auth!.roles,
    );
  }

  /**
   * LES CANDIDATS À LA RÉINSCRIPTION — `reinscriptions.php`.
   *
   * Its other re-enrolment screen, and a different job from the search: this one
   * repopulates the classes of the new year in bulk, from the roll of the year
   * that just ended.
   *
   * ⚠ GROUPÉ PAR FAMILLE, ET LA DETTE UNE SEULE FOIS. Its own recorded bug:
   * "La liste plate repetait la dette sur chaque ligne : une famille de quatre
   * enfants affichait quatre fois 8 000 MRU, et un comptable pouvait croire
   * qu'elle devait 32 000." The debt belongs to the correspondent.
   *
   * ⚠ LES FAMILLES BLOQUÉES D'ABORD — "ce sont celles qui demandent une
   * decision". Everything else is alphabetical.
   *
   * ⚠ ET LE DÉTAIL VIENT DE LA MÊME SOURCE QUE LE TOTAL, for the reason it
   * gives: the breakdown under a family must add up to the figure beside its
   * name, so both come from `detailAcrossYears()`.
   *
   * The pagination is a cursor on the family, not an OFFSET on the pupil: a
   * household split across two pages would show half its children on each and
   * its debt on both.
   */
  @Get('re-enrol/candidates')
  @RequirePermission('scolarite.reinscrire')
  async reEnrolCandidates(
    @Query('sourceYearId') sourceYearId?: string,
    @Query('fromGroupId') fromGroupId?: string,
    @Query('cursor') cursor?: string,
  ) {
    const target = await this.years.enrolmentTarget();

    // Par défaut, les élèves de l'année précédente — ceux qui reviennent.
    const source = await this.db.query(async (tx) => {
      if (sourceYearId) {
        const { rows } = await tx.query<{ id: string; label: string; start_year: number }>(
          'SELECT id, label, start_year FROM academic_years WHERE id = $1',
          [uuid.parse(sourceYearId)],
        );
        return rows[0] ?? null;
      }
      const { rows } = await tx.query<{ id: string; label: string; start_year: number }>(
        `SELECT id, label, start_year FROM academic_years
          WHERE start_year = $1 - 1 LIMIT 1`,
        [target.start_year],
      );
      return rows[0] ?? null;
    });

    // Son `$precedente` : l'année qui précède la cible — c'est elle qui titre
    // la colonne « Classe … », quelle que soit l'année d'origine choisie.
    const precedente = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ label: string; start_year: number }>(
        'SELECT label, start_year FROM academic_years WHERE start_year = $1 - 1 LIMIT 1',
        [target.start_year],
      );
      return rows[0] ?? null;
    });

    if (!source) {
      return {
        target: { id: target.id, label: target.label },
        source: null,
        previous: precedente ? { label: precedente.label } : null,
        families: [],
        nextCursor: null,
        blockedCount: 0,
      };
    }

    const groupFilter = fromGroupId ? uuid.parse(fromGroupId) : null;
    // Le curseur porte le nom du foyer ET sa clé : deux familles homonymes
    // existent, et une pagination qui ne trancherait que sur le nom en
    // sauterait une. Le séparateur est un caractère ordinaire — un NUL ne
    // traverse pas une colonne `text` de Postgres.
    const cut = cursor ? cursor.lastIndexOf('~') : -1;
    const afterName = cut >= 0 ? cursor!.slice(0, cut) : null;
    const afterKey = cut >= 0 ? cursor!.slice(cut + 1) : null;
    const PER_PAGE = 40;

    const rows = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        guardian_key: string;
        guardian_id: string | null;
        guardian_name: string | null;
        student_id: string;
        first_name: string;
        last_name: string;
        matricule: string | null;
        sex: string | null;
        from_group: string | null;
        from_group_id: string | null;
        outcome: string | null;
        already: boolean;
        authorised: boolean;
      }>(
        `WITH candidats AS (
           SELECT s.id AS student_id, s.first_name, s.last_name, s.matricule, s.sex,
                  s.guardian_id,
                  COALESCE(u.full_name, 'Sans correspondant') AS guardian_name,
                  COALESCE(s.guardian_id::text, 'orphelin:' || s.id::text) AS guardian_key,
                  g.name AS from_group, e.group_id AS from_group_id,
                  e.outcome::text AS outcome,
                  EXISTS (
                    SELECT 1 FROM enrollments cur
                     WHERE cur.student_id = s.id
                       AND cur.academic_year_id = $2
                       AND cur.status <> 'cancelled'
                  ) AS already,
                  EXISTS (
                    SELECT 1 FROM reenrolment_authorisations a
                     WHERE a.student_id = s.id
                       AND a.academic_year_id = $2
                       AND a.revoked_at IS NULL
                  ) AS authorised
             FROM enrollments e
             JOIN students s ON s.id = e.student_id
             LEFT JOIN users u ON u.id = s.guardian_id
             LEFT JOIN groups g ON g.id = e.group_id
            WHERE e.academic_year_id = $1
              AND e.status <> 'cancelled'
              AND ($3::uuid IS NULL OR e.group_id = $3)
         ),
         pages AS (
           SELECT DISTINCT guardian_key,
                  min(guardian_name) OVER (PARTITION BY guardian_key) AS nom
             FROM candidats
         )
         SELECT c.* FROM candidats c
          WHERE c.guardian_key IN (
            SELECT guardian_key FROM pages
             WHERE ($4::text IS NULL OR (nom, guardian_key) > ($4::text, $5::text))
             ORDER BY nom, guardian_key
             LIMIT $6
          )
          ORDER BY c.guardian_name, c.guardian_key, c.from_group NULLS LAST,
                   c.last_name, c.first_name`,
        [source.id, target.id, groupFilter, afterName, afterKey, PER_PAGE],
      );
      return rows;
    });

    /**
     * LE RÉSULTAT DE FIN D'ANNÉE — son « Résultat » : « le comptable doit voir
     * si l'eleve a ete admis avant de le reinscrire dans le niveau suivant ».
     * Chez lui, `bulletin_moyennes` (la moyenne du DERNIER trimestre calculé
     * de l'année précédente) passe par `verdict_admission()`. Nous ne stockons
     * pas les moyennes : le bulletin de classe est recalculé, une fois par
     * groupe et par trimestre, pour les seuls groupes de la page — du dernier
     * trimestre au premier, chaque élève gardant le premier verdict trouvé.
     */
    const verdicts = new Map<string, { status: string; label: string; labelAr: string }>();
    if (precedente) {
      const anneePrec = (await this.years.list()).find((y) => y.start_year === precedente.start_year);
      const groupes = [...new Set(rows.map((r) => r.from_group_id).filter((g): g is string => !!g))];
      for (const groupId of groupes) {
        const attendus = new Set(rows.filter((r) => r.from_group_id === groupId).map((r) => r.student_id));
        for (const term of [3, 2, 1]) {
          if (attendus.size === 0) break;
          const cartes = await this.grades
            .classReportCards(groupId, term, anneePrec?.id)
            .catch(() => ({ students: [] as { studentId: string; verdict: { status: string; label: string; labelAr: string } }[] }));
          for (const c of cartes.students) {
            // Sans moyenne à ce trimestre, on regarde le précédent.
            if (!attendus.has(c.studentId) || c.verdict.status === 'non_evalue') continue;
            verdicts.set(c.studentId, c.verdict);
            attendus.delete(c.studentId);
          }
        }
      }
    }

    // Regroupement par foyer, puis la dette — demandée UNE fois par famille.
    const byGuardian = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = byGuardian.get(r.guardian_key) ?? [];
      list.push(r);
      byGuardian.set(r.guardian_key, list);
    }

    const families = [];
    for (const [key, children] of byGuardian) {
      const guardianId = children[0]!.guardian_id;
      const detail = guardianId
        ? await this.debts.detailAcrossYears(guardianId)
        : null;
      const debt = detail ? detail.total.toFixed(2) : '0.00';
      const owes = detail ? detail.total.greaterThan(0.009) : false;
      const authorised = children.some((c) => c.authorised);

      families.push({
        key,
        guardianId,
        guardianName: children[0]!.guardian_name ?? 'Sans correspondant',
        // ⚠ Une seule fois, pour le foyer. Jamais répétée par enfant.
        debt,
        authorised,
        blocked: owes && !authorised,
        // Le détail sous la famille : d'où vient exactement ce chiffre.
        lines: detail
          ? [
              ...detail.tuition.map((t) => ({
                who: t.studentName,
                origin: `Mensualité ${t.label}`,
                paid: t.paid,
                full: t.due,
                amount: t.outstanding,
              })),
              ...detail.misc.map((m) => ({
                who: m.who,
                origin: m.label,
                paid: '0.00',
                full: m.outstanding,
                amount: m.outstanding,
              })),
              ...detail.annualFees.map((f) => ({
                who: 'Famille',
                origin: f.label,
                paid: '0.00',
                full: f.outstanding,
                amount: f.outstanding,
              })),
              // École « services » (§6) : chaque échéance de service due, par
              // enfant — « Cantine — déjeuner (Octobre 2025) », « Frais
              // d'inscription ». Aucune dans une école « famille ».
              ...detail.services.map((s) => ({
                who: s.studentName,
                origin: s.monthLabel ? `${s.label} (${s.monthLabel})` : s.label,
                paid: s.paid,
                full: s.due,
                amount: s.outstanding,
              })),
            ]
          : [],
        children: children.map((c) => ({
          studentId: c.student_id,
          name: `${c.first_name} ${c.last_name}`.trim(),
          matricule: c.matricule,
          fromGroup: c.from_group,
          outcome: c.outcome,
          verdict: verdicts.get(c.student_id) ?? null,
          alreadyEnrolled: c.already,
          authorised: c.authorised,
          blocked: owes && !c.authorised && !c.already,
        })),
      });
    }

    // ⚠ Les familles bloquées d'abord — ce sont celles qui demandent une
    // décision. Puis l'ordre alphabétique, insensible à la casse comme son
    // `strcasecmp`.
    families.sort((a, b) => {
      if (a.blocked !== b.blocked) return a.blocked ? -1 : 1;
      return a.guardianName.localeCompare(b.guardianName, 'fr', { sensitivity: 'base' });
    });

    // Le curseur suit l'ordre de la page, pas celui de l'affichage.
    const last = [...byGuardian.values()].at(-1)?.[0];
    const nextCursor =
      byGuardian.size === PER_PAGE && last
        ? `${last.guardian_name ?? ''}~${last.guardian_key}`
        : null;

    return {
      target: { id: target.id, label: target.label, startYear: target.start_year },
      source: { id: source.id, label: source.label },
      previous: precedente ? { label: precedente.label } : null,
      families,
      nextCursor,
      // ⚠ DES ÉLÈVES, PAS DES FAMILLES — son propre compteur : "$nb_bloques
      // élève(s) bloqué(s) pour dette sur cette page", et son filtre écarte
      // ceux qui sont déjà réinscrits.
      blockedCount: families.reduce(
        (n, f) => n + f.children.filter((c) => c.blocked).length,
        0,
      ),
    };
  }

  /**
   * AUTORISER LA RÉINSCRIPTION MALGRÉ LA DETTE — `reinscriptions.php`, action
   * `autoriser`, and its bottom panel « Autoriser une réinscription malgré la
   * dette ».
   *
   * ⚠ THE PERMISSION IS CHECKED TWICE ON PURPOSE. The guard lets the direction's
   * screen open; the service checks `scolarite.niveaux` again before writing,
   * because this route is reachable by anyone the guard admits and the decision
   * is the one that unblocks money.
   */
  @Post('re-enrol/authorise')
  @RequirePermission('scolarite.niveaux')
  async authoriseDespiteDebt(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        studentId: uuid,
        reason: z.string().trim().max(200).optional(),
      })
      .parse(raw ?? {});
    const target = await this.years.enrolmentTarget();
    return this.enrollments.authoriseDespiteDebt(
      body.studentId,
      target.id,
      body.reason ?? null,
      request.auth!.userId,
      request.auth!.permissions,
    );
  }

  /** RETIRER L'AUTORISATION. The row stays; only the decision is withdrawn. */
  @Post('re-enrol/authorise/revoke')
  @RequirePermission('scolarite.niveaux')
  async revokeAuthorisation(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ studentId: uuid }).parse(raw ?? {});
    const target = await this.years.enrolmentTarget();
    await this.enrollments.revokeAuthorisation(
      body.studentId,
      target.id,
      request.auth!.userId,
      request.auth!.permissions,
    );
    return { ok: true };
  }

  /** Re-enrol a whole class in one go. */
  @Post('re-enrol/bulk')
  @RequirePermission('scolarite.reinscrire')
  bulkReEnrol(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        studentIds: z.array(uuid).min(1).max(200),
        groupId: uuid,
        // École « services » : un mode pour tout le lot, obligatoire (§2).
        studyMode: studyModeSchema.optional(),
      })
      .parse(raw ?? {});
    return this.enrollments.bulkReEnrol(
      body.studentIds,
      body.groupId,
      request.auth!.userId,
      request.auth!.permissions,
      body.studyMode ? { studyMode: body.studyMode } : {},
    );
  }

  /**
   * ⚠ A CHILD'S FEE SCHEDULE, BY ID, WITH NO PERMISSION. A parent reads their
   * own child's balance at `/parent/balance`, which is scoped by the token;
   * this route took an enrolment id and trusted it.
   */
  @Get(':id/months')
  @RequirePermission(
    'finance.consulter', 'finance.encaisser', 'scolarite.inscrire', 'scolarite.reinscrire',
  )
  months(@Param('id') id: string) {
    return this.enrollments.monthsFor(uuid.parse(id));
  }

  @Post(':id/outcome')
  @RequirePermission('scolarite.niveaux')
  outcome(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({ outcome: z.enum(['pending', 'passed', 'held_back', 'expelled']) })
      .parse(raw ?? {});
    return this.enrollments.setOutcome(uuid.parse(id), body.outcome, request.auth!.userId);
  }
}
