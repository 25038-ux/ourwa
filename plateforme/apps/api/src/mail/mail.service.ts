import { Inject, Injectable, Logger } from '@nestjs/common';
import { marqueDepuisEnv } from '@elourwa/shared/brand';
import nodemailer from 'nodemailer';
import { DbService } from '../db/db.service.js';

export interface OutboundMessage {
  schoolId: string | null;
  kind: string;
  recipient: string;
  subject: string;
  body: string;
}

/**
 * Everything that has to leave the building.
 *
 * ⚠ NOTHING IS SENT INSIDE A REQUEST. A request that waits on an SMTP handshake
 * is a request that hangs when the mail host is slow, and one that loses the
 * message entirely when the process restarts mid-send. The row is written, the
 * request returns, and a worker delivers.
 *
 * ⚠ AND NOTHING IS LOGGED. `password-reset.service.ts` used to print the reset
 * link whenever SMTP was unreachable — convenient in development, and in
 * production a live credential written into a file that gets shipped to log
 * aggregation and read by people who should not be able to take over an account.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger('mail');

  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** Is a real mail host configured? */
  static configured(): boolean {
    return Boolean(process.env.SMTP_HOST);
  }

  /**
   * Queue a message. Always succeeds if the database is up.
   *
   * `registry()` rather than `query()`: `outbound_mail` is a platform table with
   * no policy, and the queue must accept work from a request that has a tenant
   * and from one that does not — a password reset is requested before anyone has
   * signed in.
   */
  async enqueue(message: OutboundMessage): Promise<{ id: string }> {
    return this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO outbound_mail (school_id, kind, recipient, subject, body)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          message.schoolId,
          message.kind,
          message.recipient,
          message.subject,
          message.body,
        ],
      );
      return { id: rows[0]!.id };
    });
  }

  /**
   * Deliver one batch.
   *
   * `FOR UPDATE SKIP LOCKED` is what makes this safe to run in more than one
   * process: each worker claims rows nobody else holds, and a crash releases the
   * lock with the transaction rather than stranding the work.
   */
  async drain(limit = 20): Promise<{ sent: number; failed: number }> {
    // ⚠ SANS HÔTE, ON NE RÉCLAME RIEN. Réclamer comptait une tentative et, cinq
    // tentatives plus tard (31 minutes), chaque courriel était « abandonné » —
    // le contraire de « rien n'est perdu ». Ils attendent, intacts, la configuration.
    if (!MailService.configured()) return { sent: 0, failed: 0 };
    const batch = await this.db.registry(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        recipient: string;
        subject: string;
        body: string;
        attempts: number;
        max_attempts: number;
      }>(
        // ⚠ UN BAIL : la ligne réclamée recule de cinq minutes, sinon un second
        // processus (l'ancien conteneur pendant un déploiement) la reprenait
        // pendant l'envoi et la famille recevait le courriel deux fois.
        `UPDATE outbound_mail SET attempts = attempts + 1, run_after = now() + interval '5 minutes'
          WHERE id IN (
            SELECT id FROM outbound_mail
             WHERE status = 'pending' AND run_after <= now()
             ORDER BY created_at
             LIMIT $1
             FOR UPDATE SKIP LOCKED
          )
          RETURNING id, recipient, subject, body, attempts, max_attempts`,
        [limit],
      );
      return rows;
    });

    if (batch.length === 0) return { sent: 0, failed: 0 };

    let sent = 0;
    let failed = 0;

    for (const row of batch) {
      try {
        await this.deliver(row.recipient, row.subject, row.body);
        await this.db.registry((tx) =>
          tx.query(
            "UPDATE outbound_mail SET status = 'sent', sent_at = now() WHERE id = $1",
            [row.id],
          ),
        );
        sent += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown';
        const exhausted = row.attempts >= row.max_attempts;

        await this.db.registry((tx) =>
          tx.query(
            `UPDATE outbound_mail
                SET status = $2,
                    last_error = $3,
                    -- Exponential backoff, held in the row so a restart does not
                    -- forget how long it was meant to wait: 1, 2, 4, 8, 16 min.
                    run_after = now() + (interval '1 minute' * power(2, $4::int))
              WHERE id = $1`,
            [row.id, exhausted ? 'abandoned' : 'pending', reason, Math.min(row.attempts, 4)],
          ),
        );
        failed += 1;

        // The reason, never the message: the body may hold a reset link.
        if (exhausted) {
          this.log.error(`Giving up on message ${row.id} after ${row.attempts}: ${reason}`);
        }
      }
    }

    return { sent, failed };
  }

  private async deliver(to: string, subject: string, text: string): Promise<void> {
    const host = process.env.SMTP_HOST;
    if (!host) {
      // Not an error the worker should retry away silently: it is a deployment
      // that was never finished, and the queue growing is the visible symptom.
      throw new Error('SMTP_HOST is not configured');
    }

    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 25),
      secure: process.env.SMTP_SECURE === 'true',
      connectionTimeout: 10_000,
      ...(process.env.SMTP_USER
        ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? '' } }
        : {}),
    });

    await transport.sendMail({
      // `||`, pas `??` : docker compose transmet une variable vide (""), que `??`
      // gardait — et le courrier partait sans expéditeur.
      from: process.env.SMTP_FROM || marqueDepuisEnv(process.env).expediteur,
      to,
      subject,
      text,
    });
  }

  /** What is stuck, for the platform console. */
  async queueHealth() {
    return this.db.registry(async (tx) => {
      const { rows } = await tx.query<{
        pending: string;
        abandoned: string;
        oldest_pending: string | null;
      }>(
        `SELECT count(*) FILTER (WHERE status = 'pending')::text AS pending,
                count(*) FILTER (WHERE status = 'abandoned')::text AS abandoned,
                min(created_at) FILTER (WHERE status = 'pending')::text AS oldest_pending
           FROM outbound_mail`,
      );
      return {
        pending: Number(rows[0]!.pending),
        abandoned: Number(rows[0]!.abandoned),
        oldestPending: rows[0]!.oldest_pending,
        configured: MailService.configured(),
      };
    });
  }
}
