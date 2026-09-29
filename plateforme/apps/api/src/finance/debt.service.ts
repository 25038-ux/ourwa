import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import {
  SERVICES,
  SERVICE_CODES,
  comparerEcheancesService,
  definitionService,
  libelleService,
  money,
  toStorage,
  type FamilleService,
  type Periodicite,
  type ServiceCode,
} from '@elourwa/shared';
import { DbService } from '../db/db.service.js';
import type { Queryable } from '@elourwa/db';
import { FeesService } from './fees.service.js';
import { BillingModelService } from './billing-model.service.js';
import { TenderService, type TenderLine } from './tender.service.js';
import { resumeMoyens } from './expenses.service.js';
import { nextDocumentNumber } from './sequences.js';
import { AuditService } from '../audit/audit.service.js';
import { currentTenant } from '../tenant/tenant.context.js';

export interface DebtLine {
  studentId: string;
  studentName: string;
  label: string;
  calendarMonth: number;
  calendarYear: number;
  due: string;
  paid: string;
  outstanding: string;
}

/** Un abonnement de service d'un enfant, sur la fiche (§7). */
export interface AbonnementFiche {
  id: string;
  service: ServiceCode;
  label: string;
  periodicite: Periodicite;
  famille: FamilleService;
  /** Le montant figé à la souscription. */
  amount: string;
  exempt: boolean;
  startMonth: number;
  startYear: number;
  /** ISO ; null tant que l'abonnement court. */
  endedAt: string | null;
}

/** Une échéance de service dans une carte de mois de la fiche (§7). */
export interface LigneServiceMois {
  studentServiceId: string;
  service: ServiceCode;
  label: string;
  due: string;
  /** Payé net (annulations déduites). */
  paid: string;
  /** 0 si exempté ; jamais négatif. */
  outstanding: string;
  state: 'paid' | 'partial' | 'due' | 'exempt';
  /** Le dernier paiement VIVANT (ni annulation, ni annulé) — ce que ✕ annule. */
  paymentId: string | null;
  /** Son reçu groupé, et son numéro — ce que « Reçu » ouvre. */
  receiptId: string | null;
  receiptNumber: string | null;
}

/** Une échéance de service portée par l'enfant plutôt que par un mois (§7). */
export interface LigneServiceEnfant extends LigneServiceMois {
  periodicite: Periodicite;
  /** null pour un service annuel ; le mois, pour une échéance mensuelle hors de la grille. */
  month: number | null;
  year: number | null;
}

/**
 * UNE ÉCHÉANCE DE SERVICE DUE (§6) — une ligne de la dette d'une école
 * « services » : un mois de cantine, de piscine ou de docteur ÉCHU, ou un
 * service annuel (inscription, photocopie) de l'année. Jamais dans `tuition` :
 * « Mois impayés » compte la scolarité seule.
 */
export interface LigneServiceDette {
  studentId: string;
  studentName: string;
  studentServiceId: string;
  service: ServiceCode;
  label: string;
  periodicite: Periodicite;
  /** null pour un service annuel. */
  month: number | null;
  year: number | null;
  /** « Octobre 2025 » ; null pour un service annuel. */
  monthLabel: string | null;
  due: string;
  /** Payé net (annulations déduites). */
  paid: string;
  outstanding: string;
}

export interface FamilyDebt {
  guardianId: string;
  tuition: DebtLine[];
  annualFees: { label: string; outstanding: string }[];
  /** École « services » (§6) ; [] dans une école « famille ». Compris dans `total`. */
  services: LigneServiceDette[];
  beforeWriteOffs: string;
  writtenOff: string;
  total: string;
  /** « Annuler toute la dette » : la remise couvre tout, créances comprises. */
  clearsAll: boolean;
}

/**
 * ⚠ THE DEBT RULE — one rule, agreed with the direction. The receipts are proof.
 *
 *     debt = SUM of months ELAPSED, OWED and UNSETTLED
 *          + SUM of unpaid annual family fees for the open year
 *          - direction write-offs
 *
 * What is NOT debt — each of these was a real defect in El Ourwa at some point:
 *
 *   - a negotiated rate. `enrollments.monthly_fee` IS the amount owed; the gap
 *     to the level's full rate is never claimed.
 *   - a discount. Already deducted from what the month costs.
 *   - a free month (`is_free`, or a month marked free).
 *   - an exempted month, named or automatic (the months before a student's entry
 *     are written as free by the schedule builder, so they never reach here).
 *   - a month that has not happened yet.
 *
 * The invoice-remainder term of El Ourwa's rule is absent because there are no
 * invoices without an import (ADR-0010). When one is scheduled it is added to
 * this sum — the shape does not change.
 *
 * ÉCOLE « SERVICES » (ADR-0073, spec §6) — un terme de plus, le MÊME dans les
 * quatre chemins (`forGuardian`, `forGuardians`, `detailAcrossYears`,
 * `outstanding`), ajouté AVANT les remises :
 *
 *          + SUM des échéances de service dues et non réglées
 *
 *   - un mois de service compte comme un mois de scolarité : échu, dans le
 *     périmètre d'année de la scolarité (`perimetreScolarite`) ;
 *   - un service annuel (inscription, photocopie) compte comme les frais
 *     annuels d'aujourd'hui : pour l'année demandée (`forGuardian`), pour
 *     l'année ouverte (`detailAcrossYears`) — dès l'inscription ;
 *   - jamais pour un abonnement exempté, ni pour une inscription annulée ; un
 *     mois supprimé par l'arrêt d'un service n'existe plus.
 *
 * Une école « famille » ne lit rien de tout cela : `services: []`, et chaque
 * total est celui d'avant, au centime.
 */
@Injectable()
export class DebtService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(FeesService) private readonly fees: FeesService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TenderService) private readonly tender: TenderService,
    @Inject(BillingModelService) private readonly billing: BillingModelService,
  ) {}

  /**
   * ⚠ LA SCOLARITÉ N'EST DUE QUE POUR L'ANNÉE SCOLARISÉE — et à partir de
   * l'année où l'école a commencé à tenir ses comptes ici.
   *
   * Trouvé par la réconciliation sur les 1 372 familles réelles : El Ourwa
   * calculait 1 574 000.00 de scolarité due, nous 34 038 500.00 — 611 mois
   * impayés contre 11 844. Vingt fois plus, sur le chiffre qu'on réclame à une
   * famille. Sa règle, dans `obtenir_dette_parent_detaillee()` :
   *
   *   « Un élève dont la dernière inscription est antérieure a QUITTÉ l'école :
   *     lui facturer les mois postérieurs à son départ inventerait une créance. »
   *   « Les années antérieures à `dette_mois_depuis_annee` n'ont ni facture ni
   *     paiement repris. Les compter fabriquerait une dette qui n'a jamais existé. »
   *
   * Les arriérés des années passées ne s'évaporent pas : ils sont CONSTATÉS dans
   * `misc_debts` (ses `dettes_familles`, 9 875 500.00 d'arriérés réconciliés au
   * centime). Les recompter depuis l'échéancier les ferait payer deux fois.
   *
   * ⚠ L'ANNÉE SCOLARISÉE EST CELLE QUI A L'EFFECTIF, PAS LE DRAPEAU `active`.
   * Sa règle : « la dernière année à au moins 50 inscriptions », et sa raison :
   * « l'année ouverte peut n'avoir que quelques réinscriptions faites ». C'est
   * ce qui fait qu'au moment où l'on clôt une année et qu'on ouvre la suivante,
   * les arriérés de l'année qui vient de finir BLOQUENT ENCORE la réinscription
   * — l'effectif n'a pas bougé, donc la dette non plus. Prendre le drapeau
   * `active` les effacerait le jour même de la clôture, avant la première
   * réinscription : exactement le trou que la porte de réinscription existe
   * pour fermer (`re-enrol-debt.spec.ts`).
   *
   * Le seuil de 50 est le sien, taillé pour son école. Une école de vingt
   * élèves n'atteindrait jamais 50 et retomberait sur l'année civile, où rien
   * n'est dû : on le borne donc à l'effectif de l'année la plus peuplée. Sur
   * ses données, min(50, 1 206) = 50 — la règle est la sienne, à l'unité.
   *
   * ⚠ ET L'ANNÉE DE DÉPART VAUT ZÉRO QUAND LA CLÉ EST ABSENTE. Chez lui elle vaut
   * 2024 par défaut, parce que c'est un artefact de SA reprise. Une école neuve
   * n'a rien à couper ; la clé arrive avec l'import quand elle a un sens.
   */
  private async perimetreScolarite(
    tx: Parameters<Parameters<DbService['query']>[0]>[0],
  ): Promise<{ anneeScolarisee: number; depuis: number }> {
    const { rows: effectifs } = await tx.query<{ start_year: number; n: string }>(
      `SELECT y.start_year, COUNT(*)::text AS n FROM enrollments e
         JOIN academic_years y ON y.id = e.academic_year_id
        WHERE e.status <> 'cancelled'
        GROUP BY y.start_year ORDER BY y.start_year DESC`,
    );
    const plusPeuplee = effectifs.reduce((m, r) => Math.max(m, Number(r.n)), 0);
    const seuil = Math.min(50, plusPeuplee);
    let anneeScolarisee = effectifs.find((r) => Number(r.n) >= seuil && seuil > 0)?.start_year;
    if (anneeScolarisee === undefined) {
      // Aucune inscription nulle part : l'année ouverte, sinon l'année civile.
      const { rows: actives } = await tx.query<{ start_year: number }>(
        "SELECT start_year FROM academic_years WHERE status = 'active' ORDER BY start_year DESC LIMIT 1",
      );
      anneeScolarisee = actives[0]?.start_year ?? new Date().getFullYear();
    }
    const { rows: cfg } = await tx.query<{ value: string }>(
      "SELECT value FROM configuration WHERE key = 'dette_mois_depuis_annee'",
    );
    const depuis = cfg[0] ? Number.parseInt(cfg[0].value, 10) || 0 : 0;
    return { anneeScolarisee, depuis };
  }

  /**
   * LES ÉCHÉANCES DE SERVICE QUI PEUVENT ÊTRE DUES (§6) — la requête partagée
   * par les quatre chemins de la dette ; le calcul (échu, reste > 0) est dans
   * `dettesDeServices()`, partagé de même.
   *
   * Une échéance de l'échéancier (`student_service_months` : un mois arrêté a
   * été supprimé, il n'existe plus), avec son payé NET (annulations comprises),
   * pour les enfants de ces familles dont l'inscription de l'année n'est pas
   * annulée, d'un abonnement non exempté :
   *   - service mensuel : l'année des mois de scolarité — par id (`forGuardian`,
   *     dans le périmètre), ou l'année scolarisée à partir de l'année de départ
   *     (`detailAcrossYears`) ; `null` : aucun mois ;
   *   - service annuel : l'année `annuels` (demandée, ou ouverte) ; `null` : aucun.
   *
   * ⚠ UNE ÉCOLE « FAMILLE » N'EXÉCUTE RIEN DE PLUS que la lecture de son
   * modèle, et reçoit [] : ses totaux restent ceux d'avant, au centime.
   */
  private async echeancesServicesDues(
    tx: Queryable,
    guardianIds: string[],
    perimetre: {
      mensuels: { anneeId: string } | { startYear: number; depuis: number } | null;
      annuels: string | null;
    },
  ): Promise<EcheanceServiceDue[]> {
    if (guardianIds.length === 0) return [];
    if (!(await this.billing.isServices(tx))) return [];
    if (perimetre.mensuels === null && perimetre.annuels === null) return [];
    const mensuels = perimetre.mensuels;
    const { rows } = await tx.query<EcheanceServiceDue>(
      `SELECT s.guardian_id, s.id AS student_id, s.first_name, s.last_name,
              ss.id AS student_service_id, ss.service,
              m.calendar_month, m.calendar_year, m.amount_due::text AS amount_due,
              -- Le net : la somme de TOUTES les lignes, annulations comprises.
              COALESCE((
                SELECT SUM(sp.amount) FROM service_payments sp
                 WHERE sp.student_service_id = m.student_service_id
                   AND sp.calendar_month = m.calendar_month
                   AND sp.calendar_year = m.calendar_year
              ), 0)::text AS paid
         FROM student_service_months m
         JOIN student_services ss ON ss.id = m.student_service_id
         JOIN students s ON s.id = ss.student_id
         JOIN academic_years y ON y.id = ss.academic_year_id
         JOIN enrollments e
           ON e.student_id = ss.student_id AND e.academic_year_id = ss.academic_year_id
        WHERE s.guardian_id = ANY($1::uuid[])
          AND e.status <> 'cancelled'
          AND ss.exempt = false
          AND CASE WHEN ss.service = ANY($2::text[])
                   THEN ss.academic_year_id = $3::uuid
                   ELSE $4::boolean
                        AND ($5::uuid IS NULL OR ss.academic_year_id = $5::uuid)
                        AND ($6::int IS NULL OR (y.start_year = $6::int AND y.start_year >= $7::int))
              END
        ORDER BY s.guardian_id, s.last_name, s.first_name, s.id`,
      [
        guardianIds,
        SERVICES_ANNUELS,
        perimetre.annuels,
        mensuels !== null,
        mensuels && 'anneeId' in mensuels ? mensuels.anneeId : null,
        mensuels && 'startYear' in mensuels ? mensuels.startYear : null,
        mensuels && 'startYear' in mensuels ? mensuels.depuis : null,
      ],
    );
    return rows;
  }

  async forGuardian(
    guardianId: string,
    academicYearId: string,
    startYear: number,
  ): Promise<FamilyDebt> {
    // (le calcul est dans `calculerDette()`, partagé avec `forGuardians()`)
    const now = new Date();
    const nowIndex = now.getFullYear() * 12 + (now.getMonth() + 1);

    const { rows, services } = await this.db.query(async (tx) => {
      // La même règle que chez lui : `ei.annee = :courante AND ei.annee_id = :a`.
      // Une année passée n'a plus de mois « non facturé » à réclamer.
      const { anneeScolarisee, depuis } = await this.perimetreScolarite(tx);
      const horsPerimetre = startYear !== anneeScolarisee || startYear < depuis;
      // École « services » (§6) : les mois de service suivent le périmètre de la
      // scolarité ; les services annuels, l'année demandée, comme les frais
      // annuels ci-dessous. Une école « famille » : [] sans autre requête.
      const services = await this.echeancesServicesDues(tx, [guardianId], {
        mensuels: horsPerimetre ? null : { anneeId: academicYearId },
        annuels: academicYearId,
      });
      if (horsPerimetre) return { rows: [] as LigneMois[], services };

      const result = await tx.query<LigneMois>(
        `SELECT s.id AS student_id, s.first_name, s.last_name,
                m.month_label, m.calendar_month, m.calendar_year, m.amount_due,
                COALESCE(d.amount, 0)::text AS discount,
                COALESCE(p.total, 0)::text AS paid,
                (fx.id IS NOT NULL OR mx.id IS NOT NULL) AS exempt
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
           LEFT JOIN exemptions fx ON fx.student_id = s.id AND fx.kind = 'full'
           LEFT JOIN exemptions mx
             ON mx.student_id = s.id AND mx.kind = 'monthly'
            AND mx.calendar_month = m.calendar_month AND mx.calendar_year = m.calendar_year
          WHERE s.guardian_id = $1
            AND e.academic_year_id = $2
            AND e.status <> 'cancelled'
            AND e.is_free = false
            AND m.status = 'billable'
          ORDER BY s.last_name, s.first_name, m.month_order`,
        [guardianId, academicYearId],
      );
      return { rows: result.rows, services };
    });

    /*
     * LES FRAIS ANNUELS — sa section B bis.
     *
     * ⚠ LA CONDITION PORTAIT SUR LES MOIS FACTURABLES, PAS SUR L'INSCRIPTION.
     * `if (rows.length > 0)` : `rows` sont les lignes de MOIS. Une famille dont
     * l'enfant est inscrit mais dont les mois sont gratuits, exemptés ou pas
     * encore échus n'en a aucune — ses frais annuels disparaissaient du total
     * tout en restant affichés comme dus. La fiche du guichet annonçait alors
     * « ✓ En règle (0 MRU) » à côté de 6 500 MRU non payés, et son bouton
     * « Encaisser » est `disabled` quand la dette vaut zéro : l'école ne pouvait
     * pas encaisser ce qu'on lui devait.
     *
     * El Ourwa conditionne sur autre chose, et le dit :
     *
     *   « Ne comptent que si la famille a bien un eleve inscrit CETTE annee-la. »
     *
     *   SELECT COUNT(*) FROM etudiant_inscriptions i JOIN etudiants e …
     *    WHERE e.parent_id = :p AND i.annee = :an AND i.statut <> 'annule'
     *
     * — un compte d'INSCRIPTIONS. C'est cette requête-là, portée telle quelle.
     * `detailAcrossYears()` testait déjà l'année ouverte et n'a jamais eu le
     * défaut : d'où deux écrans qui annonçaient 6 500 et un qui annonçait 0.
     *
     * Et son commentaire dit pourquoi cela compte : « S'ils ne sont pas
     * encaisses a ce moment-la, ils ne s'evaporent pas : ils sont dus. »
     */
    const aUnInscrit = await this.db.query(async (tx) => {
      const { rows: n } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM enrollments e
           JOIN students s ON s.id = e.student_id
          WHERE s.guardian_id = $1 AND e.academic_year_id = $2
            AND e.status <> 'cancelled'`,
        [guardianId, academicYearId],
      );
      return Number(n[0]!.n) > 0;
    });

    const fees = aUnInscrit ? await this.fees.annualFeesDue(guardianId, academicYearId, startYear) : [];

    // Write-offs are a direction decision and outrank the calculation.
    const remises = await this.db.query(async (tx) => {
      const { rows: w } = await tx.query<{ total: string; clears: boolean }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total,
                COALESCE(bool_or(clears_all), false) AS clears
           FROM debt_write_offs
          WHERE guardian_id = $1 AND revoked_at IS NULL
            AND (academic_year_id IS NULL OR academic_year_id = $2)`,
        [guardianId, academicYearId],
      );
      return { amount: money(w[0]!.total), clearsAll: w[0]!.clears };
    });

    return calculerDette(guardianId, rows, fees, remises, nowIndex, services);
  }

  /**
   * LA MÊME DETTE, POUR PLUSIEURS FAMILLES — quatre requêtes au lieu de onze
   * PAR FAMILLE. Impayés appelait `forGuardian()` pour chacun des ~1 372
   * correspondants : plus de 15 000 allers-retours vers la base, des dizaines
   * de secondes sur un serveur distant, et six connexions prises au guichet
   * pendant ce temps (règle 18).
   *
   * ⚠ RIEN DU CALCUL NE CHANGE — c'est la condition. Les requêtes sont
   * celles de `forGuardian()` mot pour mot, avec `guardian_id = ANY(…)` à la
   * place de `= $1` et la colonne `guardian_id` en plus pour regrouper ; le
   * tri par famille garde son ordre (`last_name, first_name, month_order`) ;
   * puis `calculerDette()` — la même fonction — tourne pour chaque famille sur
   * ses lignes. Un test compare, famille par famille, ce chemin et
   * `forGuardian()` : « le détail vient de la même source que le total » tient.
   */
  async forGuardians(
    guardianIds: string[],
    academicYearId: string,
    startYear: number,
  ): Promise<Map<string, FamilyDebt>> {
    const now = new Date();
    const nowIndex = now.getFullYear() * 12 + (now.getMonth() + 1);
    const out = new Map<string, FamilyDebt>();
    if (guardianIds.length === 0) return out;

    const { lignes, inscrits, remises, services } = await this.db.query(async (tx) => {
      const { anneeScolarisee, depuis } = await this.perimetreScolarite(tx);
      const horsPerimetre = startYear !== anneeScolarisee || startYear < depuis;
      // Les termes de service de `forGuardian()`, mot pour mot, pour le lot.
      const services = await this.echeancesServicesDues(tx, guardianIds, {
        mensuels: horsPerimetre ? null : { anneeId: academicYearId },
        annuels: academicYearId,
      });
      const { rows: lignes } = horsPerimetre
        ? { rows: [] as (LigneMois & { guardian_id: string })[] }
        : await tx.query<LigneMois & { guardian_id: string }>(
            `SELECT s.guardian_id, s.id AS student_id, s.first_name, s.last_name,
                    m.month_label, m.calendar_month, m.calendar_year, m.amount_due,
                    COALESCE(d.amount, 0)::text AS discount,
                    COALESCE(p.total, 0)::text AS paid,
                    (fx.id IS NOT NULL OR mx.id IS NOT NULL) AS exempt
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
               LEFT JOIN exemptions fx ON fx.student_id = s.id AND fx.kind = 'full'
               LEFT JOIN exemptions mx
                 ON mx.student_id = s.id AND mx.kind = 'monthly'
                AND mx.calendar_month = m.calendar_month AND mx.calendar_year = m.calendar_year
              WHERE s.guardian_id = ANY($1::uuid[])
                AND e.academic_year_id = $2
                AND e.status <> 'cancelled'
                AND e.is_free = false
                AND m.status = 'billable'
              ORDER BY s.guardian_id, s.last_name, s.first_name, m.month_order`,
            [guardianIds, academicYearId],
          );
      const { rows: inscrits } = await tx.query<{ guardian_id: string }>(
        `SELECT DISTINCT s.guardian_id
           FROM enrollments e
           JOIN students s ON s.id = e.student_id
          WHERE s.guardian_id = ANY($1::uuid[]) AND e.academic_year_id = $2
            AND e.status <> 'cancelled'`,
        [guardianIds, academicYearId],
      );
      const { rows: remises } = await tx.query<{ guardian_id: string; total: string; clears: boolean }>(
        `SELECT guardian_id, COALESCE(SUM(amount), 0)::text AS total,
                COALESCE(bool_or(clears_all), false) AS clears
           FROM debt_write_offs
          WHERE guardian_id = ANY($1::uuid[]) AND revoked_at IS NULL
            AND (academic_year_id IS NULL OR academic_year_id = $2)
          GROUP BY guardian_id`,
        [guardianIds, academicYearId],
      );
      return { lignes, inscrits, remises, services };
    });

    const aUnInscrit = new Set(inscrits.map((r) => r.guardian_id));
    const frais = await this.fees.annualFeesDueFor(
      guardianIds.filter((id) => aUnInscrit.has(id)),
      academicYearId,
      startYear,
    );
    const remisesPar = new Map(remises.map((r) => [r.guardian_id, { amount: money(r.total), clearsAll: r.clears }]));
    const lignesPar = new Map<string, LigneMois[]>();
    for (const l of lignes) {
      const liste = lignesPar.get(l.guardian_id) ?? [];
      liste.push(l);
      lignesPar.set(l.guardian_id, liste);
    }
    const servicesPar = new Map<string, EcheanceServiceDue[]>();
    for (const s of services) {
      const liste = servicesPar.get(s.guardian_id) ?? [];
      liste.push(s);
      servicesPar.set(s.guardian_id, liste);
    }
    for (const id of guardianIds) {
      out.set(
        id,
        calculerDette(
          id,
          lignesPar.get(id) ?? [],
          aUnInscrit.has(id) ? (frais.get(id) ?? []) : [],
          remisesPar.get(id) ?? { amount: new Decimal(0), clearsAll: false },
          nowIndex,
          servicesPar.get(id) ?? [],
        ),
      );
    }
    return out;
  }

  /** `miscDebtsFor()` pour plusieurs familles : la même requête, regroupée. */
  async miscDebtsRemainingFor(guardianIds: string[]): Promise<Map<string, { remaining: string }[]>> {
    const out = new Map<string, { remaining: string }[]>(guardianIds.map((id) => [id, []]));
    if (guardianIds.length === 0) return out;
    const rows = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ guardian_id: string; remaining: string }>(
        `SELECT guardian_id, COALESCE(corrected_balance, total - repaid)::text AS remaining
           FROM misc_debts
          WHERE guardian_id = ANY($1::uuid[])
            AND COALESCE(corrected_balance, total - repaid) > 0
          ORDER BY start_year DESC NULLS LAST, created_at`,
        [guardianIds],
      );
      return rows;
    });
    for (const r of rows) out.get(r.guardian_id)?.push({ remaining: r.remaining });
    return out;
  }

  /** Families who owe money — El Ourwa's `impayes`. */
  /**
   * CE QUE LA FAMILLE DOIT, TOUTES ANNÉES CONFONDUES.
   *
   * ⚠ `forGuardian()` IS SCOPED TO ONE YEAR AND THAT IS RIGHT FOR THE TILL — the
   * caisse shows the year it is looking at. It is WRONG for the re-enrolment
   * gate, which is the whole point of that gate: what stops a family coming back
   * in October is what they still owe from LAST year.
   *
   * El Ourwa's `obtenir_dette_parent_detaillee($db, $pid, ?int $annee_id = null)`
   * takes the year as optional, and `reinscrire_etudiant.php` calls it WITHOUT
   * one. Its exam-access note says the same of its own sum: "mois échus non
   * réglés, reliquats de factures de TOUTES les années".
   *
   * Elapsed, owed and unsettled, across every year — the same three conditions
   * as the yearly figure, with the year filter removed.
   */
  async outstandingAcrossYears(guardianId: string): Promise<Decimal> {
    return (await this.detailAcrossYears(guardianId)).total;
  }

  /**
   * LE MEME CHIFFRE, LIGNE PAR LIGNE.
   *
   * ⚠ LE DETAIL AFFICHE VIENT DE LA MEME SOURCE QUE LE TOTAL. El Ourwa
   * arranges it exactly this way and says why: its bulk screen once printed a
   * total from one function and a breakdown from another, so the lines did not
   * add up to the figure above them. `dette_du_parent()` IS
   * `obtenir_dette_parent_detaillee()['total_dette']` — one calculation, read
   * two ways.
   */
  async detailAcrossYears(guardianId: string): Promise<{
    tuition: {
      studentId: string;
      studentName: string;
      label: string;
      calendarMonth: number;
      calendarYear: number;
      due: string;
      paid: string;
      outstanding: string;
    }[];
    misc: { id: string; label: string; who: string; outstanding: string }[];
    annualFees: { label: string; outstanding: string }[];
    /** École « services » (§6) ; [] dans une école « famille ». Compris dans `total`. */
    services: LigneServiceDette[];
    beforeWriteOffs: string;
    writtenOff: string;
    total: Decimal;
  }> {
    const now = new Date();
    const nowIndex = now.getFullYear() * 12 + (now.getMonth() + 1);

    const parts = await this.db.query(async (tx) => {
      const { anneeScolarisee, depuis } = await this.perimetreScolarite(tx);
      const { rows } = await tx.query<{
        student_id: string;
        student_name: string;
        month_label: string | null;
        calendar_month: number;
        calendar_year: number;
        amount_due: string;
        discount: string;
        paid: string;
        exempt: boolean;
      }>(
        `SELECT s.id AS student_id, (s.first_name || ' ' || s.last_name) AS student_name, m.month_label,
                m.calendar_month, m.calendar_year, m.amount_due::text,
                COALESCE(d.amount, 0)::text AS discount,
                COALESCE(p.total, 0)::text AS paid,
                (fx.id IS NOT NULL OR mx.id IS NOT NULL) AS exempt
           FROM enrollment_months m
           JOIN enrollments e ON e.id = m.enrollment_id
           JOIN academic_years y ON y.id = e.academic_year_id
           JOIN students s ON s.id = e.student_id
           LEFT JOIN discounts d
             ON d.student_id = s.id AND d.calendar_month = m.calendar_month
            AND d.calendar_year = m.calendar_year
           LEFT JOIN (
             SELECT student_id, calendar_month, calendar_year, SUM(amount) AS total
               FROM payments GROUP BY student_id, calendar_month, calendar_year
           ) p ON p.student_id = s.id AND p.calendar_month = m.calendar_month
              AND p.calendar_year = m.calendar_year
           LEFT JOIN exemptions fx ON fx.student_id = s.id AND fx.kind = 'full'
           LEFT JOIN exemptions mx
             ON mx.student_id = s.id AND mx.kind = 'monthly'
            AND mx.calendar_month = m.calendar_month AND mx.calendar_year = m.calendar_year
          WHERE s.guardian_id = $1
            AND e.status <> 'cancelled'
            AND e.is_free = false
            AND m.status = 'billable'
            -- L'annee scolarisee seulement : voir perimetreScolarite().
            AND y.start_year = $2
            AND y.start_year >= $3
          -- Dans l'ordre du calendrier : un releve d'arrieres qui saute de
          -- fevrier a juin puis revient a janvier ne se lit pas.
          ORDER BY s.last_name, s.first_name, m.calendar_year, m.calendar_month`,
        [guardianId, anneeScolarisee, depuis],
      );

      let total = new Decimal(0);
      const tuition: {
        studentId: string;
        studentName: string;
        label: string;
        calendarMonth: number;
        calendarYear: number;
        due: string;
        paid: string;
        outstanding: string;
      }[] = [];

      for (const r of rows) {
        if (r.exempt) continue;
        // ⚠ A month that has not happened yet is not a debt (standing rule, and
        // the same predicate `forGuardian` uses). Re-enrolling in October must
        // not be blocked by next June.
        const index = r.calendar_year * 12 + r.calendar_month;
        if (index > nowIndex) continue;

        const due = money(r.amount_due).minus(money(r.discount));
        const short = due.minus(money(r.paid));
        if (short.greaterThan(0)) {
          total = total.plus(short);
          tuition.push({
            studentId: r.student_id,
            studentName: r.student_name.trim(),
            label: r.month_label ?? `${r.calendar_month}/${r.calendar_year}`,
            calendarMonth: r.calendar_month,
            calendarYear: r.calendar_year,
            due: toStorage(Decimal.max(0, due)),
            paid: toStorage(money(r.paid)),
            outstanding: toStorage(short),
          });
        }
      }

      /**
       * ── B. LES CRÉANCES — `dettes_familles` ───────────────────────────
       *
       * ⚠ THIS TERM WAS MISSING AND THE GATE WAS OPEN. The comment above quotes
       * El Ourwa's own rule — "mois échus non réglés, reliquats de factures de
       * TOUTES les années" — and only the first half was summed. A family whose
       * whole arrears sit in a créance (an arriéré carried over, a remainder on
       * an invoice) passed the re-enrolment gate owing nothing, and the exam
       * ratchet handed them the term.
       *
       * A CORRECTION OVERRIDES THE ARITHMETIC, here as everywhere else:
       * `corrected_balance` when set IS the remainder, so a créance corrected
       * down or cancelled stops blocking immediately — which is the point of
       * `dette_modifier` and `dette_annuler` on the re-enrolment screen.
       */
      const { rows: misc } = await tx.query<{
        id: string;
        debtor_name: string;
        kind: string | null;
        start_year: number | null;
        invoice_source: number | null;
        total: string;
        student_name: string | null;
        remaining: string;
      }>(
        `SELECT d.id, d.debtor_name, d.kind, d.start_year, d.invoice_source, d.total::text,
                (st.first_name || ' ' || st.last_name) AS student_name,
                COALESCE(d.corrected_balance, d.total - d.repaid)::text AS remaining
           FROM misc_debts d
           LEFT JOIN students st ON st.id = d.student_id
          WHERE d.guardian_id = $1
            AND COALESCE(d.corrected_balance, d.total - d.repaid) > 0
          -- Son « ORDER BY d.annee, d.facture_source ».
          ORDER BY d.start_year NULLS FIRST, d.invoice_source NULLS FIRST, d.created_at`,
        [guardianId],
      );
      const miscLines = misc.map((m) => {
        total = total.plus(money(m.remaining));
        const reste = money(m.remaining);
        // Ses libelles : « Arriéré 2024-2025 (1 000 MRU) » — « un arriere ne
        // renvoie a aucune facture : le libeller "reliquat de facture"
        // enverrait la famille chercher un papier qui n existe pas » — et
        // « Reliquat de la facture n° X (total T, reste R) ».
        const label =
          (m.kind ?? 'facture') === 'arriere'
            ? `Arriéré${m.start_year ? ` ${m.start_year}-${m.start_year + 1}` : ''} (${fr(reste)} MRU)`
            : `Reliquat de la facture${m.invoice_source ? ` n° ${m.invoice_source}` : ''}` +
              (money(m.total).greaterThan(0) ? ` (total ${fr(money(m.total))}, reste ${fr(reste)})` : '');
        return {
          id: m.id,
          label,
          who: m.student_name?.trim() || 'Famille',
          outstanding: m.remaining,
        };
      });

      /**
       * ── C. LA REMISE DE LA DIRECTION ───────────────────────────────
       *
       * ⚠ « ANNULER TOUTE LA DETTE » CLEARS IT, and this read ignored the flag.
       * A total write-off stores `amount = 0` with `clears_all`, so summing the
       * amounts subtracted nothing and the family stayed blocked — while the
       * screen that granted it says "Dette annulée : la famille peut réinscrire."
       * `forGuardian()` has always read `bool_or(clears_all)`; this one did not.
       */
      const { rows: waived } = await tx.query<{ total: string; clears: boolean }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total,
                COALESCE(bool_or(clears_all), false) AS clears
           FROM debt_write_offs
          WHERE guardian_id = $1 AND revoked_at IS NULL`,
        [guardianId],
      );

      /**
       * ── B bis. LES FRAIS ANNUELS DE L'ANNÉE OUVERTE ──────────────────
       *
       * ⚠ Its own note: "Ils n'entraient nulle part dans la dette, si bien
       * qu'une famille pouvait etre reinscrite sans les payer et n'en garder
       * aucune trace." Called without a year the debt covers the whole
       * schooling, but the enrolment and photocopy fees are owed for the OPEN
       * year — that is when one enrols — so El Ourwa falls back to
       * `annee_active()` here rather than skipping the block.
       *
       * And only when the family actually has a child enrolled that year: fees
       * fall due on enrolling, not on existing.
       */
      const { rows: openYear } = await tx.query<{ id: string; start_year: number; label: string }>(
        `SELECT y.id, y.start_year, y.label
           FROM academic_years y
          WHERE y.status = 'active'
            AND EXISTS (
              SELECT 1 FROM enrollments e
                JOIN students st ON st.id = e.student_id
               WHERE st.guardian_id = $1
                 AND e.academic_year_id = y.id
                 AND e.status <> 'cancelled'
            )
          ORDER BY y.start_year DESC
          LIMIT 1`,
        [guardianId],
      );

      /**
       * ── D. LES SERVICES (école « services », §6) ──────────────────────
       *
       * Les mêmes termes que `forGuardian()` : les mois de service de l'année
       * SCOLARISÉE (le périmètre de la scolarité, section A), et les services
       * annuels de l'année OUVERTE (la règle des frais annuels, B bis). Une
       * école « famille » : [] sans autre requête.
       */
      const services = await this.echeancesServicesDues(tx, [guardianId], {
        mensuels: { startYear: anneeScolarisee, depuis },
        annuels: openYear[0]?.id ?? null,
      });

      return {
        total,
        tuition,
        misc: miscLines,
        openYear: openYear[0] ?? null,
        waived: money(waived[0]!.total),
        clearsAll: waived[0]!.clears,
        services,
      };
    });

    // The annual-fee scale is read by `FeesService`, which opens its own
    // transaction — so it is asked once the debt transaction has closed.
    let beforeWriteOffs = parts.total;
    const annualFees: { label: string; outstanding: string }[] = [];
    if (parts.openYear) {
      for (const fee of await this.fees.annualFeesDue(
        guardianId,
        parts.openYear.id,
        parts.openYear.start_year,
      )) {
        if (fee.remaining.greaterThan(0)) {
          beforeWriteOffs = beforeWriteOffs.plus(fee.remaining);
          // Son libelle : « Frais d'inscription 2025-2026 (versé X sur Y) » ou « (non réglé) ».
          annualFees.push({
            label:
              `${fee.label} ${parts.openYear.label}` +
              (fee.paid.greaterThan(0)
                ? ` (versé ${fr(fee.paid)} sur ${fr(fee.scale)})`
                : ' (non réglé)'),
            outstanding: toStorage(fee.remaining),
          });
        }
      }
    }

    // Les services, par la même fonction que `calculerDette()` — avant la remise.
    const services = dettesDeServices(parts.services, nowIndex);
    beforeWriteOffs = beforeWriteOffs.plus(services.total);

    // ⚠ A total write-off outranks the whole sum, creances and fees included.
    const total = parts.clearsAll
      ? new Decimal(0)
      : Decimal.max(0, beforeWriteOffs.minus(parts.waived));

    return {
      tuition: parts.tuition,
      misc: parts.misc,
      annualFees,
      services: services.lignes,
      beforeWriteOffs: toStorage(beforeWriteOffs),
      writtenOff: toStorage(parts.clearsAll ? beforeWriteOffs : parts.waived),
      total,
    };
  }

  /**
   * LA FICHE DE CHAQUE ENFANT — `gestion_caisse.php`'s per-child card.
   *
   * ⚠ THIS IS THE SUBSTANCE OF THE SCREEN AND IT WAS MISSING ENTIRELY. Our
   * profile listed the children and totalled the debt; El Ourwa's shows, FOR
   * EVERY CHILD, EVERY MONTH OF THE YEAR AS ITS OWN CARD — what it cost, whether
   * it was paid, the receipt, and what to do about it if it was not.
   *
   * That grid is how the office answers the only question a parent ever asks at
   * the counter: "which months do I still owe?" A total cannot answer it, and
   * neither can a list of arrears — the parent wants to see October settled and
   * March outstanding, side by side, and be handed the receipt for October.
   *
   * Four states, its own:
   *
   *   paid    — "✓ Payé (2 500)", with [Reçu] and [✕ annuler]
   *   partial — something arrived but not the whole month
   *   exempt  — "Exempté (avant inscription)", with [✕ Annuler l'exemption]
   *   due     — "En attente", with [Encaisser] and [Réduction]
   *
   * ⚠ AND THE REDUCED RATE IS PRINTED ON THE MONTH IT APPLIES TO: "Tarif réduit
   * — plein : 3 000 (−500)". A negotiated rate that is invisible on the card
   * looks like an underpayment to whoever reads it next.
   *
   * ÉCOLE « SERVICES » (ADR-0073, §7) — par enfant, en plus : `studyMode`,
   * `services` (ses abonnements de l'année, arrêtés compris), et dans CHAQUE
   * mois `services` (une sous-ligne par échéance de service de ce mois : dû,
   * payé net, reste, état, le dernier paiement vivant et son reçu) ; les
   * services annuels (inscription, photocopie) dans `annualServices`. Une école
   * « famille » reçoit `studyMode: null` et des listes vides ; tout le reste est
   * inchangé.
   */
  async familyLedger(guardianId: string, academicYearId: string) {
    return this.db.query(async (tx) => {
      // Lu dans CETTE transaction : une seconde connexion, tenue pendant que
      // celle-ci l'est, épuiserait la pile sous la charge.
      const facturationServices = await this.billing.isServices(tx);
      const { rows: children } = await tx.query<{
        student_id: string;
        first_name: string;
        last_name: string;
        matricule: string | null;
        level_name: string | null;
        group_name: string | null;
        monthly_fee: string;
        full_rate: string;
        is_free: boolean;
        entry_date: string | null;
        exempt_full: boolean;
        study_mode: string | null;
      }>(
        `SELECT s.id AS student_id, s.first_name, s.last_name, s.matricule,
                l.name AS level_name, g.name AS group_name,
                e.monthly_fee::text, e.full_rate::text, e.is_free, e.study_mode,
                to_char(e.entry_date, 'DD/MM/YYYY') AS entry_date,
                EXISTS (
                  SELECT 1 FROM exemptions x
                   WHERE x.student_id = s.id AND x.kind = 'full'
                ) AS exempt_full
           FROM students s
           JOIN enrollments e ON e.student_id = s.id
           LEFT JOIN groups g ON g.id = e.group_id
           LEFT JOIN levels l ON l.id = COALESCE(e.level_id, g.level_id)
          WHERE s.guardian_id = $1
            AND e.academic_year_id = $2
            AND e.status <> 'cancelled'
          ORDER BY s.last_name, s.first_name`,
        [guardianId, academicYearId],
      );

      const out = [];
      for (const child of children) {
        const { rows: months } = await tx.query<{
          calendar_month: number;
          calendar_year: number;
          month_label: string | null;
          status: string;
          amount_due: string;
          paid: string;
          discount: string | null;
          payment_id: string | null;
          receipt_number: string | null;
          exempt_month: boolean;
          covered_by_invoice: boolean;
        }>(
          `SELECT m.calendar_month, m.calendar_year, m.month_label, m.status,
                  m.amount_due::text,
                  COALESCE(pay.total, 0)::text AS paid,
                  d.amount::text AS discount,
                  pay.last_id::text AS payment_id,
                  pay.last_receipt AS receipt_number,
                  m.covered_by_invoice,
                  EXISTS (
                    SELECT 1 FROM exemptions x
                     WHERE x.student_id = $1 AND x.kind = 'monthly'
                       AND x.calendar_month = m.calendar_month
                       AND x.calendar_year  = m.calendar_year
                  ) AS exempt_month
             FROM enrollment_months m
             JOIN enrollments e ON e.id = m.enrollment_id
             LEFT JOIN discounts d
               ON d.student_id = $1 AND d.calendar_month = m.calendar_month
              AND d.calendar_year = m.calendar_year
             LEFT JOIN (
               /**
                * ⚠ SUM EVERY ROW, INCLUDING THE REVERSALS. Append-only means a
                * reversal is a NEGATIVE row pointing at what it undoes, so the
                * plain sum is already the net — filtering reversals out would
                * count the original twice over.
                *
                * The receipt is a different question: it must come from a
                * payment that is neither a reversal nor one that has been
                * reversed, or the card would offer to print a receipt for money
                * that came back out.
                */
               SELECT calendar_month, calendar_year, SUM(amount) AS total,
                      (array_agg(id ORDER BY paid_at DESC)
                         FILTER (WHERE live))[1] AS last_id,
                      (array_agg(receipt_number ORDER BY paid_at DESC)
                         FILTER (WHERE live))[1] AS last_receipt
                 FROM (
                   SELECT p.*,
                          (p.reverses_id IS NULL
                           AND NOT EXISTS (
                             SELECT 1 FROM payments r WHERE r.reverses_id = p.id
                           )) AS live
                     FROM payments p WHERE p.student_id = $1
                 ) q
                GROUP BY calendar_month, calendar_year
             ) pay ON pay.calendar_month = m.calendar_month
                  AND pay.calendar_year  = m.calendar_year
            WHERE e.student_id = $1 AND e.academic_year_id = $2
              AND e.status <> 'cancelled'
            ORDER BY m.month_order`,
          [child.student_id, academicYearId],
        );

        // École « services » : ses abonnements et leurs échéances. Chaque
        // échéance mensuelle va dans la carte de SON mois ; une échéance dont le
        // mois n'est pas dans la grille (l'année aurait changé de mois après
        // l'inscription) n'est pas perdue : elle rejoint les lignes de l'enfant.
        const services = facturationServices
          ? await this.servicesDeLEnfant(tx, child.student_id, academicYearId)
          : { abonnements: [], lignes: [] };
        const grille = new Set(months.map((m) => `${m.calendar_year}-${m.calendar_month}`));
        const parMois = new Map<string, LigneServiceMois[]>();
        const annualServices: LigneServiceEnfant[] = [];
        for (const l of services.lignes) {
          const cle = `${l.echeance.year}-${l.echeance.month}`;
          if (l.periodicite === 'mensuel' && grille.has(cle)) {
            parMois.set(cle, [...(parMois.get(cle) ?? []), l.ligne]);
          } else {
            const annuel = l.periodicite === 'annuel';
            annualServices.push({
              ...l.ligne,
              periodicite: l.periodicite,
              month: annuel ? null : l.echeance.month,
              year: annuel ? null : l.echeance.year,
            });
          }
        }

        out.push({
          studentId: child.student_id,
          name: `${child.first_name} ${child.last_name}`.trim(),
          matricule: child.matricule,
          levelName: child.level_name,
          groupName: child.group_name,
          monthlyFee: child.monthly_fee,
          fullRate: child.full_rate,
          isFree: child.is_free,
          exemptFull: child.exempt_full,
          entryDate: child.entry_date,
          // "1er mois dû" — the first month the schedule actually charges for.
          // Its own rule of the 25th already decided this when the schedule was
          // built, so it is read rather than recomputed.
          firstBillable:
            months.find((m) => m.status === 'billable')
              ? `${MOIS[months.find((m) => m.status === 'billable')!.calendar_month - 1]} ` +
                `${months.find((m) => m.status === 'billable')!.calendar_year}`
              : null,
          months: months.map((m) => {
            const due = money(m.amount_due).minus(money(m.discount ?? '0'));
            const paid = money(m.paid);
            const exempt = m.exempt_month || child.exempt_full || m.status !== 'billable';

            /**
             * ⚠ "RÉGLÉ PAR FACTURE" IS CHECKED BEFORE "PARTIEL", and the order
             * is the whole point.
             *
             * The old software issued one invoice covering several months at
             * once. The import spreads it, so each month carries LESS than its
             * tariff and would read "Partiel" — a family who paid in full, in a
             * single payment, shown as owing on five separate months. El Ourwa
             * marks those months and says how they were settled instead.
             */
            const state = exempt
              ? 'exempt'
              : m.covered_by_invoice && paid.lessThan(due)
                ? 'invoice'
                : paid.greaterThanOrEqualTo(due) && due.greaterThan(0)
                  ? 'paid'
                  : paid.greaterThan(0)
                    ? 'partial'
                    : 'due';

            return {
              month: m.calendar_month,
              year: m.calendar_year,
              label: MOIS[m.calendar_month - 1] ?? String(m.calendar_month),
              state,
              due: due.toFixed(2),
              paid: paid.toFixed(2),
              // The negotiated rate, printed on the month it applies to.
              fullRate: child.full_rate,
              discount: m.discount,
              paymentId: m.payment_id,
              receiptNumber: m.receipt_number,
              // El Ourwa's own wording for a month before the child arrived.
              autoExempt: m.status !== 'billable' && !m.exempt_month && !child.exempt_full,
              /**
               * ⚠ A MONTH BEFORE THE CHILD ARRIVED THAT IS NEVERTHELESS
               * BILLABLE has had its automatic exemption lifted by hand — the
               * direction decided the family did owe it. That is the only
               * month « Rétablir l'exemption » makes sense on, and without
               * this flag the button would have to appear on every month or on
               * none.
               *
               * El Ourwa keeps a table for this (`exemptions_auto_annulees`).
               * The entry date already says it, so we ask the date.
               */
              autoLifted:
                m.status === 'billable' &&
                child.entry_date !== null &&
                dateLue(child.entry_date) !== null &&
                new Date(m.calendar_year, m.calendar_month - 1, 1) <
                  new Date(dateLue(child.entry_date)!.getFullYear(), dateLue(child.entry_date)!.getMonth(), 1),
              // École « services » : les échéances de service de ce mois (§7) ; [] sinon.
              services: parMois.get(`${m.calendar_year}-${m.calendar_month}`) ?? [],
            };
          }),
          // École « services » (§7) ; null et [] dans une école « famille ».
          /** '8h-14h' | '8h-17h'. */
          studyMode: child.study_mode,
          services: services.abonnements,
          annualServices,
        });
      }
      return { children: out };
    });
  }

  /**
   * LES SERVICES D'UN ENFANT POUR LA FICHE (§7) : ses abonnements de l'année,
   * dans l'ordre du catalogue, et chaque échéance de leur échéancier avec son
   * payé NET (annulations comprises), son reste (0 si exempté), son état, et le
   * dernier paiement VIVANT — ni une annulation, ni un paiement annulé : c'est
   * lui que le bouton ✕ annule et son reçu que « Reçu » ouvre ; offrir le reçu
   * d'un argent ressorti serait offrir une preuve fausse.
   */
  private async servicesDeLEnfant(
    tx: Queryable,
    studentId: string,
    academicYearId: string,
  ): Promise<{
    abonnements: AbonnementFiche[];
    lignes: { periodicite: Periodicite; echeance: { month: number; year: number }; ligne: LigneServiceMois }[];
  }> {
    const { rows: subs } = await tx.query<{
      id: string;
      service: ServiceCode;
      amount: string;
      exempt: boolean;
      start_month: number;
      start_year: number;
      ended_at: Date | null;
    }>(
      `SELECT id, service, amount::text AS amount, exempt, start_month, start_year, ended_at
         FROM student_services
        WHERE student_id = $1 AND academic_year_id = $2
        ORDER BY created_at, id`,
      [studentId, academicYearId],
    );
    if (subs.length === 0) return { abonnements: [], lignes: [] };

    const { rows: echeances } = await tx.query<{
      student_service_id: string;
      calendar_month: number;
      calendar_year: number;
      amount_due: string;
      paid: string;
      payment_id: string | null;
      receipt_id: string | null;
      receipt_number: string | null;
    }>(
      `SELECT m.student_service_id, m.calendar_month, m.calendar_year,
              m.amount_due::text AS amount_due,
              COALESCE(pay.total, 0)::text AS paid,
              pay.last_id::text AS payment_id,
              pay.last_receipt_id::text AS receipt_id,
              pay.last_receipt AS receipt_number
         FROM student_service_months m
         LEFT JOIN (
           -- La somme de TOUTES les lignes, annulations comprises, est le net ;
           -- le dernier paiement, lui, est pris parmi les lignes vivantes seules.
           SELECT student_service_id, calendar_month, calendar_year, SUM(amount) AS total,
                  (array_agg(id ORDER BY paid_at DESC, id DESC) FILTER (WHERE live))[1] AS last_id,
                  (array_agg(receipt_id ORDER BY paid_at DESC, id DESC) FILTER (WHERE live))[1] AS last_receipt_id,
                  (array_agg(receipt_number ORDER BY paid_at DESC, id DESC) FILTER (WHERE live))[1] AS last_receipt
             FROM (
               SELECT p.*,
                      (p.reverses_id IS NULL
                       AND NOT EXISTS (
                         SELECT 1 FROM service_payments r WHERE r.reverses_id = p.id
                       )) AS live
                 FROM service_payments p
                WHERE p.student_id = $1 AND p.academic_year_id = $2
             ) q
            GROUP BY student_service_id, calendar_month, calendar_year
         ) pay ON pay.student_service_id = m.student_service_id
              AND pay.calendar_month = m.calendar_month
              AND pay.calendar_year = m.calendar_year
        WHERE m.student_service_id = ANY($3::uuid[])`,
      [studentId, academicYearId, subs.map((s) => s.id)],
    );

    const parId = new Map(subs.map((s) => [s.id, s]));
    const rang = (s: ServiceCode) => SERVICE_CODES.indexOf(s);
    const abonnements: AbonnementFiche[] = [...subs]
      .sort((a, b) => rang(a.service) - rang(b.service))
      .map((s) => {
        const def = definitionService(s.service);
        return {
          id: s.id,
          service: s.service,
          label: libelleService(s.service),
          periodicite: def.periodicite,
          famille: def.famille,
          amount: s.amount,
          exempt: s.exempt,
          startMonth: s.start_month,
          startYear: s.start_year,
          endedAt: s.ended_at ? s.ended_at.toISOString() : null,
        };
      });

    const lignes = echeances
      .map((e) => {
        const s = parId.get(e.student_service_id)!;
        const due = money(e.amount_due);
        const paid = money(e.paid);
        const outstanding = s.exempt ? new Decimal(0) : Decimal.max(0, due.minus(paid));
        const state: LigneServiceMois['state'] = s.exempt
          ? 'exempt'
          : outstanding.isZero()
            ? 'paid'
            : paid.greaterThan(0)
              ? 'partial'
              : 'due';
        return {
          periodicite: definitionService(s.service).periodicite,
          echeance: { month: e.calendar_month, year: e.calendar_year },
          ligne: {
            studentServiceId: s.id,
            service: s.service,
            label: libelleService(s.service),
            due: toStorage(due),
            paid: toStorage(paid),
            outstanding: toStorage(outstanding),
            state,
            paymentId: e.payment_id,
            receiptId: e.receipt_id,
            receiptNumber: e.receipt_number,
          },
        };
      })
      .sort(
        (a, b) =>
          comparerEcheancesService(
            { service: a.ligne.service, ...a.echeance },
            { service: b.ligne.service, ...b.echeance },
          ) || a.ligne.studentServiceId.localeCompare(b.ligne.studentServiceId),
      );
    return { abonnements, lignes };
  }

  /**
   * NOTIFIER LES IMPAYÉS — `gestion_caisse.php`, action `notifier_impayes`.
   *
   * A payment reminder to every family whose child has an unpaid month.
   *
   * ⚠ THIS TELLS PEOPLE THEY OWE MONEY, so who it reaches matters more than
   * whether it works. Three exclusions, all El Ourwa's:
   *
   *   a child exempted outright · a month exempted on its own · a month with
   *   any payment against it.
   *
   * ⚠ THE THIRD IS ITS RULE AND IS KEPT DELIBERATELY. `NOT EXISTS (SELECT 1 FROM
   * paiements …)` treats ANY payment as settling the month, so a family who has
   * paid 1 000 of 10 000 is not chased. That is a plausible courtesy rather than
   * an obvious defect — standing rule 26 — so it stands, and the screen states
   * it rather than leaving an operator to assume otherwise.
   *
   * ⚠ ONE DEPARTURE: THE YEAR. El Ourwa's query joins no enrolment and filters
   * no year, so it reminds the families of children who left the school that
   * they owe this month. That is the same defect as ADR-0018 and the harm is
   * sharper — an accusation, sent to somebody who no longer attends. Recorded
   * in docs/DECISIONS.md.
   */
  async notifyUnpaid(
    input: { academicYearId: string; calendarMonth: number; calendarYear: number },
    actorId: string,
    // ⚠ PASSÉ PAR L'APPELANT, PAS INJECTÉ. NotificationsService importe
    // ExamAccessService qui importe DebtService : injecter NotificationsService
    // ici fermait un cycle d'import ESM, et le paquet construit mourait à
    // l'import (« Cannot access 'NotificationsService' before initialization »)
    // — invisible aux tests, dont le transformateur n'émet pas les métadonnées.
    notifier: (
      tx: Queryable,
      n: { guardianId: string; studentId: string; eleve: string; mois: string },
    ) => Promise<void>,
  ): Promise<{ sent: number; month: string; year: number }> {
    const { schoolId } = currentTenant();
    const monthName = MOIS[input.calendarMonth - 1] ?? String(input.calendarMonth);

    const sender = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ full_name: string }>(
        'SELECT full_name FROM users WHERE id = $1',
        [actorId],
      );
      return rows[0]?.full_name ?? 'Administration';
    });

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ guardian_id: string; student_id: string; first_name: string; last_name: string }>(
        `SELECT DISTINCT s.guardian_id, s.id AS student_id, s.first_name, s.last_name
           FROM students s
           JOIN enrollments e ON e.student_id = s.id
          WHERE s.guardian_id IS NOT NULL
            AND e.academic_year_id = $1
            AND e.status <> 'cancelled'
            AND e.is_free = false
            -- ⚠ L'ARGENT VIVANT SEULEMENT : une contre-passation est une ligne
            -- négative qui garde le mois de l'originale — les deux « existaient »,
            -- et une famille dont le paiement avait été annulé n'était plus jamais
            -- rappelée pour ce mois.
            AND NOT EXISTS (
              SELECT 1 FROM payments p
               WHERE p.student_id = s.id
                 AND p.calendar_month = $2 AND p.calendar_year = $3
                 AND p.reverses_id IS NULL
                 AND NOT EXISTS (SELECT 1 FROM payments r WHERE r.reverses_id = p.id)
            )
            AND NOT EXISTS (
              SELECT 1 FROM exemptions x
               WHERE x.student_id = s.id
                 AND (x.kind = 'full'
                      OR (x.kind = 'monthly'
                          AND x.calendar_month = $2 AND x.calendar_year = $3))
            )`,
        [input.academicYearId, input.calendarMonth, input.calendarYear],
      );

      for (const row of rows) {
        const child = `${row.first_name} ${row.last_name}`.trim();
        // Son `notifier_parent(parent_id, 'info', 'Rappel de paiement', …, etudiant_id)` :
        // la NOTIFICATION (fil de l'application, poussée sur le téléphone), dans
        // la langue du parent. Nous n'écrivions qu'un message de messagerie —
        // que personne ne voyait arriver : « ne notifie aucun impayé ».
        await notifier(tx, {
          guardianId: row.guardian_id,
          studentId: row.student_id,
          eleve: child,
          mois: `${monthName} ${input.calendarYear}`,
        });
        await tx.query(
          `INSERT INTO messages (school_id, guardian_id, sender_name, subject, body, sent_by)
           VALUES ($1, $2, $3, 'Rappel de paiement', $4, $5)`,
          [
            schoolId,
            row.guardian_id,
            sender,
            // Its own sentence, with the child and the month named. A reminder
            // that does not say WHICH child is useless to a family with four.
            `Le paiement de ${child} pour ${monthName} ${input.calendarYear} ` +
              "n'a pas encore été enregistré. Merci de régulariser.",
            actorId,
          ],
        );
      }

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'unpaid_reminders_sent',
          entity: 'academic_year',
          entityId: input.academicYearId,
          after: {
            month: `${input.calendarYear}-${input.calendarMonth}`,
            recipients: String(rows.length),
          },
        },
        tx,
      );

      return { sent: rows.length, month: monthName, year: input.calendarYear };
    });
  }

  /**
   * THE CHILDREN A FAMILY ACTUALLY HAS IN SCHOOL THIS YEAR — `enfants_scolarises()`.
   *
   * ⚠ READ FROM THE ENROLMENT, NEVER FROM THE STUDENT ROW. El Ourwa records the
   * bug this caused, with the family it happened to: `etudiants.frais_mensuel`
   * carries one rate with no year, no gratuity and no knowledge of whether the
   * child has left, so the Med Bilal family was billed 13 000 MRU instead of
   * 6 000 — two of four children owed nothing at all.
   *
   * The class comes from that year's enrolment too, not from the cached group
   * on the student: it is the class the child was in THAT year.
   */
  async childrenInSchool(
    guardianId: string,
    academicYearId: string,
  ): Promise<
    {
      studentId: string;
      name: string;
      fee: string;
      free: boolean;
      status: string;
      className: string | null;
    }[]
  > {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        student_id: string;
        first_name: string;
        last_name: string;
        monthly_fee: string;
        is_free: boolean;
        status: string;
        class_name: string | null;
      }>(
        `SELECT s.id AS student_id, s.first_name, s.last_name,
                e.monthly_fee::text AS monthly_fee, e.is_free, e.status,
                g.name AS class_name
           FROM enrollments e
           JOIN students s ON s.id = e.student_id
           LEFT JOIN groups g ON g.id = e.group_id
          WHERE s.guardian_id = $1
            AND e.academic_year_id = $2
            AND e.status <> 'cancelled'
          ORDER BY s.first_name, s.last_name`,
        [guardianId, academicYearId],
      );

      return rows.map((r) => ({
        studentId: r.student_id,
        name: `${r.first_name} ${r.last_name === '—' ? '' : r.last_name}`.trim(),
        // A free child costs nothing. Reporting the rate anyway is how a
        // scholarship pupil ends up on a debt list.
        fee: r.is_free ? '0.00' : money(r.monthly_fee).toFixed(2),
        free: r.is_free,
        status: r.status,
        className: r.class_name,
      }));
    });
  }

  /**
   * The correspondents list — `gestion_caisse.php`'s landing table.
   *
   * ⚠ "CORRESPONDANT" is the school's word for whoever it deals with about
   * money. Searchable by pupil name, correspondent name, matricule or phone,
   * because the person at the counter volunteers whichever of those they know.
   *
   * One query with the counts folded in. Fetching the roster and then asking
   * per family would be several hundred round trips for a page that opens all
   * day long.
   */
  async correspondents(input: {
    q?: string;
    unpaidMonth?: number;
    unpaidYear?: number;
    academicYearId: string;
  }) {
    const term = (input.q ?? '').trim();

    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT u.id, u.full_name, u.phone, u.active,
                count(DISTINCT s.id)::int AS nb_enfants,
                -- NOT SUM(DISTINCT): two children on the same fee would
                -- collapse into one and the family's monthly total would be
                -- halved. The join yields at most one enrolment per child for
                -- the year, so a plain SUM is already correct.
                COALESCE(SUM(e.monthly_fee), 0)::numeric(14,2)::text AS frais_total,
                (
                  -- Sa règle de la dette, mot pour mot : un mois n'est impayé
                  -- que s'il est DÛ (inscrit, non gratuit, non exempté, non
                  -- couvert par une facture) et que les versements ne
                  -- couvrent pas le tarif convenu.
                  SELECT count(DISTINCT st.id)::int
                    FROM enrollment_months m
                    JOIN enrollments en ON en.id = m.enrollment_id
                    JOIN students st ON st.id = en.student_id
                   WHERE st.guardian_id = u.id
                     AND en.academic_year_id = $1
                     AND en.status <> 'cancelled' AND en.is_free = false
                     AND m.status = 'billable' AND m.covered_by_invoice = false
                     AND ($2::int IS NULL OR m.calendar_month = $2)
                     AND ($3::int IS NULL OR m.calendar_year = $3)
                     AND NOT EXISTS (SELECT 1 FROM exemptions x WHERE x.student_id = st.id
                                       AND (x.kind = 'full' OR (x.kind = 'monthly'
                                            AND x.calendar_month = m.calendar_month
                                            AND x.calendar_year = m.calendar_year)))
                     AND COALESCE((
                           SELECT SUM(p.amount) FROM payments p
                            WHERE p.student_id = st.id
                              AND p.calendar_month = m.calendar_month
                              AND p.calendar_year = m.calendar_year
                         ), 0) < m.amount_due - 0.01
                ) AS nb_impayes
           FROM users u
           -- LEFT JOIN de bout en bout, comme chez lui : chaque correspondant
           -- garde sa ligne, avec 0 enfant et 0 MRU s'il n'a personne d'inscrit.
           LEFT JOIN students s ON s.guardian_id = u.id
           LEFT JOIN enrollments e
             ON e.student_id = s.id AND e.academic_year_id = $1
            AND e.status <> 'cancelled'
          WHERE EXISTS (SELECT 1 FROM students sx WHERE sx.guardian_id = u.id)
            AND ($4::text = ''
                 OR u.full_name ILIKE '%' || $4 || '%'
                 -- Son REPLACE(REPLACE(REPLACE(telephone,' ',''),'-',''),'+','') LIKE chiffres
                 OR ($5::text <> '' AND regexp_replace(COALESCE(u.phone, ''), '[^0-9]', '', 'g') LIKE '%' || $5 || '%')
                 OR EXISTS (SELECT 1 FROM students x WHERE x.guardian_id = u.id
                              AND (x.first_name ILIKE '%' || $4 || '%'
                                OR x.last_name ILIKE '%' || $4 || '%'
                                OR (x.first_name || ' ' || x.last_name) ILIKE '%' || $4 || '%'
                                -- Son x.identifiant LIKE :q5 : le matricule, et lui seul.
                                OR COALESCE(x.matricule, '') ILIKE '%' || $4 || '%')))
          GROUP BY u.id, u.full_name, u.phone, u.active
          ORDER BY u.full_name`,
        [
          input.academicYearId,
          input.unpaidMonth ?? null,
          input.unpaidYear ?? null,
          term,
          term.replace(/[^0-9]/g, ''),
        ],
      );
      // Son `HAVING nb_impayes > 0` quand le filtre « mois impayé » est actif.
      return input.unpaidMonth ? rows.filter((r) => Number(r.nb_impayes) > 0) : rows;
    });
  }

  /**
   * "Dettes diverses" — debt owed to the school that is not a monthly fee.
   *
   * A book not returned, a supply advanced, an agreed catch-up. El Ourwa's
   * `dettes`, and the second money column on its Impayés screen.
   */
  async miscDebtsFor(guardianId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        debtor_name: string;
        months: number;
        total: string;
        repaid: string;
        remaining: string;
        corrected_balance: string | null;
        correction_reason: string | null;
        corrected_at: Date | null;
        reason: string | null;
        created_at: string;
        start_year: number | null;
        kind: string;
        invoice_source: number | null;
      }>(
        `SELECT id, debtor_name, months, total::text, repaid::text,
                -- ⚠ A CORRECTION OVERRIDES THE ARITHMETIC. total is what was
                -- claimed and never changes; corrected_balance, when set, IS
                -- what remains. El Ourwa edits its solde column directly and
                -- keeps total for the trail; we keep three separate facts.
                COALESCE(corrected_balance, total - repaid)::text AS remaining,
                corrected_balance::text, correction_reason, corrected_at,
                reason, created_at,
                -- Ses trois colonnes de la migration 0026 : l'année à laquelle
                -- la créance se rattache, sa nature, et le numéro de facture
                -- quand c'en est une.
                start_year, kind, invoice_source
           FROM misc_debts
          WHERE guardian_id = $1
            AND COALESCE(corrected_balance, total - repaid) > 0
          -- Les plus récentes d'abord, comme son écran ; une créance sans
          -- année ferme la marche plutôt que d'ouvrir la liste.
          ORDER BY start_year DESC NULLS LAST, created_at`,
        [guardianId],
      );
      return rows;
    });
  }

  /**
   * LES DÉBITEURS — `dette.php`, sa « Liste des débiteurs » (table `dettes`).
   *
   * Ses deux tables tiennent dans notre `misc_debts` : `dettes_familles` (les
   * arriérés d'un FOYER, `guardian_id` posé — Impayés et Réinscriptions) et
   * `dettes` (un débiteur NOMMÉ, sans foyer : une demande de type `dette`
   * approuvée, ou l'ancienne saisie de `dette.php`). Sa page ne liste que les
   * secondes : chez nous, celles sans `guardian_id`. Sur les 1 357 créances
   * reprises, aucune n'est dans ce cas — la section reste vide, comme chez lui.
   *
   * Sa recherche (`debiteur_nom LIKE :q OR telephone LIKE :q`) et son ordre
   * (`(montant_total - montant_rembourse) DESC, debiteur_nom`).
   */
  async debiteurs(q: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        debtor_name: string;
        phone: string | null;
        months: number;
        total: string;
        repaid: string;
        reste: string;
      }>(
        `SELECT id, debtor_name, phone, months, total::text, repaid::text,
                GREATEST(0, COALESCE(corrected_balance, total - repaid))::numeric(14,2)::text AS reste
           FROM misc_debts
          WHERE guardian_id IS NULL
            AND ($1 = '' OR debtor_name ILIKE '%' || $1 || '%' OR COALESCE(phone, '') ILIKE '%' || $1 || '%')
          ORDER BY COALESCE(corrected_balance, total - repaid) DESC, debtor_name`,
        [q.trim()],
      );
      return rows;
    });
  }

  /** Every unsettled miscellaneous debt, whoever owes it. The Dettes tab. */
  async allMiscDebts(includeSettled = false) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT d.id, d.debtor_name, d.phone, d.months, d.total::text,
                d.repaid::text,
                COALESCE(d.corrected_balance, d.total - d.repaid)::text AS remaining,
                d.corrected_balance::text, d.correction_reason, d.corrected_at,
                d.reason, d.created_at, d.guardian_id, d.student_id,
                -- ⚠ LES TROIS COLONNES DE 0026 PARTAIENT DE miscDebtsFor ET
                -- PAS D'ICI, si bien que le tableau des réinscriptions — celui
                -- qui les affiche — recevait une année vide et un type
                -- « Arriéré » pour tout le monde. Deux lectures de la même
                -- table doivent rendre les mêmes colonnes.
                d.start_year, d.kind, d.invoice_source,
                s.first_name || ' ' || s.last_name AS student_name
           FROM misc_debts d
           LEFT JOIN students s ON s.id = d.student_id
          WHERE $1::boolean OR COALESCE(d.corrected_balance, d.total - d.repaid) > 0
          ORDER BY (COALESCE(d.corrected_balance, d.total - d.repaid) > 0) DESC,
                   d.start_year DESC NULLS LAST, d.created_at DESC`,
        [includeSettled],
      );
      return rows;
    });
  }

  /**
   * CORRIGER UNE CRÉANCE — `reinscriptions.php`, action `dette_modifier`.
   *
   * ⚠ `total` IS WHAT WAS CLAIMED AND NEVER CHANGES. El Ourwa's own comment:
   * "On conserve `total` (montant d'origine) et on ne touche qu'au solde : la
   * trace de ce qui avait ete reclame reste lisible." It edits a stored `solde`;
   * we compute the remainder, so the correction needs a column of its own — and
   * having one keeps the claim, the payments and the correction as three
   * separate facts, none overwriting another.
   *
   * ⚠ THE MOTIF IS PART OF THE RECORD, not a nicety. A balance that changed
   * with no reason attached is the entry an auditor stops at.
   */
  async correctMiscDebt(
    debtId: string,
    balanceText: string,
    reason: string,
    actorId: string,
  ) {
    const { schoolId } = currentTenant();

    const raw = balanceText.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      throw new BadRequestException('Le montant restant doit être positif ou nul.');
    }

    return this.db.query(async (tx) => {
      const { rows: before } = await tx.query<{ total: string; repaid: string;
        corrected_balance: string | null }>(
        'SELECT total::text, repaid::text, corrected_balance::text FROM misc_debts WHERE id = $1',
        [debtId],
      );
      if (before.length === 0) throw new NotFoundException('Ligne de dette introuvable.');

      const claimed = money(before[0]!.total);
      if (money(raw).greaterThan(claimed.plus(0.01))) {
        // Correcting a balance UPWARDS past what was ever claimed is not a
        // correction; it is a new debt, and it should be created as one so it
        // carries its own reason and its own date.
        throw new BadRequestException(
          `Le restant dû ne peut dépasser le montant réclamé (${toStorage(claimed)}). ` +
            "Créez une nouvelle créance plutôt que d'augmenter celle-ci.",
        );
      }

      const previous =
        before[0]!.corrected_balance ??
        money(before[0]!.total).minus(before[0]!.repaid).toFixed(2);

      const { rows } = await tx.query<{ id: string }>(
        `UPDATE misc_debts
            SET corrected_balance = $2,
                correction_reason = $3,
                corrected_at = now(),
                corrected_by = $4
          WHERE id = $1
        RETURNING id`,
        [debtId, raw, reason.trim() || null, actorId],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: Number(raw) === 0 ? 'misc_debt_cancelled' : 'misc_debt_corrected',
          entity: 'misc_debt',
          entityId: debtId,
          before: { remaining: previous },
          after: { remaining: raw, reason: reason.trim() },
        },
        tx,
      );
      return { id: rows[0]!.id, remaining: raw };
    });
  }

  /**
   * ANNULER UNE CRÉANCE — its `dette_annuler`, and its own words on why the
   * row survives: "la ligne est conservee, son solde tombe a 0 et le motif est
   * enregistre. Supprimer la ligne detruirait la trace comptable de ce qui
   * avait ete reclame a la famille."
   *
   * The same operation as a correction with a different number, which is why
   * there is one column and not two.
   */
  async cancelMiscDebt(debtId: string, reason: string, actorId: string) {
    return this.correctMiscDebt(debtId, '0', reason, actorId);
  }

  async createMiscDebt(
    input: {
      debtorName: string;
      guardianId?: string;
      studentId?: string;
      phone?: string;
      months?: number;
      total: string;
      reason?: string;
      /** Son `annee` : 2024 pour 2024-2025. Inconnue plutôt que devinée. */
      startYear?: number;
      /** Son `type_dette`. */
      kind?: 'arriere' | 'facture';
      /** Son `facture_source`, quand c'est une facture. */
      invoiceSource?: number;
    },
    actorId: string,
  ) {
    return this.db.query((tx) => this.createMiscDebtWithin(tx, input, actorId));
  }

  /** La même écriture dans une transaction ouverte par l'appelant (« Demandes », type `dette`). */
  async createMiscDebtWithin(
    tx: Queryable,
    input: {
      debtorName: string;
      guardianId?: string;
      studentId?: string;
      phone?: string;
      months?: number;
      total: string;
      reason?: string;
      /** Son `annee` : 2024 pour 2024-2025. Inconnue plutôt que devinée. */
      startYear?: number;
      /** Son `type_dette`. */
      kind?: 'arriere' | 'facture';
      /** Son `facture_source`, quand c'est une facture. */
      invoiceSource?: number;
    },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    if (money(input.total).lessThanOrEqualTo(0)) {
      throw new BadRequestException('Le montant de la dette doit être supérieur à zéro.');
    }

    /*
     * ⚠ UNE ANNÉE QUI N'EN EST PAS UNE VAUT MIEUX REFUSÉE QUE STOCKÉE. Le champ
     * est un `smallint` sans clé étrangère — exprès, pour accepter les reprises
     * d'années que nous ne connaissons pas — donc rien d'autre ne vérifie qu'il
     * s'agit d'une année scolaire plausible.
     */
    if (input.startYear !== undefined) {
      if (!Number.isInteger(input.startYear) || input.startYear < 2000 || input.startYear > 2100) {
        throw new BadRequestException(
          'L’année de la créance doit être une année de début plausible (2000-2100).',
        );
      }
    }

    {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO misc_debts
           (school_id, student_id, guardian_id, debtor_name, phone, months, total, reason,
            created_by, start_year, kind, invoice_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          schoolId, input.studentId ?? null, input.guardianId ?? null,
          input.debtorName.trim(), input.phone ?? null, input.months ?? 1,
          toStorage(money(input.total)), input.reason ?? null, actorId,
          input.startYear ?? null, input.kind ?? 'arriere', input.invoiceSource ?? null,
        ],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'misc_debt_created',
          entity: 'misc_debt',
          entityId: rows[0]!.id,
          after: { debtor: input.debtorName, total: input.total, reason: input.reason ?? null },
        },
        tx,
      );
      return { id: rows[0]!.id };
    }
  }

  /**
   * REMBOURSER UNE DETTE DIVERSE — `dette.php`, action `rembourser`.
   *
   * Le montant est LA SOMME DES LIGNES DU WIDGET DES MOYENS
   * (`lire_lignes_paiement(true, 0)`), écrites dans la caisse en entrée
   * (`enregistrer_lignes_paiement('dette', $rid, …, 'entrant')`), puis un numéro
   * `REMB-Ymd-<dette>-<4 chiffres>` et le reçu `?print_recu_remb=`.
   *
   * ⚠ SANS LIGNES, L'ARGENT N'EXISTE PAS POUR LA CAISSE : le rapport financier,
   * le journal et le tableau de bord de la plateforme lisent `tender_lines`.
   * Un remboursement à montant nu faisait baisser la dette sans faire monter
   * la caisse.
   *
   * Son identifiant de dette dans le numéro est entier ; le nôtre est un uuid,
   * dont on garde les huit premiers hexadécimaux — comme `PRT-…` (prêts).
   */
  async repayMiscDebt(debtId: string, tender: TenderLine[], actorId: string) {
    const { schoolId } = currentTenant();

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ total: string; repaid: string; corrected_balance: string | null }>(
        'SELECT total::text, repaid::text, corrected_balance::text FROM misc_debts WHERE id = $1 FOR UPDATE',
        [debtId],
      );
      if (!rows[0]) throw new NotFoundException('Dette introuvable.');
      const reste = Decimal.max(
        0,
        rows[0].corrected_balance !== null
          ? money(rows[0].corrected_balance)
          : money(rows[0].total).minus(money(rows[0].repaid)),
      );

      const lignes = tender.filter((l) => money(l.amount).greaterThan(0));
      if (lignes.length === 0) {
        throw new BadRequestException(
          'Veuillez indiquer au moins un moyen de paiement avec un montant.',
        );
      }
      const total = lignes.reduce((a, l) => a.plus(money(l.amount)), new Decimal(0));
      if (total.greaterThan(reste.plus('0.01'))) {
        throw new BadRequestException(
          `Le remboursement (${fr(total)} MRU) dépasse le reste dû (${fr(reste)} MRU).`,
        );
      }

      const now = new Date();
      const ymd =
        `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}` +
        `${String(now.getDate()).padStart(2, '0')}`;
      const numero = `REMB-${ymd}-${debtId.replace(/-/g, '').slice(0, 8)}-${String(await nextDocumentNumber(tx, schoolId, 'remboursement_dette')).padStart(4, '0')}`;

      const { rows: ins } = await tx.query<{ id: string }>(
        `INSERT INTO misc_debt_repayments (school_id, debt_id, amount, receipt_number, recorded_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [schoolId, debtId, toStorage(total), numero, actorId],
      );
      const id = ins[0]!.id;
      await this.tender.post(tx, {
        sourceType: 'dette',
        sourceId: id,
        direction: 'in',
        total: toStorage(total),
        lines: lignes,
      });
      // Son `UPDATE dettes SET montant_rembourse = montant_rembourse + :m`. Une
      // créance corrigée porte son reste dans `corrected_balance` : il baisse
      // d'autant, sinon la correction survivrait au remboursement.
      await tx.query(
        `UPDATE misc_debts
            SET repaid = repaid + $2,
                corrected_balance = CASE WHEN corrected_balance IS NULL THEN NULL
                                         ELSE GREATEST(0, corrected_balance - $2) END
          WHERE id = $1`,
        [debtId, toStorage(total)],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'misc_debt_repaid',
          entity: 'misc_debt',
          entityId: debtId,
          after: { amount: toStorage(total), receipt: numero },
        },
        tx,
      );
      return { id, numero, remaining: toStorage(Decimal.max(0, reste.minus(total))) };
    });
  }

  /**
   * LE PROFIL D'UNE DETTE — `dette.php?dette_id=` : ses trois cartes (Dette
   * totale, Remboursé, Reste dû) et l'« Historique des remboursements »
   * (`ORDER BY date_remb DESC`), chaque ligne avec son `resume_moyens('dette', id)`.
   */
  async miscDebtProfile(debtId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        debtor_name: string;
        phone: string | null;
        reason: string | null;
        total: string;
        repaid: string;
        remaining: string;
        created_at: string;
      }>(
        `SELECT id, debtor_name, phone, reason, total::text, repaid::text,
                GREATEST(0, COALESCE(corrected_balance, total - repaid))::numeric(14,2)::text AS remaining,
                created_at::text
           FROM misc_debts WHERE id = $1`,
        [debtId],
      );
      const d = rows[0];
      if (!d) throw new NotFoundException('Dette introuvable.');
      const { rows: rembs } = await tx.query<{
        id: string;
        montant: string;
        date: string;
        numero: string | null;
        moyens: { moyen: string; montant: string; reference: string | null }[] | null;
      }>(
        `SELECT r.id, r.amount::text AS montant, r.repaid_at::text AS date, r.receipt_number AS numero,
                (SELECT json_agg(json_build_object('moyen', m.name, 'montant', t.amount::text, 'reference', t.reference) ORDER BY t.created_at)
                   FROM tender_lines t JOIN payment_methods m ON m.id = t.payment_method_id
                  WHERE t.source_type = 'dette' AND t.source_id = r.id) AS moyens
           FROM misc_debt_repayments r
          WHERE r.debt_id = $1
          ORDER BY r.repaid_at DESC, r.id DESC`,
        [debtId],
      );
      return {
        ...d,
        remboursements: rembs.map((r) => ({
          id: r.id,
          montant: r.montant,
          date: r.date,
          numero: r.numero,
          moyens: resumeMoyens(r.moyens ?? []),
        })),
      };
    });
  }

  /** Le reçu « REMB-… » — `print_recu_remb`, ses lignes. */
  async miscDebtRepaymentReceipt(repaymentId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        dette_id: string;
        numero: string | null;
        date: string;
        montant: string;
        debiteur_nom: string;
        debiteur_tel: string | null;
        motif: string | null;
        montant_total: string;
        reste_apres: string;
      }>(
        `SELECT r.id, d.id AS dette_id, r.receipt_number AS numero, r.repaid_at::text AS date,
                r.amount::text AS montant, d.debtor_name AS debiteur_nom, d.phone AS debiteur_tel,
                d.reason AS motif, d.total::text AS montant_total,
                GREATEST(0, COALESCE(d.corrected_balance, d.total - d.repaid))::numeric(14,2)::text AS reste_apres
           FROM misc_debt_repayments r JOIN misc_debts d ON d.id = r.debt_id
          WHERE r.id = $1`,
        [repaymentId],
      );
      const r = rows[0];
      if (!r) throw new NotFoundException('Reçu introuvable.');
      const moyens = await this.tender.linesFor(tx, 'dette', r.id);
      // Son repli `REMB-000123` quand la ligne n'a pas de numéro (reprise).
      return { ...r, numero: r.numero ?? `REMB-${r.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`, moyens };
    });
  }

  /**
   * Grant a write-off — El Ourwa's `remise`.
   *
   * ⚠ A `remise` is a WRITE-OFF, not a `réduction` (a discount on a fee). Same
   * English word in casual speech, unrelated meanings here: one forgives a debt
   * already incurred, the other lowers what will be charged. See GLOSSARY.
   *
   * Financial records are append-only, so a write-off is never deleted. Revoking
   * one stamps it and leaves the row: "was this family ever forgiven, and by
   * whom" is a question the school will be asked.
   */
  async grantWriteOff(
    input: {
      guardianId: string;
      academicYearId?: string;
      amount?: string;
      clearsAll?: boolean;
      /** Facultatif chez lui : `$motif ?: null`. */
      reason?: string;
    },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    if (!input.clearsAll && !input.amount) {
      throw new BadRequestException('Indiquez le montant a retirer de la dette.');
    }

    return this.db.query(async (tx) => {
      /*
       * Sa règle de rattachement : « La remise doit porter sur l'année où la
       * dette EXISTE, pas sur l'année affichée à l'écran. » Une seule année
       * endettée (créances `dettes_familles` à solde positif) : on cible
       * celle-là ; plusieurs, ou aucune : remise globale (NULL).
       */
      let yearId: string | null = input.academicYearId ?? null;
      if (!input.academicYearId) {
        const { rows: annees } = await tx.query<{ id: string }>(
          `SELECT DISTINCT y.id
             FROM misc_debts d
             JOIN academic_years y ON y.start_year = d.start_year
            WHERE d.guardian_id = $1
              AND COALESCE(d.corrected_balance, d.total - d.repaid) > 0.005`,
          [input.guardianId],
        );
        yearId = annees.length === 1 ? annees[0]!.id : null;
      }
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO debt_write_offs
           (school_id, guardian_id, academic_year_id, amount, clears_all, reason, granted_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          schoolId, input.guardianId, yearId,
          input.clearsAll ? '0' : (input.amount ?? '0'),
          input.clearsAll ?? false, input.reason?.trim() || null, actorId,
        ],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'debt_written_off',
          entity: 'debt_write_off',
          entityId: rows[0]!.id,
          after: {
            guardianId: input.guardianId,
            amount: input.clearsAll ? 'all' : (input.amount ?? '0'),
            reason: input.reason,
          },
        },
        tx,
      );
      return { id: rows[0]!.id };
    });
  }

  /** Revoked, never deleted. The debt it forgave comes back. */
  async revokeWriteOff(id: string, reason: string, actorId: string) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const result = await tx.query(
        `UPDATE debt_write_offs
            SET revoked_at = now(), revoked_by = $2, revoked_reason = $3
          WHERE id = $1 AND revoked_at IS NULL`,
        [id, actorId, reason.trim() || null],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new NotFoundException('Aucune remise active correspondante.');
      }
      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'debt_write_off_revoked',
          entity: 'debt_write_off',
          entityId: id,
          after: { reason },
        },
        tx,
      );
      return { id };
    });
  }

  /**
   * LE CORRESPONDANT LUI-MÊME — the name and the phone at the top of its card.
   *
   * ⚠ THE TILL SCREEN DID NOT NAME THE FAMILY IT WAS ABOUT. Its own profile
   * opens `<h3><?= $parent_courant['nom_complet'] ?></h3>` with the telephone
   * under it, and ours opened straight into "2 enfant(s) inscrit(s)". Two
   * families in Nouakchott share a surname constantly; a clerk arriving from a
   * search result had nothing on screen confirming they were about to take
   * money against the right household.
   */
  async guardianCard(guardianId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        full_name: string;
        phone: string | null;
        email: string | null;
      }>('SELECT id, full_name, phone, email FROM users WHERE id = $1', [guardianId]);
      return rows[0] ?? null;
    });
  }

  /**
   * LES ANNÉES OÙ CETTE FAMILLE A UN ENFANT — its year selector.
   *
   * ⚠ ITS OWN SELECTOR LIED, AND ITS COMMENT SAYS HOW. The list held only years
   * where the family had an enrolment, so a household not yet re-enrolled had no
   * 2026-2027 option: nothing carried `selected`, the browser showed the FIRST
   * entry — 2025-2026 — while the header announced 2026-2027 and the page
   * computed on 2026. Its fix is ported: the open year and the year being viewed
   * are always present, whether or not this family has a child in them.
   *
   * ⚠ AND A YEAR WITH NO ENROLMENT SAYS SO — "— aucun inscrit" — rather than
   * silently opening on an empty screen that reads as lost data.
   */
  async yearsForGuardian(guardianId: string, viewingYearId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        label: string;
        start_year: number;
        status: string;
        children: number;
      }>(
        `SELECT y.id, y.label, y.start_year, y.status,
                (SELECT count(*)::int FROM enrollments e
                   JOIN students s ON s.id = e.student_id
                  WHERE s.guardian_id = $1 AND e.academic_year_id = y.id
                    AND e.status <> 'cancelled') AS children
           FROM academic_years y
          WHERE y.status = 'active'
             OR y.id = $2
             OR EXISTS (SELECT 1 FROM enrollments e
                          JOIN students s ON s.id = e.student_id
                         WHERE s.guardian_id = $1 AND e.academic_year_id = y.id
                           AND e.status <> 'cancelled')
          ORDER BY y.start_year DESC`,
        [guardianId, viewingYearId],
      );
      return rows;
    });
  }

  /** Every write-off for a family, live and revoked. */
  async writeOffsFor(guardianId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT w.id, w.amount::text, w.clears_all, w.reason, w.created_at,
                w.revoked_at, w.revoked_reason,
                g.full_name AS granted_by_name,
                -- Son « Année » et son « par » de l'annulation.
                y.label AS year_label,
                r.full_name AS revoked_by_name
           FROM debt_write_offs w
           LEFT JOIN users g ON g.id = w.granted_by
           LEFT JOIN users r ON r.id = w.revoked_by
           LEFT JOIN academic_years y ON y.id = w.academic_year_id
          WHERE w.guardian_id = $1
          ORDER BY w.created_at DESC`,
        [guardianId],
      );
      return rows;
    });
  }

  async outstanding(academicYearId: string | null, startYear: number | null) {
    // « Tous les correspondants ayant au moins un enfant » — son
    // `SELECT DISTINCT p.id … FROM parents p JOIN etudiants e`, sans limite :
    // une famille au-delà d'une centième ligne serait une famille jamais relancée.
    const guardians = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string; full_name: string; phone: string | null }>(
        `SELECT DISTINCT u.id, u.full_name, u.phone
           FROM users u
           JOIN students s ON s.guardian_id = u.id
          ORDER BY u.full_name`,
      );
      return rows;
    });

    const out: Array<{
      guardianId: string;
      name: string;
      phone: string | null;
      total: string;
      scolarite: string;
      diverses: string;
      months: number;
    }> = [];

    /*
     * ⚠ CETTE BOUCLE ÉTAIT UN N+1, ET ELLE ATTENDAIT CHAQUE FAMILLE À SON TOUR.
     *
     * Cent correspondants × deux appels, chacun ouvrant sa propre transaction
     * avec son `set_config` : deux cents allers-retours en file indienne, pour
     * un écran qu'on ouvre en début de mois pour savoir qui relancer. Mesuré à
     * deux secondes sur la base de démonstration — et elle porte 600 élèves, pas
     * 2 153.
     *
     * ⚠ RIEN DU CALCUL NE CHANGE. Chaque famille est calculée exactement comme
     * avant, par les mêmes fonctions, dans le même ordre d'opérations : la
     * règle d'El Ourwa — « le détail affiché vient de la MÊME source que le
     * total » — tient toujours, parce que c'est toujours `forGuardian()` qui
     * répond. Seule l'attente change : on cesse de faire la queue.
     *
     * Le pool tient dix connexions ; on en prend six au plus, pour qu'un
     * rapport ouvert par la comptable ne fasse pas attendre les paiements
     * encaissés au guichet pendant ce temps.
     */
    const CONCURRENCE = 6;
    // Pour UNE année : `forGuardians()` — les mêmes requêtes que `forGuardian()`,
    // pour toutes les familles à la fois (voir là-bas) — par lots de 200.
    const LOT = academicYearId === null || startYear === null ? CONCURRENCE : 200;
    for (let i = 0; i < guardians.length; i += LOT) {
      const lot = guardians.slice(i, i + LOT);
      let calculs: {
        guardian: (typeof lot)[number];
        debt: { total: string; tuition: unknown[]; beforeWriteOffs?: string; writtenOff?: string; clearsAll?: boolean };
        misc: { remaining: string }[];
      }[];
      if (academicYearId === null || startYear === null) {
        // « Toutes » : une famille peut devoir depuis plusieurs années, et c'est
        // le même calcul avec le filtre d'année retiré.
        calculs = await Promise.all(
          lot.map(async (guardian) => {
            const d = await this.detailAcrossYears(guardian.id);
            return {
              guardian,
              debt: { total: toStorage(d.total), tuition: d.tuition },
              misc: d.misc.map((m) => ({ remaining: m.outstanding })),
            };
          }),
        );
      } else {
        const ids = lot.map((g) => g.id);
        const [dettes, divers] = await Promise.all([
          this.forGuardians(ids, academicYearId, startYear),
          this.miscDebtsRemainingFor(ids),
        ]);
        calculs = lot.map((guardian) => ({
          guardian,
          debt: dettes.get(guardian.id)!,
          misc: divers.get(guardian.id) ?? [],
        }));
      }

      for (const { guardian, debt, misc } of calculs) {
        // El Ourwa's Impayés splits the money in two columns and computes them
        // exactly this way: `diverses` is the sum of what is left on the ad-hoc
        // debts, and `scolarite` is whatever the total is beyond that — never
        // negative, because a write-off can take the tuition side below zero
        // while a miscellaneous debt still stands.
        const diverses = misc.reduce(
          (sum, d) => sum.plus(money(d.remaining)),
          new Decimal(0),
        );
        /*
         * ⚠ DEUX DÉFAUTS DU 22/09, CONFIRMÉS CONTRE impayes.php :
         *   - « Toutes les années » : `detailAcrossYears().total` contient DÉJÀ
         *     les créances ; les rajouter les comptait deux fois (10 000 de
         *     créance → « TOTAL DÛ 20 000 »). Son `$du = total_dette`, une fois.
         *   - Une année : `calculerDette()` plafonnait à zéro AVANT d'ajouter
         *     les créances, donc une remise accordée sur un arriéré (le cas
         *     même de « remise ») disparaissait — la liste réclamait ce que la
         *     direction avait remis, alors que la fiche, la réinscription et
         *     l'application (detailAcrossYears) disaient le bon chiffre. Son
         *     `obtenir_dette_parent_detaillee()` : mois + créances + frais,
         *     PUIS `max(0, total_avant_remise − remise)`.
         */
        const total =
          academicYearId === null || startYear === null
            ? money(debt.total)
            : debt.clearsAll
              ? new Decimal(0)
              : Decimal.max(0, money(debt.beforeWriteOffs ?? '0').plus(diverses).minus(money(debt.writtenOff ?? '0')));
        // École « services » (§6) : les services sont dans `total` (par
        // `beforeWriteOffs` ou `detailAcrossYears().total`), donc dans cette
        // colonne ; `months` reste la scolarité seule (`tuition`).
        const scolarite = Decimal.max(total.minus(diverses), 0);

        if (total.greaterThan(0)) {
          out.push({
            guardianId: guardian.id,
            name: guardian.full_name,
            phone: guardian.phone,
            total: toStorage(total),
            scolarite: toStorage(scolarite),
            diverses: toStorage(diverses),
            months: debt.tuition.length,
          });
        }
      }
    }
    return out.sort((a, b) => money(b.total).comparedTo(money(a.total)));
  }
}

/** Une ligne de mois facturable, telle que `forGuardian()` la lit. */
interface LigneMois {
  student_id: string;
  first_name: string;
  last_name: string;
  month_label: string | null;
  calendar_month: number;
  calendar_year: number;
  amount_due: string;
  discount: string;
  paid: string;
  exempt: boolean;
}

/** Les codes des services annuels (inscription, photocopie), lus du catalogue partagé. */
const SERVICES_ANNUELS: readonly string[] = SERVICES.filter((s) => s.periodicite === 'annuel').map((s) => s.code);

/** Une échéance de service, telle que `echeancesServicesDues()` la lit. */
interface EcheanceServiceDue {
  guardian_id: string;
  student_id: string;
  first_name: string;
  last_name: string;
  student_service_id: string;
  service: ServiceCode;
  calendar_month: number;
  calendar_year: number;
  amount_due: string;
  paid: string;
}

/**
 * CE QUE LES SERVICES AJOUTENT À LA DETTE (§6), sans base — une seule règle,
 * appelée par `calculerDette()` (donc `forGuardian` et `forGuardians`) et par
 * `detailAcrossYears()` : les chemins ne peuvent pas diverger.
 *
 *   - un mois de service à venir n'est pas dû (le prédicat de la scolarité :
 *     `année × 12 + mois > maintenant`) ; un service annuel est dû dès
 *     l'inscription, comme les frais annuels ;
 *   - reste = dû − payé net ; rien s'il est nul ou négatif (un trop-payé ne
 *     devient jamais une dette négative).
 *
 * Rangé par enfant (dans l'ordre de la requête : nom, prénom), puis dans
 * l'ordre de la fenêtre d'encaissement (`comparerEcheancesService` : les
 * annuels d'abord, puis mois par mois).
 */
function dettesDeServices(
  rows: EcheanceServiceDue[],
  nowIndex: number,
): { lignes: LigneServiceDette[]; total: Decimal } {
  const rangEleve = new Map<string, number>();
  const retenues: { rang: number; ligne: LigneServiceDette; month: number; year: number }[] = [];
  let total = new Decimal(0);
  for (const r of rows) {
    const def = definitionService(r.service);
    const annuel = def.periodicite === 'annuel';
    if (!annuel && r.calendar_year * 12 + r.calendar_month > nowIndex) continue;
    const due = money(r.amount_due);
    const paid = money(r.paid);
    const outstanding = due.minus(paid);
    if (outstanding.lessThanOrEqualTo(0)) continue;
    if (!rangEleve.has(r.student_id)) rangEleve.set(r.student_id, rangEleve.size);
    total = total.plus(outstanding);
    retenues.push({
      rang: rangEleve.get(r.student_id)!,
      month: r.calendar_month,
      year: r.calendar_year,
      ligne: {
        studentId: r.student_id,
        studentName: `${r.first_name} ${r.last_name}`.trim(),
        studentServiceId: r.student_service_id,
        service: r.service,
        label: libelleService(r.service),
        periodicite: def.periodicite,
        month: annuel ? null : r.calendar_month,
        year: annuel ? null : r.calendar_year,
        monthLabel: annuel ? null : `${MOIS[r.calendar_month - 1] ?? r.calendar_month} ${r.calendar_year}`,
        due: toStorage(due),
        paid: toStorage(paid),
        outstanding: toStorage(outstanding),
      },
    });
  }
  retenues.sort(
    (a, b) =>
      a.rang - b.rang ||
      comparerEcheancesService(
        { service: a.ligne.service, month: a.month, year: a.year },
        { service: b.ligne.service, month: b.month, year: b.year },
      ) ||
      a.ligne.studentServiceId.localeCompare(b.ligne.studentServiceId),
  );
  return { lignes: retenues.map((r) => r.ligne), total };
}

/**
 * Une date rendue « jj/mm/aaaa » (son `date('d/m/Y')`) ou ISO — `new Date()`
 * lisait la première comme invalide et « Rétablir l'exemption » apparaissait
 * sur des mois réellement dus.
 */
function dateLue(s: string): Date | null {
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (fr) return new Date(Number(fr[3]), Number(fr[2]) - 1, Number(fr[1]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * LE CALCUL DE LA DETTE D'UNE FAMILLE, sans base : les lignes de mois, les
 * frais annuels (vides si aucun inscrit), les remises, et l'index du mois
 * courant. C'est le corps historique de `forGuardian()`, déplacé mot pour mot
 * pour être partagé avec `forGuardians()` — toute règle se change ICI, une fois.
 *
 * École « services » : les échéances de service (§6), ajoutées AVANT les
 * remises par `dettesDeServices()` — la même fonction que `detailAcrossYears()`.
 * Une école « famille » n'en a aucune : le calcul est celui d'avant.
 */
function calculerDette(
  guardianId: string,
  rows: LigneMois[],
  fees: { label: string; remaining: Decimal }[],
  remises: { amount: Decimal; clearsAll: boolean },
  nowIndex: number,
  services: EcheanceServiceDue[] = [],
): FamilyDebt {
  const tuition: DebtLine[] = [];
  let beforeWriteOffs = new Decimal(0);

  for (const row of rows) {
    // A month that has not happened yet is not owed.
    if (row.calendar_year * 12 + row.calendar_month > nowIndex) continue;
    if (row.exempt) continue;

    const due = Decimal.max(0, money(row.amount_due).minus(money(row.discount)));
    if (due.lessThanOrEqualTo(0)) continue;

    const paid = money(row.paid);
    const outstanding = due.minus(paid);
    if (outstanding.lessThanOrEqualTo(0)) continue;

    tuition.push({
      studentId: row.student_id,
      studentName: `${row.first_name} ${row.last_name}`.trim(),
      label: row.month_label ?? `${row.calendar_month}/${row.calendar_year}`,
      calendarMonth: row.calendar_month,
      calendarYear: row.calendar_year,
      due: toStorage(due),
      paid: toStorage(paid),
      outstanding: toStorage(outstanding),
    });
    beforeWriteOffs = beforeWriteOffs.plus(outstanding);
  }

  const annualFees: { label: string; outstanding: string }[] = [];
  for (const fee of fees) {
    if (fee.remaining.lessThanOrEqualTo(0)) continue;
    annualFees.push({ label: fee.label, outstanding: toStorage(fee.remaining) });
    beforeWriteOffs = beforeWriteOffs.plus(fee.remaining);
  }

  // Les services (§6) — AVANT la remise, qui porte sur toute la somme.
  const dettesServices = dettesDeServices(services, nowIndex);
  beforeWriteOffs = beforeWriteOffs.plus(dettesServices.total);

  const { amount: writtenOffAmount, clearsAll } = remises;
  const writtenOff = clearsAll ? beforeWriteOffs : writtenOffAmount;
  const total = clearsAll
    ? new Decimal(0)
    : Decimal.max(0, beforeWriteOffs.minus(writtenOffAmount));

  return {
    guardianId,
    tuition,
    annualFees,
    services: dettesServices.lignes,
    beforeWriteOffs: toStorage(beforeWriteOffs),
    writtenOff: toStorage(writtenOff),
    total: toStorage(total),
    clearsAll,
  };
}

/** Its `$mois_noms`. */
const MOIS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

/** Son `number_format($x, 0, ',', ' ')`. */
function fr(value: Decimal): string {
  return value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
