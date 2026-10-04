import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { PayableMonth, Queryable } from '@elourwa/db';
import {
  SERVICE_CODES,
  definitionService,
  estServiceOptionnel,
  libelleService,
  money,
  toStorage,
  type FamilleService,
  type Periodicite,
  type ServiceCode,
} from '@elourwa/shared';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AcademicYearService, type AcademicYear } from '../academic/academic-year.service.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { TarifsService, prixNonDefini } from './tarifs.service.js';

const MOIS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
] as const;

/** « de Novembre », « d'Avril ». */
function deMois(nom: string): string {
  return /^[AEIOUÉÈ]/.test(nom) ? `d'${nom}` : `de ${nom}`;
}

const index = (month: number, year: number) => year * 12 + month;

/**
 * LE PREMIER MOIS FACTURÉ PAR DÉFAUT — la règle du 25, appliquée au jour de la
 * souscription (§4) : le mois courant si l'on est le 25 ou avant, sinon le
 * suivant ; avant le début de l'année, son premier mois.
 *
 * Parmi les mois PAYABLES de l'année (sa sélection, `payableMonthsFor`) : un
 * mois que l'école ne facture pas n'est pas un mois de départ. Après le
 * dernier : `null`, il ne reste rien à facturer — et non le premier mois comme
 * le ferait `firstOwedMonthOrder`, qui rendrait dus neuf mois d'un service
 * souscrit en juillet.
 */
export function moisDeDepartParDefaut(
  months: readonly PayableMonth[],
  today: Date,
): PayableMonth | null {
  const aujourdhui = index(today.getUTCMonth() + 1, today.getUTCFullYear());
  const entree = today.getUTCDate() <= 25 ? aujourdhui : aujourdhui + 1;
  return months.find((m) => index(m.month, m.year) >= entree) ?? null;
}

/** Un abonnement tel qu'une souscription le rend. */
export interface AbonnementCree {
  id: string;
  service: ServiceCode;
  /** Le montant figé à la souscription. */
  amount: string;
  startMonth: number;
  startYear: number;
  /** Faux quand un abonnement actif de la même famille existait déjà (idempotence). */
  created: boolean;
}

export type EtatMoisService = 'paid' | 'partial' | 'due' | 'exempt';

export interface MoisAbonnement {
  month: number;
  year: number;
  label: string;
  /** Le montant de l'échéancier (figé). */
  due: string;
  /** Payé net (annulations déduites). */
  paid: string;
  /** Ce qui reste dû : 0 si exempté, jamais négatif. */
  outstanding: string;
  state: EtatMoisService;
}

export interface Abonnement {
  id: string;
  service: ServiceCode;
  label: string;
  periodicite: Periodicite;
  famille: FamilleService;
  amount: string;
  /** La remise PAR MOIS (0047) ; '0.00' sans remise. Dû d'un mois sans paiement = amount − remise. */
  remise: string;
  /** Faux pour les services d'office (inscription, photocopie) : ils s'exemptent. */
  arretable: boolean;
  exempt: boolean;
  startMonth: number;
  startYear: number;
  /** ISO ; null tant que l'abonnement court. */
  endedAt: string | null;
  months: MoisAbonnement[];
}

/**
 * LES SERVICES D'UN ÉLÈVE — abonnements, échéancier, arrêt, exemption (§4).
 *
 * ADR-0073. Un abonnement (`student_services`) est une décision, au montant
 * FIGÉ à la souscription ; son échéancier (`student_service_months`) est
 * matérialisé comme celui de la scolarité, donc il obéit aux mêmes règles : un
 * mois payé garde son prix, un mois échu est dû. L'argent, lui, est dans
 * `service_payments` (append-only), jamais ici.
 *
 * Qui fait quoi (§4) : souscrire, la caisse (`finance.encaisser`) ou les rôles
 * qui inscrivent (dans la transaction de l'inscription) ; arrêter, exempter,
 * lever l'exemption : la direction seule. Les gardes sont au contrôleur.
 *
 * Tout ce qui écrit prend le verrou de la famille — celui du reçu groupé,
 * `family-payment:<correspondant>:<année>` — puis la ligne de l'abonnement FOR
 * UPDATE : un mois ne peut pas être encaissé pendant qu'on le supprime.
 */
@Injectable()
export class StudentServicesService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AcademicYearService) private readonly years: AcademicYearService,
    @Inject(TarifsService) private readonly tarifs: TarifsService,
  ) {}

  /**
   * CRÉER UN ABONNEMENT ET SON ÉCHÉANCIER, dans une transaction ouverte (celle
   * de l'inscription, ou celle de `subscribe`).
   *
   * ⚠ IDEMPOTENT PAR FAMILLE (§8) : un abonnement ACTIF de la même famille
   * (`student_services_actif_uq`) n'est pas recréé, et c'est lui qui est rendu
   * (`created: false`) — y compris quand une autre formule de cantine était
   * demandée. Changer de formule est un geste à part : arrêter, puis souscrire.
   *
   * Mensuel : une ligne par mois payable à partir du mois de départ. Annuel
   * (photocopie, inscription) : une seule ligne, au mois de départ.
   */
  async souscrireIn(
    tx: Queryable,
    p: {
      studentId: string;
      year: AcademicYear;
      months: readonly PayableMonth[];
      service: ServiceCode;
      amount: string;
      start: PayableMonth;
      actorId: string;
      /** Pour l'audit : souscrit à l'inscription ou depuis la fiche. */
      via: 'inscription' | 'fiche';
    },
  ): Promise<AbonnementCree> {
    const { schoolId } = currentTenant();
    const def = definitionService(p.service);
    const amount = toStorage(money(p.amount));

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO student_services
         (school_id, student_id, academic_year_id, service, amount, start_month, start_year, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (school_id, student_id, academic_year_id, famille) WHERE ended_at IS NULL
       DO NOTHING
       RETURNING id`,
      [schoolId, p.studentId, p.year.id, p.service, amount, p.start.month, p.start.year, p.actorId],
    );

    if (!rows[0]) {
      const { rows: actif } = await tx.query<{
        id: string;
        service: ServiceCode;
        amount: string;
        start_month: number;
        start_year: number;
      }>(
        `SELECT id, service, amount::text AS amount, start_month, start_year
           FROM student_services
          WHERE student_id = $1 AND academic_year_id = $2 AND famille = $3 AND ended_at IS NULL`,
        [p.studentId, p.year.id, def.famille],
      );
      const a = actif[0];
      if (!a) throw new ConflictException('Abonnement concurrent : recommencez.');
      return {
        id: a.id,
        service: a.service,
        amount: a.amount,
        startMonth: a.start_month,
        startYear: a.start_year,
        created: false,
      };
    }

    const id = rows[0].id;
    const echeances =
      def.periodicite === 'annuel' ? [p.start] : p.months.filter((m) => m.order >= p.start.order);
    for (const m of echeances) {
      await tx.query(
        `INSERT INTO student_service_months
           (school_id, student_service_id, calendar_month, calendar_year, amount_due)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (school_id, student_service_id, calendar_year, calendar_month) DO NOTHING`,
        [schoolId, id, m.month, m.year, amount],
      );
    }

    await this.audit.record(
      {
        actorId: p.actorId,
        schoolId,
        action: 'student_service_subscribed',
        entity: 'student_service',
        entityId: id,
        after: {
          studentId: p.studentId,
          service: p.service,
          amount,
          start: `${p.start.month}/${p.start.year}`,
          months: echeances.length,
          year: p.year.label,
          via: p.via,
        },
      },
      tx,
    );

    return {
      id,
      service: p.service,
      amount,
      startMonth: p.start.month,
      startYear: p.start.year,
      created: true,
    };
  }

  /**
   * SOUSCRIRE DEPUIS LA FICHE — `POST /finance/students/:studentId/services`.
   *
   * Au prix de l'année, figé ; à partir du mois choisi, sinon de la règle du
   * 25 appliquée à aujourd'hui. L'élève doit être inscrit (inscription non
   * annulée) sur l'année.
   */
  async subscribe(
    input: {
      studentId: string;
      academicYearId?: string;
      service: string;
      startMonth?: number;
      startYear?: number;
    },
    actorId: string,
    today: Date = new Date(),
  ): Promise<AbonnementCree & { guardianId: string | null; academicYearId: string }> {
    await this.tarifs.exigerServices();
    const service = input.service;
    if (!estServiceOptionnel(service)) {
      throw new BadRequestException(
        service === 'inscription'
          ? "Les frais d'inscription sont créés d'office à l'inscription : ils ne se souscrivent pas."
          : `Service inconnu : « ${service} ».`,
      );
    }
    if ((input.startMonth === undefined) !== (input.startYear === undefined)) {
      throw new BadRequestException("Indiquez le mois ET l'année du premier mois facturé.");
    }
    const year = await this.years.assertWritable(
      input.academicYearId ?? (await this.years.enrolmentTarget()).id,
    );

    return this.db.query(async (tx) => {
      const { rows: inscrit } = await tx.query<{ guardian_id: string | null }>(
        `SELECT s.guardian_id
           FROM enrollments e JOIN students s ON s.id = e.student_id
          WHERE e.student_id = $1 AND e.academic_year_id = $2 AND e.status <> 'cancelled'`,
        [input.studentId, year.id],
      );
      if (!inscrit[0]) throw new NotFoundException("Cet élève n'est pas inscrit sur cette année.");
      const guardianId = inscrit[0].guardian_id;
      await this.verrouFamille(tx, guardianId, year.id);

      // La même famille déjà en cours : le même service est rendu tel quel ;
      // une autre formule de cantine est refusée, et le refus dit quoi faire.
      const { rows: actif } = await tx.query<{ service: ServiceCode }>(
        `SELECT service FROM student_services
          WHERE student_id = $1 AND academic_year_id = $2 AND famille = $3 AND ended_at IS NULL`,
        [input.studentId, year.id, definitionService(service).famille],
      );
      if (actif[0] && actif[0].service !== service) {
        throw new ConflictException(
          `Cet élève a déjà un abonnement « ${libelleService(actif[0].service)} » en cours : ` +
            "arrêtez-le d'abord pour changer de formule.",
        );
      }

      const months = await this.years.payableMonthsIn(tx, year);
      // ⚠ UN MOIS NE SE FACTURE PAS DEUX FOIS (04/10/2026) : un abonnement
      // arrêté de la même famille garde ses mois d'avant l'arrêt ; reprendre
      // le service commence APRÈS le dernier d'entre eux.
      const { rows: facture } = await tx.query<{ dernier: number | null }>(
        `SELECT MAX(m.calendar_year * 12 + m.calendar_month) AS dernier
           FROM student_service_months m
           JOIN student_services ss ON ss.id = m.student_service_id
          WHERE ss.student_id = $1 AND ss.academic_year_id = $2 AND ss.famille = $3
            AND ss.ended_at IS NOT NULL`,
        [input.studentId, year.id, definitionService(service).famille],
      );
      const dejaFacture = facture[0]?.dernier ?? null;
      const libre = (m: PayableMonth) => dejaFacture === null || index(m.month, m.year) > dejaFacture;
      let start: PayableMonth | null = null;
      if (actif[0]) {
        // Le même service, déjà en cours : `souscrireIn` le rend tel quel
        // (created: false) sans rien écrire — ni mois de départ ni prix à lire.
        start = months[0] ?? null;
      } else if (input.startMonth !== undefined) {
        start = months.find((m) => m.month === input.startMonth && m.year === input.startYear) ?? null;
        if (!start) throw new BadRequestException(`Ce mois n'appartient pas à l'année ${year.label}.`);
        if (!libre(start)) {
          const apres = months.find(libre);
          const dernierMois = ((dejaFacture! - 1) % 12) + 1;
          throw new BadRequestException(
            `« ${libelleService(service)} » est déjà facturé jusqu'en ${MOIS[dernierMois - 1]} : ` +
              (apres ? `reprenez à partir ${deMois(MOIS[apres.month - 1]!)} ${apres.year}.` : "il ne reste aucun mois à facturer."),
          );
        }
      } else {
        const regle = moisDeDepartParDefaut(months, today);
        // Après le dernier mois de l'année, `regle` est nul : rien à facturer,
        // même si des mois « libres » précèdent.
        start = !regle ? null : libre(regle) ? regle : (months.find((m) => libre(m) && m.order >= regle.order) ?? null);
        if (!start) {
          throw new BadRequestException(
            `L'année ${year.label} est terminée : il ne reste aucun mois à facturer.`,
          );
        }
      }

      const { rows: prix } = await tx.query<{ amount: string }>(
        'SELECT amount::text AS amount FROM service_prices WHERE academic_year_id = $1 AND service = $2',
        [year.id, service],
      );
      if (!prix[0] && !actif[0]) throw new BadRequestException(prixNonDefini(service, year.label));

      const cree = await this.souscrireIn(tx, {
        studentId: input.studentId,
        year,
        months,
        service,
        amount: prix[0]?.amount ?? '0',
        start: start!,
        actorId,
        via: 'fiche',
      });
      return { ...cree, guardianId, academicYearId: year.id };
    });
  }

  /**
   * ARRÊTER UN SERVICE — `POST /finance/student-services/:id/stop` (direction).
   *
   * À partir du mois M (par défaut le mois qui suit aujourd'hui), les lignes
   * d'échéancier sont supprimées : elles n'ont jamais été dues. `ended_at` est
   * posé, et la famille du service redevient libre (changer de formule).
   *
   * ⚠ UN MOIS ≥ M QUI PORTE UN PAIEMENT NET > 0 BLOQUE L'ARRÊT, avec le mois à
   * partir duquel arrêter : supprimer sa ligne laisserait de l'argent encaissé
   * contre une échéance qui n'existe plus. Un paiement annulé (net 0) ne
   * retient rien : rien n'y a été réglé, et garder la ligne la rendrait due
   * pour un service arrêté. Le grand livre, lui, n'est jamais touché.
   *
   * ⚠ L'INSCRIPTION NE S'ARRÊTE PAS : elle s'exempte (CHECK de 0042).
   */
  async stop(
    id: string,
    input: { fromMonth?: number; fromYear?: number },
    actorId: string,
    today: Date = new Date(),
  ): Promise<{
    id: string;
    service: ServiceCode;
    endedAt: string;
    monthsRemoved: number;
    guardianId: string | null;
    academicYearId: string;
  }> {
    await this.tarifs.exigerServices();
    if ((input.fromMonth === undefined) !== (input.fromYear === undefined)) {
      throw new BadRequestException("Indiquez le mois ET l'année à partir desquels arrêter.");
    }
    const depuis =
      input.fromMonth !== undefined
        ? index(input.fromMonth, input.fromYear!)
        : index(today.getUTCMonth() + 1, today.getUTCFullYear()) + 1;

    const tete = await this.tete(id);
    const year = await this.years.assertWritable(tete.academic_year_id);
    const { schoolId } = currentTenant();

    return this.db.query(async (tx) => {
      await this.verrouFamille(tx, tete.guardian_id, year.id);
      const sub = await this.abonnementPourMaj(tx, id);
      // L'inscription et (04/10/2026) la photocopie sont obligatoires : elles
      // s'exemptent, elles ne s'arrêtent pas.
      if (!definitionService(sub.service).arretable) {
        throw new BadRequestException(
          `L'abonnement « ${libelleService(sub.service)} » est obligatoire, il ne s'arrête pas : exemptez-le si l'école y renonce.`,
        );
      }
      if (sub.ended_at) throw new ConflictException('Cet abonnement est déjà arrêté.');

      const { rows: lignes } = await tx.query<{
        calendar_month: number;
        calendar_year: number;
        paye: string;
      }>(
        `SELECT m.calendar_month, m.calendar_year,
                COALESCE(SUM(p.amount), 0)::text AS paye
           FROM student_service_months m
           LEFT JOIN service_payments p
             ON p.student_service_id = m.student_service_id
            AND p.calendar_month = m.calendar_month
            AND p.calendar_year = m.calendar_year
          WHERE m.student_service_id = $1
            AND m.calendar_year * 12 + m.calendar_month >= $2
          GROUP BY m.id, m.calendar_month, m.calendar_year
          ORDER BY m.calendar_year, m.calendar_month`,
        [id, depuis],
      );
      const regles = lignes.filter((l) => money(l.paye).greaterThan(0));
      if (regles.length > 0) {
        const dernier = regles[regles.length - 1]!;
        const suivant = (dernier.calendar_month % 12) + 1;
        throw new BadRequestException(
          `${MOIS[dernier.calendar_month - 1]} est déjà réglé : arrêtez à partir ` +
            `${deMois(MOIS[suivant - 1]!)}, ou annulez d'abord le paiement.`,
        );
      }

      const supprimes = await tx.query(
        `DELETE FROM student_service_months
          WHERE student_service_id = $1 AND calendar_year * 12 + calendar_month >= $2`,
        [id, depuis],
      );
      const { rows: fin } = await tx.query<{ ended_at: Date }>(
        'UPDATE student_services SET ended_at = now(), ended_by = $2 WHERE id = $1 RETURNING ended_at',
        [id, actorId],
      );
      const monthsRemoved = supprimes.rowCount ?? 0;
      const from = { month: ((depuis - 1) % 12) + 1, year: Math.floor((depuis - 1) / 12) };

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'student_service_stopped',
          entity: 'student_service',
          entityId: id,
          before: { service: sub.service, studentId: sub.student_id },
          after: { from: `${from.month}/${from.year}`, monthsRemoved, year: year.label },
        },
        tx,
      );

      return {
        id,
        service: sub.service,
        endedAt: fin[0]!.ended_at.toISOString(),
        monthsRemoved,
        guardianId: tete.guardian_id,
        academicYearId: year.id,
      };
    });
  }

  /**
   * EXEMPTER UN SERVICE, OU LEVER L'EXEMPTION — `POST /finance/student-services/:id/exempt`
   * (direction).
   *
   * Par abonnement, donc par élève et par service, un à un. Exempté, il reste
   * visible ; ses mois pèsent 0 dans la dette ; ce qui a déjà été payé reste
   * payé (aucune écriture au grand livre). Réversible. Demander l'état déjà en
   * place ne change rien et ne s'audite pas.
   */
  async setExempt(
    id: string,
    input: { exempt: boolean; reason?: string | null },
    actorId: string,
  ): Promise<{
    id: string;
    service: ServiceCode;
    exempt: boolean;
    changed: boolean;
    guardianId: string | null;
    academicYearId: string;
  }> {
    await this.tarifs.exigerServices();
    const tete = await this.tete(id);
    const year = await this.years.assertWritable(tete.academic_year_id);
    const { schoolId } = currentTenant();

    return this.db.query(async (tx) => {
      await this.verrouFamille(tx, tete.guardian_id, year.id);
      const sub = await this.abonnementPourMaj(tx, id);
      const base = { id, service: sub.service, exempt: input.exempt, guardianId: tete.guardian_id, academicYearId: year.id };
      if (sub.exempt === input.exempt) return { ...base, changed: false };

      await tx.query(
        `UPDATE student_services
            SET exempt = $2,
                exempted_by = CASE WHEN $2 THEN $3::uuid ELSE NULL END,
                exempted_at = CASE WHEN $2 THEN now() ELSE NULL END
          WHERE id = $1`,
        [id, input.exempt, actorId],
      );
      await this.audit.record(
        {
          actorId,
          schoolId,
          action: input.exempt ? 'student_service_exempted' : 'student_service_exemption_removed',
          entity: 'student_service',
          entityId: id,
          after: {
            service: sub.service,
            studentId: sub.student_id,
            year: year.label,
            reason: input.reason?.trim() ?? '',
          },
        },
        tx,
      );
      return { ...base, changed: true };
    });
  }

  /**
   * UNE REMISE SUR UN SERVICE MENSUEL — `POST /finance/student-services/:id/remise`
   * (direction). Demande du propriétaire de Jinan (04/10/2026, ADR-0079).
   *
   * Un montant PAR MOIS retranché du prix figé de l'abonnement (0 la retire) :
   * chaque mois SANS PAIEMENT (net 0) passe à `amount − remise` ; un mois réglé,
   * même en partie, garde son prix et son reçu — la règle de « changer de mode »
   * et de « Modifier le frais mensuel ». Rien n'est écrit au grand livre.
   *
   * ⚠ Mensuel seulement : un service annuel (inscription, photocopie)
   * s'exempte. Ni négative ni plus que le prix (CHECK de 0047). Un abonnement
   * arrêté garde ses mois passés tels quels. Même verrou que l'encaissement :
   * un mois ne peut pas être réévalué pendant qu'on l'encaisse.
   */
  async setRemise(
    id: string,
    input: { remise: string },
    actorId: string,
  ): Promise<{
    id: string;
    service: ServiceCode;
    remise: string;
    monthsChanged: number;
    changed: boolean;
    guardianId: string | null;
    academicYearId: string;
  }> {
    await this.tarifs.exigerServices();
    const brut = input.remise.trim().replace(',', '.');
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(brut)) {
      throw new BadRequestException('La remise est un montant positif (ex. 500), en MRU par mois.');
    }
    const remise = money(brut);
    const tete = await this.tete(id);
    const year = await this.years.assertWritable(tete.academic_year_id);
    const { schoolId } = currentTenant();

    return this.db.query(async (tx) => {
      await this.verrouFamille(tx, tete.guardian_id, year.id);
      const sub = await this.abonnementPourMaj(tx, id);
      const base = { id, service: sub.service, guardianId: tete.guardian_id, academicYearId: year.id };
      if (definitionService(sub.service).periodicite !== 'mensuel') {
        throw new BadRequestException(
          `« ${libelleService(sub.service)} » se paie une fois l'an : il ne se remise pas — exemptez-le si l'école y renonce.`,
        );
      }
      if (sub.ended_at) throw new ConflictException('Cet abonnement est arrêté : sa remise ne change plus.');
      const prix = money(sub.amount);
      if (remise.greaterThan(prix)) {
        throw new BadRequestException(
          `La remise (${toStorage(remise)}) dépasse le prix du service (${toStorage(prix)} MRU par mois).`,
        );
      }
      if (remise.equals(money(sub.remise))) return { ...base, remise: toStorage(remise), monthsChanged: 0, changed: false };

      const du = toStorage(prix.minus(remise));
      // Les seuls mois sans paiement : net 0 (un paiement annulé ne retient rien).
      const maj = await tx.query(
        `UPDATE student_service_months m
            SET amount_due = $2
          WHERE m.student_service_id = $1
            AND COALESCE((SELECT SUM(p.amount) FROM service_payments p
                           WHERE p.student_service_id = m.student_service_id
                             AND p.calendar_month = m.calendar_month
                             AND p.calendar_year = m.calendar_year), 0) = 0`,
        [id, du],
      );
      await tx.query(
        `UPDATE student_services
            SET remise = $2::numeric,
                remise_by = CASE WHEN $2::numeric > 0 THEN $3::uuid ELSE NULL END,
                remise_at = CASE WHEN $2::numeric > 0 THEN now() ELSE NULL END
          WHERE id = $1`,
        [id, toStorage(remise), actorId],
      );
      const monthsChanged = maj.rowCount ?? 0;
      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'student_service_remise_set',
          entity: 'student_service',
          entityId: id,
          before: { remise: sub.remise },
          after: {
            service: sub.service,
            studentId: sub.student_id,
            remise: toStorage(remise),
            dueParMois: du,
            monthsChanged,
            year: year.label,
          },
        },
        tx,
      );
      return { ...base, remise: toStorage(remise), monthsChanged, changed: true };
    });
  }

  /**
   * LES ABONNEMENTS D'UN ÉLÈVE POUR UNE ANNÉE, mois par mois — pour la fiche.
   *
   * `outstanding` = exempté ? 0 : max(0, dû − payé net). Tous les mois de
   * l'échéancier, échus ou non : c'est à la dette de ne compter que les échus.
   * Une école « famille » n'a aucune ligne : `[]`.
   */
  async forStudent(studentId: string, academicYearId: string): Promise<Abonnement[]> {
    return this.db.query(async (tx) => {
      const { rows: subs } = await tx.query<{
        id: string;
        service: ServiceCode;
        amount: string;
        remise: string;
        exempt: boolean;
        start_month: number;
        start_year: number;
        ended_at: Date | null;
      }>(
        `SELECT id, service, amount::text AS amount, remise::text AS remise, exempt, start_month, start_year, ended_at
           FROM student_services
          WHERE student_id = $1 AND academic_year_id = $2
          ORDER BY created_at, id`,
        [studentId, academicYearId],
      );
      if (subs.length === 0) return [];

      const { rows: mois } = await tx.query<{
        student_service_id: string;
        calendar_month: number;
        calendar_year: number;
        amount_due: string;
        paid: string;
      }>(
        `SELECT m.student_service_id, m.calendar_month, m.calendar_year,
                m.amount_due::text AS amount_due,
                COALESCE((SELECT SUM(p.amount) FROM service_payments p
                           WHERE p.student_service_id = m.student_service_id
                             AND p.calendar_month = m.calendar_month
                             AND p.calendar_year = m.calendar_year), 0)::text AS paid
           FROM student_service_months m
          WHERE m.student_service_id = ANY($1::uuid[])
          ORDER BY m.calendar_year, m.calendar_month`,
        [subs.map((s) => s.id)],
      );

      const rang = (s: ServiceCode) => SERVICE_CODES.indexOf(s);
      return [...subs]
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
            remise: s.remise,
            arretable: def.arretable,
            exempt: s.exempt,
            startMonth: s.start_month,
            startYear: s.start_year,
            endedAt: s.ended_at ? s.ended_at.toISOString() : null,
            months: mois
              .filter((m) => m.student_service_id === s.id)
              .map((m) => {
                const due = money(m.amount_due);
                const paid = money(m.paid);
                const outstanding = s.exempt ? new Decimal(0) : Decimal.max(0, due.minus(paid));
                const state: EtatMoisService = s.exempt
                  ? 'exempt'
                  : outstanding.isZero()
                    ? 'paid'
                    : paid.greaterThan(0)
                      ? 'partial'
                      : 'due';
                return {
                  month: m.calendar_month,
                  year: m.calendar_year,
                  label: `${MOIS[m.calendar_month - 1]} ${m.calendar_year}`,
                  due: toStorage(due),
                  paid: toStorage(paid),
                  outstanding: toStorage(outstanding),
                  state,
                };
              }),
          };
        });
    });
  }

  /** L'élève, sa famille et l'année d'un abonnement — de quoi verrouiller. */
  private async tete(id: string): Promise<{
    academic_year_id: string;
    guardian_id: string | null;
  }> {
    const tete = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ academic_year_id: string; guardian_id: string | null }>(
        `SELECT ss.academic_year_id, s.guardian_id
           FROM student_services ss JOIN students s ON s.id = ss.student_id
          WHERE ss.id = $1`,
        [id],
      );
      return rows[0];
    });
    if (!tete) throw new NotFoundException('Abonnement introuvable.');
    return tete;
  }

  private async abonnementPourMaj(
    tx: Queryable,
    id: string,
  ): Promise<{ service: ServiceCode; student_id: string; exempt: boolean; ended_at: Date | null; amount: string; remise: string }> {
    const { rows } = await tx.query<{
      service: ServiceCode;
      student_id: string;
      exempt: boolean;
      ended_at: Date | null;
      amount: string;
      remise: string;
    }>(
      `SELECT service, student_id, exempt, ended_at, amount::text AS amount, remise::text AS remise
         FROM student_services WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Abonnement introuvable.');
    return rows[0];
  }

  /** Le verrou du reçu groupé (`encaisserGroupe`), pris dans le même ordre : famille d'abord. */
  private async verrouFamille(tx: Queryable, guardianId: string | null, yearId: string): Promise<void> {
    if (!guardianId) return;
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `family-payment:${guardianId}:${yearId}`,
    ]);
  }
}
