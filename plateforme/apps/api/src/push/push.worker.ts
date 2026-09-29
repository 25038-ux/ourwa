import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PushService } from './push.service.js';

/**
 * Vide la file des notifications poussées sur un minuteur — le jumeau de
 * `MailWorker`, pour les mêmes raisons : en processus, `unref()`, jamais deux
 * passes à la fois, et une erreur de base ne tue pas le minuteur.
 */
@Injectable()
export class PushWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('push-worker');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(@Inject(PushService) private readonly push: PushService) {}

  onModuleInit(): void {
    if (process.env.PUSH_WORKER === 'off') {
      this.log.warn('Désactivé par PUSH_WORKER=off — rien ne sera poussé.');
      return;
    }
    if (!PushService.configured()) {
      // Fort, une fois, au démarrage. Une file qui se remplit en silence, c'est
      // une école qui découvre en mars qu'aucun parent n'a reçu d'absence.
      this.log.warn(
        'FCM_SERVICE_ACCOUNT n’est pas défini. Les notifications s’accumulent dans ' +
          '`outbound_push` et y restent jusqu’à ce qu’il le soit. Rien n’est perdu, rien ne part.',
      );
    }
    // Trois secondes : une requête indexée sur `outbound_push` — et le
    // filet de sécurité du réveil immédiat (`PushService.reveiller`).
    const interval = Number(process.env.PUSH_INTERVAL_MS ?? 3_000);
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (!PushService.configured()) return;
      const { sent, failed } = await this.push.drain();
      if (sent > 0 || failed > 0) this.log.log(`poussées ${sent}, différées ${failed}`);
    } catch (error) {
      this.log.error(`drain : ${error instanceof Error ? error.message : 'inconnu'}`);
    } finally {
      this.running = false;
    }
  }
}
