import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { ExpulsionsService } from './expulsions.service.js';
import { RequirePermission, type AuthenticatedRequest } from '../auth/permissions.guard.js';

const uuid = z.string().uuid();

/**
 * The expulsion register.
 *
 * Behind `scolarite.inscrire`: the people who admit children are the people who
 * need to know who may not be admitted.
 */
@Controller('expulsions')
export class ExpulsionsController {
  constructor(@Inject(ExpulsionsService) private readonly expulsions: ExpulsionsService) {}

  @Get()
  @RequirePermission('scolarite.inscrire', 'scolarite.reinscrire')
  list(
    @Query('includeLifted') includeLifted?: string,
    @Query('q') q?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.expulsions.list({
      includeLifted: includeLifted === 'true',
      q: z.string().trim().max(80).optional().parse(q || undefined),
      cursor: z.string().max(200).optional().parse(cursor || undefined),
    });
  }

  @Post()
  @RequirePermission('scolarite.inscrire')
  expel(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        // L'un OU l'autre (0044) : le service refuse s'il n'y a aucun des deux.
        nationalId: z.string().trim().max(40).optional(),
        rim: z.string().trim().max(40).optional(),
        firstName: z.string().trim().min(1).max(80),
        lastName: z.string().trim().min(1).max(80),
        reason: z.string().trim().max(255).optional(),
      })
      .parse(raw ?? {});
    return this.expulsions.expel(body, request.auth!.userId);
  }

  @Post(':id/lift')
  @RequirePermission('scolarite.inscrire')
  lift(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ reason: z.string().trim().max(255).optional() }).parse(raw ?? {});
    return this.expulsions.lift(uuid.parse(id), body.reason || null, request.auth!.userId);
  }
}
