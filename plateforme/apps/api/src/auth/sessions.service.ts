import { createHash } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type pg from 'pg';
import { DbService } from '../db/db.service.js';
import { generateRefreshToken, hashRefreshToken } from './tokens.js';

export interface SessionContext {
  ip?: string | null;
  userAgent?: string | null;
  /**
   * L'application des familles : l'empreinte ne retient PAS l'adresse. Un
   * téléphone change de réseau dix fois par jour (Wi-Fi, 4G, un autre Wi-Fi)
   * et chaque changement de /24 révoquait toute la famille de jetons — le
   * parent se reconnectait « à chaque fois ». WhatsApp ne demande rien à un
   * téléphone qui change de réseau : l'appareil (User-Agent) suffit ici.
   */
  sansAdresse?: boolean;
}

/**
 * SON `empreinte_session()` : le User-Agent et les trois premiers octets de
 * l'adresse. « On tronque l'IP pour ne pas casser la session lors d'un
 * changement mineur (proxy, NAT) tout en bloquant un vol de cookie depuis un
 * autre réseau. » Pour une adresse IPv6, ses huit premiers caractères.
 *
 * ⚠ CE N'EST PAS UNE AUTHENTIFICATION, c'est un garde-fou. Un jeton de
 * rafraîchissement vaut quatre-vingt-dix jours ; le présenter depuis un autre
 * appareil ET un autre réseau que ceux qui l'ont reçu est ce à quoi ressemble
 * un vol, et la réponse est la même que pour une réutilisation : toute la
 * famille de jetons est révoquée et les deux côtés se reconnectent.
 */
export function fingerprint(ctx: SessionContext): string | null {
  const ua = ctx.userAgent ?? '';
  const ip = ctx.sansAdresse ? '' : (ctx.ip ?? '');
  if (!ua && !ip) return null;
  // La boucle locale est UNE adresse, quelle que soit sa graphie.
  const adresse = ip === '::1' || ip === '::ffff:127.0.0.1' ? '127.0.0.1' : ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const parts = adresse.split('.');
  // IPv6 : le préfixe /64 (quatre groupes) — la fin d'une adresse IPv6 change
  // d'elle-même (extensions de confidentialité) sans que l'appareil ait bougé.
  const prefix = parts.length === 4 ? parts.slice(0, 3).join('.') : adresse.split(':').slice(0, 4).join(':');
  return createHash('sha256').update(`${ua}|${prefix}`).digest('hex');
}

export interface IssuedSession {
  refreshToken: string;
  familyId: string;
  expiresAt: Date;
}

export interface RotatedSession extends IssuedSession {
  userId: string;
  schoolId: string | null;
  impersonated: boolean;
}

const REFRESH_TTL_DAYS = 90;

/**
 * Refresh-token lifecycle: issue, rotate, revoke.
 *
 * `refresh_tokens` is a platform table (a user is global), so these run outside
 * any tenant context — deliberately, via `DbService.registry()`.
 */
@Injectable()
export class SessionsService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async issue(
    userId: string,
    schoolId: string | null,
    ctx: SessionContext = {},
    opts: { familyId?: string; impersonated?: boolean } = {},
  ): Promise<IssuedSession> {
    const token = generateRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000);

    return this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ family_id: string }>(
        `INSERT INTO refresh_tokens
           (user_id, family_id, token_hash, school_id, impersonated, expires_at, user_agent, ip,
            fingerprint)
         VALUES ($1, COALESCE($2::uuid, uuid_generate_v7()), $3, $4, $5, $6, $7, $8, $9)
         RETURNING family_id`,
        [
          userId,
          opts.familyId ?? null,
          hashRefreshToken(token),
          schoolId,
          opts.impersonated ?? false,
          expiresAt,
          ctx.userAgent ?? null,
          ctx.ip ?? null,
          fingerprint(ctx),
        ],
      );
      return { refreshToken: token, familyId: rows[0]!.family_id, expiresAt };
    });
  }

  /**
   * Exchange a refresh token for a new one.
   *
   * ⚠ Reuse detection. Presenting a token that has ALREADY been rotated means it
   * was stolen: the legitimate holder and the thief both hold copies, and there
   * is no way to tell which is presenting. So the entire family is revoked and
   * both are forced to re-authenticate. Revoking only the presented token would
   * leave the thief's newer token live.
   */
  async rotate(presented: string, ctx: SessionContext = {}): Promise<RotatedSession> {
    const hash = hashRefreshToken(presented);

    const existing = await this.db.registry(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        user_id: string;
        family_id: string;
        school_id: string | null;
        impersonated: boolean;
        used_at: Date | null;
        revoked_at: Date | null;
        expires_at: Date;
        fingerprint: string | null;
      }>(
        `SELECT id, user_id, family_id, school_id, impersonated, used_at, revoked_at, expires_at,
                fingerprint
           FROM refresh_tokens WHERE token_hash = $1`,
        [hash],
      );
      return rows[0];
    });

    if (!existing) throw new UnauthorizedException('Session invalide. Reconnectez-vous.');

    // ⚠ L'EMPREINTE. Un jeton reçu par un appareil sur un réseau, présenté par
    // un autre appareil sur un autre réseau : c'est à cela que ressemble un vol,
    // et la réponse est celle de la réutilisation. Un jeton émis avant
    // l'empreinte n'en a pas et passe — une fois, il en reçoit une à la rotation.
    // Une session de famille a été émise sans adresse : elle se reconnaît à
    // l'appareil seul. Une session du personnel, émise avec, ne peut pas
    // correspondre à l'empreinte sans adresse — les deux se comparent sans
    // affaiblir l'une ni l'autre.
    const presentee = fingerprint(ctx);
    const presenteeSansAdresse = fingerprint({ ...ctx, sansAdresse: true });
    const correspond =
      !existing.fingerprint || !presentee ||
      existing.fingerprint === presentee || existing.fingerprint === presenteeSansAdresse;
    if (!correspond) {
      // Dit POURQUOI, sans secret : sans cette ligne, une famille révoquée à
      // chaque quart d'heure ne se diagnostiquait qu'en base.
      console.warn(`[session] empreinte différente au renouvellement : ip=${ctx.ip ?? '-'} ua=${(ctx.userAgent ?? '-').slice(0, 60)} sansAdresse=${ctx.sansAdresse ?? false}`);
      await this.revokeFamily(existing.family_id, 'fingerprint_mismatch');
      throw new UnauthorizedException(
        'Session présentée depuis un autre appareil : toutes les sessions ont été révoquées par sécurité. Reconnectez-vous.',
      );
    }

    if (existing.revoked_at) throw new UnauthorizedException('Session révoquée. Reconnectez-vous.');
    if (existing.expires_at.getTime() <= Date.now()) {
      throw new UnauthorizedException('Session expirée. Reconnectez-vous.');
    }

    // ⚠ UNE SEULE PRÉSENTATION GAGNE. Lire `used_at` puis le poser en deux
    // requêtes laissait deux présentations simultanées du même jeton (le
    // voleur qui court contre le titulaire) repartir chacune avec un jeton
    // neuf : la détection de réutilisation ne voyait rien. Le marquage est
    // conditionnel et atomique — zéro ligne, c'est que l'autre est passé avant.
    const gagne = await this.db.registry((tx) =>
      tx.query('UPDATE refresh_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL', [existing.id]),
    );
    if ((gagne.rowCount ?? 0) === 0) {
      await this.revokeFamily(existing.family_id, 'refresh_token_reuse_detected');
      throw new UnauthorizedException('Session réutilisée : toutes les sessions ont été révoquées par sécurité. Reconnectez-vous.');
    }

    // Le jeton suivant garde la nature de l'empreinte du précédent : une
    // session émise sans adresse (famille) reste sans adresse, sinon le
    // deuxième changement de réseau la révoquait.
    const sansAdresse = ctx.sansAdresse || (Boolean(existing.fingerprint) && existing.fingerprint === presenteeSansAdresse && existing.fingerprint !== presentee);
    const next = await this.issue(existing.user_id, existing.school_id, { ...ctx, sansAdresse }, {
      familyId: existing.family_id,
      impersonated: existing.impersonated,
    });

    return {
      ...next,
      userId: existing.user_id,
      schoolId: existing.school_id,
      impersonated: existing.impersonated,
    };
  }

  /** Kills every token in a family — the response to a detected theft. */
  async revokeFamily(familyId: string, reason: string): Promise<number> {
    return this.db.registry(async (tx) => {
      const result = await tx.query(
        `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = $2
          WHERE family_id = $1 AND revoked_at IS NULL`,
        [familyId, reason],
      );
      return result.rowCount ?? 0;
    });
  }

  /** Logout everywhere. */
  /**
   * Toutes les sessions du compte — sauf, quand elle est nommée, celle qui
   * vient de changer son mot de passe ou son identifiant : elle reste ouverte,
   * comme la session PHP de `modifier_profil.php`.
   */
  async revokeAllForUser(userId: string, reason = 'logout_all', keep?: string): Promise<number> {
    return this.db.registry(async (tx) => {
      const result = await tx.query(
        `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = $2
          WHERE user_id = $1 AND revoked_at IS NULL
            AND ($3::text IS NULL OR token_hash <> $3)`,
        [userId, reason, keep ? hashRefreshToken(keep) : null],
      );
      return result.rowCount ?? 0;
    });
  }

  async revokeOne(presented: string, reason = 'logout'): Promise<void> {
    await this.db.registry((tx) =>
      tx.query(
        `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = $2
          WHERE token_hash = $1 AND revoked_at IS NULL`,
        [hashRefreshToken(presented), reason],
      ),
    );
  }
}

/** Builds a SessionsService around a bare pool, for tests. */
export function sessionsServiceForPool(pool: pg.Pool): SessionsService {
  const db = {
    registry: async <T>(fn: (tx: pg.PoolClient) => Promise<T>) => {
      const client = await pool.connect();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    },
  } as unknown as DbService;
  return new SessionsService(db);
}
