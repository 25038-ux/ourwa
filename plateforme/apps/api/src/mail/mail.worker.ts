import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { MailService } from './mail.service.js';

/**
 * Drains the outbound queue on a timer.
 *
 * In-process on purpose, for now. A separate worker process is the right shape
 * once there is more than one kind of job, but a second deployable that the
 * school has to remember to start is a way to have no delivery at all — and
 * silent non-delivery of password resets is exactly the failure this replaces.
 *
 * `unref()` so it never holds the process open: a container that will not stop
 * is worse than one that stops with a message still queued, since the message
 * survives in the table either way.
 */
@Injectable()
export class MailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('mail-worker');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(@Inject(MailService) private readonly mail: MailService) {}

  onModuleInit(): void {
    if (process.env.MAIL_WORKER === 'off') {
      this.log.warn('Disabled by MAIL_WORKER=off — nothing will be delivered.');
      return;
    }
    if (!MailService.configured()) {
      // Loud, once, at boot. A queue quietly filling up is how a school finds
      // out in March that no parent has received a password reset since October.
      this.log.warn(
        'SMTP_HOST is not set. Messages will queue in `outbound_mail` and stay ' +
          'there until it is configured. Nothing is lost, and nothing is sent.',
      );
    }

    const interval = Number(process.env.MAIL_INTERVAL_MS ?? 15_000);
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass. Never overlaps itself, and never throws into the timer. */
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { sent, failed } = await this.mail.drain();
      if (sent > 0 || failed > 0) {
        this.log.log(`delivered ${sent}, deferred ${failed}`);
      }
    } catch (error) {
      // A database blip must not kill the timer: the next tick tries again.
      this.log.error(`drain failed: ${error instanceof Error ? error.message : 'unknown'}`);
    } finally {
      this.running = false;
    }
  }
}
