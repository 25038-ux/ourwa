import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ExpensesService } from '../finance/expenses.service.js';
import { ConcessionsService } from '../finance/concessions.service.js';
import { DebtService } from '../finance/debt.service.js';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { MailService } from '../mail/mail.service.js';
import { NotificationsService } from '../parent/notifications.service.js';

/** Messaging to families, and the accountant → direction approval workflow. */
@Injectable()
export class CommsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(forwardRef(() => ExpensesService)) private readonly expenses: ExpensesService,
    @Inject(forwardRef(() => ConcessionsService)) private readonly concessions: ConcessionsService,
    @Inject(forwardRef(() => DebtService)) private readonly debts: DebtService,
  ) {}

  /**
   * Send a message to one family, or to every family with a child enrolled.
   *
   * The bulk case writes one row per guardian rather than one shared row: a
   * message is read, or not, by each family independently, and a shared row
   * could not record that.
   *
   * At one school's size this is fine inline. A whole-platform announcement
   * would belong on a queue (standing rule 16).
   */
  /**
   * ⚠ ONE FAMILY, OR A LEVEL, OR A CLASS — NEVER A MIXTURE. El Ourwa's own
   * subtitle is the specification: "Cibler un parent par recherche OU diffuser
   * par niveau/groupe", and it refuses the combination in as many words rather
   * than silently preferring one. Preferring either would be wrong in a way
   * nobody could see: a class message delivered to one family, or a private one
   * delivered to a class.
   */
  async send(
    input: {
      subject: string;
      body: string;
      /** Target one family … */
      guardianId?: string;
      /** … or broadcast to a level, optionally narrowed to one of its groups. */
      levelId?: string;
      groupId?: string;
      /** The year whose enrolments define the audience. */
      academicYearId?: string;
    },
    actorId: string,
  ): Promise<{ sent: number; queuedForEmail: number }> {
    const { schoolId } = currentTenant();
    const senderName = await this.nameOf(actorId);

    const broadcast = Boolean(input.levelId || input.groupId);
    if (input.guardianId && broadcast) {
      throw new BadRequestException(
        'Vous ne pouvez pas combiner « parent ciblé » et « diffusion par niveau ». ' +
          'Choisissez UNE des deux options.',
      );
    }

    return this.db.query(async (tx) => {
      if (input.levelId && input.groupId) {
        const { rows } = await tx.query(
          'SELECT 1 FROM groups WHERE id = $1 AND level_id = $2',
          [input.groupId, input.levelId],
        );
        if (rows.length === 0) {
          throw new BadRequestException("Ce groupe n'appartient pas au niveau choisi.");
        }
      }

      if (input.guardianId) {
        // Sous le locataire, RLS rend invisible le correspondant d'une autre école :
        // « aucun élève » vaut « parent introuvable ici ».
        // D'ici : un élève à lui sous ce locataire (RLS cache les autres écoles),
        // ou le rôle « parent » dans cette école.
        const { rows: ici } = await tx.query(
          `SELECT 1 FROM students WHERE guardian_id = $1
           UNION ALL
           SELECT 1 FROM user_school_roles usr JOIN roles r ON r.id = usr.role_id
            WHERE usr.user_id = $1 AND usr.school_id = $2 AND r.code = 'parent'
           LIMIT 1`,
          [input.guardianId, schoolId],
        );
        if (ici.length === 0) throw new BadRequestException('Parent introuvable dans cette école.');
      }
      // L'année de la notification : celle demandée, sinon l'année active — une
      // notification sans année n'apparaît dans aucun fil (filtré sur l'année).
      const { rows: anneeActive } = await tx.query<{ id: string }>(
        "SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_year DESC LIMIT 1",
      );
      const anneeNotification = input.academicYearId ?? anneeActive[0]?.id ?? null;

      const result = input.guardianId
        ? await tx.query<{ guardian_id: string }>(
            `INSERT INTO messages (school_id, guardian_id, sender_name, subject, body, sent_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING guardian_id`,
            [schoolId, input.guardianId, senderName, input.subject, input.body, actorId],
          )
        : await tx.query<{ guardian_id: string }>(
            /**
             * Every placeholder is cast: in a SELECT list Postgres has no column
             * to infer a parameter's type from and settles on text, which then
             * will not go into a uuid column.
             *
             * ⚠ THE AUDIENCE IS THIS YEAR'S ENROLMENTS. El Ourwa records the
             * bug: "sans filtre, un message adresse a une classe partait aussi
             * aux familles des eleves qui l'ont quittee l'annee precedente."
             *
             * ⚠ AND THE SAME FILTER IS APPLIED TO A LEVEL. El Ourwa filters the
             * group query by year and the level query not at all — it reads the
             * cached `etudiants.groupe_id` instead — which is the same defect it
             * had already diagnosed one branch above. Fixing it is a deliberate
             * departure, recorded in docs/DECISIONS.md, because replicating it
             * would mail families whose children left.
             */
            `INSERT INTO messages (school_id, guardian_id, sender_name, subject, body, sent_by)
             SELECT DISTINCT $1::uuid, s.guardian_id, $2::text, $3::text, $4::text, $5::uuid
               FROM students s
               JOIN enrollments e ON e.student_id = s.id AND e.status <> 'cancelled'
               LEFT JOIN groups g ON g.id = e.group_id
              WHERE s.guardian_id IS NOT NULL
                AND ($6::uuid IS NULL OR e.academic_year_id = $6::uuid)
                AND ($7::uuid IS NULL OR g.level_id        = $7::uuid)
                AND ($8::uuid IS NULL OR e.group_id        = $8::uuid)
             RETURNING guardian_id`,
            [
              schoolId, senderName, input.subject, input.body, actorId,
              input.academicYearId ?? null,
              input.levelId ?? null,
              input.groupId ?? null,
            ],
          );

      // `messagerie.php` : `notifier_parent($pid, 'message', 'Nouveau message : '
      // . $sujet, $contenu, null, 'message', ['sujet', 'contenu'])` — une
      // notification ET un message, pour chaque famille écrite.
      for (const r of result.rows) {
        await this.notifications.notifier(tx, {
          guardianId: r.guardian_id,
          studentId: null,
          academicYearId: anneeNotification,
          kind: 'message',
          souche: 'notif_message',
          params: { sujet: input.subject, contenu: input.body },
          route: 'messages',
        });
      }

      const sent = result.rowCount ?? 0;
      if (sent === 0) {
        throw new BadRequestException('Aucun destinataire trouvé pour ces critères.');
      }

      // ⚠ DELIVERY IS QUEUED, NOT FANNED OUT HERE (standing rule 18).
      //
      // One set-based INSERT, not a loop over several hundred families: the
      // request does two statements whatever the size of the school, and the
      // worker does the talking to the mail host. A loop here would hold the
      // request open for as long as the slowest recipient.
      //
      // Only families with an address are queued. The message itself is already
      // written above and is readable in the parent app regardless — email is a
      // notification that one arrived, not the delivery mechanism.
      // The exact recipients, from what was just written — not a time window,
      // which would double-queue two sends of the same subject in one minute and
      // miss rows whenever the transaction ran long.
      const queued = await tx.query(
        `INSERT INTO outbound_mail (school_id, kind, recipient, subject, body)
         SELECT DISTINCT $1::uuid, 'family_message', u.email, $2::text, $3::text
           FROM users u
          WHERE u.id = ANY($4::uuid[])
            AND u.email IS NOT NULL
            AND u.active`,
        [schoolId, input.subject, input.body, result.rows.map((r) => r.guardian_id)],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'message_sent',
          entity: 'message',
          after: {
            subject: input.subject,
            recipients: sent,
            queuedForEmail: queued.rowCount ?? 0,
          },
        },
        tx,
      );
      return { sent, queuedForEmail: queued.rowCount ?? 0 };
    });
  }

  /**
   * The sender's name, copied onto the row rather than joined at read time.
   *
   * A message a family received last year should still say who sent it after
   * that colleague's account has been deleted.
   *
   * `users` is a platform table, outside the tenant policy, so this is read
   * without a school filter on purpose.
   */
  private async nameOf(userId: string): Promise<string> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ full_name: string }>(
        'SELECT full_name FROM users WHERE id = $1',
        [userId],
      );
      return rows[0]?.full_name ?? 'Direction';
    });
  }

  /**
   * HOW MANY FAMILIES EACH LEVEL AND EACH GROUP REACHES, for one year.
   *
   * ⚠ SO THE BUTTON CAN SAY THE NUMBER BEFORE IT IS PRESSED. "Envoyer à 214
   * familles" is a different decision from "Envoyer", and a message cannot be
   * recalled. Counting after the fact is not the same service.
   *
   * Keyed by BOTH level id and group id in one map, because the form asks the
   * same question of whichever the operator last touched.
   *
   * One query. Asking per level as the operator scrolls the dropdown would be a
   * round trip per keystroke on a control that exists to be browsed.
   */
  async audienceCounts(academicYearId: string): Promise<Record<string, number>> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ key: string; n: string }>(
        `SELECT g.level_id::text AS key, count(DISTINCT s.guardian_id)::text AS n
           FROM enrollments e
           JOIN students s ON s.id = e.student_id
           JOIN groups g ON g.id = e.group_id
          WHERE e.academic_year_id = $1 AND e.status <> 'cancelled'
            AND s.guardian_id IS NOT NULL
          GROUP BY g.level_id
         UNION ALL
         SELECT e.group_id::text AS key, count(DISTINCT s.guardian_id)::text AS n
           FROM enrollments e
           JOIN students s ON s.id = e.student_id
          WHERE e.academic_year_id = $1 AND e.status <> 'cancelled'
            AND s.guardian_id IS NOT NULL AND e.group_id IS NOT NULL
          GROUP BY e.group_id`,
        [academicYearId],
      );

      const out: Record<string, number> = {};
      for (const r of rows) if (r.key) out[r.key] = Number(r.n);
      return out;
    });
  }

  /**
   * Families who can be written to: a guardian with at least one child still
   * enrolled.
   *
   * Deliberately its own read rather than a reuse of the debt list, which is
   * behind the finance permissions. Someone who may send a message must not
   * need the right to see what families owe in order to pick one.
   */
  async families() {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string; full_name: string; children: number }>(
        `SELECT u.id, u.full_name, count(DISTINCT s.id)::int AS children
           FROM users u
           JOIN students s ON s.guardian_id = u.id
           JOIN enrollments e ON e.student_id = s.id AND e.status <> 'cancelled'
          GROUP BY u.id, u.full_name
          ORDER BY u.full_name
          LIMIT 500`,
      );
      return rows;
    });
  }

  async sentMessages(limit = 50) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT m.subject, m.sender_name, m.sent_at,
                count(*)::int AS recipients,
                count(*) FILTER (WHERE m.read_at IS NOT NULL)::int AS read_count
           FROM messages m
          GROUP BY m.subject, m.sender_name, m.sent_at
          ORDER BY m.sent_at DESC
          LIMIT $1`,
        [limit],
      );
      return rows;
    });
  }

  async messagesFor(guardianId: string, limit = 50) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, sender_name, subject, body, read_at, sent_at
           FROM messages WHERE guardian_id = $1
          ORDER BY sent_at DESC LIMIT $2`,
        [guardianId, limit],
      );
      return rows;
    });
  }

  /**
   * Mark a message read.
   *
   * The read stamp is set ONCE and never moved. "First opened at" is a fact
   * about the family; overwriting it on every re-read would turn it into "last
   * opened at", which is a different fact and not the one the office asked for.
   *
   * Scoped to the guardian in the WHERE clause, not checked beforehand: a
   * missing row and someone else's row must be indistinguishable from here.
   */
  async markRead(messageId: string, guardianId: string): Promise<{ read: boolean }> {
    return this.db.query(async (tx) => {
      const result = await tx.query(
        `UPDATE messages SET read_at = now()
          WHERE id = $1 AND guardian_id = $2 AND read_at IS NULL`,
        [messageId, guardianId],
      );
      return { read: (result.rowCount ?? 0) > 0 };
    });
  }

  /** How many of a family's messages are still unopened. */
  /**
   * Mark every message read — what opening the list does.
   *
   * ⚠ One statement, all of them. Its own: `UPDATE messages SET lu = 1 WHERE
   * parent_id = :p`. Scoped to the guardian, so a family can only ever clear
   * their own.
   */
  async markAllRead(guardianId: string): Promise<void> {
    await this.db.query((tx) =>
      tx.query(
        'UPDATE messages SET read_at = now() WHERE guardian_id = $1 AND read_at IS NULL',
        [guardianId],
      ),
    );
  }

  async unreadCount(guardianId: string): Promise<number> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM messages WHERE guardian_id = $1 AND read_at IS NULL',
        [guardianId],
      );
      return Number(rows[0]!.n);
    });
  }

  // ── Approval requests ─────────────────────────────────────────────────────

  async raise(
    input: { kind: string; description: string; amount?: string; metadata?: Record<string, unknown> },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    const raiserName = await this.nameOf(actorId);
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO approval_requests
           (school_id, raised_by, raiser_name, kind, description, amount, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          schoolId, actorId, raiserName, input.kind, input.description, input.amount ?? null,
          input.metadata ? JSON.stringify(input.metadata) : null,
        ],
      );
      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'request_raised',
          entity: 'approval_request',
          entityId: rows[0]!.id,
          after: { kind: input.kind, amount: input.amount ?? null },
        },
        tx,
      );
      return { id: rows[0]!.id };
    });
  }

  /**
   * Decide a request.
   *
   * A decision is final: re-deciding would erase who decided what and when,
   * which is the only reason this workflow exists rather than a conversation.
   */
  async decide(
    requestId: string,
    decision: 'approved' | 'refused',
    comment: string | undefined,
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows: existing } = await tx.query<{
        status: string;
        kind: string;
        raised_by: string | null;
        metadata: Record<string, unknown> | null;
      }>(
        // FOR UPDATE : deux clics simultanés exécutaient deux fois la dépense.
        'SELECT status, kind, raised_by, metadata FROM approval_requests WHERE id = $1 FOR UPDATE',
        [requestId],
      );
      const req = existing[0];
      // Son refus : « Demande introuvable ou déjà traitée. »
      if (!req || req.status !== 'pending') throw new NotFoundException('Demande introuvable ou déjà traitée.');

      /**
       * SON « If approving, auto-execute the transaction » : approuver EXÉCUTE
       * la demande, dans la même transaction que la décision.
       *   - `depense` : la dépense et ses lignes, créées au nom du demandeur ;
       *   - `frais_mensuel` : son `appliquer_tarif_mensuel()` — le tarif de
       *     l'inscription et des mois non réglés, les mois payés épargnés ;
       *   - `dette` : la créance (`dettes`).
       */
      if (decision === 'approved') {
        const meta = req.metadata ?? {};
        const acteur = req.raised_by ?? actorId;
        if (req.kind === 'depense' && Object.keys(meta).length > 0) {
          await this.expenses.recordWithin(
            tx,
            {
              amount: String(meta.montant ?? ''),
              description: String(meta.description ?? ''),
              tender: Array.isArray(meta.lignes)
                ? (meta.lignes as { paymentMethodId: string; amount: string }[])
                : [],
            },
            acteur,
          );
        } else if (req.kind === 'frais_mensuel' && meta.etudiant_id) {
          const nouveau = String(meta.frais_demande ?? '');
          if (!/^\d+(\.\d{1,2})?$/.test(nouveau)) throw new BadRequestException('Frais demandé invalide.');
          // Son `annee_facturee()` pour cet élève : sa dernière inscription non annulée.
          const { rows: insc } = await tx.query<{ academic_year_id: string }>(
            `SELECT e.academic_year_id FROM enrollments e
               JOIN academic_years y ON y.id = e.academic_year_id
              WHERE e.student_id = $1 AND e.status <> 'cancelled'
              ORDER BY y.start_year DESC LIMIT 1`,
            [String(meta.etudiant_id)],
          );
          if (!insc[0]) throw new BadRequestException('Étudiant introuvable (peut-être supprimé).');
          await this.concessions.changeMonthlyFeeWithin(
            tx,
            { studentId: String(meta.etudiant_id), academicYearId: insc[0].academic_year_id, amount: nouveau, reason: comment ?? null },
            actorId,
          );
        } else if (req.kind === 'dette' && Object.keys(meta).length > 0) {
          await this.debts.createMiscDebtWithin(
            tx,
            {
              debtorName: String(meta.debiteur_nom ?? ''),
              studentId: meta.etudiant_id ? String(meta.etudiant_id) : undefined,
              phone: meta.telephone ? String(meta.telephone) : undefined,
              months: 1,
              total: String(meta.montant_total ?? ''),
              reason: meta.motif ? String(meta.motif) : undefined,
            },
            acteur,
          );
        }
      }

      const decidee = await tx.query(
        `UPDATE approval_requests
            SET status = $2, decided_by = $3, decided_at = now(), comment = $4
          WHERE id = $1 AND status = 'pending'`,
        [requestId, decision, actorId, comment ?? null],
      );
      if (decidee.rowCount === 0) throw new NotFoundException('Demande introuvable ou déjà traitée.');

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'request_decided',
          entity: 'approval_request',
          entityId: requestId,
          after: { decision, comment: comment ?? null },
        },
        tx,
      );
      return {
        id: requestId,
        status: decision,
        // Son message : « Demande approuvée et exécutée. » / « Demande rejetée. »
        message: decision === 'approved' ? 'Demande approuvée et exécutée.' : 'Demande rejetée.',
      };
    });
  }

  /**
   * LES DEMANDES — `demandes.php` : l'administrateur voit tout (avec
   * l'identifiant du demandeur), le comptable ou le secrétaire ne voit que les
   * siennes ; par date de création décroissante ; les compteurs par statut
   * portent sur l'ensemble, pas sur le filtre.
   */
  async requests(status?: 'pending' | 'approved' | 'refused', seulement?: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT r.id, r.kind, r.description, r.amount, r.status, r.comment,
                r.raiser_name, r.created_at, r.decided_at, r.raised_by,
                COALESCE(d.username, d.email, d.phone, r.raiser_name) AS demandeur,
                u.full_name AS decided_by_name
           FROM approval_requests r
           LEFT JOIN users u ON u.id = r.decided_by
           LEFT JOIN users d ON d.id = r.raised_by
          WHERE ($1::text IS NULL OR r.status::text = $1)
            AND ($2::uuid IS NULL OR r.raised_by = $2::uuid)
          ORDER BY r.created_at DESC`,
        [status ?? null, seulement ?? null],
      );
      const { rows: comptes } = await tx.query<{ status: string; n: string }>(
        `SELECT status::text, count(*)::text AS n FROM approval_requests
          WHERE ($1::uuid IS NULL OR raised_by = $1::uuid)
          GROUP BY status`,
        [seulement ?? null],
      );
      const counts = { pending: 0, approved: 0, refused: 0 } as Record<string, number>;
      for (const c of comptes) counts[c.status] = Number(c.n);
      return { demandes: rows, counts };
    });
  }
}
