import { readFileSync } from 'node:fs';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SignJWT, importPKCS8 } from 'jose';
import { renduPourPousser, type Langue } from '@elourwa/shared';
import { DbService } from '../db/db.service.js';
import { currentTenant } from '../tenant/tenant.context.js';

/**
 * LES NOTIFICATIONS POUSSÉES — le dernier point de FEATURES.
 *
 * L'application parent INTERROGEAIT le serveur (`notifications_poller.dart`)
 * au lieu de recevoir : une mère apprenait l'absence de son fils à l'ouverture
 * de l'application, pas au moment où elle était saisie. Ici, chaque
 * notification écrite pour une famille part aussi vers ses téléphones.
 *
 * ## Le dessin — celui de `outbound_mail`, ADR-0017
 *
 * `enqueue()` écrit une ligne dans `outbound_push`, dans la même transaction que
 * la notification elle-même quand l'appelant en a une : l'un ne part pas sans
 * l'autre. `drain()`, sur un minuteur, ramasse ce qui est dû avec
 * `FOR UPDATE SKIP LOCKED`, lit les jetons de la famille SOUS LE LOCATAIRE de
 * la ligne, et envoie. Une coupure au milieu laisse la ligne où elle est.
 *
 * ## FCM, en HTTP v1, sans bibliothèque
 *
 * L'API v1 de Firebase Cloud Messaging veut un jeton OAuth2 de compte de
 * service. Il s'obtient en signant un JWT RS256 avec la clé du compte et en
 * l'échangeant à `oauth2.googleapis.com` — `jose` est déjà là pour ES256, il
 * signe aussi RS256. Pas de SDK : trois cents dépendances pour deux requêtes.
 *
 * ⚠ RIEN N'EST PERDU QUAND RIEN N'EST CONFIGURÉ. Sans `FCM_SERVICE_ACCOUNT`, les
 * lignes s'accumulent dans `outbound_push` et le travailleur le dit au
 * démarrage, une fois, fort. Comme pour le courrier.
 *
 * ⚠ UN JETON N'EST PAS UNE ADRESSE, C'EST UNE CLÉ. Il ouvre l'écran d'un
 * téléphone. Il ne se journalise pas, il ne s'affiche pas, et il part de la
 * table dès que Google répond `UNREGISTERED` — l'application a été
 * désinstallée ou le jeton a tourné.
 */

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

@Injectable()
export class PushService {
  private readonly log = new Logger('push');
  private compte: ServiceAccount | null | undefined;
  private jeton: { valeur: string; expire: number } | null = null;
  private reveil: NodeJS.Timeout | null = null;

  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** `FCM_SERVICE_ACCOUNT` : le JSON du compte de service, ou le chemin d'un fichier qui le contient. */
  static configured(): boolean {
    return Boolean(process.env.FCM_SERVICE_ACCOUNT);
  }

  // ── Les appareils ──────────────────────────────────────────────────────

  async registerDevice(
    userId: string,
    platform: 'android' | 'ios' | 'web',
    token: string,
    locale: string,
  ): Promise<void> {
    const { schoolId } = currentTenant();
    await this.db.query((tx) =>
      tx.query(
        `INSERT INTO device_tokens (school_id, user_id, platform, token, locale)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (school_id, token)
         DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform,
                       locale = EXCLUDED.locale, last_seen_at = now()`,
        [schoolId, userId, platform, token, locale === 'ar' ? 'ar' : 'fr'],
      ),
    );
  }

  /** Combien de téléphones ce compte a déclarés ici. */
  async countDevices(userId: string): Promise<number> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ n: string }>('SELECT count(*)::text AS n FROM device_tokens WHERE user_id = $1', [userId]);
      return Number(rows[0]?.n ?? 0);
    });
  }

  /** Ce jeton est-il déclaré pour ce compte, ici ? (le profil du téléphone le demande) */
  async hasDevice(userId: string, token: string): Promise<boolean> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query('SELECT 1 FROM device_tokens WHERE user_id = $1 AND token = $2', [userId, token]);
      return rows.length > 0;
    });
  }

  /** À la déconnexion : ce téléphone ne doit plus rien recevoir pour ce compte. */
  async unregisterDevice(userId: string, token: string): Promise<void> {
    await this.db.query((tx) =>
      tx.query('DELETE FROM device_tokens WHERE user_id = $1 AND token = $2', [userId, token]),
    );
  }

  // ── La file ────────────────────────────────────────────────────────────

  /**
   * Mettre en file une notification pour une famille, rendue dans SA langue.
   * `souche` est la clé sans suffixe (`notif_absence`), `params` ce que le
   * gabarit attend. Dans la transaction de l'appelant si elle est fournie.
   */
  async enqueue(
    guardianId: string,
    souche: string,
    params: Record<string, unknown>,
    route: string | null,
    tx?: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  ): Promise<void> {
    const { schoolId } = currentTenant();
    const run = async (q: NonNullable<typeof tx>) => {
      const { rows } = (await q.query('SELECT locale FROM users WHERE id = $1', [guardianId])) as {
        rows: { locale: string }[];
      };
      const langue: Langue = rows[0]?.locale === 'ar' ? 'ar' : 'fr';
      const { title, body } = renduPourPousser(souche, params, langue);
      // FCM refuse une charge au-delà de 4 Ko : le corps est borné, le texte
      // entier se lit dans l'application.
      await q.query(
        `INSERT INTO outbound_push (school_id, user_id, title, body, route)
         VALUES ($1, $2, $3, $4, $5)`,
        [schoolId, guardianId, title.slice(0, 120), body.length > 240 ? `${body.slice(0, 239)}…` : body, route],
      );
    };
    if (tx) await run(tx);
    else await this.db.query((q) => run(q));
    this.reveiller();
  }

  /**
   * RÉVEILLER LA FILE : l'envoi part dans la seconde qui suit l'écriture, pas
   * au prochain tour du minuteur. « Notifications are far from instant »
   * (propriétaire, 23/09) : dix secondes de minuteur, plus le temps de
   * Google, se sentent. La ligne est écrite dans la transaction de
   * l'appelant, invisible jusqu'à sa validation : le réveil attend une
   * seconde, et le minuteur (3 s) ramasse ce qu'une longue transaction
   * aurait validé après. Un seul réveil en attente à la fois.
   */
  reveiller(delaiMs = 1000): void {
    if (!PushService.configured() || this.reveil) return;
    this.reveil = setTimeout(() => {
      this.reveil = null;
      void this.drain().catch((e: unknown) => this.log.error(`réveil : ${e instanceof Error ? e.message : 'inconnu'}`));
    }, delaiMs);
    this.reveil.unref();
  }

  /** Une passe : ramasse ce qui est dû, envoie, marque. */
  async drain(limit = 50): Promise<{ sent: number; failed: number }> {
    // ⚠ Sans compte de service, on ne réclame même pas les lignes : les
    // réclamer compterait une tentative et reculerait leur échéance pour rien.
    // Elles attendent, intactes, que la configuration arrive.
    // ⚠ ET PAS SEULEMENT LA VARIABLE : une clé posée mais illisible (JSON
    // tronqué, chemin faux) réclamait les lignes, échouait cinq fois et les
    // abandonnait — « rien n'est perdu » ne tenait plus. Le compte est lu
    // (l'erreur est journalisée une fois) ; sans compte utilisable, on attend.
    if (!PushService.configured() || !this.compteDeService()) return { sent: 0, failed: 0 };
    const batch = await this.db.registry(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        school_id: string;
        user_id: string;
        title: string;
        body: string;
        route: string | null;
        attempts: number;
        max_attempts: number;
      }>(
        `UPDATE outbound_push SET attempts = attempts + 1, run_after = now() + interval '5 minutes'
          WHERE id IN (
            SELECT id FROM outbound_push
             WHERE status = 'pending' AND run_after <= now()
             ORDER BY created_at LIMIT $1
             FOR UPDATE SKIP LOCKED
          )
          RETURNING id, school_id, user_id, title, body, route, attempts, max_attempts`,
        [limit],
      );
      return rows;
    });
    if (batch.length === 0) return { sent: 0, failed: 0 };

    let sent = 0;
    let failed = 0;
    for (const row of batch) {
      try {
        // Les jetons de la famille, SOUS SON LOCATAIRE : la file est une table de
        // plate-forme, les appareils ne le sont pas.
        const jetons = await this.db.queryFor(row.school_id, async (tx) => {
          const { rows } = await tx.query<{ token: string }>(
            'SELECT token FROM device_tokens WHERE user_id = $1',
            [row.user_id],
          );
          return rows.map((r) => r.token);
        });
        // ⚠ PAR JETON : un téléphone injoignable faisait rejouer TOUTE la ligne —
        // et les autres téléphones de la famille sonnaient jusqu'à cinq fois.
        const morts: string[] = [];
        let livres = 0;
        let derniereErreur: unknown = null;
        for (const jeton of jetons) {
          try {
            const etat = await this.envoyer(jeton, row.title, row.body, row.route);
            if (etat === 'unregistered') morts.push(jeton);
            else livres += 1;
          } catch (e) {
            derniereErreur = e;
          }
        }
        if (jetons.length > 0 && livres === 0 && morts.length < jetons.length) throw derniereErreur;
        if (morts.length) {
          await this.db.queryFor(row.school_id, (tx) =>
            tx.query('DELETE FROM device_tokens WHERE token = ANY($1::text[])', [morts]),
          );
        }
        await this.db.registry((tx) =>
          tx.query("UPDATE outbound_push SET status = 'sent', sent_at = now() WHERE id = $1", [row.id]),
        );
        sent += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown';
        const exhausted = row.attempts >= row.max_attempts;
        await this.db.registry((tx) =>
          tx.query(
            `UPDATE outbound_push
                SET status = $2, last_error = $3,
                    run_after = now() + (interval '1 minute' * power(2, $4::int))
              WHERE id = $1`,
            [row.id, exhausted ? 'abandoned' : 'pending', reason, Math.min(row.attempts, 4)],
          ),
        );
        failed += 1;
        if (exhausted) this.log.error(`Abandon de ${row.id} après ${row.attempts} : ${reason}`);
      }
    }
    return { sent, failed };
  }

  // ── FCM ────────────────────────────────────────────────────────────────

  private compteDeService(): ServiceAccount | null {
    if (this.compte !== undefined) return this.compte;
    const brut = process.env.FCM_SERVICE_ACCOUNT;
    if (!brut) return (this.compte = null);
    try {
      const json = brut.trimStart().startsWith('{') ? brut : readFileSync(brut, 'utf8');
      const c = JSON.parse(json) as ServiceAccount;
      if (!c.project_id || !c.client_email || !c.private_key) throw new Error('champs manquants');
      return (this.compte = c);
    } catch (e) {
      this.log.error(`FCM_SERVICE_ACCOUNT illisible : ${(e as Error).message}`);
      return (this.compte = null);
    }
  }

  /** Un jeton OAuth2 de compte de service, gardé jusqu'à cinq minutes avant son échéance. */
  private async jetonAcces(compte: ServiceAccount): Promise<string> {
    if (this.jeton && this.jeton.expire > Date.now() + 300_000) return this.jeton.valeur;
    const cle = await importPKCS8(compte.private_key, 'RS256');
    const assertion = await new SignJWT({
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(compte.client_email)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(cle);
    const reponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      // Un appel qui pend bloquait tout le lot et le travailleur (une seule passe à la fois).
      signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!reponse.ok) throw new Error(`OAuth2 ${reponse.status}`);
    const corps = (await reponse.json()) as { access_token: string; expires_in: number };
    this.jeton = { valeur: corps.access_token, expire: Date.now() + corps.expires_in * 1000 };
    return corps.access_token;
  }

  /** Un envoi. `unregistered` veut dire : ce jeton est mort, retirez-le. */
  private async envoyer(
    jeton: string,
    title: string,
    body: string,
    route: string | null,
  ): Promise<'sent' | 'unregistered'> {
    const compte = this.compteDeService();
    if (!compte) throw new Error('FCM non configuré');
    const acces = await this.jetonAcces(compte);
    const reponse = await fetch(
      `https://fcm.googleapis.com/v1/projects/${compte.project_id}/messages:send`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${acces}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: jeton,
            notification: { title, body },
            data: route ? { route } : {},
            // ⚠ `elourwa_v2` : un canal Android ne change plus de son ni de
            // vibration une fois créé — la sonnerie propre et la vibration
            // (18/09) ont exigé un nouvel identifiant (MainActivity.kt, manifeste).
            android: {
              priority: 'high',
              notification: {
                channel_id: 'elourwa_v2',
                sound: 'elourwa_notif',
                default_vibrate_timings: false,
                vibrate_timings: ['0s', '0.25s', '0.12s', '0.25s'],
                notification_priority: 'PRIORITY_HIGH',
                visibility: 'PUBLIC',
                icon: 'ic_notification',
                color: '#0891B2',
              },
            },
            apns: { payload: { aps: { sound: 'default' } } },
          },
        }),
      },
    );
    if (reponse.ok) return 'sent';
    const texte = await reponse.text();
    // 404 UNREGISTERED : l'application n'est plus là. Pas une erreur, un ménage.
    if (reponse.status === 404 || texte.includes('UNREGISTERED')) return 'unregistered';
    throw new Error(`FCM ${reponse.status}`);
  }
}
