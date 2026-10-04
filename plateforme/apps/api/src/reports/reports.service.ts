import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import {
  SOURCES_SERVICES,
  definitionService,
  libelleFraisPhotocopie,
  libelleService,
  libelleSourceService,
  money,
  toStorage,
  type ServiceCode,
} from '@elourwa/shared';
import { DbService } from '../db/db.service.js';
import { BillingModelService } from '../finance/billing-model.service.js';

/**
 * Financial reporting.
 *
 * Every figure here is computed from the underlying records at read time. There
 * is no rollup table yet, and at one school's volume there does not need to be:
 * a cached total that can drift from its source is a liability, and the moment
 * one exists it must also be rebuildable and reconciled. When volume demands it,
 * `finance_daily_rollup` goes in — as a cache, never as the source of truth.
 *
 * ⚠ THE MONTH OF A FIGURE IS THE MONTH THE MONEY MOVED, never the month it was
 * billed for. El Ourwa's `rapport_financier` reads `paiement_lignes` filtered on
 * `MONTH(pl.date_creation)`, so a September fee settled in November belongs to
 * November's report. Keying on the billed month instead would show cash the till
 * never saw that month, and hide cash it did. See ADR-0013.
 *
 * ÉCOLE « SERVICES » (ADR-0073, spec §10) — les encaissements de service ont
 * leur propre grand livre (`service_payments`) et un `source_type` de moyens
 * par service : « Par origine » les sépare sans rien changer ici ; le mois les
 * compte dans `income.services` ; le journal les décrit ; le bilan de l'année
 * les contrôle. Une école « famille » n'a aucune ligne de service : chacun de
 * ses chiffres reste celui d'avant (`income.services` vaut 0.00).
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(BillingModelService) private readonly billing: BillingModelService,
  ) {}

  /**
   * The month's money, both directions.
   *
   * Dated by the movement, not by the period billed. A November payment of a
   * September fee is November cash.
   */
  async monthly(calendarMonth: number, calendarYear: number) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        tuition: string;
        evening: string;
        family_fees: string;
        expenses: string;
        salaries: string;
        salaries_teachers: string;
        salaries_staff: string;
        withdrawals: string;
        receipts: string;
        services: string;
      }>(
        `SELECT
           (SELECT COALESCE(SUM(amount), 0)::numeric(14,2)::text FROM payments
             WHERE EXTRACT(MONTH FROM paid_at) = $1
               AND EXTRACT(YEAR FROM paid_at) = $2) AS tuition,
           -- École « services » (ADR-0073) : son grand livre des services, daté
           -- comme le reste par le mouvement ; les annulations (négatives)
           -- comprises, dans le mois où elles sont faites. Vide ailleurs.
           (SELECT COALESCE(SUM(amount), 0)::numeric(14,2)::text FROM service_payments
             WHERE EXTRACT(MONTH FROM paid_at) = $1
               AND EXTRACT(YEAR FROM paid_at) = $2) AS services,
           (SELECT COALESCE(SUM(amount), 0)::numeric(14,2)::text FROM evening_payments
             WHERE EXTRACT(MONTH FROM paid_at) = $1
               AND EXTRACT(YEAR FROM paid_at) = $2) AS evening,
           (SELECT COALESCE(SUM(amount), 0)::numeric(14,2)::text FROM family_fee_payments
             WHERE EXTRACT(MONTH FROM paid_at) = $1
               AND EXTRACT(YEAR FROM paid_at) = $2) AS family_fees,
           (SELECT COALESCE(SUM(amount), 0)::numeric(14,2)::text FROM expenses
             WHERE EXTRACT(MONTH FROM spent_at) = $1
               AND EXTRACT(YEAR FROM spent_at) = $2) AS expenses,
           -- Reversals are included on purpose: they carry negative amounts,
           -- so summing everything is what nets a cancelled salary back out.
           (SELECT COALESCE(SUM(net), 0)::numeric(14,2)::text FROM salary_payments
             WHERE EXTRACT(MONTH FROM paid_at) = $1
               AND EXTRACT(YEAR FROM paid_at) = $2) AS salaries,
           -- ⚠ SPLIT, because the dashboard's doughnut plots the two separately:
           -- "Salaires professeurs" and "Salaires staff" are its own two slices.
           -- Teaching costs and administration costs are different questions and
           -- a school that cannot tell them apart cannot answer either.
           (SELECT COALESCE(SUM(net), 0)::numeric(14,2)::text FROM salary_payments
             WHERE EXTRACT(MONTH FROM paid_at) = $1
               AND EXTRACT(YEAR FROM paid_at) = $2
               AND payee_kind = 'teacher') AS salaries_teachers,
           (SELECT COALESCE(SUM(net), 0)::numeric(14,2)::text FROM salary_payments
             WHERE EXTRACT(MONTH FROM paid_at) = $1
               AND EXTRACT(YEAR FROM paid_at) = $2
               AND payee_kind <> 'teacher') AS salaries_staff,
           (SELECT COALESCE(SUM(amount), 0)::numeric(14,2)::text FROM withdrawals
             WHERE EXTRACT(MONTH FROM withdrawn_at) = $1
               AND EXTRACT(YEAR FROM withdrawn_at) = $2) AS withdrawals,
           -- Reversals draw a receipt number of their own, so they count as
           -- receipts issued even though they subtract from the total.
           (SELECT count(*)::text FROM payments
             WHERE EXTRACT(MONTH FROM paid_at) = $1
               AND EXTRACT(YEAR FROM paid_at) = $2) AS receipts`,
        [calendarMonth, calendarYear],
      );

      const r = rows[0]!;
      const income = money(r.tuition)
        .plus(money(r.evening))
        .plus(money(r.family_fees))
        .plus(money(r.services));
      const outgoings = money(r.expenses)
        .plus(money(r.salaries))
        .plus(money(r.withdrawals));

      return {
        calendarMonth,
        calendarYear,
        income: {
          tuition: r.tuition,
          evening: r.evening,
          familyFees: r.family_fees,
          /** École « services » : cantine, piscine, docteur, photocopie, inscription par élève. */
          services: r.services,
          total: toStorage(income),
        },
        outgoings: {
          expenses: r.expenses,
          salaries: r.salaries,
          salariesTeachers: r.salaries_teachers,
          salariesStaff: r.salaries_staff,
          withdrawals: r.withdrawals,
          total: toStorage(outgoings),
        },
        // Not "profit": a school's month is not a trading period, and calling it
        // that would invite reading it as one.
        net: toStorage(income.minus(outgoings)),
        receipts: Number(r.receipts),
      };
    });
  }

  /** Collections per day for a month — the shape of the month, not just its total. */
  async dailyCollections(calendarMonth: number, calendarYear: number) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ day: string; total: string; count: string }>(
        `SELECT EXTRACT(DAY FROM paid_at)::int::text AS day,
                SUM(amount)::numeric(14,2)::text AS total,
                count(*)::text AS count
           FROM payments
          WHERE EXTRACT(MONTH FROM paid_at) = $1
            AND EXTRACT(YEAR FROM paid_at) = $2
          GROUP BY 1 ORDER BY 1`,
        [calendarMonth, calendarYear],
      );
      return rows.map((r) => ({
        day: Number(r.day),
        total: r.total,
        count: Number(r.count),
      }));
    });
  }

  /**
   * How money moved, per means of payment — BOTH directions.
   *
   * Reads `tender_lines`, which since 0014 every movement posts to: a receipt, a
   * salary, an expense, a withdrawal. Before that only tuition did, so the
   * Sorties column on Rapport Financier could not be filled at all.
   */
  async byPaymentMethod(calendarMonth: number, calendarYear: number) {
    return this.db.query(async (tx) => {
      // Son « Synthèse par moyen de paiement » : TOUS les moyens (LEFT JOIN),
      // un moyen sans mouvement à zéro, par ordre de nom.
      const { rows } = await tx.query<{
        name: string;
        entrant: string;
        sortant: string;
        total: string;
      }>(
        `SELECT m.name,
                COALESCE(SUM(t.amount) FILTER (WHERE t.direction = 'in'), 0)
                  ::numeric(14,2)::text AS entrant,
                COALESCE(SUM(t.amount) FILTER (WHERE t.direction = 'out'), 0)
                  ::numeric(14,2)::text AS sortant,
                COALESCE(SUM(t.amount) FILTER (WHERE t.direction = 'in'), 0)
                  ::numeric(14,2)::text AS total
           FROM payment_methods m
           LEFT JOIN tender_lines t ON t.payment_method_id = m.id
            AND EXTRACT(MONTH FROM t.created_at) = $1
            AND EXTRACT(YEAR  FROM t.created_at) = $2
          GROUP BY m.id, m.name
          ORDER BY m.name`,
        [calendarMonth, calendarYear],
      );
      return rows;
    });
  }

  /**
   * STATISTIQUES — `statistiques.php` : « Répartition par sexe — personnel et
   * étudiants ». Son `compte_sexe()` sur quatre populations (M / F / n.d. /
   * total), puis les élèves de l'ANNÉE CONSULTÉE par niveau et par groupe.
   *
   * Ses deux requêtes partent des NIVEAUX et des GROUPES (LEFT JOIN) : un
   * niveau ou une classe sans inscrit apparaît à zéro plutôt que de disparaître.
   * Le compte passe par `groupes` → `etudiant_inscriptions` (année, statut <>
   * annulé) → `etudiants` ; ordre `n.cycle, n.ordre, n.nom[, g.nom]`.
   *
   * Ses tables : `professeurs` (tous), `staff WHERE actif = 1`,
   * `personnel_admin` (tous), `etudiants` (tous). Chez nous `personnel_admin`
   * — la fiche d'identité d'un compte de direction — et `staff` sont une seule
   * table : les « Administrateurs » sont les fiches portant un compte
   * (`user_id`), le « Staff » celles qui n'en portent pas.
   */
  async statistics(academicYearId: string) {
    return this.db.query(async (tx) => {
      const compteSexe = async (from: string) => {
        const { rows } = await tx.query<{ m: string; f: string; nd: string; total: string }>(
          `SELECT count(*) FILTER (WHERE sex = 'M')::text AS m,
                  count(*) FILTER (WHERE sex = 'F')::text AS f,
                  count(*) FILTER (WHERE sex IS NULL)::text AS nd,
                  count(*)::text AS total
             FROM ${from}`,
        );
        const r = rows[0]!;
        return { m: Number(r.m), f: Number(r.f), nd: Number(r.nd), total: Number(r.total) };
      };
      const profs = await compteSexe('teachers');
      const staff = await compteSexe('staff WHERE is_active AND user_id IS NULL');
      const admins = await compteSexe('staff WHERE user_id IS NOT NULL');
      const etudiants = await compteSexe('students');

      // Par niveau
      const { rows: parNiveau } = await tx.query<{
        niveau: string;
        m: string;
        f: string;
        total: string;
      }>(
        `SELECT n.name AS niveau,
                count(*) FILTER (WHERE e.sex = 'M')::text AS m,
                count(*) FILTER (WHERE e.sex = 'F')::text AS f,
                count(e.id)::text AS total
           FROM levels n
           LEFT JOIN groups g ON g.level_id = n.id
           LEFT JOIN enrollments ins ON ins.group_id = g.id
                                    AND ins.academic_year_id = $1
                                    AND ins.status <> 'cancelled'
           LEFT JOIN students e ON e.id = ins.student_id
          GROUP BY n.id, n.name, n.cycle, n.sort_order
          ORDER BY n.cycle, n.sort_order, n.name`,
        [academicYearId],
      );

      // Par groupe
      const { rows: parGroupe } = await tx.query<{
        groupe: string;
        niveau: string;
        m: string;
        f: string;
        total: string;
      }>(
        `SELECT g.name AS groupe, COALESCE(n.name, 'Sans niveau') AS niveau,
                count(*) FILTER (WHERE e.sex = 'M')::text AS m,
                count(*) FILTER (WHERE e.sex = 'F')::text AS f,
                count(e.id)::text AS total
           FROM groups g
           LEFT JOIN levels n ON g.level_id = n.id
           LEFT JOIN enrollments ins ON ins.group_id = g.id
                                    AND ins.academic_year_id = $1
                                    AND ins.status <> 'cancelled'
           LEFT JOIN students e ON e.id = ins.student_id
          GROUP BY g.id, g.name, n.name, n.cycle, n.sort_order
          ORDER BY n.cycle, n.sort_order, n.name, g.name`,
        [academicYearId],
      );

      return {
        profs,
        staff,
        admins,
        etudiants,
        parNiveau: parNiveau.map((r) => ({
          niveau: r.niveau,
          m: Number(r.m),
          f: Number(r.f),
          total: Number(r.total),
        })),
        parGroupe: parGroupe.map((r) => ({
          groupe: r.groupe,
          niveau: r.niveau,
          m: Number(r.m),
          f: Number(r.f),
          total: Number(r.total),
        })),
      };
    });
  }

  /**
   * Today's takings, as the till would count them.
   *
   * El Ourwa calls this "revenue live" and the office watches it during the day.
   */
  async today() {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        collected: string;
        receipts: string;
        expenses: string;
      }>(
        `SELECT
           (SELECT COALESCE(SUM(amount), 0)::numeric(14,2)::text FROM payments
             WHERE paid_at::date = CURRENT_DATE) AS collected,
           (SELECT count(*)::text FROM payments
             WHERE paid_at::date = CURRENT_DATE) AS receipts,
           (SELECT COALESCE(SUM(amount), 0)::numeric(14,2)::text FROM expenses
             WHERE spent_at::date = CURRENT_DATE) AS expenses`,
      );
      const r = rows[0]!;
      return {
        collected: r.collected,
        receipts: Number(r.receipts),
        expenses: r.expenses,
        net: toStorage(money(r.collected).minus(money(r.expenses))),
      };
    });
  }

  /**
   * THE DASHBOARD'S FOUR CHARTS — `tableau_bord.php`.
   *
   * Revenue per level, revenue per group, the financial split, and headcount per
   * group. One call: four separate round trips for one screen that opens every
   * morning is four chances for it to open half-drawn.
   *
   * ⚠ REVENUE HERE IS THE MONTHLY BILL, NOT WHAT WAS COLLECTED. El Ourwa sums
   * `frais_mensuel` — what the school charges per month if everyone pays — and
   * the chart is titled "Revenu par niveau" on that basis. Reading it as receipts
   * would make every bar smaller than the office expects and the dashboard would
   * be quietly wrong rather than loudly broken.
   *
   * Read from the ENROLMENT of the year being viewed, never from the student
   * row: that column knows nothing of the year, of a scholarship, or of a child
   * who has left.
   */
  async dashboardCharts(academicYearId: string) {
    const tb = await this.tableauBord(academicYearId);
    return { byLevel: tb.revenusNiveaux, byGroup: tb.revenusGroupes };
  }

  /**
   * LE TABLEAU DE BORD — `tableau_bord.php`, sur l'année CONSULTÉE.
   *
   * Ses chiffres, avec ses règles :
   *   - effectif : les inscriptions de l'année (active : `inscrit` ; clôturée :
   *     tout sauf `bloque_dette`) ;
   *   - professeurs : ceux qui ont un enseignement sur l'année, sinon tout le
   *     corps enseignant ;
   *   - revenu brut : la somme des `frais_mensuel` des inscriptions (active :
   *     `inscrit` ; clôturée : ni `bloque_dette` ni `annule`) — le revenu
   *     mensuel THÉORIQUE, pas les encaissements ;
   *   - charges : les salaires des professeurs + ceux du staff actif + les
   *     dépenses validées du mois civil courant ; gain net = revenu − charges ;
   *   - revenu par niveau (tous les niveaux, à zéro s'il le faut, dans l'ordre
   *     de création), revenu et effectif par groupe (« Niveau — Groupe », par
   *     cycle / ordre / nom).
   * Sans année : rien plutôt que tout (« un gain net faux de plusieurs millions »).
   */
  async tableauBord(academicYearId: string | null) {
    return this.db.query(async (tx) => {
      const annee = academicYearId
        ? (await tx.query<{ id: string; label: string; status: string }>(
            'SELECT id, label, status FROM academic_years WHERE id = $1',
            [academicYearId],
          )).rows[0] ?? null
        : null;

      // Effectif.
      let totalEtudiants = 0;
      if (annee) {
        const { rows } = await tx.query<{ n: string }>(
          annee.status === 'active'
            ? "SELECT count(*)::text AS n FROM enrollments WHERE academic_year_id = $1 AND status = 'enrolled'"
            : "SELECT count(*)::text AS n FROM enrollments WHERE academic_year_id = $1 AND status <> 'debt_blocked'",
          [annee.id],
        );
        totalEtudiants = Number(rows[0]!.n);
      } else {
        const { rows } = await tx.query<{ n: string }>('SELECT count(*)::text AS n FROM students');
        totalEtudiants = Number(rows[0]!.n);
      }

      // Professeurs.
      let totalProfesseurs = 0;
      if (annee) {
        const { rows } = await tx.query<{ n: string }>(
          'SELECT count(DISTINCT teacher_id)::text AS n FROM teachings WHERE academic_year_id = $1',
          [annee.id],
        );
        totalProfesseurs = Number(rows[0]!.n);
      }
      if (totalProfesseurs === 0) {
        const { rows } = await tx.query<{ n: string }>('SELECT count(*)::text AS n FROM teachers');
        totalProfesseurs = Number(rows[0]!.n);
      }

      // Sa condition de statut, la même pour le revenu ET les graphiques.
      const cond = annee?.status === 'active'
        ? "e.status = 'enrolled'"
        : "e.status NOT IN ('debt_blocked', 'cancelled')";

      let revenuBrut = new Decimal(0);
      let revenusNiveaux: { name: string; revenue: string }[] = [];
      let revenusGroupes: { name: string; revenue: string; headcount: number }[] = [];
      if (annee) {
        const { rows } = await tx.query<{ total: string }>(
          `SELECT COALESCE(SUM(e.monthly_fee), 0)::text AS total
             FROM enrollments e WHERE e.academic_year_id = $1 AND ${cond}`,
          [annee.id],
        );
        revenuBrut = money(rows[0]!.total);

        // « Le LEFT JOIN garde les niveaux sans inscription cette année-là » ;
        // son ORDER BY n.id : l'ordre de création (les niveaux repris d'abord).
        const niveaux = await tx.query<{ name: string; revenue: string }>(
          `SELECT l.name, COALESCE(SUM(e.monthly_fee), 0)::text AS revenue
             FROM levels l
             LEFT JOIN enrollments e
               ON e.level_id = l.id AND e.academic_year_id = $1 AND ${cond}
            GROUP BY l.id, l.name, l.legacy_id, l.cycle, l.sort_order
            ORDER BY l.legacy_id NULLS LAST, l.cycle, l.sort_order, l.name`,
          [annee.id],
        );
        revenusNiveaux = niveaux.rows.map((r) => ({ name: r.name, revenue: toStorage(money(r.revenue)) }));

        // « COUNT(i.id) et non COUNT(e.id) : c'est le nombre d'INSCRIPTIONS de l'année ».
        const groupes = await tx.query<{ name: string; revenue: string; headcount: string }>(
          `SELECT COALESCE(l.name, 'Sans niveau') || ' — ' || g.name AS name,
                  COALESCE(SUM(e.monthly_fee), 0)::text AS revenue,
                  COUNT(e.id)::text AS headcount
             FROM groups g
             LEFT JOIN levels l ON l.id = g.level_id
             LEFT JOIN enrollments e
               ON e.group_id = g.id AND e.academic_year_id = $1 AND ${cond}
            GROUP BY g.id, g.name, l.name, l.cycle, l.sort_order
            ORDER BY l.cycle, l.sort_order, l.name, g.name`,
          [annee.id],
        );
        revenusGroupes = groupes.rows.map((r) => ({
          name: r.name,
          revenue: toStorage(money(r.revenue)),
          headcount: Number(r.headcount),
        }));
      }

      // Charges : salaires des professeurs, du staff actif, dépenses du mois courant.
      const { rows: ch } = await tx.query<{ profs: string; staff: string; depenses: string }>(
        `SELECT (SELECT COALESCE(SUM(salary), 0)::text FROM teachers) AS profs,
                (SELECT COALESCE(SUM(salary), 0)::text FROM staff WHERE is_active) AS staff,
                (SELECT COALESCE(SUM(amount), 0)::text FROM expenses
                  WHERE EXTRACT(YEAR FROM spent_at) = EXTRACT(YEAR FROM CURRENT_DATE)
                    AND EXTRACT(MONTH FROM spent_at) = EXTRACT(MONTH FROM CURRENT_DATE)) AS depenses`,
      );
      const chargesProfs = money(ch[0]!.profs);
      const chargesStaff = money(ch[0]!.staff);
      const depensesSup = money(ch[0]!.depenses);
      const chargesTotales = chargesProfs.plus(chargesStaff).plus(depensesSup);
      const gainNet = revenuBrut.minus(chargesTotales);

      return {
        annee: annee ? { id: annee.id, label: annee.label } : null,
        totalEtudiants,
        totalProfesseurs,
        revenuBrut: toStorage(revenuBrut),
        chargesProfs: toStorage(chargesProfs),
        chargesStaff: toStorage(chargesStaff),
        depensesSup: toStorage(depensesSup),
        chargesTotales: toStorage(chargesTotales),
        gainNet: toStorage(gainNet),
        revenusNiveaux,
        revenusGroupes,
      };
    });
  }

  /**
   * « DÉTAILS DES TRANSACTIONS DE LA PÉRIODE » — `rapport_financier.php`.
   *
   * Une ligne par ligne de caisse (`paiement_lignes`) du mois — jamais un
   * résumé — avec son type (`$src_labels`), sa description (`get_report_desc()`),
   * son moyen, son sens, son montant et qui l'a enregistrée. Chez lui, sans
   * limite ; le journal du jour (`gestion_caisse.php`) passe par la même
   * requête avec `day`.
   */
  async transactions(input: { day?: string; month?: number; year?: number; limit?: number }) {
    return this.db.query(async (tx) => {
      const byDay = Boolean(input.day);
      const { rows } = await tx.query<{
        at: string;
        direction: string;
        source_type: string;
        amount: string;
        method: string;
        recorded_by: string | null;
        recorded_by_role: string | null;
        et_nom: string | null;
        pay_m: number | null;
        pay_a: number | null;
        dep_desc: string | null;
        sal_type: string | null;
        sal_nom: string | null;
        sal_m: number | null;
        sal_a: number | null;
        det_nom: string | null;
        cs_nom: string | null;
        cs_m: number | null;
        cs_a: number | null;
        cspp_nom: string | null;
        cspp_m: number | null;
        cspp_a: number | null;
        fa_type: string | null;
        fa_parent_nom: string | null;
        pret_benef_nom: string | null;
        adm_nom: string | null;
        svc_nom: string | null;
        svc_service: ServiceCode | null;
        svc_m: number | null;
        svc_a: number | null;
      }>(
        `SELECT tl.created_at AS at, tl.direction, tl.source_type,
                tl.amount::text, pm.name AS method,

                -- Son COALESCE(… prenom nom …, identifiant) sur les neuf auteurs possibles.
                -- (u_svc : l'encaissement d'un service, école « services » ; une
                -- seule jointure répond par ligne, l'ordre ne change donc rien.)
                COALESCE(NULLIF(TRIM(u_adm.full_name), ''), NULLIF(TRIM(u_pay.full_name), ''),
                         NULLIF(TRIM(u_dep.full_name), ''), NULLIF(TRIM(u_sal.full_name), ''),
                         NULLIF(TRIM(u_dr.full_name), ''), NULLIF(TRIM(u_cs.full_name), ''),
                         NULLIF(TRIM(u_fa.full_name), ''), NULLIF(TRIM(u_cspp.full_name), ''),
                         NULLIF(TRIM(u_pret.full_name), ''), NULLIF(TRIM(u_premb.full_name), ''),
                         NULLIF(TRIM(u_svc.full_name), ''),
                         u_pay.username, u_dep.username, u_sal.username, u_dr.username,
                         u_cs.username, u_fa.username, u_cspp.username, u_svc.username) AS recorded_by,
                -- Son COALESCE(u_x.role ...) : le rôle de l'auteur dans cette école.
                (SELECT r.code FROM user_school_roles usr JOIN roles r ON r.id = usr.role_id
                  WHERE usr.school_id = tl.school_id
                    AND usr.user_id = COALESCE(u_adm.id, u_pay.id, u_dep.id, u_sal.id, u_dr.id,
                                               u_cs.id, u_fa.id, u_cspp.id, u_pret.id, u_premb.id,
                                               u_svc.id)
                  ORDER BY r.code LIMIT 1) AS recorded_by_role,

                TRIM(st.first_name || ' ' || st.last_name) AS et_nom,
                p.calendar_month AS pay_m, p.calendar_year AS pay_a,
                e.description AS dep_desc,
                sp.payee_kind AS sal_type,
                CASE WHEN sp.payee_kind = 'teacher' THEN TRIM(te.first_name || ' ' || te.last_name)
                     WHEN sp.payee_kind = 'staff' THEN TRIM(stf.first_name || ' ' || stf.last_name)
                     ELSE NULL END AS sal_nom,
                sp.calendar_month AS sal_m, sp.calendar_year AS sal_a,
                md.debtor_name AS det_nom,
                COALESCE(TRIM(evs.first_name || ' ' || evs.last_name), en.outsider_name) AS cs_nom,
                ep.calendar_month AS cs_m, ep.calendar_year AS cs_a,
                COALESCE(TRIM(cspt.first_name || ' ' || cspt.last_name),
                         TRIM(cspe.first_name || ' ' || cspe.last_name)) AS cspp_nom,
                etp.calendar_month AS cspp_m, etp.calendar_year AS cspp_a,
                ffp.kind AS fa_type, g.full_name AS fa_parent_nom,
                COALESCE(l1.payee_name, l2.payee_name) AS pret_benef_nom,
                fh.full_name AS adm_nom,
                TRIM(svs.first_name || ' ' || svs.last_name) AS svc_nom,
                svc_ss.service AS svc_service,
                svc.calendar_month AS svc_m, svc.calendar_year AS svc_a

           FROM tender_lines tl
           JOIN payment_methods pm ON pm.id = tl.payment_method_id

           LEFT JOIN payments p ON tl.source_type = 'paiement' AND p.id = tl.source_id
           LEFT JOIN students st ON st.id = p.student_id
           LEFT JOIN users u_pay ON u_pay.id = p.recorded_by

           LEFT JOIN expenses e ON tl.source_type = 'depense' AND e.id = tl.source_id
           LEFT JOIN users u_dep ON u_dep.id = e.created_by

           LEFT JOIN salary_payments sp
             ON tl.source_type IN ('salaire_prof', 'salaire_staff', 'salaire') AND sp.id = tl.source_id
           LEFT JOIN teachers te ON sp.payee_kind = 'teacher' AND te.id = sp.payee_id
           LEFT JOIN staff stf ON sp.payee_kind = 'staff' AND stf.id = sp.payee_id
           LEFT JOIN users u_sal ON u_sal.id = sp.paid_by

           LEFT JOIN misc_debt_repayments mdr ON tl.source_type = 'dette' AND mdr.id = tl.source_id
           LEFT JOIN misc_debts md ON md.id = mdr.debt_id
           LEFT JOIN users u_dr ON u_dr.id = mdr.recorded_by

           LEFT JOIN evening_payments ep ON tl.source_type = 'cours_soir' AND ep.id = tl.source_id
           LEFT JOIN evening_enrolments en ON en.id = ep.enrolment_id
           LEFT JOIN students evs ON evs.id = en.student_id
           LEFT JOIN users u_cs ON u_cs.id = ep.recorded_by

           LEFT JOIN family_fee_payments ffp ON tl.source_type = 'frais_annuel' AND ffp.id = tl.source_id
           LEFT JOIN users g ON g.id = ffp.guardian_id
           LEFT JOIN users u_fa ON u_fa.id = ffp.recorded_by

           LEFT JOIN evening_teacher_payments etp
             ON tl.source_type = 'cours_soir_prof' AND etp.id = tl.source_id
           LEFT JOIN evening_teachings evt ON evt.id = etp.evening_teaching_id
           LEFT JOIN teachers cspt ON cspt.id = evt.teacher_id
           LEFT JOIN evening_teachers cspe ON cspe.id = evt.evening_teacher_id
           LEFT JOIN users u_cspp ON u_cspp.id = etp.paid_by

           LEFT JOIN staff_loans l1 ON tl.source_type = 'pret_personnel' AND l1.id = tl.source_id
           LEFT JOIN users u_pret ON u_pret.id = l1.granted_by
           LEFT JOIN loan_repayments lr ON tl.source_type = 'pret_remb' AND lr.id = tl.source_id
           LEFT JOIN staff_loans l2 ON l2.id = lr.loan_id
           LEFT JOIN users u_premb ON u_premb.id = lr.recorded_by

           LEFT JOIN withdrawals w ON tl.source_type = 'admin_retrait' AND w.id = tl.source_id
           LEFT JOIN fund_holders fh ON fh.id = w.fund_holder_id
           LEFT JOIN users u_adm ON u_adm.id = w.recorded_by

           -- École « services » (ADR-0073) : l'encaissement d'un service, ou son
           -- annulation (ses lignes « out » portent l'écriture négative).
           LEFT JOIN service_payments svc
             ON tl.source_type = ANY($5::text[]) AND svc.id = tl.source_id
           LEFT JOIN student_services svc_ss ON svc_ss.id = svc.student_service_id
           LEFT JOIN students svs ON svs.id = svc.student_id
           LEFT JOIN users u_svc ON u_svc.id = svc.recorded_by

          WHERE ($1::date IS NULL OR tl.created_at::date = $1::date)
            AND ($2::int  IS NULL OR EXTRACT(MONTH FROM tl.created_at) = $2)
            AND ($3::int  IS NULL OR EXTRACT(YEAR  FROM tl.created_at) = $3)
          ORDER BY tl.created_at DESC
          LIMIT $4`,
        [
          byDay ? input.day : null,
          byDay ? null : (input.month ?? null),
          byDay ? null : (input.year ?? null),
          input.limit ?? 100000,
          [...SOURCES_SERVICES],
        ],
      );

      return rows.map((r) => ({
        at: r.at,
        direction: r.direction as 'in' | 'out',
        sourceType: r.source_type,
        type: SOURCE_LABELS[r.source_type] ?? r.source_type,
        amount: toStorage(money(r.amount)),
        method: r.method,
        recordedBy: r.recorded_by,
        recordedByRole: r.recorded_by_role,
        description: describe(r),
      }));
    });
  }

  /**
   * « REVENUS DU JOUR » — `revenue_live.php` : les entrées du jour par moyen
   * (`ORDER BY total DESC`) et par origine, et leur total.
   */
  async revenusDuJour(jour: string) {
    return this.db.query(async (tx) => {
      const { rows: parMoyen } = await tx.query<{ moyen: string; total: string }>(
        `SELECT mp.name AS moyen, COALESCE(SUM(pl.amount), 0)::numeric(14,2)::text AS total
           FROM tender_lines pl JOIN payment_methods mp ON pl.payment_method_id = mp.id
          WHERE pl.direction = 'in' AND pl.created_at::date = $1::date
          GROUP BY mp.id, mp.name ORDER BY SUM(pl.amount) DESC`,
        [jour],
      );
      const { rows: parSource } = await tx.query<{ source_type: string; total: string }>(
        `SELECT pl.source_type, COALESCE(SUM(pl.amount), 0)::numeric(14,2)::text AS total
           FROM tender_lines pl
          WHERE pl.direction = 'in' AND pl.created_at::date = $1::date
          GROUP BY pl.source_type ORDER BY SUM(pl.amount) DESC`,
        [jour],
      );
      const total = parMoyen.reduce((a, r) => a.plus(money(r.total)), new Decimal(0));
      return {
        total: toStorage(total),
        parMoyen,
        parSource: parSource.map((r) => ({
          ...r,
          label: SOURCE_LABELS[r.source_type] ?? r.source_type,
        })),
      };
    });
  }

  /** « Payé aux professeurs / au staff » du mois — `paiements_salaire` par type. */
  async salairesDuMois(calendarMonth: number, calendarYear: number) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ payee_kind: string; total: string }>(
        `SELECT payee_kind, COALESCE(SUM(net), 0)::numeric(14,2)::text AS total
           FROM salary_payments WHERE calendar_month = $1 AND calendar_year = $2
          GROUP BY payee_kind`,
        [calendarMonth, calendarYear],
      );
      const par = (k: string) => rows.find((r) => r.payee_kind === k)?.total ?? '0.00';
      return { professeur: par('teacher'), staff: par('staff') };
    });
  }

  /**
   * « SYNTHÈSE — ANNÉE SCOLAIRE » — `bilan_annee_scolaire()` et
   * `controle_caisse()` d'`includes/paiements.php`.
   *
   * Pour une année reprise, le chiffre d'encaissement est celui des REÇUS de
   * l'ancien système (archive `legacy_receipts`), « le seul qui reflète tout
   * l'argent entré » ; la dépense est le plus grand du débit d'archive
   * (compte 560011) et des sorties de caisse d'ici. Sans reçu sur la période,
   * la caisse d'El Ourwa (`tender_lines`) fait foi. Bornes : du 1er du mois de
   * début au dernier jour du mois de fin, l'année civile suivante ; sans année,
   * l'année civile courante.
   */
  async bilanAnneeScolaire(annee: {
    id: string;
    label: string;
    start_year: number;
    start_month: number;
    end_month: number;
  } | null) {
    return this.db.query(async (tx) => {
      const y = new Date().getFullYear();
      const du = annee
        ? `${annee.start_year}-${String(annee.start_month).padStart(2, '0')}-01`
        : `${y}-01-01`;
      const finMois = annee ? annee.end_month : 12;
      const finAnnee = annee ? annee.start_year + 1 : y;
      const dernierJour = new Date(Date.UTC(finAnnee, finMois, 0)).getUTCDate();
      const au = `${finAnnee}-${String(finMois).padStart(2, '0')}-${String(dernierJour).padStart(2, '0')}`;

      const { rows: recus } = await tx.query<{ n: string; m: string }>(
        `SELECT COUNT(*)::text AS n, COALESCE(SUM(amount_paid), 0)::numeric(14,2)::text AS m
           FROM legacy_receipts WHERE received_at::date BETWEEN $1::date AND $2::date`,
        [du, au],
      );
      const { rows: caisse } = await tx.query<{ e: string; s: string }>(
        `SELECT COALESCE(SUM(amount) FILTER (WHERE direction = 'in'), 0)::numeric(14,2)::text AS e,
                COALESCE(SUM(amount) FILTER (WHERE direction = 'out'), 0)::numeric(14,2)::text AS s
           FROM tender_lines WHERE created_at::date BETWEEN $1::date AND $2::date`,
        [du, au],
      );
      const { rows: archive } = await tx.query<{ d: string }>(
        `SELECT COALESCE(SUM(debit), 0)::numeric(14,2)::text AS d FROM legacy_ledger_lines
          WHERE account = '560011' AND piece_date BETWEEN $1::date AND $2::date`,
        [du, au],
      );

      const nb = Number(recus[0]!.n);
      const bilan =
        nb > 0
          ? {
              encaisse: recus[0]!.m,
              depense: toStorage(Decimal.max(money(archive[0]!.d), money(caisse[0]!.s))),
              nb,
              source: 'recus' as const,
            }
          : { encaisse: caisse[0]!.e, depense: caisse[0]!.s, nb: 0, source: 'caisse' as const };

      // Contrôle de cohérence : chaque paiement doit être intégralement
      // ventilé en lignes de caisse, sinon les totaux sont faux sans que rien
      // ne le signale.
      const w = annee ? 'WHERE p.academic_year_id = $1' : '';
      const arg = annee ? [annee.id] : [];
      const { rows: nbP } = await tx.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM payments p ${w}`,
        arg,
      );
      const { rows: sansLigne } = await tx.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM payments p ${w ? w + ' AND' : 'WHERE'} NOT EXISTS (
            SELECT 1 FROM tender_lines l WHERE l.source_type = 'paiement' AND l.source_id = p.id)`,
        arg,
      );
      const { rows: ecarts } = await tx.query<{ n: string; m: string }>(
        `SELECT COUNT(*)::text AS n, COALESCE(SUM(ABS(ecart)), 0)::numeric(14,2)::text AS m FROM (
            -- Signé, comme tillConsistency : une annulation écrit des lignes « out ».
            SELECT p.id, p.amount - COALESCE((SELECT SUM(CASE WHEN l.direction = 'out' THEN -l.amount ELSE l.amount END)
                     FROM tender_lines l
                     WHERE l.source_type = 'paiement' AND l.source_id = p.id), 0) AS ecart
              FROM payments p ${w}) x WHERE ABS(ecart) > 0.009`,
        arg,
      );

      const controle = {
        paiements: Number(nbP[0]!.n),
        sans_ligne: Number(sansLigne[0]!.n),
        ecart_nb: Number(ecarts[0]!.n),
        ecart_montant: ecarts[0]!.m,
      };

      /*
       * École « services » (ADR-0073) : son grand livre des services passe au
       * même contrôle et compte dans les mêmes chiffres — comme dans
       * `PaymentsService.tillConsistency()`. Un encaissement de cantine sans
       * ses moyens est le même trou dans la caisse. Une école « famille » n'en
       * a pas : son contrôle est celui d'avant, sans autre requête.
       */
      if (await this.billing.isServices(tx)) {
        const ws = annee ? 'WHERE sp.academic_year_id = $2' : '';
        const argS: unknown[] = annee ? [[...SOURCES_SERVICES], annee.id] : [[...SOURCES_SERVICES]];
        const { rows: svc } = await tx.query<{ n: string; sans: string; ecart_n: string; ecart_m: string }>(
          `SELECT COUNT(*)::text AS n,
                  COUNT(*) FILTER (WHERE NOT EXISTS (
                    SELECT 1 FROM tender_lines l
                     WHERE l.source_type = ANY($1::text[]) AND l.source_id = x.id))::text AS sans,
                  COUNT(*) FILTER (WHERE ABS(x.ecart) > 0.009)::text AS ecart_n,
                  COALESCE(SUM(ABS(x.ecart)) FILTER (WHERE ABS(x.ecart) > 0.009), 0)::numeric(14,2)::text AS ecart_m
             FROM (
               -- Signé : une annulation écrit des lignes « out ».
               SELECT sp.id, sp.amount - COALESCE((
                        SELECT SUM(CASE WHEN l.direction = 'out' THEN -l.amount ELSE l.amount END)
                          FROM tender_lines l
                         WHERE l.source_type = ANY($1::text[]) AND l.source_id = sp.id), 0) AS ecart
                 FROM service_payments sp ${ws}
             ) x`,
          argS,
        );
        controle.paiements += Number(svc[0]!.n);
        controle.sans_ligne += Number(svc[0]!.sans);
        controle.ecart_nb += Number(svc[0]!.ecart_n);
        controle.ecart_montant = toStorage(money(controle.ecart_montant).plus(money(svc[0]!.ecart_m)));
      }

      return {
        libelle: annee ? annee.label : String(y),
        du,
        au,
        jour: [new Date().toISOString().slice(0, 10), au].sort()[0]!,
        ...bilan,
        controle,
      };
    });
  }

  /** Toutes les années qui portent des données : MIN/MAX(annee) de `paiements`. */
  async bornesAnnees() {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ mn: number | null; mx: number | null }>(
        'SELECT MIN(calendar_year)::int AS mn, MAX(calendar_year)::int AS mx FROM payments',
      );
      return { anneeMin: rows[0]?.mn ?? null, anneeMax: rows[0]?.mx ?? null };
    });
  }

  /**
   * The most recent month in which any money moved at all.
   *
   * A school's year ends in June, so opening the report in August shows a month
   * with nothing in it — which is correct and looks broken. This lets the empty
   * state name a month that has something, instead of leaving the reader to
   * guess whether the page failed.
   */
  async mostRecentActivity(): Promise<{ month: number; year: number } | null> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ month: string; year: string }>(
        `SELECT EXTRACT(MONTH FROM at)::int::text AS month,
                EXTRACT(YEAR  FROM at)::int::text AS year
           FROM (
             SELECT paid_at AS at FROM payments
             UNION ALL SELECT paid_at FROM evening_payments
             UNION ALL SELECT paid_at FROM family_fee_payments
             -- École « services » (ADR-0073) : vide ailleurs.
             UNION ALL SELECT paid_at FROM service_payments
             UNION ALL SELECT spent_at FROM expenses
             UNION ALL SELECT paid_at FROM salary_payments
             UNION ALL SELECT withdrawn_at FROM withdrawals
           ) movements
          ORDER BY at DESC
          LIMIT 1`,
      );
      const r = rows[0];
      return r ? { month: Number(r.month), year: Number(r.year) } : null;
    });
  }

  /** A rough shape for the year so far, month by month. */
  async yearToDate(startYear: number) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        calendar_month: string;
        calendar_year: string;
        total: string;
      }>(
        /*
         * ⚠ LA FENÊTRE ÉTAIT CODÉE EN DUR SUR OCTOBRE-JUIN, et l'année de cette
         * école commence en SEPTEMBRE (`academic_years.start_month = 9`). Tout
         * un mois d'encaissements — celui de la rentrée, qui n'est pas le plus
         * calme — tombait donc hors de la synthèse annuelle, sans que rien ne le
         * signale : le total était simplement plus petit qu'il ne devait l'être.
         *
         * La fenêtre suit maintenant l'année déclarée. Le repli sur 10 et 7 ne
         * sert que si aucune ligne n'existe pour cette année-là.
         */
        `WITH bornes AS (
           SELECT COALESCE(MIN(start_month), 10)::int AS debut,
                  COALESCE(MIN(end_month), 6)::int    AS fin
             FROM academic_years WHERE start_year = $1::int
         )
         SELECT EXTRACT(MONTH FROM p.paid_at)::int::text AS calendar_month,
                EXTRACT(YEAR  FROM p.paid_at)::int::text AS calendar_year,
                SUM(p.amount)::numeric(14,2)::text AS total
           FROM payments p, bornes b
          WHERE p.paid_at >= make_timestamptz($1::int, b.debut, 1, 0, 0, 0)
            -- Fin INCLUSE : « jusqu'à juin » veut dire juin compris, donc la
            -- borne haute est le premier jour du mois suivant.
            AND p.paid_at <  make_timestamptz($1::int + 1, b.fin, 1, 0, 0, 0)
                             + interval '1 month'
          GROUP BY 1, 2
          ORDER BY 2, 1`,
        [startYear],
      );

      const peak = rows.reduce(
        (max, r) => Decimal.max(max, money(r.total)),
        new Decimal(0),
      );

      return rows.map((r) => ({
        month: Number(r.calendar_month),
        year: Number(r.calendar_year),
        total: r.total,
        // A share of the busiest month, so a bar chart needs no second pass.
        share: peak.greaterThan(0)
          ? money(r.total).dividedBy(peak).times(100).toDecimalPlaces(1).toNumber()
          : 0,
      }));
    });
  }
}

/** Son `$src_labels` — les mots que le bureau lit sur le rapport. */
export const SOURCE_LABELS: Record<string, string> = {
  paiement: 'Frais scolaires',
  depense: 'Dépense',
  salaire_prof: 'Salaire professeur',
  salaire_staff: 'Salaire staff',
  dette: 'Remboursement dette',
  dette_creation: 'Dette versée',
  cours_soir: 'Cours du soir',
  cours_soir_prof: 'Salaire prof. cours du soir',
  frais_annuel: 'Frais annuels',
  pret_personnel: 'Prêt au personnel',
  pret_remb: 'Remboursement prêt personnel',
  admin_retrait: 'Retrait administrateur',
  // École « services » (ADR-0073, §10) : une origine par service, pour que
  // « Par origine » dise ce que rapporte chacun. Les libellés sont ceux du
  // catalogue partagé (`libelleSourceService`).
  service_cantine: libelleSourceService('service_cantine'),
  service_piscine: libelleSourceService('service_piscine'),
  service_docteur: libelleSourceService('service_docteur'),
  service_transport: libelleSourceService('service_transport'),
  /** Le nom de l'école pour la photocopie (FEE_PHOTOCOPY_LABEL), lu à chaque lecture. */
  get service_photocopie(): string {
    return libelleSourceService('service_photocopie');
  },
  service_inscription: libelleSourceService('service_inscription'),
};

const MOIS_NOMS = [
  '', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

const periode = (m: number | null, a: number | null) =>
  m ? ` (${MOIS_NOMS[m] ?? ''} ${a})` : '';

/** Son `get_report_desc()`, cas par cas, mot pour mot. */
function describe(r: {
  source_type: string;
  et_nom: string | null;
  pay_m: number | null;
  pay_a: number | null;
  dep_desc: string | null;
  sal_type: string | null;
  sal_nom: string | null;
  sal_m: number | null;
  sal_a: number | null;
  det_nom: string | null;
  cs_nom: string | null;
  cs_m: number | null;
  cs_a: number | null;
  cspp_nom: string | null;
  cspp_m: number | null;
  cspp_a: number | null;
  fa_type: string | null;
  fa_parent_nom: string | null;
  pret_benef_nom: string | null;
  adm_nom: string | null;
  svc_nom: string | null;
  svc_service: ServiceCode | null;
  svc_m: number | null;
  svc_a: number | null;
}): string {
  switch (r.source_type) {
    case 'paiement':
      return `Frais scolaires : ${r.et_nom?.trim() || 'Inconnu'}${periode(r.pay_m, r.pay_a)}`;
    case 'depense':
      return `Dépense : ${r.dep_desc ?? 'Sans description'}`;
    case 'salaire_prof':
    case 'salaire_staff':
    case 'salaire':
      return (
        `Salaire ${r.sal_type === 'teacher' ? 'professeur' : (r.sal_type ?? '')} : ` +
        `${r.sal_nom ?? 'Inconnu'}${periode(r.sal_m, r.sal_a)}`
      );
    case 'dette':
      return `Remboursement dette : ${r.det_nom ?? 'Inconnu'}`;
    case 'dette_creation':
      return `Création de dette : ${r.det_nom ?? 'Inconnu'}`;
    case 'cours_soir':
      return `Cours du soir : ${r.cs_nom?.trim() || 'Inconnu'}${periode(r.cs_m, r.cs_a)}`;
    case 'cours_soir_prof':
      return `Salaire prof. cours du soir : ${r.cspp_nom ?? 'Inconnu'}${periode(r.cspp_m, r.cspp_a)}`;
    case 'frais_annuel':
      return `${r.fa_type === 'photocopy' ? libelleFraisPhotocopie() : "Frais d'inscription"} : ${r.fa_parent_nom ?? 'Inconnu'}`;
    case 'pret_personnel':
      return `Prêt au personnel : ${r.pret_benef_nom ?? 'Inconnu'}`;
    case 'pret_remb':
      return `Remboursement (avance) prêt : ${r.pret_benef_nom ?? 'Inconnu'}`;
    case 'admin_retrait':
      return `Retrait administrateur : ${r.adm_nom ?? 'Inconnu'}`;
    // École « services » (ADR-0073, §10) : « Cantine (déjeuner) : Nom (Octobre
    // 2026) », « Piscine : Nom (Octobre 2026) » ; un service annuel sans mois.
    case 'service_cantine':
    case 'service_piscine':
    case 'service_docteur':
    case 'service_photocopie':
    case 'service_inscription':
      return `${quoiService(r.svc_service, r.source_type)} : ${r.svc_nom?.trim() || 'Inconnu'}` +
        (r.svc_service && definitionService(r.svc_service).periodicite === 'mensuel'
          ? periode(r.svc_m, r.svc_a)
          : '');
    default:
      return r.source_type.charAt(0).toUpperCase() + r.source_type.slice(1);
  }
}

/**
 * Ce qu'une ligne de service a réglé : « Cantine (déjeuner) » — la formule entre
 * parenthèses, comme la spec l'écrit —, « Piscine », « Docteur », le nom de la
 * photocopie, « Frais d'inscription ». Sans abonnement retrouvé, le libellé de
 * l'origine.
 */
function quoiService(service: ServiceCode | null, sourceType: string): string {
  if (!service) return SOURCE_LABELS[sourceType] ?? sourceType;
  const def = definitionService(service);
  return def.famille === 'cantine' && def.formule ? `Cantine (${def.formule})` : libelleService(service);
}
