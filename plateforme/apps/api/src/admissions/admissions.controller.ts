import { Body, Controller, Inject, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { AdmissionsService } from './admissions.service.js';
import { RequirePermission, type AuthenticatedRequest } from '../auth/permissions.guard.js';
import { servicesOptionnelsSchema, studyModeSchema } from '../finance/facturation.schemas.js';

const uuid = z.string().uuid();
const money = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a decimal string');

@Controller('admissions')
export class AdmissionsController {
  constructor(@Inject(AdmissionsService) private readonly admissions: AdmissionsService) {}

  /*
   * ⚠ `GET /admissions/guardians` A ÉTÉ SUPPRIMÉE, ET C'ÉTAIT UN ANNUAIRE OUVERT.
   *
   * Elle rendait, SANS AUCUN TERME DE RECHERCHE, jusqu'à 200 familles avec leur
   * nom, leur courriel et leur téléphone — son commentaire s'en félicitait même :
   * « An empty query lists them rather than refusing […] friction for no
   * benefit ». C'est exactement la divulgation contre laquelle
   * `GET /students/guardians/search` est bâtie, et dont elle énonce la raison :
   *
   *   « NUMBERS; a parent, or a teacher, could walk the alphabet and have all
   *     1 372. »
   *
   * Cette dernière impose donc un plancher de deux caractères et échappe les
   * jokers de LIKE. Celle-ci n'imposait rien, n'échappait rien, faisait le même
   * travail, et AUCUN ÉCRAN NE L'APPELAIT : le formulaire d'inscription, la
   * messagerie et la caisse passent tous par l'autre. Une route morte reste
   * appelable ; celle-ci défaisait la seule mesure qui protégeait l'annuaire.
   *
   * Le service `findGuardians()` part avec elle.
   */

  @Post('students')
  @RequirePermission('scolarite.inscrire')
  admit(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        firstName: z.string().trim().min(1).max(80),
        lastName: z.string().trim().min(1).max(80),
        // Facultatifs (0044, décision du propriétaire du 30/09/2026) ; vides = absents.
        rim: z.string().trim().max(40).optional(),
        nationalId: z.string().trim().max(40).optional(),
        sex: z.enum(['M', 'F']).optional(),
        dateOfBirth: z.string().date().optional(),
        // ⚠ Its `lieu_naissance`, free text: the data holds "Guerou"
        // (Assaba) as well as the Nouakchott moughataas.
        placeOfBirth: z.string().trim().max(120).optional(),
        guardianId: uuid.optional(),
        newGuardian: z
          .object({
            fullName: z.string().trim().min(2).max(120),
            email: z.string().trim().email().optional(),
            phone: z.string().trim().min(6).max(40).optional(),
            locale: z.enum(['fr', 'ar']).optional(),
            // Length only here; the policy itself lives in the service so its
            // message ("… 3 types de caractères") reaches the clerk unchanged
            // rather than being flattened into a schema error.
            initialPassword: z.string().max(200).optional(),
          })
          .optional(),
        academicYearId: uuid.optional(),
        groupId: uuid.optional(),
        monthlyFee: money.optional(),
        isFree: z.boolean().optional(),
        entryDate: z.string().date().optional(),
        // École « services » (ADR-0073) : le service les exige là, les refuse ailleurs.
        studyMode: studyModeSchema.optional(),
        services: servicesOptionnelsSchema.optional(),
      })
      .parse(raw ?? {});

    return this.admissions.admit(
      body,
      request.auth!.userId,
      request.auth!.permissions,
      request.auth!.roles,
    );
  }

  @Post('enrolments/:id/group')
  @RequirePermission('scolarite.groupes', 'scolarite.inscrire')
  move(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ groupId: uuid }).parse(raw ?? {});
    return this.admissions.moveToGroup(uuid.parse(id), body.groupId, request.auth!.userId);
  }
}
