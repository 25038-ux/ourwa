import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { deploiementDepuisEnv, marqueDepuisEnv } from '@elourwa/shared/brand';
import { DbService } from '../db/db.service.js';
import { PushService } from '../push/push.service.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  // 503 quand la base ne répond pas : une sonde qui lit 200 « degraded »
  // n'alerte personne et ne redémarre rien.
  //
  // ⚠ ET CE QUI TOURNE, PAS SEULEMENT SI ÇA TOURNE. « Render est-il à jour
  // avec le poste ? » n'avait aucune réponse mesurable : `commit` est celui
  // que Render a construit (`RENDER_GIT_COMMIT`, posé par Render ; `GIT_COMMIT`
  // ailleurs), `migration` la dernière ligne de `schema_migrations` — à
  // comparer avec `git rev-parse HEAD` et `ls packages/db/migrations | tail -1`.
  // Un dépôt privé : le SHA ne révèle rien.
  @Get()
  async health(@Res({ passthrough: true }) res: FastifyReply) {
    const database = await this.db
      .registry(async (tx) => {
        await tx.query('SELECT 1');
        return 'up' as const;
      })
      .catch(() => 'down' as const);

    const migration =
      database === 'up'
        ? await this.db
            .registry(async (tx) => {
              const { rows } = await tx.query<{ filename: string }>(
                'SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1',
              );
              return rows[0]?.filename ?? null;
            })
            .catch(() => null)
        : null;

    const deploiement = deploiementDepuisEnv(process.env);
    if (database !== 'up') res.status(503);
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      at: new Date().toISOString(),
      commit: process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? null,
      migration,
      marque: marqueDepuisEnv(process.env).nom,
      mode: deploiement.ecoleUnique ? 'ecole-unique' : 'plateforme',
      ecole: deploiement.ecoleUnique,
      console: deploiement.console,
      // « firebase » : la clé de service est posée, les notifications partent à
      // l'instant ; « sondage » : l'application interroge le serveur.
      push: PushService.configured() ? 'firebase' : 'sondage',
    };
  }
}
