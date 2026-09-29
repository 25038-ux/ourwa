import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { money, toStorage, type SourceService } from '@elourwa/shared';
import type { Queryable } from '@elourwa/db';
import { DbService } from '../db/db.service.js';
import { currentTenant } from '../tenant/tenant.context.js';

/**
 * El Ourwa's `source_type` values, verbatim — plus, for a « services » school
 * only (ADR-0073), one per service family: `service_cantine`, `service_piscine`,
 * `service_docteur`, `service_photocopie`, `service_inscription`
 * (`SOURCES_SERVICES` in @elourwa/shared). The column is free text (0014).
 */
export type TenderSource =
  | 'paiement'
  | 'frais_annuel'
  | 'cours_soir'
  | 'cours_soir_prof'
  | 'depense'
  | 'salaire'
  | 'salaire_prof'
  | 'salaire_staff'
  | 'pret_personnel'
  | 'pret_remb'
  | 'dette'
  | 'dette_creation'
  | 'admin_retrait'
  | SourceService;

export interface TenderLine {
  paymentMethodId: string;
  amount: string;
  /** Le numéro de reçu de l'application de paiement (Bankily, Masrvi…), facultatif — 0038. */
  reference?: string | null;
}

/**
 * How money moved — the one ledger, both directions.
 *
 * Every movement in El Ourwa posts here: a receipt, a salary, an expense, a
 * withdrawal, a loan handed over, a loan coming back. That is what lets its
 * Rapport Financier say 40 000 left in cash and 120 000 arrived by Bankily.
 *
 * ⚠ THE LINES MUST SUM TO THE MOVEMENT. A receipt for 5 000 settled as 3 000
 * cash and 1 500 Bankily is not a receipt for 5 000 — it is a till that will not
 * balance at closing, and the person who finds out is the one counting the
 * drawer at seven in the evening.
 */
@Injectable()
export class TenderService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /**
   * Post the lines for one movement, inside its transaction.
   *
   * `tx` is required rather than optional: a tender line written outside the
   * movement's transaction can survive a rollback, leaving the ledger claiming
   * money moved for a receipt that was never issued.
   */
  async post(
    tx: Queryable,
    input: {
      sourceType: TenderSource;
      sourceId: string;
      direction: 'in' | 'out';
      total: string;
      lines: TenderLine[];
      /** The movement's own date, so the ledger is not stamped with now(). */
      at?: string | Date;
    },
  ): Promise<void> {
    if (input.lines.length === 0) return;

    const { schoolId } = currentTenant();

    const sum = input.lines.reduce((acc, l) => acc.plus(money(l.amount)), new Decimal(0));
    if (!sum.equals(money(input.total))) {
      throw new BadRequestException(
        `Les moyens de paiement totalisent ${toStorage(sum)} pour un montant de ` +
          `${toStorage(money(input.total))}. Ils doivent correspondre exactement.`,
      );
    }

    for (const line of input.lines) {
      if (money(line.amount).lessThanOrEqualTo(0)) {
        throw new BadRequestException('Chaque ligne doit porter un montant positif.');
      }
      const reference = (line.reference ?? '').trim().slice(0, 60) || null;
      await tx.query(
        `INSERT INTO tender_lines
           (school_id, source_type, source_id, payment_method_id, amount, direction, created_at, reference)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8)`,
        [
          schoolId,
          input.sourceType,
          input.sourceId,
          line.paymentMethodId,
          toStorage(money(line.amount)),
          input.direction,
          input.at ?? null,
          reference,
        ],
      );
    }
  }

  /**
   * The synthesis Rapport Financier prints: per method, in and out.
   *
   * ⚠ MOVEMENTS WITH NO LINES ARE REPORTED, NOT DROPPED. Anything recorded
   * before this ledger existed — or entered without a means of payment — appears
   * as "Non ventilé". A report that silently omitted them would not add up to
   * the month's own totals, and the reader would be left to wonder which figure
   * to believe.
   */
  async byMethod(calendarMonth: number, calendarYear: number) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        name: string;
        entrant: string;
        sortant: string;
      }>(
        `SELECT m.name,
                COALESCE(SUM(t.amount) FILTER (WHERE t.direction = 'in'), 0)
                  ::numeric(14,2)::text AS entrant,
                COALESCE(SUM(t.amount) FILTER (WHERE t.direction = 'out'), 0)
                  ::numeric(14,2)::text AS sortant
           FROM payment_methods m
           JOIN tender_lines t ON t.payment_method_id = m.id
          WHERE EXTRACT(MONTH FROM t.created_at) = $1
            AND EXTRACT(YEAR  FROM t.created_at) = $2
          GROUP BY m.name
         HAVING SUM(t.amount) <> 0
          ORDER BY 2 DESC`,
        [calendarMonth, calendarYear],
      );
      return rows;
    });
  }

  /** What a single movement was settled with — for a receipt. */
  async forSource(sourceType: TenderSource, sourceId: string) {
    return this.db.query((tx) => this.linesFor(tx, sourceType, sourceId));
  }

  /** `lignes_paiement_de()` — the same, inside a caller's transaction. */
  async linesFor(tx: Queryable, sourceType: TenderSource, sourceId: string) {
    const { rows } = await tx.query<{ moyen: string; montant: string; reference: string | null }>(
      `SELECT m.name AS moyen, t.amount::text AS montant, t.reference
         FROM tender_lines t
         JOIN payment_methods m ON m.id = t.payment_method_id
        WHERE t.source_type = $1 AND t.source_id = $2
        ORDER BY t.created_at`,
      [sourceType, sourceId],
    );
    return rows;
  }

  /** The school's default means, for a form that needs one pre-selected. */
  async defaultMethod(): Promise<{ id: string; name: string } | null> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string; name: string }>(
        `SELECT id, name FROM payment_methods
          WHERE is_active
          ORDER BY (name ILIKE 'esp%') DESC, name
          LIMIT 1`,
      );
      return rows[0] ?? null;
    });
  }
}
