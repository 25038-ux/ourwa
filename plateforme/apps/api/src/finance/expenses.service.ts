import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { money, toStorage } from '@elourwa/shared';
import { DbService } from '../db/db.service.js';
import type { Queryable } from '@elourwa/db';
import { AuditService } from '../audit/audit.service.js';
import { TenderService, type TenderLine } from './tender.service.js';
import { nextDocumentNumber, numeroDocument } from './sequences.js';
import { currentTenant } from '../tenant/tenant.context.js';

/** Son `number_format($x, 0, ',', ' ')`, pour ses messages. */
function fr(x: Decimal): string {
  return x
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * DÉPENSES SUPPLÉMENTAIRES — `pages/super_admin/depenses.php`.
 *
 * Une sortie d'argent qui n'est ni un salaire ni un retrait. Chez lui la liste
 * est TOUTE la table (`ORDER BY date_depense DESC`), le total est SUM(montant),
 * et la ventilation par moyen de paiement est obligatoire et doit égaler le
 * montant (`lire_lignes_paiement(true, $montant)`).
 */
@Injectable()
export class ExpensesService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TenderService) private readonly tender: TenderService,
  ) {}

  /**
   * `lire_lignes_paiement(true, $montant)` — au moins une ligne, et la somme
   * égale au montant à un centime près, avec ses deux messages.
   */
  static lireLignes(montant: Decimal, tender: TenderLine[]): TenderLine[] {
    const lignes = tender.filter((l) => money(l.amount).greaterThan(0));
    if (lignes.length === 0) {
      throw new BadRequestException(
        'Veuillez indiquer au moins un moyen de paiement avec un montant.',
      );
    }
    const total = lignes.reduce((a, l) => a.plus(money(l.amount)), new Decimal(0));
    if (total.minus(montant).abs().greaterThan('0.01')) {
      throw new BadRequestException(
        `La somme des moyens de paiement (${fr(total)} MRU) doit égaler le montant dû ` +
          `(${fr(montant)} MRU).`,
      );
    }
    return lignes;
  }

  /** Son action `ajouter` (administration) — la dépense et ses lignes, ensemble. */
  async record(
    input: { amount: string; description: string; tender: TenderLine[] },
    actorId: string,
  ) {
    return this.db.query((tx) => this.recordWithin(tx, input, actorId));
  }

  /**
   * La même écriture, dans une transaction ouverte par l'appelant — c'est ce
   * que « Demandes » fait à l'approbation d'une dépense (son `decider`), pour
   * que la dépense et la décision tiennent ou tombent ensemble.
   */
  async recordWithin(
    tx: Queryable,
    input: { amount: string; description: string; tender: TenderLine[] },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    const amount = money(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Le montant doit être supérieur à 0.');
    }
    if (!input.description.trim()) {
      throw new BadRequestException('La description est obligatoire.');
    }
    const lignes = ExpensesService.lireLignes(amount, input.tender);

    {
      const receiptNo = await nextDocumentNumber(tx, schoolId, 'depense');
      const { rows } = await tx.query<{ id: string; spent_at: Date }>(
        `INSERT INTO expenses (school_id, amount, description, created_by, receipt_no)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, spent_at`,
        [schoolId, toStorage(amount), input.description.trim(), actorId, receiptNo],
      );

      // `enregistrer_lignes_paiement('depense', $did, $lignes, 'sortant')`.
      await this.tender.post(tx, {
        sourceType: 'depense',
        sourceId: rows[0]!.id,
        direction: 'out',
        total: toStorage(amount),
        lines: lignes,
        at: rows[0]!.spent_at,
      });

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'expense_recorded',
          entity: 'expense',
          entityId: rows[0]!.id,
          after: { amount: toStorage(amount), description: input.description },
        },
        tx,
      );

      return {
        id: rows[0]!.id,
        receiptNumber: numeroDocument('DEP', receiptNo),
        amount: toStorage(amount),
        spentAt: rows[0]!.spent_at,
      };
    }
  }

  /**
   * L'historique — TOUTES les dépenses, les plus récentes d'abord — et le total.
   *
   * Une dépense « supprimée » (chez lui : effacée) n'y figure plus, ni
   * l'écriture qui la neutralise : l'écran est le sien, le grand livre garde
   * les deux lignes.
   */
  async list() {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        amount: string;
        description: string;
        spent_at: string;
        receipt_no: number | null;
        moyens: { moyen: string; montant: string; reference: string | null }[] | null;
      }>(
        `SELECT e.id, e.amount::text, e.description, e.spent_at::text, e.receipt_no,
                (SELECT jsonb_agg(jsonb_build_object('moyen', m.name, 'montant', t.amount::text, 'reference', t.reference)
                                  ORDER BY t.created_at)
                   FROM tender_lines t JOIN payment_methods m ON m.id = t.payment_method_id
                  WHERE t.school_id = e.school_id AND t.source_type = 'depense'
                    AND t.source_id = e.id) AS moyens
           FROM expenses e
          WHERE e.reversed = false AND e.reverses_id IS NULL
          ORDER BY e.spent_at DESC`,
      );
      const { rows: tot } = await tx.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0)::numeric(14,2)::text AS total FROM expenses
          WHERE reversed = false AND reverses_id IS NULL`,
      );
      return {
        depenses: rows.map((r) => ({
          ...r,
          numero: r.receipt_no === null ? null : numeroDocument('DEP', r.receipt_no),
          // `resume_moyens()` : un même moyen cumulé, « Espèces 5 000 + Bankily 2 000 », ou « — ».
          moyens: resumeMoyens(r.moyens ?? []),
        })),
        total: tot[0]!.total,
      };
    });
  }

  /** Le bon de dépense — le bloc `print_bon` de `depenses.php`. */
  async receipt(expenseId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        receipt_no: number | null;
        amount: string;
        description: string;
        spent_at: string;
        cree_par_nom: string | null;
      }>(
        `SELECT d.id, d.receipt_no, d.amount::text, d.description, d.spent_at::text,
                COALESCE(NULLIF(TRIM(u.full_name), ''), u.username, u.email) AS cree_par_nom
           FROM expenses d LEFT JOIN users u ON d.created_by = u.id
          WHERE d.id = $1`,
        [expenseId],
      );
      const d = rows[0];
      if (!d) throw new NotFoundException('Bon introuvable.');
      const moyens = await this.tender.linesFor(tx, 'depense', d.id);
      return {
        id: d.id,
        numero: d.receipt_no === null ? null : numeroDocument('DEP', d.receipt_no),
        date: d.spent_at,
        description: d.description,
        cree_par_nom: d.cree_par_nom,
        moyens,
        montant: d.amount,
      };
    });
  }

  /**
   * SON « SUPPRIMER », SANS RIEN EFFACER.
   *
   * Règle 7 : l'original reste tel qu'il a été écrit ; une écriture négative
   * le neutralise et le désigne, et l'original est marqué `reversed`. La liste
   * et le total ne montrent plus ni l'un ni l'autre — exactement ce que voit
   * l'administration chez lui après « Supprimer cette dépense ? ».
   */
  async reverse(expenseId: string, reason: string, actorId: string) {
    const { schoolId } = currentTenant();

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        amount: string;
        description: string;
        reversed: boolean;
        reverses_id: string | null;
      }>('SELECT amount::text, description, reversed, reverses_id FROM expenses WHERE id = $1 FOR UPDATE', [
        expenseId,
      ]);
      const original = rows[0];
      if (!original) {
        throw new NotFoundException("Aucune dépense ne porte ce numéro : rien n'a été supprimé.");
      }
      if (original.reverses_id || money(original.amount).lessThan(0)) {
        throw new BadRequestException('Cette écriture est elle-même une annulation.');
      }
      if (original.reversed) {
        throw new BadRequestException('Cette dépense a déjà été supprimée.');
      }

      const negated = money(original.amount).negated();
      const { rows: created } = await tx.query<{ id: string; spent_at: Date }>(
        `INSERT INTO expenses (school_id, amount, description, created_by, reverses_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, spent_at`,
        [
          schoolId,
          toStorage(negated),
          `Annulation — ${original.description} (${reason})`,
          actorId,
          expenseId,
        ],
      );
      await tx.query('UPDATE expenses SET reversed = true WHERE id = $1', [expenseId]);

      // L'argent revient par où il est sorti : mêmes moyens, en entrée, sur
      // l'écriture d'annulation (sinon la dépense annulée pesait encore dans
      // les sorties par moyen).
      const { rows: lignes } = await tx.query<{ payment_method_id: string; amount: string; reference: string | null }>(
        `SELECT payment_method_id, amount::text, reference
           FROM tender_lines WHERE source_type = 'depense' AND source_id = $1`,
        [expenseId],
      );
      if (lignes.length > 0) {
        await this.tender.post(tx, {
          sourceType: 'depense',
          sourceId: created[0]!.id,
          direction: 'in',
          total: toStorage(money(original.amount)),
          lines: lignes.map((l) => ({ paymentMethodId: l.payment_method_id, amount: l.amount, reference: l.reference })),
          at: created[0]!.spent_at,
        });
      }

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'expense_reversed',
          entity: 'expense',
          entityId: created[0]!.id,
          before: { expenseId, amount: original.amount },
          after: { amount: toStorage(negated), reason },
        },
        tx,
      );

      return { id: created[0]!.id, amount: original.amount };
    });
  }
}

/** `resume_moyens()` — un même moyen cumulé, « Espèces 5 000 + Bankily 2 000 », ou « — ». */
export function resumeMoyens(lignes: { moyen: string; montant: string; reference?: string | null }[]): string {
  if (lignes.length === 0) return '—';
  const parMoyen = new Map<string, { m: Decimal; refs: string[] }>();
  for (const l of lignes) {
    const e = parMoyen.get(l.moyen) ?? { m: new Decimal(0), refs: [] };
    e.m = e.m.plus(money(l.montant));
    if (l.reference) e.refs.push(l.reference);
    parMoyen.set(l.moyen, e);
  }
  // La référence de l'application de paiement (0038) suit le moyen :
  // « Bankily 5 000 (réf. 123456) ».
  return [...parMoyen.entries()]
    .map(([nom, e]) => `${nom} ${fr(e.m)}${e.refs.length ? ` (réf. ${e.refs.join(', ')})` : ''}`)
    .join(' + ');
}
