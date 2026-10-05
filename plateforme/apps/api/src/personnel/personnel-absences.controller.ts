import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import {
  RequirePermission,
  RequireRole,
  type AuthenticatedRequest,
} from '../auth/permissions.guard.js';
import { PersonnelAbsencesService } from './personnel-absences.service.js';
import { estDateIso } from '../common/dates.js';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue : AAAA-MM-JJ.').refine(estDateIso, 'Cette date n’existe pas.');
const heure = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure attendue : HH:MM.');
const motif = z.string().trim().max(255).optional().nullable();

/**
 * LES ABSENCES DU PERSONNEL — professeurs et agents, d'après leur emploi du
 * temps (ADR-0074).
 *
 * ⚠ QUI FAIT QUOI, et aucune permission nouvelle (le catalogue est figé,
 * `permission-names.spec.ts`) :
 *
 *   lire la journée, la synthèse .. `absences.saisir` (direction, collecteur
 *                                   d'absence) ou `finance.salaires` (qui paie)
 *   déclarer une absence .......... `absences.saisir`
 *   retirer une absence ........... `absences.saisir` ; justifiée : la direction
 *   justifier ..................... `absences.saisir` + rôle direction
 *   les horaires des agents ....... lire : `absences.saisir` ou `comptes.staff` ;
 *                                   fixer : `comptes.staff` (qui embauche)
 *
 * Un professeur (`absences.consulter` seulement) ne lit pas les absences de
 * ses collègues.
 */
@Controller('personnel')
export class PersonnelAbsencesController {
  constructor(@Inject(PersonnelAbsencesService) private readonly absences: PersonnelAbsencesService) {}

  /** La feuille d'un jour : les séances des professeurs, les périodes des agents, ce qui est déclaré. */
  @Get('absences/journee')
  @RequirePermission('absences.saisir', 'finance.salaires')
  journee(@Query('date') d?: string) {
    return this.absences.journee(date.parse(d ?? new Date().toISOString().slice(0, 10)));
  }

  /** La synthèse d'un mois, par personne. */
  @Get('absences/synthese')
  @RequirePermission('absences.saisir', 'finance.salaires')
  synthese(@Query('mois') mois?: string, @Query('annee') annee?: string) {
    const now = new Date();
    return this.absences.synthese(
      z.coerce.number().int().min(1).max(12).parse(mois ?? now.getMonth() + 1),
      z.coerce.number().int().min(2000).max(2100).parse(annee ?? now.getFullYear()),
    );
  }

  /** Les absences d'une période (≤ 93 jours). */
  @Get('absences')
  @RequirePermission('absences.saisir', 'finance.salaires')
  liste(@Query() raw: unknown) {
    const q = z
      .object({
        from: date,
        to: date,
        kind: z.enum(['teacher', 'staff']).optional(),
        personId: uuid.optional(),
      })
      .parse(raw ?? {});
    return this.absences.liste(q);
  }

  /** Déclarer un professeur absent à des séances de son emploi du temps. */
  @Post('absences/professeur')
  @RequirePermission('absences.saisir')
  declarerProfesseur(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        date,
        teacherId: uuid,
        seances: z.array(z.object({ slot: z.coerce.number().int().min(1).max(6), groupId: uuid })).max(20).optional(),
        touteLaJournee: z.boolean().optional(),
        reason: motif,
      })
      .parse(raw ?? {});
    return this.absences.declarerProfesseur(body, request.auth!.userId);
  }

  /** Déclarer un agent absent sur ses horaires (période entière ou en partie). */
  @Post('absences/agent')
  @RequirePermission('absences.saisir')
  declarerAgent(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        date,
        staffId: uuid,
        periodes: z
          .array(z.object({ workHoursId: uuid, debut: heure.optional(), fin: heure.optional() }))
          .max(10)
          .optional(),
        touteLaJournee: z.boolean().optional(),
        reason: motif,
      })
      .parse(raw ?? {});
    return this.absences.declarerAgent(body, request.auth!.userId);
  }

  /** Justifier une absence (ou retirer la justification) — la direction. */
  @Post('absences/:id/justifier')
  @RequirePermission('absences.saisir')
  @RequireRole('super_admin', 'admin')
  justifier(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ justified: z.boolean().default(true), reason: motif }).parse(raw ?? {});
    return this.absences.justifier(
      uuid.parse(id),
      { justified: body.justified, ...(body.reason !== undefined ? { reason: body.reason } : {}) },
      request.auth!.userId,
    );
  }

  /** Retirer une absence (erreur de saisie). Justifiée : la direction seule. */
  @Delete('absences/:id')
  @RequirePermission('absences.saisir')
  retirer(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.absences.retirer(uuid.parse(id), request.auth!.userId, request.auth!.roles);
  }

  /** Les horaires de tous les agents. */
  @Get('horaires')
  @RequirePermission('absences.saisir', 'comptes.staff')
  horaires() {
    return this.absences.horaires();
  }

  /** Fixer la semaine d'un agent, d'un bloc. */
  @Put('horaires/:staffId')
  @RequirePermission('comptes.staff')
  definirHoraires(@Param('staffId') staffId: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        periodes: z
          .array(z.object({ jour: z.coerce.number().int().min(1).max(7), debut: heure, fin: heure }))
          .max(28),
      })
      .parse(raw ?? {});
    return this.absences.definirHoraires(uuid.parse(staffId), body.periodes, request.auth!.userId);
  }
}
