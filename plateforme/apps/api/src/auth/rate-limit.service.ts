import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { DbService } from '../db/db.service.js';

/**
 * Auth rate limiting, keyed on BOTH account and IP — ses constantes :
 * `MAX_LOGIN_ATTEMPTS = 5` / `LOCKOUT_DURATION = 900` pour le compte,
 * `IP_MAX_ATTEMPTS = 15` / `IP_LOCKOUT = 900` pour l'adresse (« protection
 * complémentaire »). Le bureau entier partage une adresse derrière son
 * routeur : à cinq par adresse, cinq fautes de frappe d'un agent fermaient la
 * porte à toute l'école.
 *
 * Both keys matter and neither is sufficient alone. Account-only lets an
 * attacker spray one password across many accounts from one machine. IP-only
 * lets a botnet grind a single account. So an attempt is recorded twice, under
 * two key spaces, and either bucket can trip.
 *
 * Held in Postgres rather than Redis for now — the state is tiny and must
 * survive a restart, and Redis is not yet running here. The interface is narrow
 * enough to move to Redis in Phase 4, when BullMQ brings Redis in anyway.
 */
@Injectable()
export class RateLimitService implements OnModuleInit, OnModuleDestroy {
  private readonly maxAttempts = 5;
  /**
   * ⚠ Par adresse IP, pas par personne. Les opérateurs mobiles mauritaniens
   * mettent des milliers de téléphones derrière une même adresse publique (CGNAT) :
   * quinze échecs y arrivent en quelques minutes le jour où les familles tapent
   * leur mot de passe provisoire, et tout le réseau se retrouvait bloqué. Réglable
   * par `LOGIN_IP_MAX_ATTEMPTS` (15 par défaut) ; le verrou PAR COMPTE, lui,
   * reste à cinq échecs quoi qu'il arrive.
   */
  private readonly ipMaxAttempts = Math.max(5, Number(process.env.LOGIN_IP_MAX_ATTEMPTS) || 15);
  private readonly windowMinutes = 15;

  private purge?: NodeJS.Timeout;

  constructor(@Inject(DbService) private readonly db: DbService) {}

  /**
   * LA PURGE — trente jours, pas un de plus. Une tentative ne sert qu'à la
   * fenêtre de quinze minutes ; la garder au-delà, c'était garder sans raison
   * l'adresse IP et l'appareil de chaque connexion — ce que la politique de
   * confidentialité (§ 3.4) promet de ne pas faire. L'historique des connexions
   * affiché à la direction vient des sessions (`refresh_tokens`), pas d'ici.
   * Une passe au démarrage, puis toutes les six heures ; une base indisponible
   * ne fait que remettre la passe à la suivante.
   */
  onModuleInit(): void {
    const passe = () => {
      try {
        void Promise.resolve(
          this.db.registry((tx) =>
            tx.query(`DELETE FROM login_attempts WHERE attempted_at < now() - interval '30 days'`),
          ),
        ).catch(() => undefined);
      } catch {
        // la passe suivante réessaiera
      }
    };
    passe();
    this.purge = setInterval(passe, 6 * 60 * 60 * 1000);
    this.purge.unref();
  }

  onModuleDestroy(): void {
    if (this.purge) clearInterval(this.purge);
  }

  /**
   * Les échecs de la fenêtre et, pour le compte, la fin du verrou : la
   * fenêtre glisse, donc le verrou tombe quinze minutes après le cinquième
   * échec le plus récent encore compté.
   */
  private async failuresIn(bucket: string): Promise<{ n: number; lockedUntil: Date | null }> {
    return this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ n: string; fin: Date | null }>(
        `SELECT count(*)::text AS n,
                (SELECT attempted_at + ($2 || ' minutes')::interval FROM login_attempts
                  WHERE bucket = $1 AND NOT succeeded
                    AND attempted_at > now() - ($2 || ' minutes')::interval
                  ORDER BY attempted_at DESC OFFSET $3 LIMIT 1) AS fin
           FROM login_attempts
          WHERE bucket = $1 AND NOT succeeded
            AND attempted_at > now() - ($2 || ' minutes')::interval`,
        [bucket, String(this.windowMinutes), this.maxAttempts - 1],
      );
      return { n: Number(rows[0]!.n), lockedUntil: rows[0]!.fin };
    });
  }

  /**
   * Throws 429 when either bucket is exhausted. Call BEFORE verifying.
   *
   * Ses deux phrases de `tenter_connexion()` : « Compte verrouillé. Réessayez
   * dans N minute(s). » quand c'est le compte, « Trop de tentatives depuis
   * votre réseau. Réessayez plus tard. » quand c'est l'adresse
   * (`ip_est_bloquee()`).
   */
  async assertAllowed(identifier: string, ip: string): Promise<void> {
    const [byAccount, byIp] = await Promise.all([
      this.failuresIn(`account:${identifier.toLowerCase()}`),
      this.failuresIn(`ip:${ip}`),
    ]);

    if (byIp.n >= this.ipMaxAttempts) {
      throw new HttpException(
        'Trop de tentatives depuis votre réseau. Réessayez plus tard.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (byAccount.n >= this.maxAttempts) {
      const restant = byAccount.lockedUntil
        ? Math.max(1, Math.ceil((byAccount.lockedUntil.getTime() - Date.now()) / 60_000))
        : this.windowMinutes;
      throw new HttpException(
        `Compte verrouillé. Réessayez dans ${restant} minute(s).`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Le compte vient-il d'atteindre la limite ? — après l'échec enregistré. */
  async justLocked(identifier: string): Promise<boolean> {
    const byAccount = await this.failuresIn(`account:${identifier.toLowerCase()}`);
    return byAccount.n === this.maxAttempts;
  }

  async record(
    identifier: string,
    ip: string,
    succeeded: boolean,
    userAgent?: string | null,
  ): Promise<void> {
    await this.db.registry((tx) =>
      tx.query(
        `INSERT INTO login_attempts (bucket, succeeded, ip, user_agent)
         VALUES ($1, $3, $4, $5), ($2, $3, $4, $5)`,
        [
          `account:${identifier.toLowerCase()}`,
          `ip:${ip}`,
          succeeded,
          ip,
          userAgent ?? null,
        ],
      ),
    );
  }

  /** A successful login clears the account's failures; the IP's stay. */
  async clearAccount(identifier: string): Promise<void> {
    await this.db.registry((tx) =>
      tx.query('DELETE FROM login_attempts WHERE bucket = $1 AND NOT succeeded', [
        `account:${identifier.toLowerCase()}`,
      ]),
    );
  }
}
