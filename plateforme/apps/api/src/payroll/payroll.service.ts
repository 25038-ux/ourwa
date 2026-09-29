import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { money, toStorage } from '@elourwa/shared';
import type { Queryable } from '@elourwa/db';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenderService, type TenderLine } from '../finance/tender.service.js';
import { nextDocumentNumber, numeroDocument } from '../finance/sequences.js';
import { currentTenant } from '../tenant/tenant.context.js';

export type PayeeKind = 'staff' | 'teacher';

const MOIS_NOMS = [
  '', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

/** Son `number_format($x, 0, ',', ' ')` — pour les messages, jamais pour un calcul. */
function fr(x: Decimal): string {
  return x
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** `'SAL-' . str_pad($id, 6, '0', STR_PAD_LEFT)`. */
export function numeroRecuSalaire(n: number): string {
  return `SAL-${String(n).padStart(6, '0')}`;
}

@Injectable()
export class PayrollService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TenderService) private readonly tender: TenderService,
  ) {}

  /** Everyone on the payroll: staff and teachers, in one list. */
  async payees() {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, 'staff' AS kind, first_name, last_name, role_title AS title,
                salary, is_active
           FROM staff
          UNION ALL
         SELECT id, 'teacher' AS kind, first_name, last_name,
                COALESCE(employment, 'professeur') AS title, salary, true AS is_active
           FROM teachers
          ORDER BY last_name, first_name`,
      );
      return rows;
    });
  }

  /**
   * LE GAIN DE RÉFÉRENCE D'UN PROFESSEUR — `paiement_staff.php`, tel quel, ×4 compris.
   *
   *   permanent → professeurs.salaire
   *   interim   → Σ (heures_par_semaine × 4 × COALESCE(e.prix_par_heure, p.prix_par_heure))
   *
   * Deux choses ont l'air fausses et ne le sont pas :
   *
   * 1. Le ×4 est un multiplicateur FIXE, pas le nombre de semaines du mois. Un
   *    mois de cinq semaines paie quatre semaines. Le remplacer par un vrai
   *    compte de semaines augmenterait en silence chaque intérimaire dans les
   *    mois longs — une décision de l'école, pas de cette fonction (règle 19).
   * 2. Le taux vient de l'ASSIGNATION d'abord, du professeur ensuite, parce
   *    qu'il dépend du niveau enseigné. NULL sur l'assignation veut dire « le
   *    taux du professeur », pas zéro.
   */
  async teacherReferencePay(teacherId: string): Promise<{
    employment: string;
    gross: Decimal;
    monthlyHours: Decimal;
  }> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        employment: string | null;
        salary: string;
        hourly_rate: string;
        interim_gross: string;
        monthly_hours: string;
      }>(
        `SELECT t.employment, t.salary::text, t.hourly_rate::text,
                COALESCE(SUM(g.hours_per_week * 4
                             * COALESCE(g.hourly_rate, t.hourly_rate)), 0)
                  ::numeric(14,2)::text AS interim_gross,
                COALESCE(SUM(g.hours_per_week * 4), 0)::numeric(14,1)::text
                  AS monthly_hours
           FROM teachers t
           -- L'ANNÉE EN COURS SEULEMENT. Son enseignements (sans année) ne porte que
           -- les assignations courantes ; la nôtre garde chaque année, et la somme
           -- sur tout doublait le gain d'un vacataire après la copie des assignations.
           LEFT JOIN teachings g ON g.teacher_id = t.id AND g.academic_year_id = (SELECT id FROM academic_years WHERE status = 'active' LIMIT 1)
          WHERE t.id = $1
          GROUP BY t.id, t.employment, t.salary, t.hourly_rate`,
        [teacherId],
      );
      const r = rows[0];
      if (!r) throw new NotFoundException('Professeur introuvable.');

      const employment = r.employment ?? 'permanent';
      return {
        employment,
        gross: employment === 'interim' ? money(r.interim_gross) : money(r.salary),
        monthlyHours: money(r.monthly_hours),
      };
    });
  }

  /**
   * LA RETENUE DE PRÊT DU MOIS — `retenue_pret()` dans `includes/finance.php`.
   *
   * Deux cas comptent, et SEULEMENT les échéances datées de ce mois :
   *   - échéance encore ouverte (montant − remboursé) d'un prêt en cours ;
   *   - échéance DÉJÀ retenue sur le salaire de ce mois (`withheld`) : elle
   *     reste déduite, sinon le « reste » du salaire redeviendrait payable après
   *     le paiement du net, ce qui permettrait de dépasser le salaire.
   * Une échéance soldée par une AVANCE en espèces (withheld = false,
   * repaid = amount) ne compte pas : le salaire redevient plein.
   *
   * ⚠ PAS DE REPORT DES ARRIÉRÉS. Nous retenions aussi ce qu'un mois antérieur
   * n'avait pas couvert. Ce n'est pas sa règle : chez lui, une échéance qui n'a
   * pas été retenue reste ouverte sur le prêt (Dettes → Prêts au personnel) et
   * ne se reprend pas sur un autre salaire. ADR-0059.
   */
  private async retenueMoisTx(
    tx: Queryable,
    kind: PayeeKind,
    payeeId: string,
    calendarMonth: number,
    calendarYear: number,
  ): Promise<Decimal> {
    const { rows } = await tx.query<{ retenue: string }>(
      `SELECT COALESCE(SUM(CASE
                WHEN i.withheld THEN i.amount
                WHEN l.status = 'outstanding' THEN GREATEST(i.amount - i.repaid, 0)
                ELSE 0 END), 0)::numeric(14,2)::text AS retenue
         FROM loan_instalments i
         JOIN staff_loans l ON l.id = i.loan_id
        WHERE l.payee_kind = $1 AND l.payee_id = $2
          AND i.calendar_month = $3 AND i.calendar_year = $4`,
      [kind, payeeId, calendarMonth, calendarYear],
    );
    return Decimal.max(0, money(rows[0]!.retenue));
  }

  async retenueMois(
    kind: PayeeKind,
    payeeId: string,
    calendarMonth: number,
    calendarYear: number,
  ): Promise<Decimal> {
    return this.db.query((tx) =>
      this.retenueMoisTx(tx, kind, payeeId, calendarMonth, calendarYear),
    );
  }

  /**
   * PAYER UN SALAIRE — l'action `payer_salaire` de `paiement_staff.php`, dans son ordre.
   *
   * Le montant est LA SOMME DES MOYENS DE PAIEMENT : sa modale n'a pas de champ
   * « montant », elle a le widget, pré-rempli du reste dû. Ses cinq refus, dans
   * son ordre et avec ses mots ; puis l'insertion, les lignes de moyens, et —
   * si le mois est désormais intégralement versé — la retenue devient un
   * remboursement effectif du prêt (`crediter_echeances_mois`).
   *
   * Ce qui est stocké : `net` = ce qui est sorti (son `montant`) ; `loan_deduction`
   * = la retenue, portée par l'écriture qui complète le mois, 0 sinon ;
   * `gross` = net + loan_deduction, si bien que Σ gross du mois vaut le gain de
   * référence une fois le mois payé, et qu'aucun rapport ne double.
   */
  async paySalary(
    input: {
      payeeKind: PayeeKind;
      payeeId: string;
      calendarMonth: number;
      calendarYear: number;
      note?: string;
      /** `moyen_id[]` / `moyen_montant[]` — le montant payé est leur somme. */
      tender: TenderLine[];
    },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();

    // `lire_lignes_paiement(true, 0)` : au moins une ligne valide, total = somme.
    const lignes = input.tender.filter((l) => money(l.amount).greaterThan(0));
    if (lignes.length === 0) {
      throw new BadRequestException(
        'Veuillez indiquer au moins un moyen de paiement avec un montant.',
      );
    }
    const total = lignes.reduce((acc, l) => acc.plus(money(l.amount)), new Decimal(0));

    return this.db.query(async (tx) => {
      // ⚠ LE MOIS EST SÉRIALISÉ. Deux caissiers qui pressent « Payer » au même
      // instant liraient le même reste et le paieraient deux fois.
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `salary:${schoolId}:${input.payeeKind}:${input.payeeId}:` +
          `${input.calendarYear}-${input.calendarMonth}`,
      ]);

      const table = input.payeeKind === 'staff' ? 'staff' : 'teachers';
      const { rows: benef } = await tx.query<{
        first_name: string;
        last_name: string;
        salary: string;
      }>(`SELECT first_name, last_name, salary::text FROM ${table} WHERE id = $1`, [
        input.payeeId,
      ]);
      const payee = benef[0];
      if (!payee) throw new NotFoundException('Données invalides.');
      if (input.payeeKind === 'staff') {
        const { rows: mp } = await tx.query<{ ok: boolean }>(
          'SELECT ($2 = ANY(paid_months)) AS ok FROM staff WHERE id = $1',
          [input.payeeId, input.calendarMonth],
        );
        if (mp[0] && !mp[0].ok) {
          throw new BadRequestException(
            `${payee.first_name} ${payee.last_name} n’est pas payé(e) en ${MOIS_NOMS[input.calendarMonth] ?? input.calendarMonth} (mois payés définis sur sa fiche).`,
          );
        }
      }

      // Gain de référence du bénéficiaire.
      let gainRef: Decimal;
      if (input.payeeKind === 'staff') {
        gainRef = money(payee.salary);
      } else {
        const { rows } = await tx.query<{
          employment: string | null;
          salary: string;
          interim: string;
        }>(
          `SELECT t.employment, t.salary::text,
                  COALESCE(SUM(g.hours_per_week * 4 * COALESCE(g.hourly_rate, t.hourly_rate)), 0)
                    ::numeric(14,2)::text AS interim
             FROM teachers t LEFT JOIN teachings g ON g.teacher_id = t.id AND g.academic_year_id = (SELECT id FROM academic_years WHERE status = 'active' LIMIT 1)
            WHERE t.id = $1 GROUP BY t.id, t.employment, t.salary`,
          [input.payeeId],
        );
        const t = rows[0]!;
        gainRef =
          (t.employment ?? 'permanent') === 'interim' ? money(t.interim) : money(t.salary);
      }

      // Retenue de prêt du mois : déduite du salaire, le net est payé.
      const retenue = await this.retenueMoisTx(
        tx,
        input.payeeKind,
        input.payeeId,
        input.calendarMonth,
        input.calendarYear,
      );
      const gainNet = Decimal.max(0, gainRef.minus(retenue));

      // Déjà payé pour CE mois.
      const { rows: sofar } = await tx.query<{ paid: string }>(
        `SELECT COALESCE(SUM(net), 0)::numeric(14,2)::text AS paid
           FROM salary_payments
          WHERE payee_kind = $1 AND payee_id = $2
            AND calendar_month = $3 AND calendar_year = $4`,
        [input.payeeKind, input.payeeId, input.calendarMonth, input.calendarYear],
      );
      const dejaPaye = money(sofar[0]!.paid);
      const reste = Decimal.max(0, gainNet.minus(dejaPaye));

      if (gainRef.lessThanOrEqualTo('0.009')) {
        throw new BadRequestException(
          'Aucun salaire de référence défini pour ce bénéficiaire : définissez ' +
            "d'abord son salaire (ou ses assignations pour un intérimaire).",
        );
      }
      if (gainNet.lessThanOrEqualTo('0.009')) {
        throw new BadRequestException(
          `La retenue de prêt (${fr(retenue)} MRU) couvre l'intégralité du salaire ` +
            'de ce mois : rien à verser.',
        );
      }
      if (dejaPaye.greaterThanOrEqualTo(gainNet.minus('0.01'))) {
        throw new BadRequestException(
          `Ce bénéficiaire a déjà été intégralement payé pour ${MOIS_NOMS[input.calendarMonth]} ` +
            `${input.calendarYear} (${fr(dejaPaye)} MRU net` +
            (retenue.greaterThan(0) ? `, retenue de prêt de ${fr(retenue)} MRU déduite` : '') +
            "). Aucun paiement supplémentaire n'est autorisé pour ce mois.",
        );
      }
      if (total.greaterThan(reste.plus('0.01'))) {
        throw new BadRequestException(
          `Le montant dépasse le reste dû du mois (${fr(reste)} MRU).`,
        );
      }

      // Le mois est-il intégralement versé par cette écriture ?
      const complete = dejaPaye.plus(total).greaterThanOrEqualTo(gainNet.minus('0.01'));
      const deduction = complete && retenue.greaterThan('0.009') ? retenue : new Decimal(0);

      const receiptNo = await this.nextSalaryReceiptNo(tx);
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO salary_payments
           (school_id, payee_kind, payee_id, payee_name, calendar_month, calendar_year,
            gross, loan_deduction, net, note, paid_by, receipt_no)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          schoolId,
          input.payeeKind,
          input.payeeId,
          `${payee.first_name} ${payee.last_name}`.trim(),
          input.calendarMonth,
          input.calendarYear,
          toStorage(total.plus(deduction)),
          toStorage(deduction),
          toStorage(total),
          input.note ?? 'Salaire',
          actorId,
          receiptNo,
        ],
      );

      // `enregistrer_lignes_paiement('salaire_prof' | 'salaire_staff', …, 'sortant')`.
      await this.tender.post(tx, {
        sourceType: input.payeeKind === 'teacher' ? 'salaire_prof' : 'salaire_staff',
        sourceId: rows[0]!.id,
        direction: 'out',
        total: toStorage(total),
        lines: lignes,
      });

      // Salaire du mois intégralement versé → la retenue de prêt devient un
      // remboursement effectif : on crédite les échéances du mois.
      if (retenue.greaterThan('0.009') && complete) {
        await this.crediterEcheancesMois(
          tx,
          input.payeeKind,
          input.payeeId,
          input.calendarMonth,
          input.calendarYear,
        );
      }

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'salary_paid',
          entity: 'salary_payment',
          entityId: rows[0]!.id,
          after: {
            payee: `${payee.first_name} ${payee.last_name}`.trim(),
            gross: toStorage(gainRef),
            deduction: toStorage(deduction),
            net: toStorage(total),
          },
        },
        tx,
      );

      return {
        id: rows[0]!.id,
        receiptNumber: numeroRecuSalaire(receiptNo),
        gross: toStorage(gainRef),
        deduction: toStorage(deduction),
        net: toStorage(total),
        /** Ce qui reste dû pour ce mois après cette écriture. */
        remaining: toStorage(Decimal.max(0, reste.minus(total))),
      };
    });
  }

  /**
   * Le prochain numéro de reçu de salaire de l'école — sous verrou, dans la
   * transaction du paiement (règle 10 : jamais MAX()+1).
   */
  private async nextSalaryReceiptNo(tx: Queryable): Promise<number> {
    const { schoolId } = currentTenant();
    await tx.query(
      `INSERT INTO salary_receipt_sequences (school_id, last_number)
       VALUES ($1, 0) ON CONFLICT DO NOTHING`,
      [schoolId],
    );
    const { rows } = await tx.query<{ last_number: number }>(
      `UPDATE salary_receipt_sequences SET last_number = last_number + 1
        WHERE school_id = $1 RETURNING last_number`,
      [schoolId],
    );
    return rows[0]!.last_number;
  }

  /**
   * `crediter_echeances_mois()` — appelé quand le salaire du mois est
   * intégralement payé : la retenue devient un remboursement effectif du prêt.
   * Chaque échéance ouverte du mois est soldée (repaid = amount, withheld), le
   * prêt crédité du restant, et les prêts terminés passent « soldé ».
   */
  private async crediterEcheancesMois(
    tx: Queryable,
    kind: PayeeKind,
    payeeId: string,
    calendarMonth: number,
    calendarYear: number,
  ): Promise<void> {
    const { rows } = await tx.query<{ id: string; loan_id: string; restant: string }>(
      `SELECT i.id, i.loan_id, (i.amount - i.repaid)::text AS restant
         FROM loan_instalments i
         JOIN staff_loans l ON l.id = i.loan_id
        WHERE l.payee_kind = $1 AND l.payee_id = $2 AND l.status = 'outstanding'
          AND i.calendar_month = $3 AND i.calendar_year = $4 AND i.repaid < i.amount`,
      [kind, payeeId, calendarMonth, calendarYear],
    );
    for (const e of rows) {
      await tx.query(
        'UPDATE loan_instalments SET repaid = amount, withheld = true WHERE id = $1',
        [e.id],
      );
      await tx.query('UPDATE staff_loans SET repaid = repaid + $2 WHERE id = $1', [
        e.loan_id,
        toStorage(money(e.restant)),
      ]);
    }
    // Solder les prêts terminés.
    await tx.query(
      `UPDATE staff_loans SET status = 'settled'
        WHERE status = 'outstanding' AND repaid >= principal - 0.01`,
    );
  }

  /**
   * LE REÇU DE SALAIRE — le bloc `print_recu_salaire` de `paiement_staff.php`.
   */
  async salaryReceipt(paymentId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        receipt_no: number | null;
        payee_kind: PayeeKind;
        payee_name: string;
        benef_tel: string | null;
        benef_fonction: string | null;
        note: string | null;
        calendar_month: number;
        calendar_year: number;
        net: string;
        paid_at: string;
        paye_par_nom: string | null;
      }>(
        `SELECT ps.id, ps.receipt_no, ps.payee_kind, ps.payee_name, ps.note,
                ps.calendar_month, ps.calendar_year, ps.net::text, ps.paid_at::text,
                CASE WHEN ps.payee_kind = 'teacher' THEN prof.phone ELSE stf.phone END AS benef_tel,
                CASE WHEN ps.payee_kind = 'teacher' THEN 'Professeur' ELSE stf.role_title END AS benef_fonction,
                COALESCE(NULLIF(TRIM(u.full_name), ''), u.username, u.email) AS paye_par_nom
           FROM salary_payments ps
           LEFT JOIN teachers prof ON ps.payee_kind = 'teacher' AND ps.payee_id = prof.id
           LEFT JOIN staff stf ON ps.payee_kind = 'staff' AND ps.payee_id = stf.id
           LEFT JOIN users u ON ps.paid_by = u.id
          WHERE ps.id = $1`,
        [paymentId],
      );
      const r = rows[0];
      if (!r) throw new NotFoundException('Reçu introuvable.');
      const moyens = await this.tender.linesFor(
        tx,
        r.payee_kind === 'teacher' ? 'salaire_prof' : 'salaire_staff',
        r.id,
      );
      return {
        id: r.id,
        numero: r.receipt_no === null ? null : numeroRecuSalaire(r.receipt_no),
        date: r.paid_at,
        benef_nom: r.payee_name,
        benef_tel: r.benef_tel,
        benef_fonction: r.benef_fonction,
        motif: r.note,
        mois: r.calendar_month,
        annee: r.calendar_year,
        paye_par_nom: r.paye_par_nom,
        moyens,
        montant: r.net,
      };
    });
  }

  /**
   * LA PAGE « PAIEMENT DU PERSONNEL » — ce que `paiement_staff.php` calcule
   * avant de rendre, pour l'un de ses trois types.
   *
   *   staff  → SELECT id, CONCAT(prenom," ",nom), fonction, salaire AS gain
   *            FROM staff WHERE actif = 1 ORDER BY nom
   *   profs  → professeurs + Σ assignations (gain_interim, heures_mois_calc)
   *            ORDER BY nom ; gain = intérim ? gain_interim : salaire
   *   admins → administrateurs actifs, gain = limite mensuelle
   *
   * puis, pour chacun : la retenue de prêt du mois (pas pour les admins) et le
   * « déjà payé » / « déjà retiré » de la période. `reste` est calculé ici
   * comme dans sa boucle d'affichage : max(0, net − payé).
   *
   * ⚠ POUR LE COMPTABLE, SUR LES ADMINS, LA LIMITE NE PART PAS : sa colonne
   * « Limite mensuelle » n'est pas rendue, et son bouton reçoit `0, 0` à la
   * place de la limite et du cumul. Le `reste`, lui, part — c'est ce qui fait
   * fonctionner le drapeau rouge de sa modale.
   */
  async staffPay(
    type: 'staff' | 'profs' | 'admins',
    /** Absent ou hors liste → sa règle de repli, plus bas. */
    moisDemande: number | null,
    calendarYear: number,
    roles: string[] = [],
  ) {
    const comptable = roles.includes('comptable');
    return this.db.query(async (tx) => {
      // Mois proposés : pour les PROFESSEURS, exactement les mois actifs
      // configurés dans « Année scolaire » pour l'année choisie ; sinon 1..12.
      let moisDisponibles = Array.from({ length: 12 }, (_, i) => i + 1);
      if (type === 'profs') {
        const { rows } = await tx.query<{ calendar_month: number }>(
          `SELECT m.calendar_month FROM academic_year_months m
             JOIN academic_years y ON y.id = m.academic_year_id
            WHERE y.start_year = $1 ORDER BY m.calendar_month`,
          [calendarYear],
        );
        if (rows.length) moisDisponibles = rows.map((r) => r.calendar_month);
      }
      // Mois hors liste : on retombe sur le mois courant s'il est actif, sinon
      // le premier actif.
      const moisCourant = new Date().getMonth() + 1;
      let calendarMonth = moisDemande ?? moisCourant;
      if (!moisDisponibles.includes(calendarMonth)) {
        calendarMonth = moisDisponibles.includes(moisCourant) ? moisCourant : moisDisponibles[0]!;
      }

      // Toutes les années qui portent des données : MIN/MAX de `paiements`.
      const { rows: bornes } = await tx.query<{ mn: number | null; mx: number | null }>(
        'SELECT MIN(calendar_year)::int AS mn, MAX(calendar_year)::int AS mx FROM payments',
      );

      type Ligne = {
        id: string;
        nom_complet: string;
        fonction: string | null;
        telephone: string | null;
        situation: string | null;
        heures_mois_calc: string | null;
        gain: string;
        mois_paye?: boolean;
        paid_months?: number[] | null;
      };
      let lignes: Ligne[];
      let deja = new Map<string, Decimal>();
      let retenues = new Map<string, Decimal>();

      if (type === 'admins') {
        const { rows } = await tx.query<Ligne>(
          `SELECT id, full_name AS nom_complet, NULL::text AS fonction, phone AS telephone,
                  NULL::text AS situation, NULL::text AS heures_mois_calc,
                  monthly_limit::text AS gain
             FROM fund_holders WHERE is_active ORDER BY full_name`,
        );
        lignes = rows;
        const { rows: d } = await tx.query<{ id: string; total: string }>(
          `SELECT fund_holder_id AS id, SUM(amount)::text AS total FROM withdrawals
            WHERE calendar_month = $1 AND calendar_year = $2 GROUP BY fund_holder_id`,
          [calendarMonth, calendarYear],
        );
        deja = new Map(d.map((r) => [r.id, money(r.total)]));
      } else {
        if (type === 'staff') {
          const { rows } = await tx.query<Ligne>(
            `SELECT id, TRIM(first_name || ' ' || last_name) AS nom_complet, role_title AS fonction,
                    phone AS telephone, NULL::text AS situation, NULL::text AS heures_mois_calc,
                    salary::text AS gain,
                    ($1 = ANY(paid_months)) AS mois_paye, paid_months
               FROM staff WHERE is_active ORDER BY last_name`,
            [calendarMonth],
          );
          lignes = rows;
        } else {
          const { rows } = await tx.query<Ligne>(
            `SELECT p.id, TRIM(p.first_name || ' ' || p.last_name) AS nom_complet,
                    'Professeur' AS fonction, p.phone AS telephone,
                    COALESCE(p.employment, 'permanent') AS situation,
                    COALESCE(SUM(e.hours_per_week * 4), 0)::numeric(14,1)::text AS heures_mois_calc,
                    CASE WHEN COALESCE(p.employment, 'permanent') = 'interim'
                         THEN COALESCE(SUM(e.hours_per_week * 4 * COALESCE(e.hourly_rate, p.hourly_rate)), 0)
                         ELSE p.salary END::numeric(14,2)::text AS gain
               FROM teachers p
               LEFT JOIN teachings e ON e.teacher_id = p.id AND e.academic_year_id = (SELECT id FROM academic_years WHERE status = 'active' LIMIT 1)
              GROUP BY p.id
              ORDER BY p.last_name`,
          );
          lignes = rows;
        }
        const kind: PayeeKind = type === 'staff' ? 'staff' : 'teacher';
        // `retenues_prets_mois()` — une requête pour tous les bénéficiaires.
        const { rows: r } = await tx.query<{ id: string; retenue: string }>(
          `SELECT l.payee_id AS id, COALESCE(SUM(CASE
                    WHEN i.withheld THEN i.amount
                    WHEN l.status = 'outstanding' THEN GREATEST(i.amount - i.repaid, 0)
                    ELSE 0 END), 0)::numeric(14,2)::text AS retenue
             FROM loan_instalments i JOIN staff_loans l ON l.id = i.loan_id
            WHERE l.payee_kind = $1 AND i.calendar_month = $2 AND i.calendar_year = $3
            GROUP BY l.payee_id`,
          [kind, calendarMonth, calendarYear],
        );
        retenues = new Map(r.map((x) => [x.id, Decimal.max(0, money(x.retenue))]));
        const { rows: d } = await tx.query<{ id: string; total: string }>(
          `SELECT payee_id AS id, SUM(net)::text AS total FROM salary_payments
            WHERE payee_kind = $1 AND calendar_month = $2 AND calendar_year = $3
            GROUP BY payee_id`,
          [kind, calendarMonth, calendarYear],
        );
        deja = new Map(d.map((x) => [x.id, money(x.total)]));
      }

      const masquerLimite = type === 'admins' && comptable;
      return {
        mois: calendarMonth,
        moisDisponibles,
        anneeMin: bornes[0]?.mn ?? null,
        anneeMax: bornes[0]?.mx ?? null,
        lignes: lignes.map((p) => {
          const gain = money(p.gain);
          const paye = deja.get(p.id) ?? new Decimal(0);
          const retenue = retenues.get(p.id) ?? new Decimal(0);
          const net = Decimal.max(0, gain.minus(retenue));
          const reste = Decimal.max(0, net.minus(paye));
          return {
            id: p.id,
            nom_complet: p.nom_complet,
            // Le personnel porte ses mois payés (0037) ; les professeurs suivent
            // les mois actifs de l'année scolaire (déjà filtrés par `moisDisponibles`).
            mois_paye: p.mois_paye ?? true,
            mois_payes: p.paid_months ?? null,
            fonction: p.fonction,
            telephone: p.telephone,
            situation: p.situation,
            heures_mois_calc: p.heures_mois_calc,
            // Les montants de limite ne sont montrés qu'à l'administration.
            gain: masquerLimite ? null : toStorage(gain),
            retenue: toStorage(retenue),
            net: masquerLimite ? null : toStorage(net),
            paye: toStorage(paye),
            reste: toStorage(reste),
            // Ses trois états de la colonne Action, décidés ici pour que le
            // comptable, privé des montants, ait quand même la bonne cellule.
            gain_nul: gain.lessThanOrEqualTo('0.009'),
            net_nul: net.lessThanOrEqualTo('0.009'),
            reste_nul: reste.lessThanOrEqualTo('0.009'),
          };
        }),
      };
    });
  }

  /**
   * CE QUE LE FORMULAIRE DE PRÊT DE `dette.php` A BESOIN DE SAVOIR.
   *
   *   staff  → SELECT id, CONCAT(prenom," ",nom), fonction FROM staff WHERE actif = 1 ORDER BY nom
   *   profs  → SELECT id, CONCAT(prenom," ",nom) FROM professeurs ORDER BY nom
   *   mois   → SELECT DISTINCT mois FROM annee_scolaire_mois WHERE actif = 1 ORDER BY mois
   *            (vide → 1..12) ; années : date('Y') .. date('Y') + 3.
   */
  async loanFormData() {
    return this.db.query(async (tx) => {
      const { rows: staff } = await tx.query<{ id: string; nom_complet: string; fonction: string | null }>(
        `SELECT id, TRIM(first_name || ' ' || last_name) AS nom_complet, role_title AS fonction
           FROM staff WHERE is_active ORDER BY last_name`,
      );
      const { rows: profs } = await tx.query<{ id: string; nom_complet: string }>(
        `SELECT id, TRIM(first_name || ' ' || last_name) AS nom_complet
           FROM teachers ORDER BY last_name`,
      );
      const moisMotif = await this.motifMois(tx);
      const annee = new Date().getFullYear();
      return {
        staff,
        profs,
        moisMotif,
        annees: [annee, annee + 1, annee + 2, annee + 3],
      };
    });
  }

  /** Le MOTIF des mois actifs de « Année scolaire », toutes années confondues. */
  private async motifMois(tx: Queryable): Promise<number[]> {
    const { rows } = await tx.query<{ calendar_month: number }>(
      'SELECT DISTINCT calendar_month FROM academic_year_months ORDER BY calendar_month',
    );
    return rows.length ? rows.map((r) => r.calendar_month) : Array.from({ length: 12 }, (_, i) => i + 1);
  }

  /**
   * ACCORDER UN PRÊT — `dette.php`, action `creer_pret`, dans son ordre.
   *
   * ⚠ LES MOIS SONT COCHÉS, PAS COMPTÉS : `pret_mois[]`, « novembre, décembre,
   * février, avril ». Ses refus, avec ses mots : bénéficiaire introuvable ;
   * montant ; aucun mois ; un mois hors du motif de l'année scolaire, au-delà
   * de trois ans, ou DÉJÀ PASSÉ (rang civil année×12+mois < aujourd'hui — le
   * salaire de ce mois est versé, la retenue ne sera jamais prélevée) ; puis
   * les moyens de paiement, dont la somme doit égaler le montant.
   *
   * L'échéancier est à parts égales, l'arrondi porté par la DERNIÈRE ; la
   * remise des fonds sort de la caisse (`pret_personnel`, sortant) ; le
   * contrat est numéroté « PRET-000123 ».
   *
   * `aujourdhui` ne sert qu'aux tests, qui montent des scénarios en 2021.
   */
  async grantLoan(
    input: {
      payeeKind: PayeeKind;
      payeeId: string;
      principal: string;
      months: { month: number; year: number }[];
      reason?: string;
      tender: TenderLine[];
    },
    actorId: string,
    aujourdhui: Date = new Date(),
  ) {
    const { schoolId } = currentTenant();

    return this.db.query(async (tx) => {
      // Le bénéficiaire existe-t-il ?
      const table = input.payeeKind === 'staff' ? 'staff' : 'teachers';
      const { rows: benef } = await tx.query<{ nom: string }>(
        `SELECT TRIM(first_name || ' ' || last_name) AS nom FROM ${table} WHERE id = $1`,
        [input.payeeId],
      );
      const benefNom = benef[0]?.nom ?? null;

      const principal = money(input.principal);
      // Mois choisis, dédoublonnés, comme son array_unique.
      const cles = new Set<string>();
      const months = input.months.filter((m) => {
        const k = `${m.month}-${m.year}`;
        if (cles.has(k)) return false;
        cles.add(k);
        return true;
      });
      const motif = new Set(await this.motifMois(tx));
      const anneeMax = aujourdhui.getFullYear() + 3;
      const rangMin = aujourdhui.getFullYear() * 12 + (aujourdhui.getMonth() + 1);
      const invalides = months.filter(
        (m) => !motif.has(m.month) || m.year > anneeMax || m.year * 12 + m.month < rangMin,
      );

      if (!benefNom) throw new BadRequestException('Bénéficiaire introuvable.');
      if (principal.lessThanOrEqualTo(0)) throw new BadRequestException('Montant du prêt invalide.');
      if (months.length === 0) {
        throw new BadRequestException(
          "Sélectionnez au moins un mois de retenue (parmi les mois de l'année scolaire).",
        );
      }
      if (invalides.length) {
        throw new BadRequestException(
          "Certains mois choisis ne font pas partie des mois de l'année scolaire " +
            "(ou dépassent l'horizon de 3 ans).",
        );
      }
      const lignes = input.tender.filter((l) => money(l.amount).greaterThan(0));
      if (lignes.length === 0) {
        throw new BadRequestException(
          'Veuillez indiquer au moins un moyen de paiement avec un montant.',
        );
      }
      const total = lignes.reduce((a, l) => a.plus(money(l.amount)), new Decimal(0));
      if (total.minus(principal).abs().greaterThan('0.01')) {
        throw new BadRequestException(
          `Le total des moyens de paiement (${fr(total)} MRU) doit être égal au montant du prêt ` +
            `(${fr(principal)} MRU).`,
        );
      }

      const receiptNo = await nextDocumentNumber(tx, schoolId, 'pret');
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO staff_loans
           (school_id, payee_kind, payee_id, payee_name, principal, reason, granted_by, receipt_no)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          schoolId, input.payeeKind, input.payeeId, benefNom,
          toStorage(principal), input.reason || null, actorId, receiptNo,
        ],
      );
      const loanId = rows[0]!.id;

      // Échéancier : répartition égale, ajustement d'arrondi sur la dernière.
      months.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
      const n = months.length;
      const part = principal.dividedBy(n).toDecimalPlaces(2, Decimal.ROUND_DOWN);
      let cumul = new Decimal(0);
      for (let i = 0; i < n; i++) {
        const mnt = i === n - 1 ? principal.minus(cumul) : part;
        cumul = cumul.plus(mnt);
        await tx.query(
          `INSERT INTO loan_instalments (school_id, loan_id, calendar_month, calendar_year, amount)
           VALUES ($1, $2, $3, $4, $5)`,
          [schoolId, loanId, months[i]!.month, months[i]!.year, toStorage(mnt)],
        );
      }

      // Sortie de caisse (remise des fonds).
      await this.tender.post(tx, {
        sourceType: 'pret_personnel',
        sourceId: loanId,
        direction: 'out',
        total: toStorage(principal),
        lines: lignes,
      });

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'loan_granted',
          entity: 'staff_loan',
          entityId: loanId,
          after: {
            payee: benefNom,
            principal: toStorage(principal),
            months: months.map((m) => `${m.year}-${m.month}`).join(', '),
          },
        },
        tx,
      );

      return {
        id: loanId,
        receiptNumber: numeroDocument('PRET', receiptNo),
        principal: toStorage(principal),
        instalments: n,
      };
    });
  }

  /**
   * AVANCE DE REMBOURSEMENT — `dette.php`, action `avance_pret`.
   *
   * Le montant est la somme des moyens de paiement (entrant, `pret_remb`) ;
   * le reçu porte 'PRT-' . date('Ymd') . '-' . $pret_id . '-' . random_int ;
   * puis `imputer_avance_pret()` : le prêt est crédité et le reste dû est
   * RÉPARTI à parts égales sur les échéances encore ouvertes.
   */
  async repayLoan(loanId: string, tender: TenderLine[], actorId: string) {
    const { schoolId } = currentTenant();

    return this.db.query(async (tx) => {
      const { rows: loanRows } = await tx.query<{
        principal: string;
        repaid: string;
        legacy_id: number | null;
      }>(
        `SELECT principal::text, repaid::text, legacy_id FROM staff_loans
          WHERE id = $1 AND status = 'outstanding' FOR UPDATE`,
        [loanId],
      );
      if (!loanRows[0]) throw new BadRequestException('Prêt introuvable ou déjà soldé.');
      const reste = Decimal.max(0, money(loanRows[0].principal).minus(money(loanRows[0].repaid)));

      const lignes = tender.filter((l) => money(l.amount).greaterThan(0));
      if (lignes.length === 0) {
        throw new BadRequestException(
          'Veuillez indiquer au moins un moyen de paiement avec un montant.',
        );
      }
      const total = lignes.reduce((a, l) => a.plus(money(l.amount)), new Decimal(0));
      if (total.greaterThan(reste.plus('0.01'))) {
        throw new BadRequestException(
          `Le montant dépasse le reste dû du prêt (${fr(reste)} MRU).`,
        );
      }

      const now = new Date();
      const ymd =
        `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}` +
        `${String(now.getDate()).padStart(2, '0')}`;
      const pid = loanRows[0].legacy_id ?? loanId.replace(/-/g, '').slice(0, 8);
      // Sa forme (date, prêt) avec, à la place des quatre chiffres tirés au
      // sort, le compteur de l'école : jamais deux reçus du même numéro (règle 10).
      const recu = `PRT-${ymd}-${pid}-${String(await nextDocumentNumber(tx, schoolId, 'remboursement_pret')).padStart(4, '0')}`;

      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO loan_repayments (school_id, loan_id, amount, receipt_number, recorded_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [schoolId, loanId, toStorage(total), recu, actorId],
      );
      await this.tender.post(tx, {
        sourceType: 'pret_remb',
        sourceId: rows[0]!.id,
        direction: 'in',
        total: toStorage(total),
        lines: lignes,
      });

      await this.imputerAvancePret(tx, loanId, total);

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'loan_repaid',
          entity: 'staff_loan',
          entityId: loanId,
          after: { amount: toStorage(total), receipt: recu },
        },
        tx,
      );

      return {
        id: rows[0]!.id,
        receiptNumber: recu,
        applied: toStorage(total),
        remaining: toStorage(Decimal.max(0, reste.minus(total))),
      };
    });
  }

  /**
   * `imputer_avance_pret()` — après une avance en espèces : crédite le prêt,
   * puis RÉPARTIT le reste à parts égales sur les échéances encore ouvertes
   * (non retenues sur salaire), la dernière portant l'arrondi. Reste nul, ou
   * plus d'échéance ouverte : les échéances restantes sont closes et le prêt
   * passe « soldé ».
   */
  private async imputerAvancePret(tx: Queryable, loanId: string, montant: Decimal): Promise<void> {
    await tx.query('UPDATE staff_loans SET repaid = repaid + $2 WHERE id = $1', [
      loanId,
      toStorage(montant),
    ]);
    const { rows: pret } = await tx.query<{ principal: string; repaid: string }>(
      'SELECT principal::text, repaid::text FROM staff_loans WHERE id = $1',
      [loanId],
    );
    if (!pret[0]) return;
    const resteGlobal = Decimal.max(0, money(pret[0].principal).minus(money(pret[0].repaid)));
    const { rows: ouvertes } = await tx.query<{ id: string }>(
      `SELECT id FROM loan_instalments
        WHERE loan_id = $1 AND repaid < amount AND withheld = false
        ORDER BY calendar_year, calendar_month`,
      [loanId],
    );
    if (resteGlobal.lessThanOrEqualTo('0.009') || ouvertes.length === 0) {
      await tx.query(
        'UPDATE loan_instalments SET repaid = amount WHERE loan_id = $1 AND withheld = false',
        [loanId],
      );
      await tx.query(`UPDATE staff_loans SET status = 'settled' WHERE id = $1`, [loanId]);
      return;
    }
    const n = ouvertes.length;
    const part = resteGlobal.dividedBy(n).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    let cumul = new Decimal(0);
    for (let i = 0; i < n; i++) {
      const mnt = i === n - 1 ? resteGlobal.minus(cumul) : part;
      cumul = cumul.plus(mnt);
      await tx.query('UPDATE loan_instalments SET amount = $2, repaid = 0 WHERE id = $1', [
        ouvertes[i]!.id,
        toStorage(mnt),
      ]);
    }
  }

  /**
   * « Prêts en cours & soldés » — `dette.php`, avec l'échéancier de chacun.
   * `ORDER BY pp.statut = "solde", pp.date_creation DESC`.
   */
  async allLoans() {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        payee_kind: PayeeKind;
        payee_id: string;
        benef_nom: string;
        principal: string;
        repaid: string;
        status: string;
        reason: string | null;
        granted_at: string;
        receipt_no: number | null;
        echeances: { mois: number; annee: number; montant: string; rembourse: string }[] | null;
      }>(
        `SELECT l.id, l.payee_kind, l.payee_id,
                -- Son CASE WHEN … CONCAT(prenom, " ", nom) : le nom d'aujourd'hui,
                -- la copie de l'époque en repli si la fiche a disparu.
                COALESCE(CASE WHEN l.payee_kind = 'staff'
                              THEN TRIM(stf.first_name || ' ' || stf.last_name)
                              ELSE TRIM(prof.first_name || ' ' || prof.last_name) END,
                         l.payee_name) AS benef_nom,
                l.principal::text, l.repaid::text, l.status, l.reason, l.granted_at::text,
                l.receipt_no,
                (SELECT jsonb_agg(jsonb_build_object(
                          'mois', i.calendar_month, 'annee', i.calendar_year,
                          'montant', i.amount::text, 'rembourse', i.repaid::text)
                        ORDER BY i.calendar_year, i.calendar_month)
                   FROM loan_instalments i WHERE i.loan_id = l.id) AS echeances
           FROM staff_loans l
           LEFT JOIN staff stf ON l.payee_kind = 'staff' AND l.payee_id = stf.id
           LEFT JOIN teachers prof ON l.payee_kind = 'teacher' AND l.payee_id = prof.id
          ORDER BY (l.status = 'settled'), l.granted_at DESC`,
      );
      return rows.map((r) => ({
        ...r,
        numero: r.receipt_no === null ? null : numeroDocument('PRET', r.receipt_no),
        reste: toStorage(Decimal.max(0, money(r.principal).minus(money(r.repaid)))),
        echeances: r.echeances ?? [],
      }));
    });
  }

  async loansFor(kind: PayeeKind, payeeId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT l.id, l.principal, l.repaid, l.status, l.reason, l.granted_at,
                (l.principal - l.repaid)::text AS outstanding,
                (SELECT count(*)::int FROM loan_instalments i
                  WHERE i.loan_id = l.id AND i.repaid < i.amount) AS instalments_left
           FROM staff_loans l
          WHERE l.payee_kind = $1 AND l.payee_id = $2
          ORDER BY l.granted_at DESC`,
        [kind, payeeId],
      );
      return rows;
    });
  }

  /** Le contrat de prêt — le bloc `print_recu_pret` de `dette.php`. */
  async loanContract(loanId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        receipt_no: number | null;
        benef_nom: string;
        benef_tel: string | null;
        benef_fonction: string | null;
        reason: string | null;
        principal: string;
        granted_at: string;
      }>(
        `SELECT pp.id, pp.receipt_no, pp.reason,
                COALESCE(CASE WHEN pp.payee_kind = 'staff'
                              THEN TRIM(stf.first_name || ' ' || stf.last_name)
                              ELSE TRIM(prof.first_name || ' ' || prof.last_name) END,
                         pp.payee_name) AS benef_nom,
                pp.principal::text, pp.granted_at::text,
                CASE WHEN pp.payee_kind = 'staff' THEN stf.phone ELSE prof.phone END AS benef_tel,
                CASE WHEN pp.payee_kind = 'staff' THEN stf.role_title ELSE 'Professeur' END AS benef_fonction
           FROM staff_loans pp
           LEFT JOIN staff stf ON pp.payee_kind = 'staff' AND pp.payee_id = stf.id
           LEFT JOIN teachers prof ON pp.payee_kind = 'teacher' AND pp.payee_id = prof.id
          WHERE pp.id = $1`,
        [loanId],
      );
      const r = rows[0];
      if (!r) throw new NotFoundException('Contrat introuvable.');
      const moyens = await this.tender.linesFor(tx, 'pret_personnel', r.id);
      const { rows: ech } = await tx.query<{ mois: number; annee: number; montant: string }>(
        `SELECT calendar_month AS mois, calendar_year AS annee, amount::text AS montant
           FROM loan_instalments WHERE loan_id = $1 ORDER BY calendar_year, calendar_month`,
        [r.id],
      );
      return {
        id: r.id,
        numero: r.receipt_no === null ? null : numeroDocument('PRET', r.receipt_no),
        date: r.granted_at,
        benef_nom: r.benef_nom,
        benef_tel: r.benef_tel,
        benef_fonction: r.benef_fonction,
        motif: r.reason,
        echeances: ech,
        moyens,
        montant: r.principal,
      };
    });
  }

  /** Le reçu d'avance — le bloc `print_recu_avance` de `dette.php`. */
  async loanRepaymentReceipt(repaymentId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        receipt_number: string | null;
        amount: string;
        repaid_at: string;
        principal: string;
        repaid: string;
        benef_nom: string;
        benef_tel: string | null;
      }>(
        `SELECT pr.id, pr.receipt_number, pr.amount::text, pr.repaid_at::text,
                pp.principal::text, pp.repaid::text,
                COALESCE(CASE WHEN pp.payee_kind = 'staff'
                              THEN TRIM(stf.first_name || ' ' || stf.last_name)
                              ELSE TRIM(prof.first_name || ' ' || prof.last_name) END,
                         pp.payee_name) AS benef_nom,
                CASE WHEN pp.payee_kind = 'staff' THEN stf.phone ELSE prof.phone END AS benef_tel
           FROM loan_repayments pr
           JOIN staff_loans pp ON pr.loan_id = pp.id
           LEFT JOIN staff stf ON pp.payee_kind = 'staff' AND pp.payee_id = stf.id
           LEFT JOIN teachers prof ON pp.payee_kind = 'teacher' AND pp.payee_id = prof.id
          WHERE pr.id = $1`,
        [repaymentId],
      );
      const r = rows[0];
      if (!r) throw new NotFoundException('Reçu introuvable.');
      const moyens = await this.tender.linesFor(tx, 'pret_remb', r.id);
      return {
        id: r.id,
        numero: r.receipt_number,
        date: r.repaid_at,
        benef_nom: r.benef_nom,
        benef_tel: r.benef_tel,
        montant_total: r.principal,
        reste_apres: toStorage(Decimal.max(0, money(r.principal).minus(money(r.repaid)))),
        moyens,
        montant: r.amount,
      };
    });
  }

  /**
   * Record a withdrawal against a fund holder's monthly limit.
   *
   * The limit is per calendar month and resets with it. Refusing an overdraw is
   * the entire point of the limit existing.
   */
  async withdraw(
    input: {
      fundHolderId: string;
      calendarMonth: number;
      calendarYear: number;
      reason?: string;
      /** `moyen_id[]` / `moyen_montant[]` — le montant retiré est leur somme. */
      tender: TenderLine[];
    },
    actorId: string,
    /** Voir les refus plus bas : le plafond ne se dit pas au comptable. */
    roles: string[] = [],
  ) {
    const { schoolId } = currentTenant();
    // `lire_lignes_paiement(true, 0)` : au moins une ligne valide, total = somme.
    const lignes = input.tender.filter((l) => money(l.amount).greaterThan(0));
    if (lignes.length === 0) {
      throw new BadRequestException(
        'Veuillez indiquer au moins un moyen de paiement avec un montant.',
      );
    }
    const amount = lignes.reduce((acc, l) => acc.plus(money(l.amount)), new Decimal(0));

    return this.db.query(async (tx) => {
      const { rows: holder } = await tx.query<{
        full_name: string;
        monthly_limit: string;
        legacy_id: number | null;
      }>(
        'SELECT full_name, monthly_limit, legacy_id FROM fund_holders WHERE id = $1 AND is_active',
        [input.fundHolderId],
      );
      if (!holder[0]) throw new NotFoundException('Administrateur introuvable ou inactif.');

      const { rows: taken } = await tx.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total FROM withdrawals
          WHERE fund_holder_id = $1 AND calendar_month = $2 AND calendar_year = $3`,
        [input.fundHolderId, input.calendarMonth, input.calendarYear],
      );

      const limit = money(holder[0].monthly_limit);
      const already = money(taken[0]!.total);
      const remaining = Decimal.max(0, limit.minus(already));
      const comptable = roles.includes('comptable');
      const nom = holder[0].full_name;
      const mois = MOIS_NOMS[input.calendarMonth];

      /*
       * SES TROIS REFUS, DANS SON ORDRE ET AVEC SES MOTS — `retirer_admin`.
       *
       * ⚠ LES MONTANTS DE PLAFOND NE SONT MONTRÉS QU'À L'ADMINISTRATION : son
       * propre commentaire. Le comptable reçoit la version sans chiffres.
       */
      if (limit.lessThanOrEqualTo('0.009')) {
        throw new BadRequestException(
          `Aucune limite mensuelle définie pour ${nom} : l'administration doit ` +
            "d'abord fixer sa limite.",
        );
      }
      if (already.greaterThanOrEqualTo(limit.minus('0.01'))) {
        throw new BadRequestException(
          comptable
            ? `⚠ LIMITE MENSUELLE ATTEINTE : ${nom} ne peut plus rien retirer pour ${mois} ${input.calendarYear}.`
            : `⚠ LIMITE MENSUELLE ATTEINTE : ${nom} a déjà retiré ${fr(already)} MRU sur ` +
                `une limite de ${fr(limit)} MRU pour ${mois} ${input.calendarYear}. ` +
                'Aucun retrait supplémentaire possible ce mois.',
        );
      }
      if (amount.greaterThan(remaining.plus('0.01'))) {
        throw new BadRequestException(
          comptable
            ? `⚠ LIMITE MENSUELLE DÉPASSÉE : ce retrait (${fr(amount)} MRU) dépasse ce que ` +
                `${nom} peut encore retirer pour ${mois} ${input.calendarYear}.`
            : `⚠ LIMITE MENSUELLE DÉPASSÉE : ${nom} ne peut retirer que ${fr(remaining)} MRU ` +
                `de plus ce mois (limite ${fr(limit)} MRU, déjà retiré ${fr(already)} MRU). ` +
                `Le retrait de ${fr(amount)} MRU est refusé.`,
        );
      }

      // `'ADM-' . date('Ymd') . '-' . $aid . '-' . random_int(1000, 9999)` —
      // son $aid est l'entier de la ligne ; ici, l'identifiant repris quand il
      // existe, sinon le début de l'UUID.
      const now = new Date();
      const ymd =
        `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}` +
        `${String(now.getDate()).padStart(2, '0')}`;
      const aid = holder[0].legacy_id ?? input.fundHolderId.replace(/-/g, '').slice(0, 8);
      const recuNumero = `ADM-${ymd}-${aid}-${String(await nextDocumentNumber(tx, schoolId, 'retrait')).padStart(4, '0')}`;

      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO withdrawals
           (school_id, fund_holder_id, amount, calendar_month, calendar_year, reason,
            receipt_number, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          schoolId, input.fundHolderId, toStorage(amount),
          input.calendarMonth, input.calendarYear, input.reason ?? null, recuNumero, actorId,
        ],
      );

      // `enregistrer_lignes_paiement('admin_retrait', $rid, $lignes, 'sortant')`.
      await this.tender.post(tx, {
        sourceType: 'admin_retrait',
        sourceId: rows[0]!.id,
        direction: 'out',
        total: toStorage(amount),
        lines: lignes,
      });

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'withdrawal_recorded',
          entity: 'withdrawal',
          entityId: rows[0]!.id,
          after: { holder: holder[0].full_name, amount: toStorage(amount) },
        },
        tx,
      );

      return {
        id: rows[0]!.id,
        receiptNumber: recuNumero,
        amount: toStorage(amount),
        remaining: toStorage(Decimal.max(0, remaining.minus(amount))),
      };
    });
  }

  /**
   * LE REÇU DE RETRAIT — le bloc `print_recu_retrait` d'`administrateurs.php`.
   *
   * ⚠ Les informations de limite sont CONFIDENTIELLES : jamais montrées au
   * comptable. Le reste, il le voit — c'est le reçu du retrait qu'il vient
   * d'enregistrer, la seule chose de cette page qui lui soit ouverte.
   */
  async withdrawalReceipt(withdrawalId: string, roles: string[] = []) {
    const comptable = roles.includes('comptable');
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        fund_holder_id: string;
        nom_complet: string;
        telephone: string | null;
        limite_mensuelle: string;
        amount: string;
        calendar_month: number;
        calendar_year: number;
        reason: string | null;
        receipt_number: string | null;
        withdrawn_at: string;
        enregistre_par_nom: string | null;
        cumul_mois: string;
      }>(
        `SELECT ar.id, ar.fund_holder_id, a.full_name AS nom_complet, a.phone AS telephone,
                a.monthly_limit::text AS limite_mensuelle, ar.amount::text, ar.calendar_month,
                ar.calendar_year, ar.reason, ar.receipt_number, ar.withdrawn_at::text,
                COALESCE(NULLIF(TRIM(u.full_name), ''), u.username, u.email) AS enregistre_par_nom,
                -- Cumul du mois APRÈS ce retrait (pour information sur le reçu).
                (SELECT COALESCE(SUM(w.amount), 0)::numeric(14,2)::text FROM withdrawals w
                  WHERE w.fund_holder_id = ar.fund_holder_id AND w.calendar_month = ar.calendar_month
                    AND w.calendar_year = ar.calendar_year AND w.withdrawn_at <= ar.withdrawn_at) AS cumul_mois
           FROM withdrawals ar
           JOIN fund_holders a ON a.id = ar.fund_holder_id
           LEFT JOIN users u ON ar.recorded_by = u.id
          WHERE ar.id = $1`,
        [withdrawalId],
      );
      const r = rows[0];
      if (!r) throw new NotFoundException('Reçu introuvable.');
      const moyens = await this.tender.linesFor(tx, 'admin_retrait', r.id);
      const limite = money(r.limite_mensuelle);
      const cumul = money(r.cumul_mois);
      return {
        id: r.id,
        numero: r.receipt_number,
        date: r.withdrawn_at,
        nom_complet: r.nom_complet,
        telephone: r.telephone,
        motif: r.reason,
        mois: r.calendar_month,
        annee: r.calendar_year,
        limite_mensuelle: comptable ? null : toStorage(limite),
        cumul_mois: comptable ? null : toStorage(cumul),
        reste_apres: comptable ? null : toStorage(Decimal.max(0, limite.minus(cumul))),
        enregistre_par_nom: r.enregistre_par_nom,
        moyens,
        montant: r.amount,
      };
    });
  }

  /**
   * LES PORTEURS DE FONDS ET CE QU'ILS ONT RETIRÉ.
   *
   * ⚠ SANS LEUR PLAFOND POUR LE COMPTABLE. Sur `paiement_staff.php?type=admins`
   * ses colonnes sont « Nom · Téléphone · Retiré ce mois · Action » ; celle de
   * la limite mensuelle n'est tout simplement pas rendue pour lui. Il enregistre
   * les retraits — il lui faut la liste — mais le plafond d'un administrateur
   * n'est pas son affaire, et `administrateurs.php` lui refuse la page entière
   * pour la même raison : « le comptable ne voit NI la page NI les limites ».
   *
   * Retiré ici, dans la réponse, et pas seulement à l'écran : ce qui part sur
   * le réseau est lisible par qui reçoit la réponse.
   */
  async fundHolders(calendarMonth: number, calendarYear: number, roles: string[] = []) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        // ⚠ `monthly_limit` et `remaining` sont retirés plus bas pour le
        // comptable : sa colonne « Limite mensuelle » n'existe pas chez lui.
        `SELECT h.id, h.full_name, h.phone, h.monthly_limit, h.is_active,
                COALESCE(w.taken, 0)::numeric(14,2)::text AS taken,
                (h.monthly_limit - COALESCE(w.taken, 0))::numeric(14,2)::text AS remaining,
                -- ⚠ L'ÉTAT SANS LE CHIFFRE. Le comptable doit savoir qu'un
                -- retrait est impossible — sinon son écran lui offre un bouton
                -- que le serveur refusera — mais pas de combien est le plafond.
                -- Ces deux booléens portent la décision ; les montants, non.
                (h.monthly_limit <= 0.009) AS no_ceiling,
                (h.monthly_limit - COALESCE(w.taken, 0) <= 0.009) AS exhausted
           FROM fund_holders h
           LEFT JOIN (
             SELECT fund_holder_id, SUM(amount) AS taken FROM withdrawals
              WHERE calendar_month = $1 AND calendar_year = $2
              GROUP BY fund_holder_id
           ) w ON w.fund_holder_id = h.id
          ORDER BY h.is_active DESC, h.full_name`,
        [calendarMonth, calendarYear],
      );
      if (!roles.includes('comptable')) return rows;
      // Les MONTANTS partent ; `no_ceiling` et `exhausted` restent, parce que
      // l'écran doit encore savoir s'il peut proposer le bouton.
      return (rows as Record<string, unknown>[]).map(
        ({ monthly_limit, remaining, ...reste }) => {
          void monthly_limit;
          void remaining;
          return reste;
        },
      );
    });
  }

  /**
   * AJOUTER UN ADMINISTRATEUR — son action `ajouter_admin`.
   *
   * ⚠ UN « ADMINISTRATEUR » ICI N'EST PAS UN COMPTE. C'est un porteur de fonds :
   * quelqu'un à qui l'école remet de l'argent, avec un plafond mensuel. Il n'a
   * pas d'identifiant, ne se connecte nulle part, et sa fiche ne sert qu'à tenir
   * la limite et les retraits. La page vit sous Finance pour cette raison.
   */
  async addFundHolder(
    input: { fullName: string; phone?: string; monthlyLimit: string },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    const nom = input.fullName.trim();
    if (nom.length < 3) {
      throw new BadRequestException('Le nom complet doit faire au moins 3 caractères.');
    }

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO fund_holders (school_id, full_name, phone, monthly_limit)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [schoolId, nom, input.phone?.trim() || null, input.monthlyLimit],
      );
      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'fund_holder_added',
          entity: 'fund_holder',
          entityId: rows[0]!.id,
          after: { full_name: nom, monthly_limit: input.monthlyLimit },
        },
        tx,
      );
      return { id: rows[0]!.id };
    });
  }

  /**
   * CORRIGER LA LIMITE ET LE TÉLÉPHONE — son `modifier_admin`, les deux petits
   * champs et le « ✓ » de chaque ligne.
   *
   * ⚠ LA LIMITE EST DE L'ARGENT : elle passe en chaîne, jamais par un nombre JS.
   */
  async updateFundHolder(
    id: string,
    input: { monthlyLimit: string; phone?: string },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows: before } = await tx.query<{ monthly_limit: string; phone: string | null }>(
        'SELECT monthly_limit::text, phone FROM fund_holders WHERE id = $1',
        [id],
      );
      if (before.length === 0) throw new NotFoundException('Administrateur introuvable.');

      await tx.query(
        'UPDATE fund_holders SET monthly_limit = $2, phone = $3 WHERE id = $1',
        [id, input.monthlyLimit, input.phone?.trim() || null],
      );
      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'fund_holder_updated',
          entity: 'fund_holder',
          entityId: id,
          before: { monthly_limit: before[0]!.monthly_limit, phone: before[0]!.phone ?? '' },
          after: { monthly_limit: input.monthlyLimit, phone: input.phone?.trim() ?? '' },
        },
        tx,
      );
      return { id };
    });
  }

  /**
   * DÉSACTIVER OU RÉACTIVER — son `basculer_admin`.
   *
   * ⚠ JAMAIS UNE SUPPRESSION. Les retraits déjà enregistrés pointent cette
   * fiche ; l'effacer emporterait la trace de l'argent sorti.
   */
  async toggleFundHolder(id: string, actorId: string) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ is_active: boolean; full_name: string }>(
        'UPDATE fund_holders SET is_active = NOT is_active WHERE id = $1 RETURNING is_active, full_name',
        [id],
      );
      if (rows.length === 0) throw new NotFoundException('Administrateur introuvable.');

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: rows[0]!.is_active ? 'fund_holder_reactivated' : 'fund_holder_deactivated',
          entity: 'fund_holder',
          entityId: id,
          after: { full_name: rows[0]!.full_name },
        },
        tx,
      );
      return { active: rows[0]!.is_active };
    });
  }

  /**
   * LE RAPPORT DES RETRAITS — sa section « Rapports des retraits ».
   *
   * ⚠ TROIS PÉRIODES, LES SIENNES : journalier, mensuel, annuel. Sept colonnes,
   * dont « Enregistré par » et « Reçu » : un retrait sans le nom de qui l'a
   * saisi n'est pas vérifiable.
   */
  async withdrawalReport(input: {
    kind: 'jour' | 'mois' | 'annee';
    date?: string;
    month?: number;
    year: number;
  }) {
    return this.db.query(async (tx) => {
      /*
       * ⚠ CE RAPPORT N'A JAMAIS RENDU UNE SEULE LIGNE, dans aucune de ses trois
       * périodes. Les trois paramètres étaient passés à chaque fois, alors que
       * la clause n'en cite qu'un ou deux : PostgreSQL refuse un paramètre
       * qu'aucune expression ne type — « could not determine data type of
       * parameter $1 » — et rejetait donc la requête entière. Le `.catch()` de
       * la page transformait l'erreur en « Aucun retrait sur cette période »,
       * sur des mois où l'argent était bel et bien sorti de la caisse.
       *
       * Chaque période porte maintenant SES paramètres, numérotés depuis $1.
       */
      const [clause, params] =
        input.kind === 'jour'
          ? [
              "w.withdrawn_at >= $1::date AND w.withdrawn_at < ($1::date + interval '1 day')",
              [input.date ?? new Date().toISOString().slice(0, 10)],
            ]
          : input.kind === 'mois'
            ? ['w.calendar_month = $1 AND w.calendar_year = $2', [input.month, input.year]]
            : ['w.calendar_year = $1', [input.year]];

      const { rows } = await tx.query<{
        withdrawn_at: string;
        holder: string;
        amount: string;
        reason: string | null;
        receipt_number: string | null;
        recorded_by: string | null;
        tender: { method: string; amount: string }[] | null;
      }>(
        /*
         * UNE SEULE REQUÊTE, VENTILATION COMPRISE. El Ourwa fait deux allers —
         * les retraits, puis un IN(...) sur leurs identifiants — et note
         * lui-même « perf : 1 requête » à côté du second. Un LATERAL les réunit
         * et se sert de tender_lines_source_idx, qui commence par
         * (school_id, source_type, source_id).
         *
         * ⚠ LES MONTANTS SORTENT EN TEXTE, jamais agrégés en float. La somme se
         * fait en Decimal plus bas ; SUM() de PostgreSQL sur numeric serait
         * exact, mais le parseur pg rend NUMERIC en chaîne et la moindre
         * arithmétique JS sur ces chaînes les convertirait (règle 6).
         */
        `SELECT w.id, w.withdrawn_at, h.full_name AS holder, w.amount::text,
                w.reason, w.receipt_number,
                u.full_name AS recorded_by,
                t.lines AS tender
           FROM withdrawals w
           JOIN fund_holders h ON h.id = w.fund_holder_id
           LEFT JOIN users u ON u.id = w.recorded_by
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(
                      jsonb_build_object('method', m.name, 'amount', l.amount::text)
                      ORDER BY l.id
                    ) AS lines
               FROM tender_lines l
               JOIN payment_methods m ON m.id = l.payment_method_id
              WHERE l.school_id = w.school_id
                AND l.source_type = 'admin_retrait'
                AND l.source_id = w.id
           ) t ON true
          WHERE ${clause}
          ORDER BY w.withdrawn_at DESC
          LIMIT 500`,
        params,
      );

      /*
       * « Répartition par administrateur » — son `arsort`, du plus gros au plus
       * petit. Le plafond est mensuel ET par personne : un rapport annuel sans
       * cette ventilation ne se rapproche d'aucun plafond.
       *
       * Map conserve l'ordre d'insertion, donc deux administrateurs à égalité
       * restent dans l'ordre du tableau — un tri stable, pas un tirage.
       */
      /*
       * ⚠ LE TOTAL SE COMPTE SUR TOUTE LA PÉRIODE, PAS SUR LES 500 LIGNES
       * AFFICHÉES. Sommer `rows` donnerait un « TOTAL DE LA PÉRIODE » qui
       * s'arrête à la 500e sortie de caisse sans le dire — un chiffre financier
       * faux, présenté comme un total.
       *
       * SUM() sur `numeric` est exact chez PostgreSQL, et le parseur pg rend le
       * résultat en chaîne (règle 6). Rien ne devient un `number` en chemin.
       */
      const { rows: agg } = await tx.query<{ holder: string; total: string }>(
        `SELECT h.full_name AS holder, SUM(w.amount)::text AS total
           FROM withdrawals w
           JOIN fund_holders h ON h.id = w.fund_holder_id
          WHERE ${clause}
          GROUP BY h.full_name
          ORDER BY SUM(w.amount) DESC, h.full_name`,
        params,
      );

      const total = agg.reduce((sum, r) => sum.plus(money(r.total)), new Decimal(0));

      return {
        rows: rows.map((r) => ({ ...r, tender: r.tender ?? [] })),
        total: toStorage(total),
        // Son `arsort` : du plus gros au plus petit. Le plafond étant mensuel ET
        // par personne, un rapport sans cette ventilation ne se rapproche
        // d'aucun plafond. Départage par nom, pour que deux montants égaux ne
        // changent pas de place d'un affichage à l'autre.
        byHolder: agg.map((r) => ({ holder: r.holder, total: toStorage(money(r.total)) })),
        // Une liste plafonnée qui ne le dit pas se lit comme une liste complète.
        truncated: rows.length === 500,
      };
    });
  }
}
