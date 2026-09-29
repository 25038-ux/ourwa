import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

export const PERMISSION_KEY = 'requiredPermission';

/**
 * Declare what a handler needs:
 *
 *   @RequirePermission('finance.encaisser')
 *   @Post('payments')
 *
 * Passing several means ANY of them suffices — roles cumulate, so an agent who
 * is both accountant and secretary passes either door.
 */
export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(PERMISSION_KEY, permissions);

export const ROLE_KEY = 'required_roles';

/**
 * ⚠ A ROLE GATE, FOR THE CASES WHERE A PERMISSION IS NOT THE RULE.
 *
 * El Ourwa mostly asks "do you hold this permission?" — but not always. Its
 * `demandes.php` grants `demandes.traiter` to the accountant so they can REACH
 * the page and raise a request, then gates the decision on
 * `$is_admin = in_array($role, ['super_admin', 'admin'])`. Two different
 * questions about the same screen.
 *
 * Applied ALONGSIDE `@RequirePermission`, never instead of it: both must pass.
 * A role check that replaced the permission check would be a second
 * authorisation system with its own gaps.
 */
export const RequireRole = (...roles: string[]) => SetMetadata(ROLE_KEY, roles);

export interface AuthenticatedRequest extends FastifyRequest {
  auth?: {
    userId: string;
    schoolId: string | null;
    roles: string[];
    permissions: string[];
    impersonated: boolean;
    /** Un administrateur de la plateforme (`users.is_platform_admin`), relu à chaque requête. */
    isPlatformAdmin?: boolean;
    /** Une session de famille : les écoles (actives) où le compte est parent. */
    ecolesFamille?: { id: string; slug: string; name: string; nameAr: string | null }[];
  };
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [];
    // ⚠ AND the role, where one is named. Both, never either.
    const roles = this.reflector.getAllAndOverride<string[]>(ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [];

    // ⚠ A ROLE ALONE USED TO BE SILENTLY INERT. The early return sat above the
    // role check, so `@RequireRole('parent')` with no `@RequirePermission` next
    // to it let ANY signed-in account through. The parent space has no
    // permission to name — a parent holds a role, not rights — which is exactly
    // the case that slipped. Both lists are read first; nothing returns early.
    if (required.length === 0 && roles.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = request.auth;
    if (!auth) throw new UnauthorizedException('Session expirée. Reconnectez-vous.');

    // Hiding a menu entry is NOT authorisation. Without this server-side check
    // it is enough to type the URL (El Ourwa `exiger_permission()`).
    const held = new Set(auth.permissions);
    if (required.length > 0 && !required.some((p) => held.has(p))) {
      // ⚠ The permission is NAMED. A bare "accès refusé" leaves an administrator
      // with no way to know which right to grant, and the person who can grant
      // it is usually the person reading this.
      throw new ForbiddenException(
        `Accès refusé — permission requise : ${required.join(' ou ')}.`,
      );
    }

    if (roles.length > 0 && !roles.some((r) => auth.roles.includes(r))) {
      /**
       * ⚠ UN REFUS QUI NE DIT QUE « NON » LAISSE QUELQU'UN COINCÉ.
       *
       * El Ourwa refuse le comptable sur ces gestes et, dans le même message,
       * lui dit où aller : « Les réductions sont réservées à l'administration.
       * Soumettez une demande de réduction depuis « Demandes ». » La file des
       * demandes existe vraiment, et le comptable la traite lui-même — le
       * refus n'est donc pas une impasse mais un aiguillage.
       *
       * On ne le dit qu'au comptable : c'est le seul rôle pour qui « Demandes »
       * est la suite du geste. Un professeur qui tombe ici s'est trompé de
       * porte, et lui proposer une file qu'il ne peut pas ouvrir l'égarerait.
       */
      if (auth.roles.includes('comptable')) {
        throw new ForbiddenException(
          'Ce geste est réservé à l’administration : il change ce que l’école ' +
            'réclame. Soumettez une demande depuis « Demandes ».',
        );
      }
      throw new ForbiddenException(`Réservé à : ${roles.join(', ')}`);
    }

    return true;
  }
}
