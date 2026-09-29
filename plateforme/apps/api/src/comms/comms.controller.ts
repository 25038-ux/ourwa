import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { CommsService } from './comms.service.js';
import { RequirePermission, type AuthenticatedRequest, RequireRole} from '../auth/permissions.guard.js';

const uuid = z.string().uuid();
const money = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a decimal string');

@Controller('messages')
export class MessagesController {
  constructor(@Inject(CommsService) private readonly comms: CommsService) {}

  @Get()
  @RequirePermission('messagerie.envoyer')
  sent() {
    return this.comms.sentMessages();
  }

  /** How many families each level and each group reaches, for the button. */
  @Get('audience')
  @RequirePermission('messagerie.envoyer')
  audience(@Query('academicYearId') academicYearId: string) {
    return this.comms.audienceCounts(z.string().uuid().parse(academicYearId));
  }

  @Get('families')
  @RequirePermission('messagerie.envoyer')
  families() {
    return this.comms.families();
  }

  @Post()
  @RequirePermission('messagerie.envoyer')
  send(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        subject: z.string().trim().min(2).max(150),
        body: z.string().trim().min(2).max(4000),
        // ⚠ ONE FAMILY, OR A LEVEL/GROUP — never both. The service refuses the
        // combination rather than preferring one, because either preference is
        // wrong in a way nobody can see afterwards.
        guardianId: uuid.optional(),
        levelId: uuid.optional(),
        groupId: uuid.optional(),
        academicYearId: uuid.optional(),
      })
      .parse(raw ?? {});
    return this.comms.send(body, request.auth!.userId);
  }
}

@Controller('requests')
export class RequestsController {
  constructor(@Inject(CommsService) private readonly comms: CommsService) {}

  @Get()
  @RequirePermission('demandes.traiter', 'finance.consulter')
  list(@Query('status') status?: string, @Req() request?: AuthenticatedRequest) {
    const parsed = z.enum(['pending', 'approved', 'refused']).optional().parse(status || undefined);
    // Son `$is_admin` : tout pour super_admin / admin, les siennes pour les autres.
    const roles = request?.auth?.roles ?? [];
    const estAdmin = roles.includes('super_admin') || roles.includes('admin');
    return this.comms.requests(parsed, estAdmin ? undefined : request?.auth?.userId);
  }

  /** Raising a request needs no right beyond being able to spend. */
  @Post()
  @RequirePermission('finance.depenser', 'demandes.traiter')
  raise(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        kind: z.string().trim().min(2).max(60),
        description: z.string().trim().min(2).max(2000),
        amount: money.optional(),
        // Son `metadata` : ce qu'il faudra pour EXÉCUTER la demande approuvée
        // (les moyens de paiement d'une dépense, l'élève et le tarif d'un
        // changement de frais…).
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(raw ?? {});
    return this.comms.raise(body, request.auth!.userId);
  }

  /** Deciding is the direction's alone. */
  /**
   * ⚠ DECIDING IS THE DIRECTION'S, AND THE PERMISSION IS NOT WHAT SAYS SO.
   *
   * `demandes.traiter` is granted to the accountant in El Ourwa's own `$legacy`
   * table — it lets them REACH this page and raise a request. Deciding is gated
   * separately, on the role: `$is_admin = in_array($role, ['super_admin',
   * 'admin'])`, and its header says the same in words: "comptable : peut créer
   * une demande [...] super_admin / admin complet : [...] peut approuver ou
   * rejeter".
   *
   * We had gated the decision on the permission alone. Correcting the grants to
   * match its table therefore handed the accountant the power to approve their
   * own expense requests — a separation of duties the school drew, closed by a
   * change that was otherwise right. Two rules, and both are needed.
   */
  @Post(':id/decision')
  @RequireRole('super_admin', 'admin')
  @RequirePermission('demandes.traiter')
  decide(@Param('id') id: string, @Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        decision: z.enum(['approved', 'refused']),
        comment: z.string().trim().max(500).optional(),
      })
      .parse(raw ?? {});
    return this.comms.decide(uuid.parse(id), body.decision, body.comment, request.auth!.userId);
  }
}
