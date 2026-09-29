import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import {
  SOURCES_SERVICES,
  comparerEcheancesService,
  definitionService,
  libelleFraisPhotocopie,
  libelleService,
  money,
  sourceTypeService,
  sum,
  toStorage,
  type Periodicite,
  type ServiceCode,
} from '@elourwa/shared';
import type { Queryable } from '@elourwa/db';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenderService } from './tender.service.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { AcademicYearService } from '../academic/academic-year.service.js';
import { BillingModelService } from './billing-model.service.js';

/** Une ligne de service d'un reçu groupé (§7, §10). */
export interface LigneServiceRecu {
  /** La ligne du grand livre des services — ce qu'annule `POST /finance/service-payments/:id/reverse`. */
  id: string;
  studentId: string;
  studentName: string;
  matricule: string | null;
  service: ServiceCode;
  label: string;
  periodicite: Periodicite;
  /** null pour un service annuel (inscription, photocopie). */
  month: number | null;
  year: number | null;
  amount: string;
  /** Le numéro de l'annulation, si la ligne a été annulée depuis. */
  reversedBy: string | null;
}

export interface TenderLine {
  paymentMethodId: string;
  amount: string;
  /** Le numéro de reçu de l'application de paiement (Bankily, Masrvi…), facultatif — 0038. */
  reference?: string | null;
}

export interface RecordPaymentInput {
  studentId: string;
  academicYearId: string;
  calendarMonth: number;
  calendarYear: number;
  amount: string;
  /** How the money arrived. Must sum EXACTLY to `amount`. */
  tender: TenderLine[];
  /** The number written in the school's paper receipt book. */
  paperReference?: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TenderService) private readonly tender: TenderService,
    @Inject(AcademicYearService) private readonly years: AcademicYearService,
    @Inject(BillingModelService) private readonly billing: BillingModelService,
  ) {}

  /**
   * LE REÇU D'UN PAIEMENT — everything `recu_document()` needs to print one.
   *
   * ⚠ THE ONLY DOCUMENT A FAMILY KEEPS. It is what they hold when they come
   * back and say they paid, so every figure on it has to come from the payment
   * itself rather than be recomputed at print time — a receipt that disagrees
   * with the ledger is worse than no receipt.
   *
   * ⚠ AND IT CARRIES ITS OWN TENDER LINES. "Moyen(s) de paiement" is a real row
   * on its receipt, and a family paying half in cash and half by Bankily gets
   * both named. Ours had no receipt route at all — the fiche linked to one and
   * the link was dead.
   */
  /**
   * LE REÇU GROUPÉ (0040) : un numéro, plusieurs mois (d'un ou plusieurs
   * enfants) et les frais annuels réglés d'un coup ; les moyens de paiement
   * additionnés par moyen et par référence. `receiptOf(paymentId)` dit si un
   * paiement de mois appartient à un tel reçu — sa carte y renvoie alors.
   */
  async receiptGroup(id: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        receipt_number: string; amount: string; paid_at: Date; year_label: string;
        guardian_id: string; guardian_name: string | null; guardian_phone: string | null;
        recorded_by: string | null; school_name: string; currency: string;
      }>(
        `SELECT r.receipt_number, r.amount::text, r.paid_at, y.label AS year_label,
                r.guardian_id, u.full_name AS guardian_name, u.phone AS guardian_phone,
                rec.full_name AS recorded_by, sc.name AS school_name, sc.currency
           FROM receipts r
           JOIN schools sc ON sc.id = r.school_id
           JOIN academic_years y ON y.id = r.academic_year_id
           LEFT JOIN users u ON u.id = r.guardian_id
           LEFT JOIN users rec ON rec.id = r.recorded_by
          WHERE r.id = $1`,
        [id],
      );
      const r = rows[0];
      if (!r) throw new NotFoundException('Reçu introuvable.');

      const { rows: mois } = await tx.query<{
        id: string; student_name: string; matricule: string | null; level_name: string | null; group_name: string | null;
        calendar_month: number; calendar_year: number; amount: string; reversed_by: string | null;
      }>(
        `SELECT p.id, (s.first_name || ' ' || s.last_name) AS student_name, s.matricule,
                l.name AS level_name, g.name AS group_name,
                p.calendar_month, p.calendar_year, p.amount::text,
                (SELECT x.receipt_number FROM payments x WHERE x.reverses_id = p.id LIMIT 1) AS reversed_by
           FROM payments p
           JOIN students s ON s.id = p.student_id
           LEFT JOIN enrollments e ON e.student_id = s.id AND e.academic_year_id = p.academic_year_id AND e.status <> 'cancelled'
           LEFT JOIN groups g ON g.id = e.group_id
           LEFT JOIN levels l ON l.id = COALESCE(e.level_id, g.level_id)
          WHERE p.receipt_id = $1 AND p.reverses_id IS NULL
          ORDER BY s.last_name, s.first_name, p.calendar_year, p.calendar_month`,
        [id],
      );
      const { rows: frais } = await tx.query<{ id: string; kind: string; amount: string }>(
        `SELECT id, kind, amount::text FROM family_fee_payments WHERE receipt_id = $1 ORDER BY kind`,
        [id],
      );
      /**
       * École « services » (ADR-0073) : les lignes de son grand livre. Une école
       * « famille » n'en a aucune : `services` y vaut `[]`. Rangées par élève,
       * puis dans l'ordre de la fenêtre — celui dans lequel les moyens ont été
       * découpés.
       */
      const { rows: servs } = await tx.query<{
        id: string; student_id: string; student_name: string; matricule: string | null;
        service: ServiceCode; calendar_month: number; calendar_year: number; amount: string;
        reversed_by: string | null;
      }>(
        `SELECT sp.id, sp.student_id, (s.first_name || ' ' || s.last_name) AS student_name, s.matricule,
                ss.service, sp.calendar_month, sp.calendar_year, sp.amount::text,
                (SELECT x.receipt_number FROM service_payments x WHERE x.reverses_id = sp.id LIMIT 1) AS reversed_by
           FROM service_payments sp
           JOIN student_services ss ON ss.id = sp.student_service_id
           JOIN students s ON s.id = sp.student_id
          WHERE sp.receipt_id = $1 AND sp.reverses_id IS NULL
          ORDER BY s.last_name, s.first_name, sp.student_id`,
        [id],
      );
      const rangEleve = new Map<string, number>();
      for (const s of servs) if (!rangEleve.has(s.student_id)) rangEleve.set(s.student_id, rangEleve.size);
      const services: LigneServiceRecu[] = [...servs]
        .sort(
          (a, b) =>
            rangEleve.get(a.student_id)! - rangEleve.get(b.student_id)! ||
            comparerEcheancesService(
              { service: a.service, month: a.calendar_month, year: a.calendar_year },
              { service: b.service, month: b.calendar_month, year: b.calendar_year },
            ) ||
            a.id.localeCompare(b.id),
        )
        .map((s) => {
          const annuel = definitionService(s.service).periodicite === 'annuel';
          return {
            id: s.id,
            studentId: s.student_id,
            studentName: s.student_name,
            matricule: s.matricule,
            service: s.service,
            label: libelleService(s.service),
            periodicite: definitionService(s.service).periodicite,
            month: annuel ? null : s.calendar_month,
            year: annuel ? null : s.calendar_year,
            amount: s.amount,
            reversedBy: s.reversed_by,
          };
        });
      /**
       * ⚠ LES MOYENS DU REÇU ÉNUMÈRENT LEURS ORIGINES. Oublier celles des services
       * imprimerait un reçu dont les moyens n'atteignent pas le total. Pour une
       * école « famille », la branche des services ne trouve rien.
       */
      const { rows: tender } = await tx.query<{ name: string; amount: string; reference: string | null }>(
        `SELECT pm.name, SUM(tl.amount)::text AS amount, tl.reference
           FROM tender_lines tl
           JOIN payment_methods pm ON pm.id = tl.payment_method_id
          WHERE tl.direction = 'in'
            AND ((tl.source_type = 'paiement' AND tl.source_id IN (SELECT id FROM payments WHERE receipt_id = $1))
              OR (tl.source_type = 'frais_annuel' AND tl.source_id IN (SELECT id FROM family_fee_payments WHERE receipt_id = $1))
              OR (tl.source_type = ANY($2::text[]) AND tl.source_id IN (SELECT id FROM service_payments WHERE receipt_id = $1)))
          GROUP BY pm.name, tl.reference
          ORDER BY pm.name, tl.reference NULLS LAST`,
        [id, [...SOURCES_SERVICES]],
      );

      return {
        receiptNumber: r.receipt_number,
        amount: r.amount,
        paidAt: r.paid_at,
        yearLabel: r.year_label,
        guardianId: r.guardian_id,
        guardianName: r.guardian_name,
        guardianPhone: r.guardian_phone,
        recordedBy: r.recorded_by,
        schoolName: r.school_name,
        currency: r.currency,
        months: mois.map((m) => ({
          paymentId: m.id,
          studentName: m.student_name,
          matricule: m.matricule,
          levelName: m.level_name,
          groupName: m.group_name,
          month: m.calendar_month,
          year: m.calendar_year,
          amount: m.amount,
          reversedBy: m.reversed_by,
        })),
        fees: frais.map((f) => ({ id: f.id, kind: f.kind, label: f.kind === 'enrolment' ? "Frais d'inscription" : libelleFraisPhotocopie(), amount: f.amount })),
        services,
        tender: tender.map((l) => ({ method: l.name, amount: l.amount, reference: l.reference })),
      };
    });
  }

  /** Le reçu groupé auquel appartient un paiement de mois, s'il y en a un. */
  async receiptOf(paymentId: string): Promise<string | null> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ receipt_id: string | null }>('SELECT receipt_id FROM payments WHERE id = $1', [paymentId]);
      return rows[0]?.receipt_id ?? null;
    });
  }

  async receipt(id: string) {

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        receipt_number: string;
        paper_reference: string | null;
        amount: string;
        calendar_month: number;
        calendar_year: number;
        paid_at: Date;
        reversed_by: string | null;
        student_name: string;
        matricule: string | null;
        level_name: string | null;
        group_name: string | null;
        guardian_name: string | null;
        guardian_phone: string | null;
        guardian_id: string | null;
        recorded_by: string | null;
        school_name: string;
        currency: string;
        year_label: string;
      }>(
        `SELECT p.receipt_number, p.paper_reference, p.amount::text,
                p.calendar_month, p.calendar_year, p.paid_at,
                (SELECT r.receipt_number FROM payments r WHERE r.reverses_id = p.id LIMIT 1)
                  AS reversed_by,
                (s.first_name || ' ' || s.last_name) AS student_name,
                s.matricule,
                l.name AS level_name, g.name AS group_name,
                u.full_name AS guardian_name, u.phone AS guardian_phone, s.guardian_id,
                rec.full_name AS recorded_by,
                sc.name AS school_name, sc.currency,
                y.label AS year_label
           FROM payments p
           JOIN students s ON s.id = p.student_id
           JOIN schools sc ON sc.id = p.school_id
           JOIN academic_years y ON y.id = p.academic_year_id
           LEFT JOIN users u ON u.id = s.guardian_id
           LEFT JOIN users rec ON rec.id = p.recorded_by
           LEFT JOIN enrollments e
             ON e.student_id = s.id AND e.academic_year_id = p.academic_year_id
           LEFT JOIN groups g ON g.id = e.group_id
           LEFT JOIN levels l ON l.id = COALESCE(e.level_id, g.level_id)
          WHERE p.id = $1`,
        [id],
      );
      const r = rows[0];
      if (!r) throw new NotFoundException('Reçu introuvable.');

      const { rows: tender } = await tx.query<{ name: string; amount: string; reference: string | null }>(
        `SELECT pm.name, tl.amount::text, tl.reference
           FROM tender_lines tl
           JOIN payment_methods pm ON pm.id = tl.payment_method_id
          WHERE tl.source_type = 'paiement' AND tl.source_id = $1
          ORDER BY pm.name`,
        [id],
      );

      // A discount on the month this receipt settles — its "Réduction appliquée".
      const { rows: discount } = await tx.query<{ amount: string }>(
        `SELECT d.amount::text FROM discounts d
           JOIN payments p ON p.student_id = d.student_id
          WHERE p.id = $1 AND d.calendar_month = p.calendar_month
            AND d.calendar_year = p.calendar_year`,
        [id],
      );

      return {
        receiptNumber: r.receipt_number,
        paperReference: r.paper_reference,
        amount: r.amount,
        month: r.calendar_month,
        year: r.calendar_year,
        paidAt: r.paid_at,
        // ⚠ A reversed payment must SAY so on its own receipt. Reprinting one
        // that has been cancelled, with nothing to distinguish it, hands a
        // family proof of a payment the ledger has undone.
        reversedBy: r.reversed_by,
        studentName: r.student_name,
        matricule: r.matricule,
        levelName: r.level_name,
        groupName: r.group_name,
        guardianName: r.guardian_name,
        guardianPhone: r.guardian_phone,
        guardianId: r.guardian_id,
        recordedBy: r.recorded_by,
        schoolName: r.school_name,
        currency: r.currency,
        yearLabel: r.year_label,
        tender: tender.map((t) => ({ method: t.name, amount: t.amount, reference: t.reference })),
        discount: discount[0]?.amount ?? null,
      };
    });
  }

  /**
   * LE REÇU D'UN FRAIS ANNUEL — its `print_recu_annuel`.
   *
   * ⚠ A DIFFERENT DOCUMENT FROM A MONTH'S RECEIPT, and it has to be. An annual
   * fee is owed by the FAMILY, not by a child: naming a student on it would
   * suggest the enrolment fee had been paid for that one child and was still
   * due for their brother. Its own lines say so — "Frais d'inscription (annuel,
   * par correspondant)" — and the correspondent is the only person named.
   *
   * The tender lines come from the same polymorphic ledger as everything else,
   * under `source_type = 'frais_annuel'`, so a receipt shows what was actually
   * handed over — cash and Bankily on one payment, if that is what happened.
   */
  async annualFeeReceipt(id: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        receipt_number: string | null;
        amount: string;
        kind: string;
        paid_at: Date;
        guardian_id: string;
        guardian_name: string | null;
        guardian_phone: string | null;
        recorded_by: string | null;
        school_name: string;
        currency: string;
        year_label: string;
      }>(
        `SELECT f.receipt_number, f.amount::text, f.kind, f.paid_at,
                f.guardian_id, u.full_name AS guardian_name, u.phone AS guardian_phone,
                rec.full_name AS recorded_by,
                sc.name AS school_name, sc.currency,
                y.label AS year_label
           FROM family_fee_payments f
           JOIN schools sc ON sc.id = f.school_id
           JOIN academic_years y ON y.id = f.academic_year_id
           LEFT JOIN users u ON u.id = f.guardian_id
           LEFT JOIN users rec ON rec.id = f.recorded_by
          WHERE f.id = $1`,
        [id],
      );
      const r = rows[0];
      if (!r) throw new NotFoundException('Reçu introuvable.');

      const { rows: tender } = await tx.query<{ name: string; amount: string; reference: string | null }>(
        `SELECT pm.name, tl.amount::text, tl.reference
           FROM tender_lines tl
           JOIN payment_methods pm ON pm.id = tl.payment_method_id
          WHERE tl.source_type = 'frais_annuel' AND tl.source_id = $1
          ORDER BY pm.name`,
        [id],
      );

      return {
        receiptNumber: r.receipt_number,
        amount: r.amount,
        kind: r.kind,
        label:
          r.kind === 'enrolment'
            ? "Frais d'inscription (annuel, par correspondant)"
            : libelleFraisPhotocopie(),
        title: r.kind === 'enrolment' ? "Frais d'inscription" : libelleFraisPhotocopie(),
        paidAt: r.paid_at,
        guardianId: r.guardian_id,
        guardianName: r.guardian_name,
        guardianPhone: r.guardian_phone,
        recordedBy: r.recorded_by,
        schoolName: r.school_name,
        currency: r.currency,
        yearLabel: r.year_label,
        tender: tender.map((t) => ({ method: t.name, amount: t.amount, reference: t.reference })),
      };
    });
  }

  /**
   * Take the next receipt number for a school and year.
   *
   * ⚠ `SELECT … FOR UPDATE`, never `MAX(number) + 1`. Two concurrent collections
   * reading the same maximum would issue the SAME receipt number to two
   * different families — and a family holds the paper.
   *
   * Must run inside the caller's transaction so the number and the payment
   * commit together; a number handed out and then rolled back leaves a gap that
   * looks like a missing receipt to an auditor.
   */
  private async nextReceiptNumber(
    tx: Queryable,
    year: number,
    prefix: string,
  ): Promise<string> {
    const { schoolId } = currentTenant();
    await tx.query(
      `INSERT INTO receipt_sequences (school_id, year, last_number)
       VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`,
      [schoolId, year],
    );
    const { rows } = await tx.query<{ last_number: number }>(
      `UPDATE receipt_sequences SET last_number = last_number + 1
        WHERE school_id = $1 AND year = $2
        RETURNING last_number`,
      [schoolId, year],
    );
    return `${prefix}-${year}-${String(rows[0]!.last_number).padStart(5, '0')}`;
  }

  /**
   * Record a tuition payment.
   *
   * Append-only: this never updates an existing payment. A correction is a
   * reversing entry (`reverse()`), so the original and the correction both
   * survive and the ledger explains itself.
   */
  async record(input: RecordPaymentInput, actorId: string) {
    const { schoolId } = currentTenant();
    const year = await this.years.assertWritable(input.academicYearId);

    const amount = money(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Un paiement doit être d’un montant positif.');
    }

    // The tender split must reconcile to the cent. El Ourwa measures this gap
    // rather than hoping — a payment recorded without a matching split makes the
    // financial reports wrong with nothing to signal it.
    if (input.tender.length === 0) {
      throw new BadRequestException(
        'Indiquez comment l’argent est arrivé : au moins un moyen de paiement.',
      );
    }
    const tendered = sum(input.tender.map((t) => t.amount));
    if (!tendered.equals(amount)) {
      throw new BadRequestException(
        `Les moyens de paiement totalisent ${toStorage(tendered)} alors que le ` +
          `paiement est de ${toStorage(amount)}. Les deux doivent correspondre ` +
          'exactement.',
      );
    }

    const school = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ receipt_prefix: string; currency: string }>(
        'SELECT receipt_prefix, currency FROM schools WHERE id = $1',
        [schoolId],
      );
      return rows[0]!;
    });

    return this.db.query(async (tx) => {
      const receiptNumber = await this.nextReceiptNumber(tx, year.start_year, school.receipt_prefix);

      const { rows } = await tx.query<{ id: string; paid_at: Date }>(
        `INSERT INTO payments
           (school_id, student_id, academic_year_id, calendar_month, calendar_year,
            amount, receipt_number, paper_reference, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, paid_at`,
        [
          schoolId, input.studentId, input.academicYearId, input.calendarMonth,
          input.calendarYear, toStorage(amount), receiptNumber,
          input.paperReference ?? null, actorId,
        ],
      );
      const paymentId = rows[0]!.id;

      // One ledger for how money moved, in both directions (0014). This used to
      // be a table of its own that only receipts wrote to, which is why nothing
      // recorded how a salary or an expense left the till.
      await this.tender.post(tx, {
        sourceType: 'paiement',
        sourceId: paymentId,
        direction: 'in',
        total: toStorage(amount),
        lines: input.tender,
        // Dated by the RECEIPT, not by the moment the row is written. El Ourwa
        // reports on the line's own date, so the two must agree or a back-dated
        // receipt would report in the wrong month.
        at: rows[0]!.paid_at,
      });

      await this.audit.record({
        actorId,
        schoolId,
        action: 'payment_recorded',
        entity: 'payment',
        entityId: paymentId,
        after: {
          amount: toStorage(amount),
          receiptNumber,
          month: `${input.calendarYear}-${input.calendarMonth}`,
        },
      }, tx);

      return {
        id: paymentId,
        receiptNumber,
        amount: toStorage(amount),
        currency: school.currency,
      };
    });
  }

  /** L'année scolaire d'un paiement, pour la porte des examens. */
  async yearOfPayment(paymentId: string): Promise<string | null> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ academic_year_id: string }>(
        'SELECT academic_year_id FROM payments WHERE id = $1',
        [paymentId],
      );
      return rows[0]?.academic_year_id ?? null;
    });
  }

  /**
   * Reverse a payment.
   *
   * A new row with the negated amount, pointing at what it reverses. The
   * original is untouched — standing rule 6. "Delete the mistake" is how a
   * ledger stops being able to explain itself.
   */
  async reverse(paymentId: string, reason: string, actorId: string) {
    const { schoolId } = currentTenant();

    const original = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        student_id: string;
        academic_year_id: string;
        calendar_month: number;
        calendar_year: number;
        amount: string;
        reverses_id: string | null;
      }>(
        `SELECT id, student_id, academic_year_id, calendar_month, calendar_year,
                amount, reverses_id
           FROM payments WHERE id = $1`,
        [paymentId],
      );
      return rows[0];
    });
    if (!original) throw new NotFoundException('Paiement introuvable.');
    if (original.reverses_id) {
      throw new BadRequestException('Cette écriture est elle-même une annulation.');
    }

    await this.years.assertWritable(original.academic_year_id);
    const school = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ receipt_prefix: string }>(
        'SELECT receipt_prefix FROM schools WHERE id = $1',
        [schoolId],
      );
      return rows[0]!;
    });
    const year = await this.years.byId(original.academic_year_id);

    return this.db.query(async (tx) => {
      // ⚠ UNE ANNULATION PAR REÇU. L'original est verrouillé pour la durée de
      // l'écriture et le « déjà annulé » relu SOUS ce verrou : deux clics
      // simultanés donnaient deux contre-passations (et l'index unique de 0039
      // refuserait de toute façon la seconde).
      await tx.query('SELECT 1 FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
      const { rows: deja } = await tx.query('SELECT 1 FROM payments WHERE reverses_id = $1', [paymentId]);
      if (deja[0]) throw new BadRequestException('Ce paiement a déjà été annulé.');

      const receiptNumber = await this.nextReceiptNumber(tx, year.start_year, school.receipt_prefix);
      const negated = money(original.amount).negated();

      const { rows } = await tx.query<{ id: string; paid_at: Date }>(
        `INSERT INTO payments
           (school_id, student_id, academic_year_id, calendar_month, calendar_year,
            amount, receipt_number, recorded_by, reverses_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, paid_at`,
        [
          schoolId, original.student_id, original.academic_year_id,
          original.calendar_month, original.calendar_year, toStorage(negated),
          receiptNumber, actorId, paymentId,
        ],
      );

      // L'argent repart par où il est entré : les mêmes moyens, en sortie,
      // sur l'écriture d'annulation — comme le soir le fait. Sans cela les
      // totaux par moyen (revenus du jour, bilan) comptaient encore un reçu
      // annulé, et la caisse signalait un écart à chaque annulation.
      const { rows: lignes } = await tx.query<{ payment_method_id: string; amount: string; reference: string | null }>(
        `SELECT payment_method_id, amount::text, reference
           FROM tender_lines WHERE source_type = 'paiement' AND source_id = $1`,
        [paymentId],
      );
      if (lignes.length > 0) {
        await this.tender.post(tx, {
          sourceType: 'paiement',
          sourceId: rows[0]!.id,
          direction: 'out',
          total: toStorage(money(original.amount)),
          lines: lignes.map((l) => ({ paymentMethodId: l.payment_method_id, amount: l.amount, reference: l.reference })),
          at: rows[0]!.paid_at,
        });
      }

      await this.audit.record({
        actorId,
        schoolId,
        action: 'payment_reversed',
        entity: 'payment',
        entityId: rows[0]!.id,
        before: { paymentId, amount: original.amount },
        after: { reversalId: rows[0]!.id, amount: toStorage(negated), reason },
      }, tx);

      return {
        id: rows[0]!.id,
        receiptNumber,
        amount: toStorage(negated),
        calendarMonth: original.calendar_month,
        calendarYear: original.calendar_year,
      };
    });
  }

  /**
   * ANNULER UN PAIEMENT DE SERVICE — `POST /finance/service-payments/:id/reverse`
   * (direction seule ; ADR-0073, spec §5).
   *
   * `reverse()` recopié pour le grand livre des services, geste pour geste : une
   * ligne NÉGATIVE qui désigne l'original (jamais d'UPDATE, règle 7), un numéro
   * à elle tiré de `receipt_sequences` dans la même transaction, l'original
   * verrouillé FOR UPDATE et le « déjà annulé » relu sous ce verrou (l'index
   * `service_payments_reverses_uq` refuserait de toute façon la seconde), les
   * moyens recopiés en « out » sous le `source_type` du service.
   *
   * ⚠ EN PLUS : LE VERROU DE LA FAMILLE, d'abord — celui du reçu groupé, de
   * l'arrêt et de l'exemption d'un abonnement. Sans lui, un arrêt pourrait
   * relire « mars réglé » pendant qu'on annule mars.
   */
  async reverseServicePayment(paymentId: string, reason: string, actorId: string) {
    const { schoolId } = currentTenant();

    const original = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        student_service_id: string;
        student_id: string;
        academic_year_id: string;
        calendar_month: number;
        calendar_year: number;
        amount: string;
        reverses_id: string | null;
        service: ServiceCode;
        guardian_id: string | null;
      }>(
        `SELECT sp.id, sp.student_service_id, sp.student_id, sp.academic_year_id,
                sp.calendar_month, sp.calendar_year, sp.amount::text AS amount, sp.reverses_id,
                ss.service, s.guardian_id
           FROM service_payments sp
           JOIN student_services ss ON ss.id = sp.student_service_id
           JOIN students s ON s.id = sp.student_id
          WHERE sp.id = $1`,
        [paymentId],
      );
      return rows[0];
    });
    if (!original) throw new NotFoundException('Paiement introuvable.');
    if (original.reverses_id) {
      throw new BadRequestException('Cette écriture est elle-même une annulation.');
    }

    await this.years.assertWritable(original.academic_year_id);
    const school = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ receipt_prefix: string }>(
        'SELECT receipt_prefix FROM schools WHERE id = $1',
        [schoolId],
      );
      return rows[0]!;
    });
    const year = await this.years.byId(original.academic_year_id);
    const sourceType = sourceTypeService(original.service);

    return this.db.query(async (tx) => {
      if (original.guardian_id) {
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `family-payment:${original.guardian_id}:${original.academic_year_id}`,
        ]);
      }
      // ⚠ UNE ANNULATION PAR LIGNE, relue sous le verrou de la ligne.
      await tx.query('SELECT 1 FROM service_payments WHERE id = $1 FOR UPDATE', [paymentId]);
      const { rows: deja } = await tx.query('SELECT 1 FROM service_payments WHERE reverses_id = $1', [paymentId]);
      if (deja[0]) throw new BadRequestException('Ce paiement a déjà été annulé.');

      const receiptNumber = await this.nextReceiptNumber(tx, year.start_year, school.receipt_prefix);
      const negated = money(original.amount).negated();

      const { rows } = await tx.query<{ id: string; paid_at: Date }>(
        `INSERT INTO service_payments
           (school_id, student_service_id, student_id, academic_year_id, calendar_month,
            calendar_year, amount, receipt_number, recorded_by, reverses_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, paid_at`,
        [
          schoolId, original.student_service_id, original.student_id, original.academic_year_id,
          original.calendar_month, original.calendar_year, toStorage(negated),
          receiptNumber, actorId, paymentId,
        ],
      );

      // L'argent repart par où il est entré : les mêmes moyens, en sortie, sur
      // l'écriture d'annulation, sous l'origine du service — les revenus par
      // service et le contrôle de caisse retombent ainsi d'eux-mêmes.
      const { rows: lignes } = await tx.query<{ payment_method_id: string; amount: string; reference: string | null }>(
        `SELECT payment_method_id, amount::text, reference
           FROM tender_lines WHERE source_type = $2 AND source_id = $1 AND direction = 'in'`,
        [paymentId, sourceType],
      );
      if (lignes.length > 0) {
        await this.tender.post(tx, {
          sourceType,
          sourceId: rows[0]!.id,
          direction: 'out',
          total: toStorage(money(original.amount)),
          lines: lignes.map((l) => ({ paymentMethodId: l.payment_method_id, amount: l.amount, reference: l.reference })),
          at: rows[0]!.paid_at,
        });
      }

      await this.audit.record({
        actorId,
        schoolId,
        action: 'service_payment_reversed',
        entity: 'service_payment',
        entityId: rows[0]!.id,
        before: { paymentId, amount: original.amount, service: original.service },
        after: { reversalId: rows[0]!.id, amount: toStorage(negated), reason },
      }, tx);

      return {
        id: rows[0]!.id,
        receiptNumber,
        amount: toStorage(negated),
        calendarMonth: original.calendar_month,
        calendarYear: original.calendar_year,
        service: original.service,
        studentServiceId: original.student_service_id,
        studentId: original.student_id,
        guardianId: original.guardian_id,
        academicYearId: original.academic_year_id,
      };
    });
  }

  /** The family a student belongs to. For the exam-access ratchet. */
  async guardianOf(studentId: string): Promise<string | null> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ guardian_id: string | null }>(
        'SELECT guardian_id FROM students WHERE id = $1',
        [studentId],
      );
      return rows[0]?.guardian_id ?? null;
    });
  }

  /** Active means of payment for this school. */
  /**
   * Les moyens de paiement — El Ourwa's `moyens_paiement`.
   *
   * ⚠ INACTIVE ONES ARE STILL RETURNED, flagged rather than filtered. Its own
   * note on the panel says why: "Un moyen désactivé n'apparaît plus dans les
   * formulaires de paiement, mais l'historique est conservé." A payment made by
   * Masrvi three years ago still has to render as Masrvi long after the school
   * stops accepting it.
   */
  async methods(includeInactive = false): Promise<{ id: string; name: string; isActive: boolean }[]> {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string; name: string; is_active: boolean }>(
        `SELECT id, name, is_active FROM payment_methods
          WHERE school_id = $1 ${includeInactive ? '' : 'AND is_active = true'}
          ORDER BY name`,
        [schoolId],
      );
      return rows.map((r) => ({ id: r.id, name: r.name, isActive: r.is_active }));
    });
  }

  /** Ajouter un moyen — "Nouveau moyen (ex : Bankily, Masrvi, …)". */
  async addMethod(name: string, actorId: string): Promise<{ id: string }> {
    const { schoolId } = currentTenant();
    const clean = name.trim();
    if (clean.length < 2) {
      throw new BadRequestException('Donnez un nom à ce moyen de paiement.');
    }

    return this.db.query(async (tx) => {
      const { rows } = await tx
        .query<{ id: string }>(
          `INSERT INTO payment_methods (school_id, name) VALUES ($1, $2) RETURNING id`,
          [schoolId, clean],
        )
        .catch((error: { code?: string }) => {
          if (error.code === '23505') {
            throw new ConflictException('Ce moyen de paiement existe déjà.');
          }
          throw error;
        });

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'payment_method_added',
          entity: 'payment_method',
          entityId: rows[0]!.id,
          after: { name: clean },
        },
        tx,
      );
      return { id: rows[0]!.id };
    });
  }

  /**
   * Activer / désactiver un moyen — its toggle.
   *
   * ⚠ NEVER DELETED, ONLY SWITCHED OFF. Payments point at the method, and the
   * history has to keep rendering; El Ourwa's panel says so in as many words.
   */
  async toggleMethod(id: string, actorId: string): Promise<{ isActive: boolean; name: string }> {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ is_active: boolean; name: string }>(
        `UPDATE payment_methods SET is_active = NOT is_active
          WHERE id = $1 RETURNING is_active, name`,
        [id],
      );
      if (rows.length === 0) throw new NotFoundException('Moyen de paiement introuvable.');

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'payment_method_toggled',
          entity: 'payment_method',
          entityId: id,
          after: { name: rows[0]!.name, isActive: String(rows[0]!.is_active) },
        },
        tx,
      );
      return { isActive: rows[0]!.is_active, name: rows[0]!.name };
    });
  }

  /** What a student has paid for one month, net of any reversal. */
  async paidForMonth(studentId: string, calendarMonth: number, calendarYear: number): Promise<Decimal> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total FROM payments
          WHERE student_id = $1 AND calendar_month = $2 AND calendar_year = $3`,
        [studentId, calendarMonth, calendarYear],
      );
      return money(rows[0]!.total);
    });
  }

  /**
   * Till consistency: every payment's tender lines must sum to its amount.
   *
   * El Ourwa measures this instead of assuming it, and the reasoning holds — a
   * mismatch makes the financial reports wrong with nothing to signal it.
   */
  async tillConsistency(): Promise<{ payments: number; mismatched: number; gap: string }> {
    return this.db.query(async (tx) => {
      const scolarite = await this.tillConsistencyTuition(tx);
      // École « services » (ADR-0073) : son grand livre des services passe au
      // même contrôle, et compte dans les mêmes chiffres — un encaissement de
      // cantine sans ses moyens est le même trou dans la caisse. Une école
      // « famille » n'en a pas : sa réponse est celle d'aujourd'hui.
      if (!(await this.billing.isServices(tx))) return scolarite;
      const { rows } = await tx.query<{ payments: string; mismatched: string; gap: string }>(
        `SELECT count(*)::text AS payments,
                count(*) FILTER (WHERE sp.amount <> COALESCE(l.total, 0))::text AS mismatched,
                COALESCE(SUM(sp.amount - COALESCE(l.total, 0)), 0)::numeric(14,2)::text AS gap
           FROM service_payments sp
           LEFT JOIN (
             -- signé : les lignes out d'une annulation comptent en négatif
             SELECT source_id, SUM(CASE WHEN direction = 'out' THEN -amount ELSE amount END) AS total
               FROM tender_lines
              WHERE source_type = ANY($1::text[])
              GROUP BY source_id
           ) l ON l.source_id = sp.id`,
        [[...SOURCES_SERVICES]],
      );
      return {
        payments: scolarite.payments + Number(rows[0]!.payments),
        mismatched: scolarite.mismatched + Number(rows[0]!.mismatched),
        gap: toStorage(money(scolarite.gap).plus(money(rows[0]!.gap))),
      };
    });
  }

  /** Le contrôle d'aujourd'hui, sur `payments` seul. */
  private async tillConsistencyTuition(
    tx: Queryable,
  ): Promise<{ payments: number; mismatched: number; gap: string }> {
    const { rows } = await tx.query<{ payments: string; mismatched: string; gap: string }>(
      `SELECT count(*)::text AS payments,
              count(*) FILTER (WHERE p.amount <> COALESCE(l.total, 0))::text AS mismatched,
              COALESCE(SUM(p.amount - COALESCE(l.total, 0)), 0)::numeric(14,2)::text AS gap
         FROM payments p
         LEFT JOIN (
           -- signé : une ligne « out » (annulation) compte en négatif, comme l'écriture qu'elle porte
           SELECT source_id, SUM(CASE WHEN direction = 'out' THEN -amount ELSE amount END) AS total
             FROM tender_lines
            WHERE source_type = 'paiement'
            GROUP BY source_id
         ) l ON l.source_id = p.id`,
    );
    return {
      payments: Number(rows[0]!.payments),
      mismatched: Number(rows[0]!.mismatched),
      gap: rows[0]!.gap,
    };
  }
}
