import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { IP_PER_MINUTE, Throttle, USER_PER_MINUTE } from './throttle.js';
import { clientIp } from './auth/client-ip.js';
import type { AuthenticatedRequest } from './auth/permissions.guard.js';

/**
 * LE PLAFOND DE REQUÊTES — applied to every endpoint.
 *
 * ⚠ COUNTED PER USER WHEN THERE IS ONE, PER IP OTHERWISE, NEVER BOTH.
 *
 * Counting both would make the office its own enemy: three people signing in
 * from one connection would share the IP ceiling and throttle each other on a
 * busy morning at the till. A signed-in session is already attributable and
 * already rate-limited at login, so its own higher ceiling is the right unit.
 * Anonymous traffic — which is what a scraper is — gets the IP ceiling.
 *
 * ⚠ AND IT ANSWERS 429 WITH `Retry-After`. A refusal that does not say when to
 * come back invites a tight retry loop, which is the traffic being defended
 * against.
 */
@Injectable()
export class ThrottleGuard implements CanActivate {
  private readonly throttle = new Throttle();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // Health checks must never be throttled: a monitor that gets a 429 reports
    // the service as down, which is the opposite of what happened.
    if (request.url?.startsWith('/health')) return true;

    const userId = request.auth?.userId;
    const key = userId ? `u:${userId}` : `ip:${clientIp(request)}`;
    const limit = userId ? USER_PER_MINUTE : IP_PER_MINUTE;

    if (this.throttle.take(key, limit)) return true;

    const reply = context.switchToHttp().getResponse<FastifyReply>();
    reply.header('Retry-After', String(this.throttle.retryAfter(key)));

    throw new HttpException(
      'Trop de requêtes. Réessayez dans un instant.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
