import { ArgumentsHost, Catch, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { ZodExceptionFilter } from './zod-exception.filter.js';

/**
 * Les erreurs de Postgres qui disent « cette VALEUR ne se lit pas » — pas
 * « la base est en panne » : un identifiant qui n'est pas un UUID (22P02),
 * une date qui n'existe pas ou mal écrite (22007, 22008), un nombre hors de
 * sa colonne (22003).
 */
const VALEUR_ILLISIBLE = new Set(['22P02', '22007', '22008', '22003']);

export function estValeurIllisible(e: unknown): e is Error & { code: string } {
  if (!(e instanceof Error)) return false;
  const code = (e as Error & { code?: unknown }).code;
  return typeof code === 'string' && VALEUR_ILLISIBLE.has(code);
}

/**
 * « PARAMÈTRE INVALIDE », PAS « INTERNAL SERVER ERROR » (05/10/2026).
 *
 * Une adresse avec une année « 2026 » au lieu de son identifiant, une date
 * « 2026-02-31 », un nombre trop grand : la valeur partait telle quelle dans
 * la requête SQL, Postgres refusait de la lire, et la personne recevait
 * « Internal server error » — ce qui dit « le serveur est cassé », se signale
 * comme une panne, et cache la vraie cause (l'adresse). Trouvé en balayant
 * toutes les routes GET avec des valeurs mal formées :
 * `/accounts/parents?limit=2026-13`,
 * `/accounts/connection-history?jour=2026-02-31`, `/reports/jour?jour=2026-02-31`…
 *
 * Un FILET, pas une validation : chaque route garde la sienne. Ce filet
 * attrape ce qu'une route aurait oublié de valider, rend 400 avec un message
 * qui dit quoi regarder, et JOURNALISE l'erreur SQL — une valeur illisible
 * produite par notre propre code (et non par l'adresse) reste visible dans
 * le journal. Tout le reste passe au traitement ordinaire de Nest.
 */
@Catch()
export class ParametreInvalideFilter extends BaseExceptionFilter {
  private readonly zod = new ZodExceptionFilter();

  override catch(exception: unknown, host: ArgumentsHost): void {
    // L'ordre des filtres globaux n'est pas garanti : une erreur de Zod garde
    // son traitement (400 avec le champ en cause), quel que soit le filtre élu.
    if (exception instanceof ZodError) return this.zod.catch(exception, host);

    if (estValeurIllisible(exception) && host.getType() === 'http') {
      const http = host.switchToHttp();
      const req = http.getRequest<FastifyRequest>();
      const reply = http.getResponse<FastifyReply>();
      console.warn(`[api] paramètre invalide ${req.method} ${req.url} — ${exception.code} : ${exception.message}`);
      void reply.status(HttpStatus.BAD_REQUEST).send({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: "Paramètre invalide : une date, un nombre ou un identifiant de l'adresse ne se lit pas.",
      });
      return;
    }
    super.catch(exception, host);
  }
}
