import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import {
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
import { PaymentsService, type TenderLine } from './payments.service.js';
import { FeesService, type AnnualFeeKind } from './fees.service.js';
import { NotificationsService } from '../parent/notifications.service.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { AcademicYearService } from '../academic/academic-year.service.js';
import { BillingModelService } from './billing-model.service.js';
import { FAMILLE_REFUS } from './tarifs.service.js';

/**
 * École « services » (ADR-0073, §3) : il n'y a pas de frais annuels PAR
 * FAMILLE. Les frais d'inscription (par élève) et la photocopie sont des
 * abonnements de chaque enfant, encaissés par le reçu groupé.
 */
export const FRAIS_FAMILLE_ABSENTS =
  "Cette école n'a pas de frais annuels par famille : les frais d'inscription et la photocopie " +
  "sont des services de chaque élève, à cocher dans la fenêtre d'encaissement.";

/**
 * École « services » : l'ancienne fenêtre à total unique (`encaisserInscription`)
 * ne sait pas répartir sur des services. Tout passe par le reçu groupé (§5).
 */
export const ANCIENNE_FENETRE_SERVICES =
  "Cette école facture par élève et par service : encaissez depuis la fenêtre d'encaissement, " +
  'qui fait un seul reçu pour les mois et les services cochés.';

/** Une échéance de service dans la fenêtre d'encaissement (§7). */
export interface LigneServiceFenetre {
  studentServiceId: string;
  service: ServiceCode;
  label: string;
  periodicite: Periodicite;
  /** null pour un service annuel (inscription, photocopie) : il se règle une fois, sans mois. */
  mois: number | null;
  annee: number | null;
  /** « Octobre 2025 » ; null pour un service annuel. */
  libelleMois: string | null;
  /** L'échéance, au montant figé sur l'abonnement. */
  du: string;
  /** Payé net (annulations déduites). */
  paye: string;
  /** 0 si exempté ; jamais négatif. */
  reste: string;
  etat: 'du' | 'partiel' | 'paye' | 'exempte';
}

/** La même, avec ce que l'encaissement doit savoir et que l'écran n'a pas à voir. */
interface LigneServiceInterne extends LigneServiceFenetre {
  /** La ligne réelle de l'échéancier — un service annuel en a une, à son mois de départ. */
  echeance: { month: number; year: number };
  exempt: boolean;
}

/** La réponse du reçu groupé. `servicePaymentIds` : école « services » seulement. */
export interface ResultatEncaissementGroupe {
  ok: true;
  receiptId: string;
  receiptNumber: string;
  academicYearId: string;
  guardianId: string;
  paymentIds: string[];
  servicePaymentIds?: string[];
  total: string;
  message: string;
}

/** A month the operator is allowed to collect for. */
export interface PayableMonth {
  /** El Ourwa's `<option value>`: "YYYY-M". */
  value: string;
  month: number;
  year: number;
  label: string;
  /** Already settled — the window greys it rather than hiding it. */
  settled: boolean;
}

export interface QuotedFee {
  kind: AnnualFeeKind;
  label: string;
  scale: string;
  paid: string;
  remaining: string;
  exempt: boolean;
  /** Paid in full already, by this family, this year. Possibly by a sibling. */
  settled: boolean;
}

export interface Quote {
  studentId: string;
  studentName: string;
  guardianId: string | null;
  /** This enrolment's own monthly fee — the negotiated one, not the level's. */
  monthly: string;
  months: PayableMonth[];
  fees: QuotedFee[];
  /** "Total attendu" — the month plus every remaining annexe fee. */
  expected: string;
  currency: string;
}

export interface CollectInput {
  studentId: string;
  academicYearId: string;
  calendarMonth: number;
  calendarYear: number;
  /** What the operator typed against each annexe fee. Absent or 0 = defer it. */
  fees: Partial<Record<AnnualFeeKind, string>>;
  /** How the money arrived. Must sum to what is actually being taken. */
  tender: TenderLine[];
  paperReference?: string;
}

/**
 * THE COLLECTION WINDOW — `includes/encaissement_inscription.php`.
 *
 * Enrolling and re-enrolling end in the same act: money is taken. The window
 * carries the THREE sums due at that moment —
 *
 *   1. the first month of tuition;
 *   2. the enrolment fee   (annual, per family);
 *   3. the photocopy fee   (annual, per family).
 *
 * ⚠ THE OPERATOR ENTERS ONE TOTAL AND IT SETTLES THREE DEBTS OF DIFFERENT
 * NATURES. The order is fixed and is the whole point of this service: THE
 * ANNEXE FEES FIRST, THE REMAINDER TO THE MONTH. El Ourwa's own comment records
 * why — before it split them, everything was imputed to the tuition month,
 * "ce qui gonflait le mois d'un montant qui ne lui revenait pas". A month that
 * shows 17 000 collected against a 10 000 fee is not a rounding curiosity: it
 * makes the month look overpaid and the fees look unpaid, and both figures then
 * lie to whoever reads them next.
 *
 * The annexe fees are due ONCE PER FAMILY PER YEAR. If an elder sibling has
 * already settled them the remainder is zero, and the window says so instead of
 * asking a second time.
 */
@Injectable()
export class CollectionService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TenderService) private readonly tender: TenderService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(FeesService) private readonly fees: FeesService,
    @Inject(AcademicYearService) private readonly years: AcademicYearService,
      @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(BillingModelService) private readonly billing: BillingModelService,
) {}

  /**
   * What the window shows before the operator touches it.
   *
   * Read in one place so the screen and the posting agree about what is owed.
   * A window that quotes a figure the posting then rejects teaches an operator
   * to distrust the screen.
   */
  async quote(studentId: string, academicYearId: string): Promise<Quote> {
    const year = await this.years.byId(academicYearId);

    const row = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        student_id: string;
        first_name: string;
        last_name: string;
        guardian_id: string | null;
        monthly_fee: string | null;
        currency: string;
      }>(
        `SELECT s.id AS student_id, s.first_name, s.last_name, s.guardian_id,
                e.monthly_fee::text AS monthly_fee, sc.currency
           FROM students s
           JOIN schools sc ON sc.id = s.school_id
           LEFT JOIN enrollments e
             ON e.student_id = s.id AND e.academic_year_id = $2 AND e.status <> 'cancelled'
          WHERE s.id = $1`,
        [studentId, academicYearId],
      );
      return rows[0] ?? null;
    });
    if (!row) throw new NotFoundException('Élève introuvable.');

    const monthly = money(row.monthly_fee ?? '0');
    const months = await this.payableMonths(studentId, academicYearId);

    const fees: QuotedFee[] = [];
    let annexes = new Decimal(0);
    if (row.guardian_id) {
      const due = await this.fees.annualFeesDue(row.guardian_id, academicYearId, year.start_year);
      for (const f of due) {
        annexes = annexes.plus(f.remaining);
        fees.push({
          kind: f.kind,
          label: f.label,
          scale: f.scale.toFixed(2),
          paid: f.paid.toFixed(2),
          remaining: f.remaining.toFixed(2),
          exempt: f.exempt,
          settled: f.remaining.lessThanOrEqualTo(0),
        });
      }
    }

    return {
      studentId: row.student_id,
      studentName: `${row.first_name} ${row.last_name}`.trim(),
      guardianId: row.guardian_id,
      monthly: monthly.toFixed(2),
      months,
      fees,
      expected: monthly.plus(annexes).toFixed(2),
      currency: row.currency,
    };
  }

  /**
   * The months this enrolment may be collected for, with their CIVIL year.
   *
   * ⚠ THE CIVIL YEAR IS NOT DECORATION. "Janvier" alone does not say whether it
   * is January of the year just closed or of the one running; a window that
   * posts a bare month number will eventually book a payment into a settled
   * year. El Ourwa's `<option value>` is "YYYY-M" for exactly this reason.
   *
   * Read from the schedule the enrolment already has, never regenerated here:
   * the schedule knows which months precede the student's entry and are
   * therefore not owed.
   */
  private async payableMonths(studentId: string, academicYearId: string): Promise<PayableMonth[]> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        calendar_month: number;
        calendar_year: number;
        month_label: string | null;
        status: string;
        paid: string;
        amount_due: string;
      }>(
        `SELECT m.calendar_month, m.calendar_year, m.month_label, m.status,
                m.amount_due::text AS amount_due,
                COALESCE(p.total, 0)::text AS paid
           FROM enrollment_months m
           JOIN enrollments e ON e.id = m.enrollment_id
           LEFT JOIN (
             SELECT student_id, calendar_month, calendar_year, SUM(amount) AS total
               FROM payments WHERE student_id = $1 GROUP BY student_id, calendar_month, calendar_year
           ) p ON p.calendar_month = m.calendar_month AND p.calendar_year = m.calendar_year
          WHERE e.student_id = $1 AND e.academic_year_id = $2 AND e.status <> 'cancelled'
          ORDER BY m.month_order`,
        [studentId, academicYearId],
      );

      return rows.map((r) => ({
        value: `${r.calendar_year}-${r.calendar_month}`,
        month: r.calendar_month,
        year: r.calendar_year,
        label: r.month_label ?? `${r.calendar_month}/${r.calendar_year}`,
        settled:
          r.status !== 'billable' || money(r.paid).greaterThanOrEqualTo(money(r.amount_due)),
      }));
    });
  }

  /**
   * TAKE THE MONEY AND SPLIT IT.
   *
   * Everything is validated before a row is written, and the whole thing commits
   * or none of it does. A collection that half-lands leaves a family holding a
   * receipt for a debt the school still shows as owed.
   */
  async collect(input: CollectInput, actorId: string) {
    const { schoolId } = currentTenant();

    // A closed year accepts no financial writing. Checked first: everything
    // below is pointless if the year cannot be written to at all.
    const year = await this.years.assertWritable(input.academicYearId);

    if (input.tender.length === 0) {
      throw new BadRequestException(
        'Indiquez comment la somme est arrivée : au moins un moyen de paiement.',
      );
    }
    const taken = sum(input.tender.map((t) => t.amount));
    if (taken.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Le montant encaissé doit être positif.');
    }

    const quote = await this.quote(input.studentId, input.academicYearId);
    if (!quote.guardianId) {
      throw new BadRequestException("Cet élève n'est rattaché à aucune famille.");
    }

    // The period must be one of THIS enrolment's payable months. A form is free
    // to post "2050-7"; it does not get to invent a school month by doing so.
    const period = `${input.calendarYear}-${input.calendarMonth}`;
    if (!quote.months.some((m) => m.value === period)) {
      throw new BadRequestException(
        `Choisissez un mois de l'année scolaire ${year.label}.`,
      );
    }

    /**
     * ⚠ THE ANNEXE SHARE — what was asked for, bounded by what is REALLY still
     * due. Beyond the remainder the money has no debt to settle and would
     * become a credit belonging to nothing; El Ourwa caps rather than refusing,
     * because an operator typing the full scale when a sibling has part-paid is
     * making an ordinary mistake, not committing fraud.
     */
    const requested: { kind: AnnualFeeKind; amount: Decimal }[] = [];
    let annexeShare = new Decimal(0);
    for (const fee of quote.fees) {
      const raw = input.fees[fee.kind];
      if (raw === undefined || raw === null || raw === '') continue;
      let value = money(raw);
      if (value.lessThanOrEqualTo(0)) continue;
      const remaining = money(fee.remaining);
      if (remaining.lessThanOrEqualTo(0)) continue; // already settled, or exempt
      if (value.greaterThan(remaining)) value = remaining;
      requested.push({ kind: fee.kind, amount: value });
      annexeShare = annexeShare.plus(value);
    }

    // The remainder goes to the month — and only the remainder.
    const tuitionShare = taken.minus(annexeShare);

    if (tuitionShare.lessThan(0)) {
      throw new BadRequestException(
        `Le total encaissé (${fr(taken)} ${quote.currency}) est inférieur aux frais ` +
          `annexes saisis (${fr(annexeShare)} ${quote.currency}).`,
      );
    }

    const monthDue = money(quote.monthly);
    if (tuitionShare.greaterThan(monthDue)) {
      throw new BadRequestException(
        `Le montant imputé à la scolarité (${fr(tuitionShare)} ${quote.currency}) dépasse ` +
          `le mois dû (${fr(monthDue)} ${quote.currency}).`,
      );
    }

    // Split the tender across the two destinations in the same order, so each
    // receipt records how ITS OWN money arrived. A fee paid by Bankily must not
    // be reported as cash because the tuition line happened to be cash.
    const split = allocate(input.tender, [annexeShare, tuitionShare]);

    const school = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ receipt_prefix: string }>(
        'SELECT receipt_prefix FROM schools WHERE id = $1',
        [schoolId],
      );
      return rows[0]!;
    });

    return this.db.query(async (tx) => {
      let paymentId: string | null = null;
      let receiptNumber: string | null = null;
      const feePaymentIds: string[] = [];
      const detail: string[] = [];

      // ── The month ────────────────────────────────────────────────────────
      if (tuitionShare.greaterThan(0)) {
        receiptNumber = await this.nextReceipt(tx, year.start_year, school.receipt_prefix);
        const { rows } = await tx.query<{ id: string; paid_at: Date }>(
          `INSERT INTO payments
             (school_id, student_id, academic_year_id, calendar_month, calendar_year,
              amount, receipt_number, paper_reference, recorded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, paid_at`,
          [
            schoolId, input.studentId, input.academicYearId, input.calendarMonth,
            input.calendarYear, toStorage(tuitionShare), receiptNumber,
            input.paperReference ?? null, actorId,
          ],
        );
        paymentId = rows[0]!.id;
        await this.tender.post(tx, {
          sourceType: 'paiement',
          sourceId: paymentId,
          direction: 'in',
          total: toStorage(tuitionShare),
          lines: split[1]!,
          at: rows[0]!.paid_at,
        });
        detail.push(`Scolarité : ${fr(tuitionShare)} ${quote.currency}`);

        // « Paiement enregistré » — `gestion_caisse.php`, `notifier_parent_de_etudiant(
        // …, 'paiement', ['montant' => mois année, 'eleve'])`. La famille sait
        // que la caisse a bien pris son argent, tout de suite, sur son téléphone.
        // Son `montant` est le MOIS payé, pas la somme ; la somme, elle, est
        // sur le reçu — et un montant sur un écran verrouillé n'est pas pour
        // qui tient le téléphone.
        const mois = quote.months.find((mm) => mm.value === period);
        await this.notifications.notifier(tx, {
          // Vérifié non nul plus haut : sans famille, pas d'encaissement.
          guardianId: quote.guardianId!,
          studentId: input.studentId,
          academicYearId: input.academicYearId,
          kind: 'info',
          souche: 'notif_paiement',
          params: { eleve: quote.studentName, montant: mois?.label ?? period },
          route: 'profil',
        });
      }

      // ── The annexe fees ──────────────────────────────────────────────────
      // Each gets its own receipt: they are separate debts, a family may settle
      // one and defer the other, and a reversal must be able to name just one.
      let annexeLines = split[0]!;
      for (const fee of requested) {
        const number = await this.nextReceipt(tx, year.start_year, `${school.receipt_prefix}-A`);
        const { rows } = await tx.query<{ id: string; paid_at: Date }>(
          `INSERT INTO family_fee_payments
             (school_id, guardian_id, academic_year_id, kind, amount,
              receipt_number, paper_reference, recorded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, paid_at`,
          [
            schoolId, quote.guardianId, input.academicYearId, fee.kind,
            toStorage(fee.amount), number, input.paperReference ?? null, actorId,
          ],
        );
        const id = rows[0]!.id;
        feePaymentIds.push(id);

        const [mine, rest] = take(annexeLines, fee.amount);
        annexeLines = rest;
        await this.tender.post(tx, {
          sourceType: 'frais_annuel',
          sourceId: id,
          direction: 'in',
          total: toStorage(fee.amount),
          lines: mine,
          at: rows[0]!.paid_at,
        });

        const label = quote.fees.find((f) => f.kind === fee.kind)!.label;
        detail.push(`${label} : ${fr(fee.amount)} ${quote.currency}`);
      }

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'collection_recorded',
          entity: 'payment',
          entityId: paymentId ?? feePaymentIds[0]!,
          after: {
            total: toStorage(taken),
            tuition: toStorage(tuitionShare),
            fees: requested.map((r) => `${r.kind}=${toStorage(r.amount)}`).join(','),
            month: period,
          },
        },
        tx,
      );

      return {
        paymentId,
        receiptNumber,
        feePaymentIds,
        total: toStorage(taken),
        tuition: toStorage(tuitionShare),
        feesPaid: requested.map((r) => ({ kind: r.kind, amount: toStorage(r.amount) })),
        currency: quote.currency,
        detail: detail.join(' · '),
      };
    });
  }

  /**
   * CONFIRMER UN PAIEMENT — `gestion_caisse.php`, action `confirmer_paiement`,
   * dans son ordre et avec ses mots.
   *
   *   1. mois exempté automatiquement (avant l'inscription) → refus ;
   *   2. mois exempté (totale ou mensuelle) → refus ;
   *   3. année clôturée → refus ;
   *   4. lignes de moyens (au moins une, total = somme) ;
   *   5. déjà versé + total > dû du mois (frais − réduction) → refus, en
   *      nommant la réduction quand il y en a une ;
   *   6. paiement écrit, lignes ventilées, parent notifié.
   *
   * Chez lui un second versement sur le même mois MET À JOUR la ligne ;
   * ici il en écrit une seconde (règle 7 : jamais d'UPDATE d'une écriture
   * financière) — la fiche somme les deux, et le message est le sien :
   * « Paiement additionnel enregistré. ».
   */
  async confirmerPaiement(
    input: { studentId: string; mois: number; annee: number; tender: TenderLine[] },
    actorId: string,
  ) {
    const lignes = input.tender.filter((l) => money(l.amount).greaterThan(0));

    const ctx = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        academic_year_id: string;
        status: string;
        amount_due: string;
        first_name: string;
        last_name: string;
        exempt: boolean;
        discount: string;
        paid: string;
      }>(
        `SELECT e.academic_year_id, m.status, m.amount_due::text, s.first_name, s.last_name,
                EXISTS (SELECT 1 FROM exemptions x WHERE x.student_id = s.id
                          AND (x.kind = 'full' OR (x.kind = 'monthly'
                               AND x.calendar_month = $2 AND x.calendar_year = $3))) AS exempt,
                COALESCE((SELECT d.amount FROM discounts d WHERE d.student_id = s.id
                            AND d.calendar_month = $2 AND d.calendar_year = $3), 0)::text AS discount,
                COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.student_id = s.id
                            AND p.calendar_month = $2 AND p.calendar_year = $3), 0)::text AS paid
           FROM students s
           JOIN enrollments e ON e.student_id = s.id AND e.status <> 'cancelled'
           JOIN enrollment_months m ON m.enrollment_id = e.id
                AND m.calendar_month = $2 AND m.calendar_year = $3
          WHERE s.id = $1
          ORDER BY e.created_at DESC LIMIT 1`,
        [input.studentId, input.mois, input.annee],
      );
      return rows[0] ?? null;
    });
    if (!ctx) throw new BadRequestException('Données de paiement invalides.');

    // Un mois « free » dans l'échéancier, sans exemption posée à la main, est
    // son `mois_auto_exempte()` : antérieur à l'inscription (règle du 25).
    if (ctx.status !== 'billable' && !ctx.exempt) {
      throw new BadRequestException(
        "Ce mois est antérieur à la date d'inscription/réinscription de l'étudiant : il est " +
          "exempté automatiquement. (L'administrateur peut annuler cette exemption depuis la " +
          'carte du mois.)',
      );
    }
    if (ctx.exempt) {
      throw new BadRequestException('Ce mois est exempté pour cet étudiant : aucun paiement requis.');
    }

    const reduction = money(ctx.discount);
    const attendu = Decimal.max(0, money(ctx.amount_due).minus(reduction));

    // Une année clôturée est en lecture seule.
    await this.years.assertWritable(ctx.academic_year_id);

    if (lignes.length === 0) {
      throw new BadRequestException(
        'Veuillez indiquer au moins un moyen de paiement avec un montant.',
      );
    }
    const total = lignes.reduce((a, l) => a.plus(money(l.amount)), new Decimal(0));
    const deja = money(ctx.paid);
    const avecReduction = reduction.greaterThan(0)
      ? `, réduction de ${mru0(reduction)} incluse`
      : '';
    if (deja.plus(total).greaterThan(attendu.plus('0.01'))) {
      throw new BadRequestException(
        deja.greaterThan(0)
          ? `Le montant total dépasse le montant dû du mois (${mru0(attendu)}${avecReduction}).`
          : `Le montant dépasse le montant dû du mois (${mru0(attendu)}${avecReduction}).`,
      );
    }

    const result = await this.payments.record(
      {
        studentId: input.studentId,
        academicYearId: ctx.academic_year_id,
        calendarMonth: input.mois,
        calendarYear: input.annee,
        amount: toStorage(total),
        tender: lignes,
      },
      actorId,
    );

    // « Paiement enregistré » — `notifier_parent_de_etudiant(…, 'paiement', …)`.
    await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ guardian_id: string | null }>(
        'SELECT guardian_id FROM students WHERE id = $1',
        [input.studentId],
      );
      if (!rows[0]?.guardian_id) return;
      await this.notifications.notifier(tx, {
        guardianId: rows[0].guardian_id,
        studentId: input.studentId,
        academicYearId: ctx.academic_year_id,
        kind: 'info',
        souche: 'notif_paiement',
        params: {
          eleve: `${ctx.first_name} ${ctx.last_name}`.trim(),
          montant: `${MOIS_NOMS[input.mois]} ${input.annee}`,
        },
        route: 'profil',
      });
    });

    return {
      ...result,
      additionnel: deja.greaterThan(0),
      message: deja.greaterThan(0)
        ? 'Paiement additionnel enregistré.'
        : `Paiement enregistré ! Reçu : ${result.receiptNumber}`,
    };
  }

  /**
   * LA FENÊTRE D'ENCAISSEMENT QUI SUIT UNE (RÉ)INSCRIPTION —
   * `includes/encaissement_inscription.php`, `encaissement_fenetre()` : l'élève
   * (tarif de l'inscription de l'année cible), les mois payables de l'année,
   * et les frais annexes exigibles de la famille (barème, payé, reste,
   * exempté — dus une fois par famille et par année).
   *
   * École « services » (ADR-0073, §7) : pas de frais annuels par famille
   * (`annexes` vaut `{}`, FeesService le dit) ; à leur place, `services` — une
   * ligne par échéance de chaque abonnement de l'élève pour l'année, au montant
   * figé, avec son payé net, son reste et son état. Une école « famille » y lit
   * `[]`.
   */
  async fenetreInscription(studentId: string, academicYearId?: string) {
    const f = await this.construireFenetre(studentId, academicYearId);
    return {
      eleve: f.eleve,
      annee: f.annee,
      mois: f.mois,
      moisPayables: f.moisPayables,
      annexes: f.annexes,
      services: f.servicesInternes.map(ligneServicePublique),
    };
  }

  /**
   * La fenêtre, avec ce que l'encaissement doit savoir en plus : le modèle de
   * facturation de l'école et l'échéance réelle de chaque ligne de service.
   */
  private async construireFenetre(studentId: string, academicYearId?: string) {
    const facturationServices = await this.billing.isServices();
    const annees = await this.years.list();
    const annee = (academicYearId ? annees.find((a) => a.id === academicYearId) : annees.find((a) => a.status === 'active')) ?? null;
    if (!annee) {
      throw new BadRequestException("Aucune année scolaire n'est ouverte. Ouvrez-en une dans « Années scolaires ».");
    }
    const eleve = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        prenom: string;
        nom: string;
        matricule: string | null;
        parent_id: string | null;
        telephone_parent: string | null;
        frais_mensuel: string;
        niveau_nom: string | null;
        groupe_nom: string | null;
      }>(
        `SELECT s.id, s.first_name AS prenom, s.last_name AS nom, s.matricule, s.guardian_id AS parent_id,
                u.phone AS telephone_parent,
                COALESCE(e.monthly_fee, 0)::text AS frais_mensuel,
                l.name AS niveau_nom, g.name AS groupe_nom
           FROM students s
           LEFT JOIN users u ON u.id = s.guardian_id
           LEFT JOIN enrollments e ON e.student_id = s.id AND e.academic_year_id = $2 AND e.status <> 'cancelled'
           LEFT JOIN groups g ON g.id = e.group_id
           LEFT JOIN levels l ON l.id = g.level_id
          WHERE s.id = $1`,
        [studentId, annee.id],
      );
      return rows[0] ?? null;
    });
    if (!eleve) throw new NotFoundException('Élève introuvable.');

    // TOUS LES MOIS DE L'ANNÉE, chacun avec son état — dû, réduction, payé,
    // reste, exempté. L'agent coche ceux que la famille règle (décision du
    // propriétaire, 20/09) ; `moisPayables` reste la liste de ceux qu'on peut
    // encore encaisser.
    const mois = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        calendar_month: number; calendar_year: number; status: string; amount_due: string;
        discount: string; paid: string; exempt: boolean;
      }>(
        `SELECT m.calendar_month, m.calendar_year, m.status, m.amount_due::text,
                COALESCE(d.amount, 0)::text AS discount,
                COALESCE((SELECT SUM(p.amount) FROM payments p
                           WHERE p.student_id = s.id AND p.calendar_month = m.calendar_month
                             AND p.calendar_year = m.calendar_year), 0)::text AS paid,
                EXISTS (SELECT 1 FROM exemptions x WHERE x.student_id = s.id
                          AND (x.kind = 'full' OR (x.kind = 'monthly'
                               AND x.calendar_month = m.calendar_month AND x.calendar_year = m.calendar_year))) AS exempt
           FROM enrollment_months m
           JOIN enrollments e ON e.id = m.enrollment_id
           JOIN students s ON s.id = e.student_id
           LEFT JOIN discounts d ON d.student_id = s.id AND d.calendar_month = m.calendar_month AND d.calendar_year = m.calendar_year
          WHERE e.student_id = $1 AND e.academic_year_id = $2 AND e.status <> 'cancelled'
          ORDER BY m.month_order`,
        [studentId, annee.id],
      );
      return rows.map((r) => {
        const du = Decimal.max(0, money(r.amount_due).minus(money(r.discount)));
        const paye = money(r.paid);
        const reste = Decimal.max(0, du.minus(paye));
        const etat = r.exempt || r.status !== 'billable'
          ? 'exempte'
          : reste.lessThanOrEqualTo('0.005') ? 'paye' : paye.greaterThan('0.005') ? 'partiel' : 'du';
        return {
          mois: r.calendar_month,
          annee: r.calendar_year,
          libelle: `${MOIS_NOMS[r.calendar_month]} ${r.calendar_year}`,
          du: toStorage(du),
          paye: toStorage(paye),
          reste: toStorage(reste),
          etat,
        };
      });
    });
    const moisPayables = mois.filter((m) => m.etat === 'du' || m.etat === 'partiel').map(({ mois, annee, libelle }) => ({ mois, annee, libelle }));

    const annexes: Record<string, { libelle: string; bareme: string; paye: string; reste: string; exempte: boolean }> = {};
    if (eleve.parent_id) {
      const due = await this.fees.annualFeesDue(eleve.parent_id, annee.id, annee.start_year);
      for (const f of due) {
        annexes[f.kind === 'enrolment' ? 'inscription' : 'photocopie'] = {
          libelle: f.kind === 'enrolment' ? "Frais d'inscription" : libelleFraisPhotocopie(),
          bareme: toStorage(f.scale),
          paye: toStorage(f.paid),
          reste: toStorage(f.remaining),
          exempte: f.exempt,
        };
      }
    }
    // École « services » seulement : ses échéances de service. Une école
    // « famille » n'en a aucune et ne les lit pas.
    const servicesInternes = facturationServices
      ? await this.db.query((tx) => this.lignesServices(tx, studentId, annee.id))
      : [];
    return {
      eleve,
      annee: { id: annee.id, label: annee.label, start_year: annee.start_year },
      mois,
      moisPayables,
      annexes,
      facturationServices,
      servicesInternes,
    };
  }

  /**
   * LES ÉCHÉANCES DE SERVICE D'UN ÉLÈVE POUR UNE ANNÉE (§7), dans l'ordre de la
   * fenêtre (`comparerEcheancesService`) — qui est aussi l'ordre dans lequel le
   * reçu groupé découpe les moyens de paiement.
   *
   * Toutes les lignes de l'échéancier, échues ou non (la famille peut payer
   * d'avance), y compris celles d'un abonnement arrêté (les mois antérieurs à
   * l'arrêt restent dus ; les suivants n'existent plus). Rien pour une
   * inscription annulée, comme la scolarité. Payé = somme NETTE du grand livre
   * des services (annulations comprises). Un abonnement exempté : ses lignes
   * restent visibles, « exempte », reste 0 ; ce qui a été payé reste payé.
   */
  private async lignesServices(
    tx: Queryable,
    studentId: string,
    academicYearId: string,
  ): Promise<LigneServiceInterne[]> {
    const { rows } = await tx.query<{
      student_service_id: string;
      service: ServiceCode;
      exempt: boolean;
      calendar_month: number;
      calendar_year: number;
      amount_due: string;
      paid: string;
    }>(
      `SELECT ss.id AS student_service_id, ss.service, ss.exempt,
              m.calendar_month, m.calendar_year, m.amount_due::text AS amount_due,
              COALESCE((SELECT SUM(p.amount) FROM service_payments p
                         WHERE p.student_service_id = m.student_service_id
                           AND p.calendar_month = m.calendar_month
                           AND p.calendar_year = m.calendar_year), 0)::text AS paid
         FROM student_services ss
         JOIN student_service_months m ON m.student_service_id = ss.id
        WHERE ss.student_id = $1 AND ss.academic_year_id = $2
          AND EXISTS (SELECT 1 FROM enrollments e
                       WHERE e.student_id = ss.student_id
                         AND e.academic_year_id = ss.academic_year_id
                         AND e.status <> 'cancelled')`,
      [studentId, academicYearId],
    );
    return rows
      .map((r): LigneServiceInterne => {
        const def = definitionService(r.service);
        const annuel = def.periodicite === 'annuel';
        const du = money(r.amount_due);
        const paye = money(r.paid);
        const reste = r.exempt ? new Decimal(0) : Decimal.max(0, du.minus(paye));
        const etat = r.exempt
          ? 'exempte'
          : reste.lessThanOrEqualTo('0.005') ? 'paye' : paye.greaterThan('0.005') ? 'partiel' : 'du';
        return {
          studentServiceId: r.student_service_id,
          service: r.service,
          label: libelleService(r.service),
          periodicite: def.periodicite,
          mois: annuel ? null : r.calendar_month,
          annee: annuel ? null : r.calendar_year,
          libelleMois: annuel ? null : `${MOIS_NOMS[r.calendar_month]} ${r.calendar_year}`,
          du: toStorage(du),
          paye: toStorage(paye),
          reste: toStorage(reste),
          etat,
          echeance: { month: r.calendar_month, year: r.calendar_year },
          exempt: r.exempt,
        };
      })
      .sort(
        (a, b) =>
          comparerEcheancesService(
            { service: a.service, month: a.echeance.month, year: a.echeance.year },
            { service: b.service, month: b.echeance.month, year: b.echeance.year },
          ) || a.studentServiceId.localeCompare(b.studentServiceId),
      );
  }

  /**
   * UN SEUL REÇU POUR PLUSIEURS MOIS ET LES FRAIS ANNUELS — décision du
   * propriétaire (2026-09-20) : à l'inscription, à la réinscription et à la
   * caisse, l'agent coche les mois de l'année affichée et les frais que la
   * famille règle, encaisse, et remet UN reçu (« it makes no sense to issue
   * multiple receipts for paying October and June »).
   *
   * Le grand livre garde sa forme : un mois = une ligne de `payments` (la
   * dette, les rapports et les annulations reposent dessus), un frais = une
   * ligne de `family_fee_payments`. Le reçu (`receipts`, 0040) les réunit
   * sous UN numéro, tiré de la même séquence ; chaque ligne le désigne et
   * reprend son numéro. Les moyens sont ventilés ligne par ligne, dans
   * l'ordre — chaque ligne sait comment SON argent est arrivé, avec la
   * référence de l'application de paiement.
   *
   * Chaque mois coché se règle EN ENTIER (son reste dû) ; un règlement partiel
   * passe par la carte du mois, comme avant. Chaque frais coché aussi.
   *
   * ÉCOLE « SERVICES » (ADR-0073, §5 et §7) : les échéances de service cochées
   * (`services`) entrent sur le MÊME reçu — même verrou, même numéro, même
   * règle « moyens = total au centime » — chacune pour son reste entier, dans
   * SON grand livre (`service_payments`), jamais dans `payments` (une cantine y
   * marquerait la scolarité réglée). Ses moyens portent le `source_type` du
   * service. Ordre d'allocation des moyens : les mois, les frais famille, puis
   * les services dans l'ordre de la fenêtre. Payer un service « séparément »,
   * c'est un reçu d'une seule ligne.
   */
  async encaisserGroupe(
    input: {
      studentId: string;
      academicYearId?: string;
      mois: { mois: number; annee: number }[];
      fraisInscription?: boolean;
      fraisPhotocopie?: boolean;
      /** École « services » : les échéances cochées. Un service annuel se désigne sans mois. */
      services?: { studentServiceId: string; mois?: number; annee?: number }[];
      tender: TenderLine[];
    },
    actorId: string,
  ): Promise<ResultatEncaissementGroupe> {
    const { schoolId } = currentTenant();
    const fen = await this.construireFenetre(input.studentId, input.academicYearId);
    await this.years.assertWritable(fen.annee.id);
    if (!fen.eleve.parent_id) {
      throw new BadRequestException('Cet élève n’a pas de correspondant : rien ne peut être encaissé à son nom.');
    }
    const demandes = input.services ?? [];
    // Une école « famille » n'a pas de services : en recevoir un est une erreur
    // de l'appelant, et le taire le ferait croire encaissé.
    if (!fen.facturationServices && demandes.length > 0) {
      throw new BadRequestException(FAMILLE_REFUS);
    }

    // Les mois cochés, dans l'ordre de l'année, chacun pour son reste dû.
    const cles = new Set(input.mois.map((m) => `${m.annee}-${m.mois}`));
    const moisChoisis = fen.mois.filter((m) => cles.has(`${m.annee}-${m.mois}`));
    if (moisChoisis.length !== cles.size) {
      throw new BadRequestException(`Choisissez des mois de l'année scolaire ${fen.annee.label}.`);
    }
    const nonEncaissable = moisChoisis.find((m) => m.etat === 'exempte' || m.etat === 'paye');
    if (nonEncaissable) {
      throw new BadRequestException(
        nonEncaissable.etat === 'paye'
          ? `${nonEncaissable.libelle} est déjà réglé.`
          : `${nonEncaissable.libelle} est exempté pour cet élève : aucun paiement requis.`,
      );
    }

    const frais: { kind: AnnualFeeKind; montant: Decimal; libelle: string }[] = [];
    for (const [type, voulu] of [['inscription', input.fraisInscription], ['photocopie', input.fraisPhotocopie]] as const) {
      if (!voulu) continue;
      // École « services » : ces frais sont des services de l'élève (§3).
      if (fen.facturationServices) throw new BadRequestException(FRAIS_FAMILLE_ABSENTS);
      const f = fen.annexes[type];
      if (!f) throw new BadRequestException("Le montant de ces frais n'est pas défini pour cette année. Renseignez-le d'abord dans « Frais annuels ».");
      if (f.exempte) throw new BadRequestException(`${f.libelle} : la famille en est exemptée pour ${fen.annee.label}.`);
      const reste = money(f.reste);
      if (reste.lessThanOrEqualTo('0.005')) throw new BadRequestException(`${f.libelle} : déjà réglés pour ${fen.annee.label}.`);
      frais.push({ kind: type === 'inscription' ? 'enrolment' : 'photocopy', montant: reste, libelle: f.libelle });
    }

    // Les échéances de service cochées, dans l'ordre de la fenêtre, chacune pour
    // son reste entier. Une ligne se désigne par son abonnement, et par son mois
    // pour un service mensuel ; tout ce qui n'est pas une ligne de CET élève
    // pour CETTE année est refusé — l'abonnement d'un frère compris.
    const clesServices = new Set<string>();
    for (const d of demandes) {
      const siennes = fen.servicesInternes.filter((l) => l.studentServiceId === d.studentServiceId);
      const premiere = siennes[0];
      if (!premiere) {
        throw new BadRequestException(`Cette ligne n'est pas un service de cet élève pour ${fen.annee.label}.`);
      }
      if (premiere.periodicite === 'annuel') {
        clesServices.add(cleService(premiere));
        continue;
      }
      if (d.mois === undefined || d.annee === undefined) {
        throw new BadRequestException(`${premiere.label} : indiquez le mois à encaisser.`);
      }
      const ligne = siennes.find((l) => l.echeance.month === d.mois && l.echeance.year === d.annee);
      if (!ligne) {
        throw new BadRequestException(
          `${premiere.label} : ${MOIS_NOMS[d.mois] ?? d.mois} ${d.annee} n'est pas un mois de cet abonnement.`,
        );
      }
      clesServices.add(cleService(ligne));
    }
    const servicesChoisis = fen.servicesInternes.filter((l) => clesServices.has(cleService(l)));
    const serviceNonEncaissable = servicesChoisis.find((l) => l.etat === 'exempte' || l.etat === 'paye');
    if (serviceNonEncaissable) {
      throw new BadRequestException(
        serviceNonEncaissable.etat === 'paye'
          ? `« ${nomLigne(serviceNonEncaissable)} » est déjà réglé.`
          : `« ${nomLigne(serviceNonEncaissable)} » : cet élève en est exempté, aucun paiement requis.`,
      );
    }

    if (moisChoisis.length === 0 && frais.length === 0 && servicesChoisis.length === 0) {
      throw new BadRequestException(
        fen.facturationServices
          ? 'Cochez au moins un mois ou un service à encaisser.'
          : 'Cochez au moins un mois ou un frais à encaisser.',
      );
    }
    const total = moisChoisis.reduce((a, m) => a.plus(money(m.reste)), new Decimal(0))
      .plus(frais.reduce((a, f) => a.plus(f.montant), new Decimal(0)))
      .plus(servicesChoisis.reduce((a, l) => a.plus(money(l.reste)), new Decimal(0)));

    const lignes = input.tender.filter((l) => money(l.amount).greaterThan(0));
    if (lignes.length === 0) {
      throw new BadRequestException('Veuillez indiquer au moins un moyen de paiement avec un montant.');
    }
    const encaisse = lignes.reduce((a, l) => a.plus(money(l.amount)), new Decimal(0));
    // Au centime : chaque ligne reçoit exactement son reste, et le grand livre
    // des moyens exige l'égalité — un centime de trop n'irait nulle part.
    if (!encaisse.equals(total)) {
      throw new BadRequestException(
        `La somme des moyens de paiement (${toStorage(encaisse)}) doit égaler le total coché (${toStorage(total)}).`,
      );
    }

    const school = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ receipt_prefix: string }>('SELECT receipt_prefix FROM schools WHERE id = $1', [schoolId]);
      return rows[0]!;
    });
    // L'ordre d'allocation (§7) : les mois, les frais famille, puis les services.
    const parts = allocate(lignes, [
      ...moisChoisis.map((m) => money(m.reste)),
      ...frais.map((f) => f.montant),
      ...servicesChoisis.map((l) => money(l.reste)),
    ]);
    const eleveNom = `${fen.eleve.prenom} ${fen.eleve.nom}`.trim();

    return this.db.query(async (tx) => {
      // ⚠ SÉRIALISER LA FAMILLE (comme payGlobal) : deux guichets, ou deux
      // onglets, qui voient tous deux « octobre dû » et encaissent tous deux
      // écriraient deux paiements d'octobre. Sous le verrou, l'état est relu.
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `family-payment:${fen.eleve.parent_id}:${fen.annee.id}`,
      ]);
      for (const m of moisChoisis) {
        const { rows } = await tx.query<{ paye: string }>(
          `SELECT COALESCE(SUM(amount), 0)::text AS paye FROM payments
            WHERE student_id = $1 AND calendar_month = $2 AND calendar_year = $3`,
          [input.studentId, m.mois, m.annee],
        );
        if (!money(rows[0]!.paye).equals(money(m.paye))) {
          throw new ConflictException(`${m.libelle} vient d'être encaissé par ailleurs : rechargez la page.`);
        }
      }
      for (const f of frais) {
        const { rows } = await tx.query<{ paye: string }>(
          `SELECT COALESCE(SUM(amount), 0)::text AS paye FROM family_fee_payments
            WHERE guardian_id = $1 AND academic_year_id = $2 AND kind = $3`,
          [fen.eleve.parent_id, fen.annee.id, f.kind],
        );
        const attendu = fen.annexes[f.kind === 'enrolment' ? 'inscription' : 'photocopie']!;
        if (!money(rows[0]!.paye).equals(money(attendu.paye))) {
          throw new ConflictException(`${f.libelle} viennent d'être encaissés par ailleurs : rechargez la page.`);
        }
      }
      // Les services, relus sous le même verrou — celui que prennent aussi
      // l'arrêt et l'exemption d'un abonnement : l'échéance doit encore
      // exister, ne pas être devenue exemptée, et n'avoir rien reçu entre-temps.
      for (const l of servicesChoisis) {
        const { rows } = await tx.query<{ paye: string; exempt: boolean; du: string }>(
          `SELECT COALESCE((SELECT SUM(p.amount) FROM service_payments p
                             WHERE p.student_service_id = m.student_service_id
                               AND p.calendar_month = m.calendar_month
                               AND p.calendar_year = m.calendar_year), 0)::text AS paye,
                  ss.exempt, m.amount_due::text AS du
             FROM student_service_months m
             JOIN student_services ss ON ss.id = m.student_service_id
            WHERE m.student_service_id = $1 AND m.calendar_month = $2 AND m.calendar_year = $3`,
          [l.studentServiceId, l.echeance.month, l.echeance.year],
        );
        const relu = rows[0];
        // ⚠ ET SON MONTANT : une remise posée pendant que la fenêtre était
        // ouverte (ADR-0079) ferait encaisser l'ancien prix — un trop-perçu.
        if (
          !relu ||
          relu.exempt !== l.exempt ||
          !money(relu.paye).equals(money(l.paye)) ||
          !money(relu.du).equals(money(l.du))
        ) {
          throw new ConflictException(
            `« ${nomLigne(l)} » vient de changer (encaissé, exempté, remisé ou arrêté par ailleurs) : rechargez la page.`,
          );
        }
      }

      const receiptNumber = await this.nextReceipt(tx, fen.annee.start_year, school.receipt_prefix);
      const { rows: recu } = await tx.query<{ id: string; paid_at: Date }>(
        `INSERT INTO receipts (school_id, academic_year_id, guardian_id, receipt_number, amount, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, paid_at`,
        [schoolId, fen.annee.id, fen.eleve.parent_id, receiptNumber, toStorage(total), actorId],
      );
      const receiptId = recu[0]!.id;
      const paidAt = recu[0]!.paid_at;
      const detail: string[] = [];
      const paymentIds: string[] = [];

      let i = 0;
      for (const m of moisChoisis) {
        const montant = money(m.reste);
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO payments
             (school_id, student_id, academic_year_id, calendar_month, calendar_year,
              amount, receipt_number, recorded_by, receipt_id, paid_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [schoolId, input.studentId, fen.annee.id, m.mois, m.annee, toStorage(montant), receiptNumber, actorId, receiptId, paidAt],
        );
        paymentIds.push(rows[0]!.id);
        await this.tender.post(tx, { sourceType: 'paiement', sourceId: rows[0]!.id, direction: 'in', total: toStorage(montant), lines: parts[i++]!, at: paidAt });
        detail.push(m.libelle);
      }
      for (const f of frais) {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO family_fee_payments
             (school_id, guardian_id, academic_year_id, kind, amount, receipt_number, recorded_by, receipt_id, paid_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [schoolId, fen.eleve.parent_id, fen.annee.id, f.kind, toStorage(f.montant), receiptNumber, actorId, receiptId, paidAt],
        );
        await this.tender.post(tx, { sourceType: 'frais_annuel', sourceId: rows[0]!.id, direction: 'in', total: toStorage(f.montant), lines: parts[i++]!, at: paidAt });
        detail.push(f.libelle);
      }
      // Les services : leur grand livre, leur `source_type` (les revenus par
      // service de « Revenue Live → Par origine » en viennent sans jointure).
      const servicePaymentIds: string[] = [];
      for (const l of servicesChoisis) {
        const montant = money(l.reste);
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO service_payments
             (school_id, student_service_id, student_id, academic_year_id, calendar_month, calendar_year,
              amount, receipt_number, recorded_by, receipt_id, paid_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [
            schoolId, l.studentServiceId, input.studentId, fen.annee.id, l.echeance.month, l.echeance.year,
            toStorage(montant), receiptNumber, actorId, receiptId, paidAt,
          ],
        );
        servicePaymentIds.push(rows[0]!.id);
        await this.tender.post(tx, {
          sourceType: sourceTypeService(l.service),
          sourceId: rows[0]!.id,
          direction: 'in',
          total: toStorage(montant),
          lines: parts[i++]!,
          at: paidAt,
        });
        detail.push(l.libelleMois ? `${l.label} (${l.libelleMois})` : l.label);
      }

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'receipt_group_recorded',
          entity: 'receipt',
          entityId: receiptId,
          after: { receiptNumber, amount: toStorage(total), studentId: input.studentId, lines: detail },
        },
        tx,
      );
      // « Paiement enregistré » — une notification pour le tout, avec ce qu'il couvre.
      await this.notifications.notifier(tx, {
        guardianId: fen.eleve.parent_id!,
        studentId: input.studentId,
        academicYearId: fen.annee.id,
        kind: 'info',
        souche: 'notif_paiement',
        params: { eleve: eleveNom, montant: detail.join(', ') },
        route: 'profil',
      });

      const resultat: ResultatEncaissementGroupe = {
        ok: true,
        receiptId,
        receiptNumber,
        academicYearId: fen.annee.id,
        guardianId: fen.eleve.parent_id!,
        paymentIds,
        total: toStorage(total),
        message: `Encaissement enregistré — reçu ${receiptNumber} (${detail.join(' · ')}).`,
      };
      // Une école « famille » reçoit la réponse d'aujourd'hui, clé pour clé.
      return fen.facturationServices ? { ...resultat, servicePaymentIds } : resultat;
    });
  }

  /**
   * ENCAISSER CE QUE LA FENÊTRE A COLLECTÉ — son `encaissement_encaisser()` :
   * le widget renvoie UN total qui couvre plusieurs créances ; les frais
   * annexes d'abord (bornés par le reste dû, puis par l'encaissé), le solde va
   * au mois — et ne peut pas dépasser le mois dû. Ses refus, mot pour mot.
   */
  async encaisserInscription(
    input: {
      studentId: string;
      periode: string;
      fraisInscription?: string;
      fraisPhotocopie?: string;
      tender: TenderLine[];
    },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    // École « services » : un total unique ne sait pas se répartir sur des
    // services, et ses frais annexes par famille n'existent pas (§3, §5).
    if (await this.billing.isServices()) throw new BadRequestException(ANCIENNE_FENETRE_SERVICES);
    const fen = await this.fenetreInscription(input.studentId);
    const m = /^(\d{4})-(\d{1,2})$/.exec(input.periode);
    const annee = m ? Number(m[1]) : 0;
    const mois = m ? Number(m[2]) : 0;
    // Sans mois choisi, l'encaissement ne porte que sur les frais annexes
    // (décision du propriétaire, 2026-09-17 : le mois se diffère).
    const moisChoisi = m !== null;
    if (moisChoisi && !fen.moisPayables.some((x) => x.mois === mois && x.annee === annee)) {
      throw new BadRequestException(`Choisissez un mois de l'année scolaire ${fen.annee.label}.`);
    }
    await this.years.assertWritable(fen.annee.id);

    const lignes = input.tender.filter((l) => money(l.amount).greaterThan(0));
    if (lignes.length === 0) {
      throw new BadRequestException('Veuillez indiquer au moins un moyen de paiement avec un montant.');
    }
    const encaisse = lignes.reduce((a, l) => a.plus(money(l.amount)), new Decimal(0));
    const fraisMois = money(fen.eleve.frais_mensuel);

    // La part des frais annexes : demandée, bornée par le reste réellement dû.
    const demande: { kind: AnnualFeeKind; montant: Decimal; libelle: string }[] = [];
    let partAnnexes = new Decimal(0);
    for (const [type, brut] of [['inscription', input.fraisInscription], ['photocopie', input.fraisPhotocopie]] as const) {
      if (!brut) continue;
      const f = fen.annexes[type];
      if (!f) continue;
      let v = money(brut);
      const reste = money(f.reste);
      if (v.lessThanOrEqualTo('0.005') || reste.lessThanOrEqualTo('0.005')) continue;
      if (v.greaterThan(reste)) v = reste;
      demande.push({ kind: type === 'inscription' ? 'enrolment' : 'photocopy', montant: v, libelle: f.libelle });
      partAnnexes = partAnnexes.plus(v);
    }
    const partMois = encaisse.minus(partAnnexes);
    if (partMois.lessThan('-0.005')) {
      throw new BadRequestException(
        `Le total encaissé (${mru0(encaisse)}) est inférieur aux frais annexes saisis (${mru0(partAnnexes)}).`,
      );
    }
    if (partMois.greaterThan(fraisMois.plus('0.005'))) {
      throw new BadRequestException(
        `Le montant imputé à la scolarité (${mru0(partMois)}) dépasse le mois dû (${mru0(fraisMois)}).`,
      );
    }
    if (partMois.greaterThan('0.005') && !moisChoisi) {
      throw new BadRequestException(
        `Choisissez le mois de scolarité à encaisser, ou ramenez le total aux frais annexes (${mru0(partAnnexes)}).`,
      );
    }

    // Les moyens sont ventilés dans l'ordre : le mois d'abord, puis chaque
    // frais annexe — chez lui toutes les lignes vont au mois et les frais
    // annexes n'en portent aucune.
    // ⚠ La référence du reçu de l'application de paiement voyage avec chaque
    // part : la perdre ici, c'est un reçu imprimé sans elle (« isn't shown on
    // any receipt at all »).
    const restantes = lignes.map((l) => ({ paymentMethodId: l.paymentMethodId, amount: money(l.amount), reference: l.reference ?? null }));
    const prendre = (montant: Decimal): TenderLine[] => {
      const out: TenderLine[] = [];
      let reste = montant;
      for (const l of restantes) {
        if (reste.lessThanOrEqualTo(0)) break;
        if (l.amount.lessThanOrEqualTo(0)) continue;
        const part = Decimal.min(l.amount, reste);
        out.push({ paymentMethodId: l.paymentMethodId, amount: toStorage(part), reference: l.reference });
        l.amount = l.amount.minus(part);
        reste = reste.minus(part);
      }
      return out;
    };

    const detail: string[] = [];
    let paiementId: string | null = null;
    if (partMois.greaterThan('0.005')) {
      const r = await this.payments.record(
        {
          studentId: input.studentId,
          academicYearId: fen.annee.id,
          calendarMonth: mois,
          calendarYear: annee,
          amount: toStorage(partMois),
          tender: prendre(partMois),
        },
        actorId,
      );
      paiementId = r.id;
      detail.push(`Scolarité : ${mru0(partMois)}`);
    }
    for (const d of demande) {
      if (!fen.eleve.parent_id) break;
      await this.payerFraisAnnuel(
        { guardianId: fen.eleve.parent_id, academicYearId: fen.annee.id, kind: d.kind, montant: toStorage(d.montant), tender: prendre(d.montant) },
        actorId,
      );
      detail.push(`${d.libelle} : ${mru0(d.montant)}`);
    }

    if (fen.eleve.parent_id) {
      await this.db.query(async (tx) => {
        await this.notifications.notifier(tx, {
          guardianId: fen.eleve.parent_id!,
          studentId: input.studentId,
          academicYearId: fen.annee.id,
          kind: 'info',
          souche: 'notif_paiement',
          params: { eleve: `${fen.eleve.prenom} ${fen.eleve.nom}`, montant: detail.join(' · ') },
          route: 'profil',
        });
      });
    }
    void schoolId;
    return { ok: true, message: `Encaissement enregistré — ${detail.join(' · ')}.`, paiementId, detail: detail.join(' · ') };
  }

  /**
   * PAYER UN FRAIS ANNUEL — `gestion_caisse.php`, action `payer_frais_annuel`,
   * dans son ordre : année clôturée ; exempté ; barème non défini ; montant
   * saisi > reste dû ; lignes de moyens égales au montant.
   */
  async payerFraisAnnuel(
    input: {
      guardianId: string;
      academicYearId: string;
      kind: AnnualFeeKind;
      montant: string;
      tender: TenderLine[];
    },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    // École « services » : pas de frais annuels PAR FAMILLE (§3). Dit en clair
    // plutôt que le « Données invalides. » qu'un barème vide produirait plus bas.
    if (await this.billing.isServices()) throw new BadRequestException(FRAIS_FAMILLE_ABSENTS);
    const year = await this.years.byId(input.academicYearId);
    const montant = money(input.montant);
    if (montant.lessThanOrEqualTo(0)) throw new BadRequestException('Données invalides.');

    if (year.status === 'closed') {
      throw new BadRequestException(
        `L'année ${year.start_year}-${year.start_year + 1} est clôturée : aucun encaissement ` +
          "ne peut plus y être imputé.",
      );
    }
    const due = await this.fees.annualFeesDue(input.guardianId, input.academicYearId, year.start_year);
    const fee = due.find((f) => f.kind === input.kind);
    if (!fee) throw new BadRequestException('Données invalides.');
    if (fee.exempt) throw new BadRequestException('Ce correspondant est exempté de ces frais.');
    if (fee.scale.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        "Le montant de ces frais n'est pas défini pour cette année. Renseignez-le d'abord " +
          'dans « Frais annuels ».',
      );
    }
    if (montant.greaterThan(fee.remaining.plus('0.01'))) {
      throw new BadRequestException(
        `Le montant saisi (${mru0(montant)}) dépasse le reste dû (${mru0(fee.remaining)}).`,
      );
    }
    // `lire_lignes_paiement(true, $montant)`.
    const lignes = input.tender.filter((l) => money(l.amount).greaterThan(0));
    if (lignes.length === 0) {
      throw new BadRequestException(
        'Veuillez indiquer au moins un moyen de paiement avec un montant.',
      );
    }
    const total = lignes.reduce((a, l) => a.plus(money(l.amount)), new Decimal(0));
    if (total.minus(montant).abs().greaterThan('0.01')) {
      throw new BadRequestException(
        `La somme des moyens de paiement (${mru0(total)}) doit égaler le montant dû (${mru0(montant)}).`,
      );
    }

    const school = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ receipt_prefix: string }>(
        'SELECT receipt_prefix FROM schools WHERE id = $1',
        [schoolId],
      );
      return rows[0]!;
    });

    return this.db.query(async (tx) => {
      const number = await this.nextReceipt(tx, year.start_year, `${school.receipt_prefix}-A`);
      const { rows } = await tx.query<{ id: string; paid_at: Date }>(
        `INSERT INTO family_fee_payments
           (school_id, guardian_id, academic_year_id, kind, amount, receipt_number, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, paid_at`,
        [schoolId, input.guardianId, input.academicYearId, input.kind, toStorage(montant), number, actorId],
      );
      await this.tender.post(tx, {
        sourceType: 'frais_annuel',
        sourceId: rows[0]!.id,
        direction: 'in',
        total: toStorage(montant),
        lines: lignes,
        at: rows[0]!.paid_at,
      });
      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'annual_fee_paid',
          entity: 'family_fee_payment',
          entityId: rows[0]!.id,
          after: { kind: input.kind, amount: toStorage(montant), receiptNumber: number },
        },
        tx,
      );
      return {
        id: rows[0]!.id,
        receiptNumber: number,
        message: `Paiement des frais annuels enregistré ! Reçu : ${number}`,
      };
    });
  }

  /**
   * ENCAISSER UN RÈGLEMENT / AVANCE — `gestion_caisse.php`, `paiement_global`.
   *
   * A family hands over a lump sum without naming a month or a child. The till
   * spreads it, in El Ourwa's order:
   *
   *   1. THE DEBT — elapsed, owed, unpaid months, oldest first.
   *   2. THEN FORWARD — the remaining months of the year, as an advance.
   *
   * ⚠ ONLY THE MONTHS OF THE YEAR BEING PAID FOR. This is El Ourwa's own fix and
   * its comment is worth keeping whole: before it, the query took "TOUS les mois
   * de TOUTES les annees, de 2023 a 2028", so an overpayment "pouvait donc etre
   * impute a un mois d'une annee cloturee, ou d'une annee ou l'eleve n'est pas
   * inscrit". Money landing in a closed year is money that cannot be reported on.
   *
   * ⚠ IT SKIPS WHAT IS NOT OWED: a child whose schooling is free, a child
   * exempted outright, a month exempted on its own, and it deducts a discount
   * before deciding what a month is short. Putting money on any of those turns a
   * concession into a payment and the family into a creditor.
   *
   * ⚠ APPEND-ONLY, unlike the original. El Ourwa does
   * `UPDATE paiements SET montant = montant + …` on a month that already has a
   * payment. Standing rule 7 forbids that, and there is no unique key here
   * forcing it: a second instalment on a month is a second row, so the ledger
   * still says who paid what and when.
   */
  async payGlobal(
    input: {
      guardianId: string;
      academicYearId: string;
      tender: TenderLine[];
      paperReference?: string;
    },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    const year = await this.years.assertWritable(input.academicYearId);

    if (input.tender.length === 0) {
      throw new BadRequestException(
        'Indiquez comment la somme est arrivée : au moins un moyen de paiement.',
      );
    }
    const taken = sum(input.tender.map((t) => t.amount));
    if (taken.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Le montant encaissé doit être positif.');
    }

    const school = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ receipt_prefix: string; currency: string }>(
        'SELECT receipt_prefix, currency FROM schools WHERE id = $1',
        [schoolId],
      );
      return rows[0]!;
    });

    return this.db.query(async (tx) => {
      /**
       * ⚠ SERIALISE THE FAMILY. Two clerks taking money from the same family at
       * once would both read the same set of short months and both fill them,
       * doubling every allocation.
       */
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `family-payment:${input.guardianId}:${input.academicYearId}`,
      ]);

      // What each month of each child is short, in order. One query: the debt
      // and the advance are the same question asked of different months.
      const { rows: months } = await tx.query<{
        student_id: string;
        calendar_month: number;
        calendar_year: number;
        due: string;
        paid: string;
      }>(
        `SELECT s.id AS student_id, m.calendar_month, m.calendar_year,
                GREATEST(0, m.amount_due - COALESCE(d.amount, 0))::text AS due,
                COALESCE(p.total, 0)::text AS paid
           FROM enrollment_months m
           JOIN enrollments e ON e.id = m.enrollment_id
           JOIN students s ON s.id = e.student_id
           LEFT JOIN discounts d
             ON d.student_id = s.id AND d.calendar_month = m.calendar_month
            AND d.calendar_year = m.calendar_year
           LEFT JOIN (
             SELECT student_id, calendar_month, calendar_year, SUM(amount) AS total
               FROM payments GROUP BY student_id, calendar_month, calendar_year
           ) p ON p.student_id = s.id AND p.calendar_month = m.calendar_month
              AND p.calendar_year = m.calendar_year
          WHERE s.guardian_id = $1
            AND e.academic_year_id = $2
            AND e.status <> 'cancelled'
            AND e.is_free = false
            AND m.status = 'billable'
            -- Exempted outright, or this month named.
            AND NOT EXISTS (
              SELECT 1 FROM exemptions x
               WHERE x.student_id = s.id
                 AND (x.kind = 'full'
                      OR (x.kind = 'monthly'
                          AND x.calendar_month = m.calendar_month
                          AND x.calendar_year = m.calendar_year))
            )
          ORDER BY m.calendar_year, m.calendar_month, s.last_name, s.first_name`,
        [input.guardianId, input.academicYearId],
      );

      // What is still short, month by month, in the order money should fill it.
      const shortfalls = months
        .map((r) => ({
          studentId: r.student_id,
          month: r.calendar_month,
          year: r.calendar_year,
          short: Decimal.max(0, money(r.due).minus(money(r.paid))),
        }))
        .filter((r) => r.short.greaterThan(0.005));

      const capacity = shortfalls.reduce((acc, r) => acc.plus(r.short), new Decimal(0));

      if (capacity.lessThanOrEqualTo(0)) {
        /*
         * ⚠ « RIEN À RÉGLER » À CÔTÉ D'UNE DETTE AFFICHÉE EST UNE IMPASSE.
         *
         * Ce règlement global répartit sur les MOIS, et seulement sur eux —
         * comme le sien : ses frais annuels ont leur propre commande,
         * « Paiement frais annuels », et chaque frais son bouton « Encaisser »
         * sur la fiche. C'est correct.
         *
         * Mais une famille dont toute la dette est en frais annuels voyait
         * « Dette : 6 500 MRU » en haut et « n'a rien à régler » au clic, sans
         * rien qui dise où aller. Le refus nomme donc ce qui reste dû et par où
         * cela se règle.
         */
        const { rows: reste } = await tx.query<{ n: string }>(
          `SELECT count(*)::text AS n
             FROM enrollments e
             JOIN students s ON s.id = e.student_id
            WHERE s.guardian_id = $1 AND e.academic_year_id = $2
              AND e.status <> 'cancelled'`,
          [input.guardianId, input.academicYearId],
        );
        throw new BadRequestException(
          Number(reste[0]!.n) > 0
            ? `Aucun mois de ${year.label} ne reste à régler pour cette famille. ` +
              'Des frais annuels peuvent rester dus : ils s’encaissent depuis ' +
              '« Frais annuels », chacun par son propre bouton.'
            : `Cette famille n'a rien à régler pour ${year.label}.`,
        );
      }

      /**
       * ⚠ REFUSED RATHER THAN PARTLY RECORDED. El Ourwa stops allocating when it
       * runs out of months, and whatever is left over is never written anywhere:
       * the family paid more than the school recorded. Naming the figure is the
       * only honest answer — the operator can then take the right amount, or the
       * direction can decide what the excess is. See docs/DECISIONS.md.
       */
      if (taken.greaterThan(capacity.plus(0.01))) {
        throw new BadRequestException(
          `Le montant dépasse ce que cette famille peut devoir pour ${year.label} ` +
            `(${fr(capacity)} ${school.currency}).`,
        );
      }

      let remaining = taken;
      let lines = input.tender.map((l) => ({ ...l }));
      const paymentIds: string[] = [];
      let allocated = new Decimal(0);

      for (const slot of shortfalls) {
        if (remaining.lessThanOrEqualTo(0.005)) break;
        const amount = Decimal.min(remaining, slot.short);

        const receiptNumber = await this.nextReceipt(
          tx,
          year.start_year,
          school.receipt_prefix,
        );
        const { rows } = await tx.query<{ id: string; paid_at: Date }>(
          `INSERT INTO payments
             (school_id, student_id, academic_year_id, calendar_month, calendar_year,
              amount, receipt_number, paper_reference, recorded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, paid_at`,
          [
            schoolId, slot.studentId, input.academicYearId, slot.month, slot.year,
            toStorage(amount), receiptNumber, input.paperReference ?? null, actorId,
          ],
        );
        const paymentId = rows[0]!.id;
        paymentIds.push(paymentId);

        // The means are drawn down in order, so each receipt records how ITS
        // share of the money actually arrived.
        const [mine, rest] = take(lines, amount);
        lines = rest;
        await this.tender.post(tx, {
          sourceType: 'paiement',
          sourceId: paymentId,
          direction: 'in',
          total: toStorage(amount),
          lines: mine,
          at: rows[0]!.paid_at,
        });

        remaining = remaining.minus(amount);
        allocated = allocated.plus(amount);
      }

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'global_payment_recorded',
          entity: 'user',
          entityId: input.guardianId,
          after: {
            allocated: toStorage(allocated),
            months: String(paymentIds.length),
            year: year.label,
          },
        },
        tx,
      );

      return {
        paymentIds,
        allocated: toStorage(allocated),
        months: paymentIds.length,
        currency: school.currency,
        message:
          `Paiement global de ${fr(allocated)} ${school.currency} ` +
          `enregistré et distribué sur ${paymentIds.length} mois.`,
      };
    });
  }

  /**
   * The next receipt number, inside the caller's transaction.
   *
   * ⚠ `UPDATE … RETURNING`, never `MAX() + 1` — two collections reading the same
   * maximum hand two families the same number, and a family holds the paper.
   * Duplicated from PaymentsService rather than exported from it, because the
   * sequence must advance in THIS transaction and a shared helper that opened
   * its own would hand out a number that survives a rollback.
   */
  private async nextReceipt(tx: Queryable, year: number, prefix: string): Promise<string> {
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
}

/** El Ourwa's number formatting: thin spaces, no decimals on whole amounts. */
/** Son `number_format($x, 0, ',', ' ') . ' MRU'`. */
function mru0(value: Decimal): string {
  return `${value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} MRU`;
}

const MOIS_NOMS = [
  '', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

/**
 * La clé d'une échéance de service cochée : l'abonnement seul pour un service
 * annuel (une échéance), l'abonnement et le mois pour un service mensuel.
 */
function cleService(l: LigneServiceInterne): string {
  return l.periodicite === 'annuel'
    ? l.studentServiceId
    : `${l.studentServiceId}:${l.echeance.year}-${l.echeance.month}`;
}

/** « Cantine — déjeuner, Octobre 2025 » ; « Frais d'inscription ». */
function nomLigne(l: LigneServiceFenetre): string {
  return l.libelleMois ? `${l.label}, ${l.libelleMois}` : l.label;
}

/** Ce que l'écran reçoit d'une ligne de service : sans l'échéance interne. */
function ligneServicePublique(l: LigneServiceInterne): LigneServiceFenetre {
  return {
    studentServiceId: l.studentServiceId,
    service: l.service,
    label: l.label,
    periodicite: l.periodicite,
    mois: l.mois,
    annee: l.annee,
    libelleMois: l.libelleMois,
    du: l.du,
    paye: l.paye,
    reste: l.reste,
    etat: l.etat,
  };
}

function fr(value: Decimal): string {
  const rounded = value.toDecimalPlaces(2);
  const whole = rounded.isInteger();
  const text = whole ? rounded.toFixed(0) : rounded.toFixed(2).replace('.', ',');
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Cut the tender lines into consecutive buckets of the given sizes.
 *
 * The operator records ONE set of payment means for the whole window; each
 * receipt then needs its own share of them. Consumed in order — the first
 * bucket takes from the first method until it is full — which matches how the
 * money is physically handed over and keeps every line's amount positive.
 */
function allocate(lines: TenderLine[], buckets: Decimal[]): TenderLine[][] {
  let remaining = lines.map((l) => ({ ...l }));
  const out: TenderLine[][] = [];
  for (const size of buckets) {
    const [mine, rest] = take(remaining, size);
    out.push(mine);
    remaining = rest;
  }
  return out;
}

/** Take `amount` off the front of `lines`, returning what was taken and what is left. */
function take(lines: TenderLine[], amount: Decimal): [TenderLine[], TenderLine[]] {
  let want = amount;
  const taken: TenderLine[] = [];
  const left: TenderLine[] = [];

  for (const line of lines) {
    const available = money(line.amount);
    if (want.lessThanOrEqualTo(0)) {
      left.push(line);
      continue;
    }
    if (available.lessThanOrEqualTo(want)) {
      taken.push(line);
      want = want.minus(available);
      continue;
    }
    // The line straddles the boundary: it pays part of this bucket and part of
    // the next. Both halves keep the method, so the till still balances.
    taken.push({ paymentMethodId: line.paymentMethodId, amount: toStorage(want), reference: line.reference ?? null });
    left.push({ paymentMethodId: line.paymentMethodId, amount: toStorage(available.minus(want)), reference: line.reference ?? null });
    want = new Decimal(0);
  }
  return [taken, left];
}
