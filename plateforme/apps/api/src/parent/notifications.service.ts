import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import type { Queryable } from '@elourwa/db';
import { CacheService } from '../cache/cache.service.js';
import { PushService } from '../push/push.service.js';
import { ExamAccessService } from '../exams/exam-access.service.js';
import { currentTenant } from '../tenant/tenant.context.js';

export interface ParentNotification {
  id: string;
  kind: string;
  i18nKey: string;
  i18nParams: Record<string, unknown>;
  studentId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * LE FLUX DE NOTIFICATIONS DU PARENT — `api/parent/notifications.php`.
 *
 * ⚠ THE TABLE WAS WRITE-ONLY. `notifications` has been filled since homework
 * shipped — an exercise sent, a timetable published — and nothing in the system
 * ever read a row back: no endpoint, no screen, no badge. A school could send an
 * exercise to thirty families and none of them would be told.
 *
 * ⚠ AND THE EXAM RATCHET REACHES THE STREAM, which is the part that is easy to
 * miss. El Ourwa withholds `note` notifications from a family that may not see
 * exam results, and its reasoning is the specification:
 *
 *   "`notifications`.`type` ... ne distingue PAS un devoir d'un examen. Une
 *    notification de type « note » peut donc porter un resultat d'examen, et
 *    rien dans la table ne permet de le savoir. On echoue fermé : quand les
 *    examens sont bloqués, aucune notification de note ne part. Mieux vaut
 *    retenir l'annonce d'un devoir que laisser filer celle d'un examen — c'est
 *    precisement le levier de recouvrement de l'ecole."
 *
 * Withholding results is how the school gets paid. "Nouvelle note :
 * Mathématiques — 14/20" in a notification defeats that as completely as
 * handing over the bulletin.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(ExamAccessService) private readonly examAccess: ExamAccessService,
      @Inject(CacheService) private readonly cache: CacheService,
    @Inject(PushService) private readonly push: PushService,
) {}

  /**
   * ⚠ ONE FILTER, USED BY BOTH THE LIST AND THE COUNT. El Ourwa counts "SOUS
   * LES MÊMES FILTRES que la liste", and the reason is immediate: a badge
   * saying 2 over a list of 1 sends a parent looking for something they are not
   * allowed to see, and then to the office to ask why.
   */
  private async withheldKinds(guardianId: string, academicYearId: string): Promise<string[]> {
    // A NULL term asks the question globally: allowed only when the family owes
    // nothing at all. That is the right question here — a notification carries
    // no term, so there is no term to ask about.
    const open = await this.examAccess.canSeeExams(guardianId, null, academicYearId, null);
    return open ? [] : ['grade'];
  }

  /**
   * A family's stream for one year.
   *
   * ⚠ SCOPED TO THE YEAR, AND A NULL YEAR IS NOT A WILDCARD. Migration 0010
   * added `academic_year_id` and left the pre-existing rows NULL on purpose:
   * "Existing rows keep NULL and become invisible to parents." A closed year
   * takes its announcements with it, or a family reads last June's news beside
   * an otherwise empty space and takes it for this week's.
   */
  async forGuardian(
    guardianId: string,
    academicYearId: string,
    limit = 50,
  ): Promise<{ items: ParentNotification[]; unread: number }> {
    const withheld = await this.withheldKinds(guardianId, academicYearId);

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        kind: string;
        i18n_key: string;
        i18n_params: Record<string, unknown>;
        student_id: string | null;
        read_at: Date | null;
        created_at: Date;
      }>(
        `SELECT id, kind, i18n_key, i18n_params, student_id, read_at, created_at
           FROM notifications
          WHERE guardian_id = $1 AND academic_year_id = $2
            AND NOT (kind = ANY($3::text[]))
          ORDER BY created_at DESC
          LIMIT $4`,
        [guardianId, academicYearId, withheld, limit],
      );

      const { rows: counted } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM notifications
          WHERE guardian_id = $1 AND academic_year_id = $2
            AND read_at IS NULL AND NOT (kind = ANY($3::text[]))`,
        [guardianId, academicYearId, withheld],
      );

      return {
        items: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          i18nKey: r.i18n_key,
          i18nParams: r.i18n_params,
          studentId: r.student_id,
          readAt: r.read_at,
          createdAt: r.created_at,
        })),
        unread: Number(counted[0]!.n),
      };
    });
  }

  /**
   * NOTIFIER UNE FAMILLE — le port de `notifier_parent_de_etudiant()` et
   * `notifier_parent()` (`includes/parent_auth.php`).
   *
   * Une ligne dans `notifications` — clé et paramètres, rendus par
   * l'application dans la langue du parent — ET une ligne dans `outbound_push`,
   * déjà rendue dans cette langue, pour les téléphones où l'application ne
   * tourne pas. Les deux dans la même transaction : l'une ne part pas sans
   * l'autre.
   *
   * ⚠ El Ourwa appelle ceci depuis DOUZE endroits — absence, retard, note,
   * remarque, exercice, message, paiement, inscription, réinscription, emploi
   * du temps… — et nous depuis deux. C'est de là que venait « un parent ne voit
   * une remarque qu'à l'ouverture ». Chaque appelant passe la souche et les
   * paramètres que l'application attend (`notif_absence` + `{eleve, date}`).
   */
  async notifier(
    tx: Queryable,
    input: {
      guardianId: string;
      studentId: string | null;
      academicYearId: string | null;
      kind: string;
      souche: string;
      params: Record<string, unknown>;
      route?: string;
    },
  ): Promise<void> {
    const { schoolId } = currentTenant();
    await tx.query(
      `INSERT INTO notifications
         (school_id, guardian_id, student_id, academic_year_id, kind, i18n_key, i18n_params)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        schoolId,
        input.guardianId,
        input.studentId,
        input.academicYearId,
        input.kind,
        input.souche,
        JSON.stringify(input.params),
      ],
    );
    // ⚠ « QUAND LES EXAMENS SONT BLOQUÉS, AUCUNE NOTIFICATION DE NOTE NE PART »
    // (sa règle, citée en tête de ce fichier) : le fil la retenait, mais la
    // poussée partait quand même — la famille tapait dessus et tombait sur
    // un onglet retenu et une cloche vide. La ligne reste écrite : elle
    // paraîtra dans l'application dès que la situation est régularisée.
    if (
      input.kind === 'grade' &&
      input.academicYearId &&
      (await this.withheldKinds(input.guardianId, input.academicYearId)).includes('grade')
    ) {
      return;
    }
    await this.push.enqueue(input.guardianId, input.souche, input.params, input.route ?? null, tx);
  }

  /** Pousser pour des familles dont la notification est DÉJÀ écrite (les envois en masse). */
  async pousser(
    tx: Queryable,
    lignes: readonly { guardianId: string; params: Record<string, unknown> }[],
    souche: string,
    route?: string,
  ): Promise<void> {
    const vues = new Set<string>();
    for (const l of lignes) {
      // Une famille, une fois : deux enfants dans la même classe ne font pas
      // deux vibrations pour le même exercice.
      if (vues.has(l.guardianId)) continue;
      vues.add(l.guardianId);
      await this.push.enqueue(l.guardianId, souche, l.params, route ?? null, tx);
    }
  }

  /**
   * The badge alone, under the same filters as the list.
   *
   * ⚠ GARDÉ 60 SECONDES, COMME CHEZ LUI (`api/parent/notifications.php`,
   * `cache_remember($cle_nl, 60, …)`). L'application parent interroge ce
   * chiffre en boucle ; le recalculer à chaque fois, avec le filtre des genres
   * retenus qui lit la dette, c'est la requête la plus fréquente de toute
   * l'application pour un chiffre qui change trois fois par jour. Il est
   * OUBLIÉ dès qu'une notification est lue, et à chaque nouvelle notification.
   */
  async unreadCount(guardianId: string, academicYearId: string): Promise<number> {
    return this.cache.remember(`non-lus:${guardianId}:${academicYearId}`, 60, async () => {
      const withheld = await this.withheldKinds(guardianId, academicYearId);
      return this.db.query(async (tx) => {
        const { rows } = await tx.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM notifications
            WHERE guardian_id = $1 AND academic_year_id = $2
              AND read_at IS NULL AND NOT (kind = ANY($3::text[]))`,
          [guardianId, academicYearId, withheld],
        );
        return Number(rows[0]!.n);
      });
    });
  }

  /** Le nombre gardé ne vaut plus rien : une lecture vient d'avoir lieu. Comme chez lui,
   * un ENVOI n'invalide pas — le badge rattrape dans la minute. */
  private oublierNonLus(guardianId: string): void {
    this.cache.forgetPrefix(`non-lus:${guardianId}:`);
  }

  /**
   * Mark one read.
   *
   * ⚠ A FOREIGN ID IS REFUSED, NOT SILENTLY IGNORED. Scoping the UPDATE by
   * guardian and shrugging at "0 rows" would give the same answer for another
   * family's notification and for one already read — and those are different
   * facts. RLS keeps other schools out; this keeps other families out inside a
   * school.
   */
  /**
   * `false` : absente de CETTE école (une famille de deux écoles interroge
   * chacune ; l'identifiant n'appartient qu'à une) ; 403 seulement si elle
   * existe ici et appartient à une autre famille.
   */
  async markRead(id: string, guardianId: string): Promise<boolean> {
    const trouvee = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ guardian_id: string }>(
        'SELECT guardian_id FROM notifications WHERE id = $1',
        [id],
      );
      if (rows.length === 0) return false;
      if (rows[0]!.guardian_id !== guardianId) {
        throw new ForbiddenException('Cette notification ne vous appartient pas.');
      }
      await tx.query(
        'UPDATE notifications SET read_at = now() WHERE id = $1 AND read_at IS NULL',
        [id],
      );
      return true;
    });
    if (trouvee) this.oublierNonLus(guardianId);
    return trouvee;
  }

  /**
   * Mark the whole stream read.
   *
   * ⚠ UNDER THE SAME FILTERS. A withheld mark notification must NOT be marked
   * read: the family never saw it, and once read it would never resurface when
   * the debt is settled and the door opens.
   */
  async markAllRead(guardianId: string, academicYearId: string): Promise<{ marked: number }> {
    const withheld = await this.withheldKinds(guardianId, academicYearId);
    const marque = await this.db.query(async (tx) => {
      const { rowCount } = await tx.query(
        `UPDATE notifications SET read_at = now()
          WHERE guardian_id = $1 AND academic_year_id = $2
            AND read_at IS NULL AND NOT (kind = ANY($3::text[]))`,
        [guardianId, academicYearId, withheld],
      );
      // The tenant is read so a caller outside a tenant context fails here
      // rather than quietly updating nothing.
      currentTenant();
      return { marked: rowCount ?? 0 };
    });
    // APRÈS l'écriture : oublier avant laisserait une lecture concurrente
    // remettre l'ancien nombre en cache entre les deux.
    this.oublierNonLus(guardianId);
    return marque;
  }
}
