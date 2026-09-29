import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { TenantService } from './tenant.service.js';
import { runInTenant } from './tenant.context.js';
import { AuditService } from '../audit/audit.service.js';
import { clientIp, schoolSlugFromTrustedHeader } from '../auth/client-ip.js';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedRequest } from '../auth/permissions.guard.js';

/**
 * Establishes the tenant for the request, and checks the caller may enter it.
 *
 * `X-School-Slug` is accepted ONLY outside production, so tests and curl can
 * target a branch without manufacturing subdomains.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(
    @Inject(TenantService) private readonly tenants: TenantService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const path = (request.url ?? '').split('?')[0]!;

    // Endpoints that exist above any single school. `/auth` resolves its own
    // school from the Host, because a platform admin logs in at
    // `admin.<domain>` where there is no school at all.
    if (
      path.startsWith('/health') ||
      path.startsWith('/platform') ||
      path.startsWith('/auth')
    ) {
      return next.handle();
    }

    // UNE SESSION DE FAMILLE N'A PAS D'ÉCOLE DANS LA REQUÊTE : l'application
    // des familles est une pour toutes les branches. Les routes qui la servent
    // parcourent elles-mêmes les écoles du compte, chacune sous son propre
    // contexte (`runInTenant`) — RLS s'applique école par école, jamais
    // contournée. Rien d'autre n'est ouvert à une telle session : sans école,
    // toute autre route reste refusée par l'absence de contexte.
    if (request.auth?.ecolesFamille && (path.startsWith('/parent') || path.startsWith('/attachments'))) {
      return next.handle();
    }

    // ⚠ EN PRODUCTION AUSSI, du serveur web. Le site appelle l'API côté serveur
    // sur 127.0.0.1 (ou un mandataire de confiance) : son Host ne porte pas
    // l'école, seul X-School-Slug la porte — et il ne fait que recopier le
    // sous-domaine que la personne a visité. Refuser l'en-tête en production
    // cassait CHAQUE requête du site (« Aucune école dans cette requête »),
    // trouvé en lançant le paquet construit, pas les tests.
    const headerSlug = schoolSlugFromTrustedHeader(request as unknown as FastifyRequest);

    // En école unique, ni l'en-tête ni l'hôte ne peuvent désigner autre chose.
    const slug = this.tenants.ecoleUnique() ?? headerSlug ?? this.tenants.slugFromHost(request.headers.host);
    if (!slug) {
      throw new BadRequestException(
        'Aucune école dans cette requête. Utilisez un sous-domaine d’école, ' +
          'par exemple http://nour.localhost:3001.',
      );
    }

    const school = await this.tenants.findBySlug(slug);

    // ⚠ Resolving WHICH school this request is for is not the same as deciding
    // whether the caller may enter it.
    //
    // RLS scopes every query to the tenant that gets set here — faithfully, to
    // whichever tenant that is. So without this check, a signed-in user at one
    // branch reads another branch's data simply by changing the Host header (or
    // `X-School-Slug` in development). The database is doing exactly what it was
    // told; the bug is that it was told the wrong thing.
    //
    // A platform admin is the one legitimate exception, and their session is
    // marked `impersonated` so the audit log can tell the two apart.
    const auth = request.auth;
    // Une session de famille (sans école) n'entre nulle part ailleurs que sur
    // /parent et /attachments, traités plus haut : ici, sous n'importe quel
    // slug, elle est refusée — « auth.schoolId » nul ne vaut pas « partout ».
    const familleEgaree = Boolean(auth?.ecolesFamille);
    if (auth && (familleEgaree || (auth.schoolId && auth.schoolId !== school.id))) {
      await this.audit.record({
        actorId: auth.userId,
        schoolId: school.id,
        action: 'cross_school_access_denied',
        entity: 'school',
        entityId: school.id,
        ip: clientIp(request as never),
        after: { tokenSchoolId: auth.schoolId, requestedSlug: slug, path },
      });
      throw new ForbiddenException('Cette session n’appartient pas à cette école.');
    }

    return runInTenant({ schoolId: school.id, slug: school.slug }, () => next.handle());
  }
}
