import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { libelleFraisPhotocopie, money } from '@elourwa/shared';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { BillingModelService } from './billing-model.service.js';

export type AnnualFeeKind = 'enrolment' | 'photocopy';

export interface FeeDue {
  kind: AnnualFeeKind;
  label: string;
  /** The configured amount for this year. */
  scale: Decimal;
  /** Already paid by this family, this year. */
  paid: Decimal;
  /** What is still owed. Zero when exempt. */
  remaining: Decimal;
  exempt: boolean;
}

// Le nom du frais « photocopie » est celui de l'école (FEE_PHOTOCOPY_LABEL —
// El Mourad : « Frais Graytna »), lu à l'affichage.
const label = (kind: AnnualFeeKind): string =>
  kind === 'enrolment' ? "Frais d'inscription" : libelleFraisPhotocopie();

@Injectable()
export class FeesService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(BillingModelService) private readonly billing: BillingModelService,
  ) {}

  /**
   * ⚠ FEES EXIST AT THREE LEVELS. All three must be modelled — collapsing them
   * removes a capability the school already uses: charging one student
   * differently from another.
   *
   *   1. per enrolment  — `enrollments.enrolment_fee` etc. **The real data.**
   *   2. per year       — `configuration` key `frais_inscription_<year>`
   *   3. global default — `configuration` key `frais_inscription`
   *   4. otherwise zero
   *
   * Mirrors El Ourwa's resolution order at `gestion_caisse.php:1065`.
   */
  async resolveScale(kind: AnnualFeeKind, startYear: number): Promise<Decimal> {
    // El Ourwa's key names are French and are kept, because the same
    // `configuration` rows would be read by an importer later.
    const base = kind === 'enrolment' ? 'frais_inscription' : 'frais_photocopie';

    const value = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ key: string; value: string }>(
        'SELECT key, value FROM configuration WHERE key = ANY($1::text[])',
        [[`${base}_${startYear}`, base]],
      );
      const byKey = new Map(rows.map((r) => [r.key, r.value]));
      return byKey.get(`${base}_${startYear}`) ?? byKey.get(base) ?? '0';
    });

    return money(value);
  }

  /**
   * What a family still owes in annual fees for a year.
   *
   * Due ONCE PER FAMILY, not per child. If an elder sibling has already paid,
   * the remainder is zero and the caller can say so instead of charging twice.
   */
  async annualFeesDue(guardianId: string, academicYearId: string, startYear: number): Promise<FeeDue[]> {
    /**
     * ⚠ UNE ÉCOLE « SERVICES » N'A PAS DE FRAIS ANNUELS PAR FAMILLE (ADR-0073,
     * spec §3). Ses frais d'inscription sont PAR ÉLÈVE (l'abonnement
     * `inscription`) et sa photocopie est un service optionnel : lire en plus
     * le barème par famille ferait payer deux fois. La dette, la fenêtre
     * d'encaissement et la fiche lisent toutes ici, et reçoivent donc « rien ».
     */
    if (await this.billing.isServices()) return [];
    const out: FeeDue[] = [];

    for (const kind of ['enrolment', 'photocopy'] as const) {
      const scale = await this.resolveScale(kind, startYear);

      const { paid, exempt } = await this.db.query(async (tx) => {
        const paidRows = await tx.query<{ total: string }>(
          `SELECT COALESCE(SUM(amount), 0)::text AS total
             FROM family_fee_payments
            WHERE guardian_id = $1 AND academic_year_id = $2 AND kind = $3`,
          [guardianId, academicYearId, kind],
        );
        const exemptRows = await tx.query(
          `SELECT 1 FROM family_fee_exemptions
            WHERE guardian_id = $1 AND kind = $2
              AND (academic_year_id IS NULL OR academic_year_id = $3)
            LIMIT 1`,
          [guardianId, kind, academicYearId],
        );
        return {
          paid: money(paidRows.rows[0]!.total),
          exempt: exemptRows.rows.length > 0,
        };
      });

      const remaining = exempt ? new Decimal(0) : Decimal.max(0, scale.minus(paid));
      out.push({ kind, label: label(kind), scale, paid, remaining, exempt });
    }

    return out;
  }

  /**
   * LES MÊMES FRAIS, POUR PLUSIEURS FAMILLES EN QUATRE REQUÊTES. Le barème
   * est lu une fois par sorte (il ne dépend pas de la famille), les paiements
   * et les exonérations une fois pour toutes les familles ; puis, famille par
   * famille, EXACTEMENT le calcul de `annualFeesDue()` — `exempt ? 0 :
   * max(0, barème − payé)`. Pour Impayés, qui appelait `annualFeesDue()`
   * 1 372 fois (six requêtes chacune).
   */
  async annualFeesDueFor(
    guardianIds: string[],
    academicYearId: string,
    startYear: number,
  ): Promise<Map<string, FeeDue[]>> {
    const out = new Map<string, FeeDue[]>(guardianIds.map((id) => [id, []]));
    if (guardianIds.length === 0) return out;
    // Voir `annualFeesDue` : une école « services » n'en a pas — chaque famille, [].
    if (await this.billing.isServices()) return out;
    for (const kind of ['enrolment', 'photocopy'] as const) {
      const scale = await this.resolveScale(kind, startYear);
      const { paye, exonere } = await this.db.query(async (tx) => {
        const { rows: paid } = await tx.query<{ guardian_id: string; total: string }>(
          `SELECT guardian_id, COALESCE(SUM(amount), 0)::text AS total
             FROM family_fee_payments
            WHERE guardian_id = ANY($1::uuid[]) AND academic_year_id = $2 AND kind = $3
            GROUP BY guardian_id`,
          [guardianIds, academicYearId, kind],
        );
        const { rows: ex } = await tx.query<{ guardian_id: string }>(
          `SELECT DISTINCT guardian_id FROM family_fee_exemptions
            WHERE guardian_id = ANY($1::uuid[]) AND kind = $2
              AND (academic_year_id IS NULL OR academic_year_id = $3)`,
          [guardianIds, kind, academicYearId],
        );
        return {
          paye: new Map(paid.map((r) => [r.guardian_id, money(r.total)])),
          exonere: new Set(ex.map((r) => r.guardian_id)),
        };
      });
      for (const id of guardianIds) {
        const paid = paye.get(id) ?? new Decimal(0);
        const exempt = exonere.has(id);
        const remaining = exempt ? new Decimal(0) : Decimal.max(0, scale.minus(paid));
        out.get(id)!.push({ kind, label: label(kind), scale, paid, remaining, exempt });
      }
    }
    return out;
  }

  /**
   * CONFIGURER LES MONTANTS — its `configurer_frais_annuels`, behind the
   * "Configurer les montants (admin)" fold.
   *
   * ⚠ THE SCALE IS PER YEAR AND THAT IS THE WHOLE POINT. Writing
   * `frais_photocopie_2026` leaves 2025 exactly as it was, so raising this
   * year's fee cannot rewrite what last year's families owed — and last year's
   * receipts keep matching last year's ledger.
   *
   * ⚠ AND IT IS A STRING ALL THE WAY DOWN. Never `Number(amount)`: 1500.50
   * through a JS number is a rounding error waiting for a reconciliation.
   */
  async setScale(
    kind: AnnualFeeKind,
    startYear: number,
    amount: string,
    actorId?: string,
  ): Promise<void> {
    const raw = amount.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      throw new BadRequestException('Le montant doit être positif.');
    }

    const base = kind === 'enrolment' ? 'frais_inscription' : 'frais_photocopie';
    const { schoolId } = currentTenant();
    await this.db.query(async (tx) => {
      await tx.query(
        `INSERT INTO configuration (school_id, key, value) VALUES ($1, $2, $3)
         ON CONFLICT (school_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [schoolId, `${base}_${startYear}`, raw],
      );
      if (actorId) {
        await this.audit.record(
          {
            actorId,
            schoolId,
            action: 'annual_fee_scale_set',
            entity: 'configuration',
            // The key goes in the payload, not in `entityId` — that column is a
            // uuid, and `frais_photocopie_2026` is not one.
            after: { key: `${base}_${startYear}`, value: raw },
          },
          tx,
        );
      }
    });
  }

  /**
   * EXEMPTER UN CORRESPONDANT D'UN FRAIS ANNUEL — its `exempter_frais_annuel`.
   *
   * ⚠ THIS COULD BE READ AND NEVER WRITTEN. `annualFeesDue` has consulted
   * `family_fee_exemptions` since the table existed, but nothing in the
   * application could put a row in it — so the office could see that a family
   * owed 5 000 MRU of enrolment fee and had no way to waive it.
   *
   * ⚠ EXEMPT MEANS NOTHING IS OWED, NOT THAT THE AMOUNT BECAME ZERO. The scale
   * stays visible beside the badge, because "Exempté" on a 5 000 MRU fee and
   * "Exempté" on a fee nobody ever set are different facts.
   *
   * One year at a time, as its screen offers: a waiver granted for hardship this
   * year is not a promise about the next.
   */
  async exempt(
    guardianId: string,
    kind: AnnualFeeKind,
    academicYearId: string,
    actorId: string,
  ): Promise<void> {
    const { schoolId } = currentTenant();
    await this.db.query(async (tx) => {
      // Idempotent: pressing Exempter twice is not an error, and must not
      // produce two rows that then have to be removed twice.
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO family_fee_exemptions
           (school_id, guardian_id, kind, academic_year_id, granted_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (school_id, guardian_id, kind, academic_year_id) DO NOTHING
         RETURNING id`,
        [schoolId, guardianId, kind, academicYearId, actorId],
      );
      if (rows.length === 0) return;

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'annual_fee_exempted',
          entity: 'guardian',
          entityId: guardianId,
          after: { kind, academic_year_id: academicYearId },
        },
        tx,
      );
    });
  }

  /** RETIRER L'EXEMPTION — its `retirer_exemption_frais_annuel`. */
  async removeExemption(
    guardianId: string,
    kind: AnnualFeeKind,
    academicYearId: string,
    actorId: string,
  ): Promise<void> {
    const { schoolId } = currentTenant();
    await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `DELETE FROM family_fee_exemptions
          WHERE guardian_id = $1 AND kind = $2
            AND (academic_year_id = $3 OR academic_year_id IS NULL)
          RETURNING id`,
        [guardianId, kind, academicYearId],
      );
      if (rows.length === 0) return;

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'annual_fee_exemption_removed',
          entity: 'guardian',
          entityId: guardianId,
          before: { kind, academic_year_id: academicYearId },
        },
        tx,
      );
    });
  }

  /**
   * LES VERSEMENTS DE FRAIS ANNUELS — its "Paiements des frais annuels" fold.
   *
   * Date, type, amount, receipt number, and a link to reprint it. A family that
   * has paid its enrolment fee is entitled to the paper, and the till is
   * entitled to see the number when the family arrives without it.
   */
  async paymentsFor(guardianId: string, academicYearId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        kind: AnnualFeeKind;
        label: string;
        amount: string;
        receipt_number: string | null;
        paid_at: Date;
      }>(
        `SELECT id, kind,
                CASE kind WHEN 'enrolment' THEN 'Frais d''inscription'
                          ELSE $3::text END AS label,
                amount::text, receipt_number, paid_at
           FROM family_fee_payments
          WHERE guardian_id = $1 AND academic_year_id = $2
          ORDER BY paid_at DESC`,
        [guardianId, academicYearId, libelleFraisPhotocopie()],
      );
      return rows;
    });
  }
}
