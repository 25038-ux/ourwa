import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Query, Req, ForbiddenException } from '@nestjs/common';
import { z } from 'zod';
import { PedagogyService } from './pedagogy.service.js';
import { GradesService } from '../grades/grades.service.js';
import { AuthService } from '../auth/auth.service.js';
import { RequirePermission, type AuthenticatedRequest } from '../auth/permissions.guard.js';

const uuid = z.string().uuid();
const isoDate = z.string().date();

@Controller('attendance')
export class AttendanceController {
  constructor(@Inject(PedagogyService) private readonly pedagogy: PedagogyService) {}

  /** Ses `$creneaux_jour` — les cases du jour, sinon toutes les matières de l'année. */
  @Get('creneaux')
  @RequirePermission('absences.saisir', 'absences.consulter')
  creneaux(
    @Query('groupId') groupId: string,
    @Query('date') date: string,
    @Query('academicYearId') academicYearId: string,
  ) {
    return this.pedagogy.creneauxDuJour(uuid.parse(groupId), isoDate.parse(date), uuid.parse(academicYearId));
  }

  /** La feuille d'appel : les inscrits du groupe et le statut déjà saisi. */
  @Get('appel')
  @RequirePermission('absences.saisir', 'absences.consulter')
  appel(
    @Query('groupId') groupId: string,
    @Query('date') date: string,
    @Query('academicYearId') academicYearId: string,
    @Query('teachingId') teachingId?: string,
  ) {
    return this.pedagogy.appel(
      uuid.parse(groupId),
      isoDate.parse(date),
      uuid.parse(academicYearId),
      teachingId ? uuid.parse(teachingId) : null,
    );
  }

  @Post('appel')
  @RequirePermission('absences.saisir')
  enregistrer(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        groupId: uuid,
        date: isoDate,
        academicYearId: uuid,
        teachingId: uuid.nullable().optional(),
        statuts: z
          .array(z.object({ studentId: uuid, statut: z.enum(['present', 'absent', 'retard']) }))
          .min(1)
          .max(500),
      })
      .parse(raw ?? {});
    return this.pedagogy.enregistrerAppel(
      { ...body, teachingId: body.teachingId ?? null },
      request.auth!.userId,
    );
  }

  @Get('student/:studentId')
  @RequirePermission('absences.consulter')
  forStudent(@Param('studentId') studentId: string) {
    return this.pedagogy.absencesFor(uuid.parse(studentId));
  }
}

@Controller('remarks')
export class RemarksController {
  constructor(
    @Inject(PedagogyService) private readonly pedagogy: PedagogyService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(GradesService) private readonly grades: GradesService,
  ) {}

  @Get('student/:studentId')
  @RequirePermission('notes.consulter', 'absences.consulter')
  forStudent(@Param('studentId') studentId: string) {
    return this.pedagogy.remarksFor(uuid.parse(studentId));
  }

  /**
   * Ses refus, dans son ordre : « Élève non autorisé. » (l'anti-IDOR), « La
   * remarque ne peut pas être vide. » ; une gravité inconnue vaut `info`.
   */
  @Post('student/:studentId')
  @RequirePermission('notes.consulter')
  async add(
    @Param('studentId') studentId: string,
    @Body() raw: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = z
      .object({
        body: z.string().trim().max(2000),
        severity: z.string().default('info'),
        academicYearId: z.string().uuid().optional(),
      })
      .parse(raw ?? {});
    const severity = (['info', 'positive', 'warning', 'serious'] as const).find((s) => s === body.severity) ?? 'info';
    const id = uuid.safeParse(studentId);
    if (!id.success) throw new ForbiddenException('Élève non autorisé.');
    // A teacher may only remark on a child they actually teach. Every teacher
    // holds `notes.consulter`, so without this any of them could write about any
    // child in the school and the family would read it. Administrative reach
    // (`scolarite.groupes`) covers the whole school, as in El Ourwa.
    if (!request.auth!.permissions.includes('scolarite.groupes')) {
      const teaches = await this.grades.teachesStudent(
        request.auth!.userId,
        id.data,
        body.academicYearId ?? null,
      );
      if (!teaches) throw new ForbiddenException('Élève non autorisé.');
    }
    if (body.body === '') throw new BadRequestException('La remarque ne peut pas être vide.');

    // Son `$auteur = prenom . ' ' . nom` de la fiche `professeurs` ; sinon le nom du compte.
    const authorName =
      (await this.grades.teacherName(request.auth!.userId)) ??
      (await this.auth.displayName(request.auth!.userId));
    return this.pedagogy.addRemark(id.data, body.body, severity, request.auth!.userId, authorName);
  }
}

@Controller('homework')
export class HomeworkController {
  constructor(
    @Inject(PedagogyService) private readonly pedagogy: PedagogyService,
    @Inject(GradesService) private readonly grades: GradesService,
  ) {}

  /**
   * Ses refus, dans son ordre : « Enseignement invalide. » (l'anti-IDOR),
   * « Titre et description obligatoires. », « Date limite invalide. » ; puis
   * les destinataires de l'année consultée (`academicYearId`).
   */
  @Post(':teachingId')
  @RequirePermission('exercices.envoyer')
  async send(
    @Param('teachingId') teachingId: string,
    @Body() raw: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const body = z
      .object({
        title: z.string().trim().max(150),
        body: z.string().trim().max(5000),
        dueOn: z.string().trim().optional(),
        academicYearId: z.string().uuid().optional(),
      })
      .parse(raw ?? {});
    const id = uuid.safeParse(teachingId);
    if (!id.success) throw new BadRequestException('Enseignement invalide.');

    // A teacher may only send to their OWN class. An administrator may send to
    // any (El Ourwa's `envoyer_exercice` does exactly this), so the check only
    // applies when the caller has no administrative reach.
    if (!request.auth!.permissions.includes('scolarite.groupes')) {
      await this.grades.assertOwnTeaching(request.auth!.userId, id.data, 'Enseignement invalide.');
    }
    if (body.title === '' || body.body === '') {
      throw new BadRequestException('Titre et description obligatoires.');
    }
    if (body.dueOn && !isoDate.safeParse(body.dueOn).success) {
      throw new BadRequestException('Date limite invalide.');
    }

    return this.pedagogy.sendHomework(
      id.data,
      { title: body.title, body: body.body, dueOn: body.dueOn || undefined },
      request.auth!.userId,
      body.academicYearId ?? null,
    );
  }
}
