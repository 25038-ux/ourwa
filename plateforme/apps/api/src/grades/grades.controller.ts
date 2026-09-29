import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { GradesService } from './grades.service.js';
import { ReferenceService } from '../academic/reference.service.js';
import { AcademicYearService } from '../academic/academic-year.service.js';
import { TimetableService } from '../timetable/timetable.service.js';
import { RequirePermission, type AuthenticatedRequest } from '../auth/permissions.guard.js';

const uuid = z.string().uuid();
const term = z.coerce.number().int().min(1).max(3);

@Controller('grades')
export class GradesController {
  constructor(
    @Inject(GradesService) private readonly grades: GradesService,
    @Inject(AcademicYearService) private readonly years: AcademicYearService,
  ) {}

  /**
   * THE REPORT-CARD FORMULA for a level — `notes_etudiants.php`, `config_formule`.
   *
   * ⚠ SETTING IT IS THE DIRECTION'S, NOT THE OFFICE'S. El Ourwa refuses the
   * accountant and the secretary in as many words: "La configuration du calcul
   * des bulletins est réservée à l'administration." It decides the mark on every
   * bulletin of a level, which is not a clerical setting.
   */
  @Get('formulas/:levelId')
  @RequirePermission('notes.consulter', 'notes.saisir')
  formulas(@Param('levelId') levelId: string) {
    return this.grades.formulasFor(uuid.parse(levelId));
  }

  @Post('formulas')
  @RequirePermission('scolarite.niveaux')
  setFormula(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const weight = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Un coefficient décimal');
    const body = z
      .object({
        levelId: uuid,
        terms: z
          .array(
            z.object({
              term,
              courseworkWeight: weight,
              examWeight: weight,
              divisor: weight,
            }),
          )
          .min(1)
          .max(3),
      })
      .parse(raw ?? {});

    // Its form posts all three terms at once and reports how many were saved.
    return Promise.all(
      body.terms.map((t) =>
        this.grades.setFormula({ levelId: body.levelId, ...t }, request.auth!.userId),
      ),
    ).then(() => ({ saved: body.terms.length }));
  }

  /** The mark sheet for one teaching. */
  @Get('sheet/:teachingId')
  @RequirePermission('notes.saisir', 'notes.consulter')
  sheet(@Param('teachingId') teachingId: string, @Query('term') rawTerm = '1') {
    return this.grades.sheet(uuid.parse(teachingId), term.parse(rawTerm));
  }

  /**
   * Record marks.
   *
   * Behind `notes.saisir`, which the teacher role deliberately does NOT hold —
   * El Ourwa v13 moved grade entry to the administration (ADR-0005). Granting
   * that one permission to the role restores it, with no code change.
   */
  @Post('sheet/:teachingId')
  @RequirePermission('notes.saisir')
  record(
    @Param('teachingId') teachingId: string,
    @Body() raw: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    // Son formulaire : `devoirs[<eleve>][]` et `examens[<eleve>]`. Les devoirs
    // d'un élève sont remplacés par la liste envoyée (renumérotée D1…Dn, les
    // cases vides sautées) ; un examen vide ne touche pas l'existant.
    const { body, marks } = lireFeuille(raw);

    return this.grades.record(uuid.parse(teachingId), body.term, marks, request.auth!.userId, {
      replaceCourseworkFor: body.eleves.map((e) => e.studentId),
    });
  }

  /**
   * One student's report card — the same document the parent app shows.
   *
   * Delegates to the class computation and picks the student out, so the
   * printed sheet and the parent's copy cannot drift apart.
   */
  @Get('report-card/:studentId')
  @RequirePermission('notes.consulter')
  reportCard(
    @Param('studentId') studentId: string,
    @Query('term') rawTerm = '1',
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.grades.reportCardFor(uuid.parse(studentId), term.parse(rawTerm), {
      academicYearId: academicYearId ? uuid.parse(academicYearId) : undefined,
    });
  }

  /** Son classement d'un groupe — `?classement=1`. */
  @Get('classement/:groupId')
  @RequirePermission('notes.consulter')
  classement(
    @Param('groupId') groupId: string,
    @Query('base') base = '1',
    @Query('annee') annee = '',
  ) {
    const b = z.enum(['1', '2', '3', 'annee']).catch('1').parse(base);
    const y = z.coerce.number().int().min(2020).max(2100).parse(annee);
    return this.grades.classement(uuid.parse(groupId), b, y);
  }

  /** Les années qui portent des notes — pour le défaut de « Année ». */
  @Get('annees-avec-notes')
  @RequirePermission('notes.consulter')
  anneesAvecNotes() {
    return this.grades.anneesAvecNotes();
  }

  /** Every report card for a class, computed in one pass. */
  @Get('class/:groupId')
  @RequirePermission('notes.consulter')
  classCards(
    @Param('groupId') groupId: string,
    @Query('term') rawTerm = '1',
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.grades.classReportCards(
      uuid.parse(groupId),
      term.parse(rawTerm),
      academicYearId ? uuid.parse(academicYearId) : undefined,
    );
  }
}

/**
 * The teacher's own view.
 *
 * Every handler here is scoped to the signed-in teacher. A teacher must not be
 * able to read another teacher's class by changing an id in the URL, so the
 * scope is enforced server-side rather than by which links are rendered.
 */
@Controller('teacher')
export class TeacherController {
  constructor(
    @Inject(GradesService) private readonly grades: GradesService,
    @Inject(ReferenceService) private readonly reference: ReferenceService,
    @Inject(AcademicYearService) private readonly years: AcademicYearService,
    @Inject(TimetableService) private readonly timetable: TimetableService,
  ) {}

  @Get('my-classes')
  async myClasses(@Req() request: AuthenticatedRequest) {
    const year = await this.years.defaultView();
    if (!year) return { classes: [] };
    const teacherId = await this.reference.teacherIdForUser(request.auth!.userId);
    if (!teacherId) return { classes: [] };
    return {
      academicYear: year.label,
      classes: await this.reference.teachingsForTeacher(teacherId, year.id),
    };
  }

  /**
   * The signed-in teacher's own week.
   *
   * Resolved from the token, never from a teacher id in the URL: a teacher may
   * see their own timetable and nobody else's, and the only safe way to say
   * "their own" is to derive it rather than accept it.
   */
  /**
   * The children a teacher may write about — their own classes' rosters.
   *
   * Resolved from the token, never from a parameter. A list built from an id in
   * the URL is a list the caller chose.
   */
  @Get('my-students')
  async myStudents(@Req() request: AuthenticatedRequest, @Query('academicYearId') academicYearId?: string) {
    const year = academicYearId ? uuid.parse(academicYearId) : (await this.years.defaultView())?.id ?? null;
    return this.reference.studentsTaughtBy(request.auth!.userId, year);
  }

  /**
   * SA PAIE — les deux tuiles « Tarif horaire » et « Salaire mensuel » de son
   * tableau de bord, et sa carte « Détail de mon salaire mensuel ».
   *
   * ⚠ Aucune permission ne la garde, et c'est correct : elle est résolue depuis
   * le JETON. Il n'y a pas d'identifiant à passer, donc rien à détourner — un
   * professeur voit sa fiche et celle de personne d'autre. Une permission
   * `finance.salaires` ici la fermerait à ceux qu'elle concerne.
   */
  @Get('my-pay')
  myPay(@Req() request: AuthenticatedRequest) {
    return this.reference.ownPay(request.auth!.userId);
  }

  /** Son `tableau_bord.php` : la fiche et les enseignements courants, résolus depuis le jeton. */
  @Get('tableau-bord')
  async tableauBord(
    @Req() request: AuthenticatedRequest,
    @Query('academicYearId') academicYearId?: string,
  ) {
    const year = academicYearId ? uuid.parse(academicYearId) : (await this.years.defaultView())?.id ?? null;
    return this.reference.tableauBord(request.auth!.userId, year);
  }

  /**
   * SES CLASSES, ET LA LISTE DES ÉLÈVES DE L'UNE D'ELLES.
   *
   * ⚠ `my-roster/:groupId` PREND UN IDENTIFIANT DANS L'URL — c'est le seul de
   * ce contrôleur. La garde est donc dans le service, avant la lecture, et non
   * dans le rendu : sans elle, changer le numéro suffirait à lire la classe
   * d'un collègue.
   */
  @Get('my-groups')
  async myGroups(@Req() request: AuthenticatedRequest, @Query('academicYearId') academicYearId?: string) {
    const year = academicYearId ? uuid.parse(academicYearId) : (await this.years.defaultView())?.id ?? null;
    return this.reference.classesForTeacher(request.auth!.userId, year);
  }

  @Get('my-roster/:groupId')
  async myRoster(
    @Req() request: AuthenticatedRequest,
    @Param('groupId') groupId: string,
    @Query('academicYearId') academicYearId?: string,
  ) {
    const year = academicYearId ? uuid.parse(academicYearId) : (await this.years.defaultView())?.id ?? null;
    return this.reference.rosterForTeacher(request.auth!.userId, uuid.parse(groupId), year);
  }

  @Get('my-timetable')
  async myTimetable(@Req() request: AuthenticatedRequest) {
    const teacherId = await this.reference.teacherIdForUser(request.auth!.userId);
    if (!teacherId) return { slots: [] };
    return { slots: await this.timetable.forTeacher(teacherId) };
  }

  @Get('sheet/:teachingId')
  async sheet(
    @Req() request: AuthenticatedRequest,
    @Param('teachingId') teachingId: string,
    @Query('term') rawTerm = '1',
  ) {
    const id = uuid.parse(teachingId);
    // The boundary. Without it, an id in the URL is enough.
    await this.grades.assertOwnTeaching(request.auth!.userId, id);
    return this.grades.sheet(id, term.parse(rawTerm));
  }

  /**
   * SAISIR LES NOTES — décision du propriétaire (2026-09-17) : le professeur
   * saisit les résultats de SES enseignements (ses matières, ses groupes), et
   * de rien d'autre. Pas de `notes.saisir` ici — c'est la permission de la
   * direction, qui ouvre toutes les feuilles ; la porte du professeur est
   * `assertOwnTeaching`, la même que pour lire la feuille. Le corps et la
   * règle sont ceux de la direction (`POST grades/sheet/:teachingId`).
   */
  @Post('sheet/:teachingId')
  async recordOwn(
    @Req() request: AuthenticatedRequest,
    @Param('teachingId') teachingId: string,
    @Body() raw: unknown,
  ) {
    const id = uuid.parse(teachingId);
    await this.grades.assertOwnTeaching(request.auth!.userId, id);
    const { body, marks } = lireFeuille(raw);
    return this.grades.record(id, body.term, marks, request.auth!.userId, {
      replaceCourseworkFor: body.eleves.map((e) => e.studentId),
    });
  }
}

/**
 * LE CORPS D'UNE FEUILLE DE NOTES, LU UNE FOIS POUR LES DEUX ROUTES (direction
 * et professeur) : le même schéma, la même règle de renumérotation — deux
 * copies auraient fini par diverger sur la forme d'une note.
 */
function lireFeuille(raw: unknown) {
  const note = z.string().trim().regex(/^-?\d+(\.\d{1,2})?$/);
  const body = z
    .object({
      term,
      eleves: z
        .array(
          z.object({
            studentId: uuid,
            devoirs: z.array(z.string().trim()).max(10),
            examen: z.string().trim().nullable().optional(),
          }),
        )
        .min(1)
        .max(500),
    })
    .parse(raw ?? {});
  const marks: { studentId: string; kind: 'coursework' | 'exam'; sequenceNo: number; score: string }[] = [];
  for (const e of body.eleves) {
    let n = 1;
    for (const d of e.devoirs) {
      if (d === '') continue;
      marks.push({ studentId: e.studentId, kind: 'coursework', sequenceNo: n++, score: note.parse(d) });
    }
    if (e.examen) marks.push({ studentId: e.studentId, kind: 'exam', sequenceNo: 1, score: note.parse(e.examen) });
  }
  return { body, marks };
}
