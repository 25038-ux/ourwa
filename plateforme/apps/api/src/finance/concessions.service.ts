import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { money, toStorage } from '@elourwa/shared';
import { DbService } from '../db/db.service.js';
import type { Queryable } from '@elourwa/db';
import { AuditService } from '../audit/audit.service.js';
import { currentTenant } from '../tenant/tenant.context.js';

/**
 * EXEMPTIONS AND RÉDUCTIONS — `gestion_caisse.php`.
 *
 * Three ways a school charges a family less, and they are NOT interchangeable:
 *
 *   exemption totale     — this child pays nothing, ever
 *   exemption mensuelle  — one named month is excused
 *   réduction            — one month costs less than the rate
 *
 * A fourth exists elsewhere and is different again: a REMISE forgives debt
 * already owed, while a discount lowers a price BEFORE it is owed. Collapsing
 * the two would make it impossible to answer "what did the school charge?"
 * separately from "what did the school let go?".
 *
 * ⚠ THE TABLES EXISTED AND THE DEBT QUERY READ THEM, AND NOTHING COULD CREATE
 * ONE. A school could not excuse a single month of a single child.
 *
 * ⚠ ALL OF THIS IS THE DIRECTION'S, NOT THE TILL'S. El Ourwa refuses the
 * accountant outright and tells them where to go instead: "Les réductions sont
 * réservées à l'administration. Soumettez une demande de réduction depuis
 * « Demandes »." The permission is enforced at the controller; the sentence is
 * kept there too.
 */
@Injectable()
export class ConcessionsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Exempt a child from tuition entirely. */
  async exemptStudent(
    studentId: string,
    reason: string | null,
    actorId: string,
  ): Promise<{ id: string }> {
    const { schoolId } = currentTenant();

    return this.db.query(async (tx) => {
      const { rows } = await tx
        .query<{ id: string }>(
          `INSERT INTO exemptions (school_id, student_id, kind, reason, granted_by)
           VALUES ($1, $2, 'full', $3, $4) RETURNING id`,
          [schoolId, studentId, reason, actorId],
        )
        .catch((error: { code?: string }) => {
          if (error.code === '23505') {
            throw new ConflictException('Cet étudiant a déjà une exemption totale.');
          }
          throw error;
        });

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'exemption_granted',
          entity: 'student',
          entityId: studentId,
          after: { kind: 'full', reason: reason ?? '' },
        },
        tx,
      );
      return { id: rows[0]!.id };
    });
  }

  /** Excuse one named month. */
  async exemptMonth(
    input: {
      studentId: string;
      calendarMonth: number;
      calendarYear: number;
      reason: string | null;
    },
    actorId: string,
  ): Promise<{ id: string }> {
    const { schoolId } = currentTenant();

    if (input.calendarMonth < 1 || input.calendarMonth > 12) {
      throw new BadRequestException('Mois invalide.');
    }

    return this.db.query(async (tx) => {
      const { rows } = await tx
        .query<{ id: string }>(
          `INSERT INTO exemptions
             (school_id, student_id, kind, calendar_month, calendar_year, reason, granted_by)
           VALUES ($1, $2, 'monthly', $3, $4, $5, $6) RETURNING id`,
          [
            schoolId, input.studentId, input.calendarMonth,
            input.calendarYear, input.reason, actorId,
          ],
        )
        .catch((error: { code?: string }) => {
          if (error.code === '23505') {
            throw new ConflictException('Ce mois est déjà exempté (ou déjà payé).');
          }
          throw error;
        });

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'exemption_granted',
          entity: 'student',
          entityId: input.studentId,
          after: {
            kind: 'monthly',
            month: `${input.calendarYear}-${input.calendarMonth}`,
            reason: input.reason ?? '',
          },
        },
        tx,
      );
      return { id: rows[0]!.id };
    });
  }

  /** Lift an exemption, of either kind. The debt comes back. */
  async liftExemption(exemptionId: string, actorId: string): Promise<void> {
    const { schoolId } = currentTenant();

    await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ student_id: string; kind: string }>(
        'DELETE FROM exemptions WHERE id = $1 RETURNING student_id, kind',
        [exemptionId],
      );
      if (rows.length === 0) throw new NotFoundException('Exemption introuvable.');

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'exemption_lifted',
          entity: 'student',
          entityId: rows[0]!.student_id,
          before: { kind: rows[0]!.kind },
        },
        tx,
      );
    });
  }

  /**
   * RÉDUCTION — lower what one month costs.
   *
   * ⚠ TWO GUARDS, BOTH EL OURWA'S, AND THE SECOND IS THE INTERESTING ONE.
   *
   * A discount may not exceed the month itself — obvious enough.
   *
   * It may also not take the month BELOW WHAT HAS ALREADY BEEN PAID. If a family
   * has handed over 8 000 and the month is then reduced to 5 000, the school
   * owes them 3 000 it never agreed to: a credit conjured out of a concession,
   * against a month that is now over-settled. Its own message names the figure
   * so the operator can see what they are colliding with.
   *
   * Replaces rather than stacks: one discount per child per month, or "the
   * discount" stops being a number anyone can state.
   */
  async applyDiscount(
    input: {
      studentId: string;
      calendarMonth: number;
      calendarYear: number;
      amount: string;
      reason: string | null;
    },
    actorId: string,
  ): Promise<void> {
    const { schoolId } = currentTenant();
    const amount = money(input.amount);

    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Le montant de la réduction doit être positif.');
    }
    if (input.calendarMonth < 1 || input.calendarMonth > 12) {
      throw new BadRequestException('Mois invalide.');
    }

    await this.db.query(async (tx) => {
      const { rows: months } = await tx.query<{ amount_due: string; paid: string }>(
        `SELECT m.amount_due::text,
                COALESCE(p.total, 0)::text AS paid
           FROM enrollment_months m
           JOIN enrollments e ON e.id = m.enrollment_id
           LEFT JOIN (
             SELECT student_id, calendar_month, calendar_year, SUM(amount) AS total
               FROM payments WHERE student_id = $1
              GROUP BY student_id, calendar_month, calendar_year
           ) p ON p.calendar_month = m.calendar_month AND p.calendar_year = m.calendar_year
          WHERE e.student_id = $1 AND e.status <> 'cancelled'
            AND m.calendar_month = $2 AND m.calendar_year = $3
          LIMIT 1`,
        [input.studentId, input.calendarMonth, input.calendarYear],
      );
      const row = months[0];
      if (!row) throw new NotFoundException("Ce mois n'est pas au programme de cet élève.");

      const due = money(row.amount_due);
      const paid = money(row.paid);

      if (amount.greaterThan(due.plus(0.01))) {
        throw new BadRequestException(
          `La réduction (${fr(amount)}) dépasse le frais mensuel (${fr(due)}).`,
        );
      }
      if (due.minus(amount).lessThan(paid.minus(0.01))) {
        throw new BadRequestException(
          `Impossible : ${fr(paid)} sont déjà payés pour ce mois ` +
            '(le dû après réduction serait inférieur).',
        );
      }

      await tx.query(
        `INSERT INTO discounts
           (school_id, student_id, calendar_month, calendar_year, amount, reason, granted_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (school_id, student_id, calendar_month, calendar_year)
         DO UPDATE SET amount = EXCLUDED.amount,
                       reason = EXCLUDED.reason,
                       granted_by = EXCLUDED.granted_by`,
        [
          schoolId, input.studentId, input.calendarMonth, input.calendarYear,
          toStorage(amount), input.reason, actorId,
        ],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'discount_applied',
          entity: 'student',
          entityId: input.studentId,
          after: {
            month: `${input.calendarYear}-${input.calendarMonth}`,
            amount: toStorage(amount),
            reason: input.reason ?? '',
          },
        },
        tx,
      );
    });
  }

  /** Withdraw a discount. The month costs its full rate again. */
  async removeDiscount(
    studentId: string,
    calendarMonth: number,
    calendarYear: number,
    actorId: string,
  ): Promise<void> {
    const { schoolId } = currentTenant();

    await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ amount: string }>(
        `DELETE FROM discounts
          WHERE student_id = $1 AND calendar_month = $2 AND calendar_year = $3
          RETURNING amount::text`,
        [studentId, calendarMonth, calendarYear],
      );
      if (rows.length === 0) throw new NotFoundException('Réduction introuvable.');

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'discount_removed',
          entity: 'student',
          entityId: studentId,
          before: {
            month: `${calendarYear}-${calendarMonth}`,
            amount: rows[0]!.amount,
          },
        },
        tx,
      );
    });
  }

  /**
   * MODIFIER LE FRAIS MENSUEL — `gestion_caisse.php`, `modifier_frais_admin`.
   *
   * ⚠ EL OURWA WRITES `etudiants.frais_mensuel`, THE CACHED COLUMN ITS OWN DEBT
   * QUERY BYPASSES. That query reads
   * `COALESCE(NULLIF(ei.frais_mensuel, 0), e.frais_mensuel)` — the ENROLMENT's
   * rate first. So for any enrolled student, which is everybody this screen is
   * about, writing the student row changes nothing that is owed. The button
   * appears to work and does not.
   *
   * The rate that counts is on the enrolment, so that is what changes here, and
   * the schedule moves with it.
   *
   * ⚠ ONLY THE MONTHS THAT ARE STILL OPEN. Re-pricing a month somebody has paid
   * creates a debt or a credit retroactively, against a receipt the family is
   * holding — and a part-paid month is just as dangerous: dropping its price
   * below what has been handed over turns the family into a creditor. A month
   * with any payment on it keeps the price it was paid at.
   *
   * Zero is allowed and is NOT an exemption: the rate is nothing, rather than
   * the child being excused, and the two read differently on every report that
   * counts rates.
   */
  async changeMonthlyFee(
    input: {
      studentId: string;
      academicYearId: string;
      amount: string;
      reason: string | null;
    },
    actorId: string,
  ): Promise<{ from: string; to: string; monthsRepriced: number }> {
    return this.db.query((tx) => this.changeMonthlyFeeWithin(tx, input, actorId));
  }

  /** Son `appliquer_tarif_mensuel()`, dans une transaction ouverte par l'appelant (« Demandes »). */
  async changeMonthlyFeeWithin(
    tx: Queryable,
    input: {
      studentId: string;
      academicYearId: string;
      amount: string;
      reason: string | null;
    },
    actorId: string,
  ): Promise<{ from: string; to: string; monthsRepriced: number }> {
    const { schoolId } = currentTenant();
    const amount = money(input.amount);

    if (amount.lessThan(0)) {
      throw new BadRequestException('Le frais mensuel ne peut pas être négatif.');
    }

    {
      const { rows: enrolments } = await tx.query<{ id: string; monthly_fee: string }>(
        `SELECT id, monthly_fee::text FROM enrollments
          WHERE student_id = $1 AND academic_year_id = $2 AND status <> 'cancelled'`,
        [input.studentId, input.academicYearId],
      );
      const enrolment = enrolments[0];
      if (!enrolment) {
        throw new NotFoundException("Cet élève n'est pas inscrit sur cette année.");
      }

      const previous = money(enrolment.monthly_fee);

      await tx.query('UPDATE enrollments SET monthly_fee = $1 WHERE id = $2', [
        toStorage(amount),
        enrolment.id,
      ]);

      /**
       * ⚠ LES MOIS NON RÉGLÉS SEULEMENT. UN MOIS PAYÉ GARDE SON PRIX.
       *
       * Une version antérieure repriçait TOUS les mois facturables, réglés
       * compris, pour coller à El Ourwa — dont la note dit « s'applique à tous
       * les mois ». Ce n'était pas un choix de sa part : il n'avait aucun prix
       * stocké par mois, `modifier_frais_admin` faisait un seul
       * `UPDATE etudiants SET frais_mensuel`, et chaque mois se recalculait
       * depuis cette colonne. Il ne POUVAIT pas épargner un mois réglé.
       *
       * Il le peut désormais : v20 lui donne la même règle, en lisant
       * `inscription_mois.montant_du` — un prix par mois qu'il enregistrait déjà
       * sans jamais le relire. Mesuré chez lui avant correction : 43 mois réglés
       * exposés, 18 familles, 113 500 MRU déjà encaissés, et une hausse de 500
       * MRU y créait 21 500 MRU de dette sur des mois payés.
       *
       * Le risque de réconciliation est levé par l'alignement, pas par la
       * reprise : les deux systèmes épargnent maintenant les mêmes mois.
       *
       * Réclamer un complément sur un mois pour lequel la famille détient un
       * reçu n'est défendable dans aucun des deux.
       *
       * ⚠ LE TROP-PERÇU NE DEVIENT PAS UNE DETTE NÉGATIVE. Un mois payé 10 000
       * qui n'en coûte plus que 4 000 est « payé » ; le reste dû d'un mois est
       * borné à zéro, et le surplus ne vient pas effacer la dette des autres.
       * C'est déjà ce que fait le calcul de dette, et un test le tient.
       */
      const { rows: repriced } = await tx.query<{ n: string }>(
        `WITH touched AS (
           UPDATE enrollment_months m
              SET amount_due = $1
            WHERE m.enrollment_id = $2
              AND m.status = 'billable'
              AND COALESCE((
                    SELECT sum(p.amount) FROM payments p
                     WHERE p.student_id     = $3
                       AND p.calendar_month = m.calendar_month
                       AND p.calendar_year  = m.calendar_year
                  ), 0) < m.amount_due
           RETURNING 1
         )
         SELECT count(*)::text AS n FROM touched`,
        [toStorage(amount), enrolment.id, input.studentId],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'monthly_fee_changed',
          entity: 'student',
          entityId: input.studentId,
          before: { monthlyFee: toStorage(previous) },
          after: {
            monthlyFee: toStorage(amount),
            monthsRepriced: repriced[0]!.n,
            reason: input.reason ?? '',
          },
        },
        tx,
      );

      return {
        from: toStorage(previous),
        to: toStorage(amount),
        monthsRepriced: Number(repriced[0]!.n),
      };
    }
  }

  /**
   * ANNULER L'EXEMPTION AUTOMATIQUE — make a pre-enrolment month billable.
   *
   * ⚠ THIS CREATES A DEBT THAT DID NOT EXIST. The months before a child's entry
   * are written free by the schedule builder because the child was not there;
   * El Ourwa lets the direction override that when a family actually did owe
   * the month — a mid-year transfer that was agreed verbally, most often.
   *
   * Its confirmation is explicit for that reason: "Ce mois deviendra dû et
   * comptera dans la dette."
   *
   * Priced from the enrolment's own rate, never the level's: the negotiated
   * rate is what this family owes.
   */
  async restoreMonth(
    input: {
      studentId: string;
      academicYearId: string;
      calendarMonth: number;
      calendarYear: number;
    },
    actorId: string,
  ): Promise<void> {
    const { schoolId } = currentTenant();

    await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string; monthly_fee: string }>(
        `SELECT m.id, e.monthly_fee::text
           FROM enrollment_months m
           JOIN enrollments e ON e.id = m.enrollment_id
          WHERE e.student_id = $1 AND e.academic_year_id = $2
            AND e.status <> 'cancelled'
            AND m.calendar_month = $3 AND m.calendar_year = $4`,
        [input.studentId, input.academicYearId, input.calendarMonth, input.calendarYear],
      );
      const row = rows[0];
      if (!row) throw new NotFoundException("Ce mois n'est pas au programme de cet élève.");

      await tx.query(
        `UPDATE enrollment_months SET status = 'billable', amount_due = $1 WHERE id = $2`,
        [row.monthly_fee, row.id],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'month_made_billable',
          entity: 'student',
          entityId: input.studentId,
          after: {
            month: `${input.calendarYear}-${input.calendarMonth}`,
            amountDue: row.monthly_fee,
          },
        },
        tx,
      );
    });
  }

  /**
   * RÉTABLIR L'EXEMPTION AUTOMATIQUE — its `retablir_exemption_auto`.
   *
   * ⚠ `restoreMonth` EXISTED AND THIS DID NOT. The direction could make a
   * pre-enrolment month billable and never take it back: a month made due by
   * mistake stayed due for ever, the family owed money they did not owe, and the
   * only remedy was editing the database. El Ourwa carries both, side by side
   * on the same month card.
   *
   * ⚠ REFUSED ONCE THE MONTH HAS BEEN PAID, which El Ourwa does not check. Its
   * version deletes a row and stops; ours would have to set `amount_due` to
   * zero, which leaves a payment against a month that costs nothing — money in
   * the ledger belonging to no charge. Saying so is better than producing it.
   */
  async reExemptMonth(
    input: {
      studentId: string;
      academicYearId: string;
      calendarMonth: number;
      calendarYear: number;
    },
    actorId: string,
  ): Promise<void> {
    const { schoolId } = currentTenant();

    await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string; amount_due: string }>(
        `SELECT m.id, m.amount_due::text
           FROM enrollment_months m
           JOIN enrollments e ON e.id = m.enrollment_id
          WHERE e.student_id = $1 AND e.academic_year_id = $2
            AND e.status <> 'cancelled'
            AND m.calendar_month = $3 AND m.calendar_year = $4`,
        [input.studentId, input.academicYearId, input.calendarMonth, input.calendarYear],
      );
      const row = rows[0];
      if (!row) throw new NotFoundException("Ce mois n'est pas au programme de cet élève.");

      const { rows: paid } = await tx.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total
           FROM payments
          WHERE student_id = $1 AND calendar_month = $2 AND calendar_year = $3`,
        [input.studentId, input.calendarMonth, input.calendarYear],
      );
      if (money(paid[0]!.total).greaterThan('0.005')) {
        throw new BadRequestException(
          'Ce mois a déjà été réglé : le rendre gratuit laisserait un paiement ' +
            'sans rien à payer. Annulez le paiement d’abord.',
        );
      }

      await tx.query(
        `UPDATE enrollment_months SET status = 'free', amount_due = 0 WHERE id = $1`,
        [row.id],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'month_made_free',
          entity: 'student',
          entityId: input.studentId,
          before: { amountDue: row.amount_due },
          after: { month: `${input.calendarYear}-${input.calendarMonth}` },
        },
        tx,
      );
    });
  }

  /** Every concession on one child, for the profile screen. */
  async forStudent(studentId: string) {
    return this.db.query(async (tx) => {
      const { rows: exemptions } = await tx.query(
        `SELECT id, kind, calendar_month, calendar_year, reason, created_at
           FROM exemptions WHERE student_id = $1
          ORDER BY calendar_year NULLS FIRST, calendar_month NULLS FIRST`,
        [studentId],
      );
      const { rows: discounts } = await tx.query(
        `SELECT calendar_month, calendar_year, amount::text, reason
           FROM discounts WHERE student_id = $1
          ORDER BY calendar_year, calendar_month`,
        [studentId],
      );
      return { exemptions, discounts };
    });
  }
}

/** El Ourwa's `number_format($x, 0, ',', ' ') . ' MRU'`. */
function fr(value: Decimal): string {
  return `${value.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} MRU`;
}
