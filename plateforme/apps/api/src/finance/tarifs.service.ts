import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  SERVICES_COCHABLES,
  SERVICES_D_OFFICE,
  SERVICES_OPTIONNELS,
  definitionService,
  estModeEtude,
  estServiceCochable,
  estServiceOptionnel,
  libelleFraisPhotocopie,
  libelleMode,
  libelleService,
  money,
  toStorage,
  type ModeEtude,
  type Periodicite,
  type ServiceOptionnel,
} from '@elourwa/shared';
import type { Queryable } from '@elourwa/db';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AcademicYearService, type AcademicYear } from '../academic/academic-year.service.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { BillingModelService, type BillingModel } from './billing-model.service.js';
import { ConcessionsService } from './concessions.service.js';

// ── Les refus, mot pour mot ceux de la spécification (docs/specs/jinan-facturation.md) ──

/** §2 — une inscription sans mode dans une école « services ». */
export const MODE_REQUIS =
  `Choisissez le mode d'étude : ${libelleMode('8h-14h')} ou ${libelleMode('8h-17h')}.`;

/**
 * Une école « famille » (El Mourad, Nour, Rissala, Salam) ne connaît rien de
 * tout cela. Un mode ou un service reçu là est une erreur de l'appelant : le
 * taire le ferait croire enregistré.
 */
export const FAMILLE_REFUS =
  "Cette école facture par famille : elle ne connaît ni mode d'étude ni services par élève.";

/** §4 — les trois cantines sont exclusives. */
export const CANTINE_UNIQUE =
  'Une seule formule de cantine par élève : petit déjeuner, déjeuner, ou les deux.';

/** §2 — « Le tarif 8h – 17h du niveau 6ème n'est pas défini — bouton « Frais ». » */
export function tarifNonDefini(mode: ModeEtude, niveau: string): string {
  return `Le tarif ${libelleMode(mode)} du niveau ${niveau} n'est pas défini — bouton « Frais ».`;
}

/** §3 — NULL n'est pas « gratuit » : l'école n'a encore rien décidé. */
export function fraisNonDefinis(niveau: string): string {
  return `Les frais d'inscription du niveau ${niveau} ne sont pas définis — bouton « Frais ».`;
}

/** §4 — « Le prix de la piscine n'est pas défini pour 2026-2027 — bouton « Frais ». » */
export function prixNonDefini(service: ServiceOptionnel, annee: string): string {
  return `Le prix ${duService(service)} n'est pas défini pour ${annee} — bouton « Frais ».`;
}

function duService(service: ServiceOptionnel): string {
  switch (service) {
    case 'cantine_petit_dejeuner':
      return 'de la cantine (petit déjeuner)';
    case 'cantine_dejeuner':
      return 'de la cantine (déjeuner)';
    case 'cantine_complet':
      return 'de la cantine (petit déjeuner + déjeuner)';
    case 'piscine':
      return 'de la piscine';
    case 'docteur':
      return 'du docteur';
    case 'transport':
      return 'du transport';
    // 06/10/2026 (ADR-0082) : le nom entre guillemets, comme la photocopie.
    case 'plateforme':
      return 'de « Frais de plateforme »';
    case 'fourniture':
      return 'de « Frais de fourniture »';
    case 'photocopie':
      return `de « ${libelleFraisPhotocopie()} »`;
  }
}

/**
 * Un montant saisi sur la page « Frais » : une chaîne, jamais un nombre JS
 * (règle 6). Vide = « non défini » (NULL), ce qui n'est pas « gratuit » (0).
 */
function montantOuVide(brut: string, quoi: string): string | null {
  const v = brut.trim();
  if (v === '') return null;
  // numeric(14,2) : douze chiffres avant la virgule, deux après, jamais de signe.
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(v)) {
    throw new BadRequestException(
      `${quoi} : indiquez un montant positif, en chiffres, deux décimales au plus.`,
    );
  }
  return toStorage(v);
}

export interface TarifsNiveau {
  id: string;
  nom: string;
  /** NULL = non défini : on ne peut pas inscrire dans ce mode. */
  tarif8h14: string | null;
  tarif8h17: string | null;
  /** NULL = non défini ; '0.00' = gratuit. */
  fraisInscription: string | null;
}

export interface PrixService {
  code: ServiceOptionnel;
  libelle: string;
  periodicite: Periodicite;
  /**
   * Vrai : créé d'office à chaque (ré)inscription (la photocopie, ADR-0079) —
   * pas une case à cocher ; faux : la famille le coche.
   */
  obligatoire: boolean;
  /** NULL = non défini : le service ne peut pas être souscrit cette année. */
  prix: string | null;
}

export interface PageTarifs {
  billingModel: BillingModel;
  annee: {
    id: string;
    label: string;
    startYear: number;
    status: AcademicYear['status'];
    /** Faux pour une année close : ses prix sont en lecture seule. */
    modifiable: boolean;
  };
  niveaux: TarifsNiveau[];
  services: PrixService[];
}

/**
 * Ce qu'une inscription dans une école « services » va figer, lu une fois et
 * vérifié AVANT toute écriture.
 */
export interface PlanInscription {
  studyMode: ModeEtude;
  /** Le tarif du niveau pour ce mode : `enrollments.full_rate`. */
  fullRate: string;
  levelName: string;
  /** `levels.student_enrolment_fee` au jour de l'inscription ('0.00' = gratuit). */
  enrolmentFee: string;
  /**
   * Les services à souscrire, au prix de l'année, dans l'ordre du catalogue :
   * ceux d'office (la photocopie, sauf prix 0) puis les cochés, sans doublon.
   */
  services: { service: ServiceOptionnel; amount: string }[];
}

type LigneNiveau = {
  id: string;
  name: string;
  rate_8h14: string | null;
  rate_8h17: string | null;
  enrolment_fee: string | null;
};

const COLONNES = {
  tarif8h14: 'monthly_rate_8h14',
  tarif8h17: 'monthly_rate_8h17',
  fraisInscription: 'student_enrolment_fee',
} as const;

const QUOI = {
  tarif8h14: `Tarif ${libelleMode('8h-14h')}`,
  tarif8h17: `Tarif ${libelleMode('8h-17h')}`,
  fraisInscription: "Frais d'inscription",
} as const;

/**
 * LES TARIFS D'UNE ÉCOLE « SERVICES » — la page « Frais » (§9), et les deux
 * lectures qu'une inscription en fait (§2, §3, §4).
 *
 * ADR-0073. Trois sortes de prix, et aucune n'est rétroactive :
 *
 *   - les tarifs mensuels PAR MODE d'un niveau (`levels.monthly_rate_8h14`,
 *     `monthly_rate_8h17`) : copiés dans `enrollments.monthly_fee` / `full_rate`
 *     et dans l'échéancier à l'inscription ;
 *   - les frais d'inscription PAR ÉLÈVE d'un niveau (`levels.student_enrolment_fee`) :
 *     figés sur l'abonnement `inscription` ;
 *   - les prix des six services, par école et PAR ANNÉE (`service_prices`) :
 *     figés sur l'abonnement à la souscription.
 *
 * Modifier l'un d'eux change la PROCHAINE inscription, jamais ce qu'une famille
 * doit déjà — comme `setLevelRate` pour une école « famille » (levels.spec.ts).
 *
 * Tout geste d'écriture est refusé à une école « famille » : ces colonnes et
 * cette table n'y ont aucun sens, et une valeur posée là par erreur ne serait
 * lue par personne.
 */
@Injectable()
export class TarifsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AcademicYearService) private readonly years: AcademicYearService,
    @Inject(BillingModelService) private readonly billing: BillingModelService,
    @Inject(ConcessionsService) private readonly concessions: ConcessionsService,
  ) {}

  /** Refuse tout geste « services » à une école « famille ». */
  async exigerServices(): Promise<void> {
    if (!(await this.billing.isServices())) throw new BadRequestException(FAMILLE_REFUS);
  }

  /**
   * LA PAGE « FRAIS » — `GET /finance/tarifs`.
   *
   * L'année demandée, sinon l'année active (§9), sinon la plus récente qui a
   * des inscriptions. Une année close se lit : c'est ce que ses familles ont
   * payé. Lue aussi par une école « famille », qui y trouve son modèle et rien
   * à modifier — le site affiche alors « indisponible ».
   */
  async tarifs(academicYearId?: string): Promise<PageTarifs> {
    const billingModel = await this.billing.current();
    const year = academicYearId
      ? await this.years.byId(academicYearId)
      : ((await this.years.active()) ?? (await this.years.defaultView()));
    if (!year) throw new BadRequestException('Aucune année scolaire.');

    return this.db.query(async (tx) => {
      const { rows: niveaux } = await tx.query<LigneNiveau>(
        `SELECT id, name,
                monthly_rate_8h14::text AS rate_8h14,
                monthly_rate_8h17::text AS rate_8h17,
                student_enrolment_fee::text AS enrolment_fee
           FROM levels
          ORDER BY cycle, sort_order, name`,
      );
      const prix = await this.prixIn(tx, year.id);
      return {
        billingModel,
        annee: {
          id: year.id,
          label: year.label,
          startYear: year.start_year,
          status: year.status,
          modifiable: year.status !== 'closed',
        },
        niveaux: niveaux.map((n) => ({
          id: n.id,
          nom: n.name,
          tarif8h14: n.rate_8h14,
          tarif8h17: n.rate_8h17,
          fraisInscription: n.enrolment_fee,
        })),
        services: SERVICES_OPTIONNELS.map((code) => ({
          code,
          libelle: libelleService(code),
          periodicite: definitionService(code).periodicite,
          obligatoire: !definitionService(code).optionnel,
          prix: prix.get(code) ?? null,
        })),
      };
    });
  }

  /** Les prix de l'année, par service (absent = non défini). */
  private async prixIn(tx: Queryable, academicYearId: string): Promise<Map<ServiceOptionnel, string>> {
    const { rows } = await tx.query<{ service: ServiceOptionnel; amount: string }>(
      'SELECT service, amount::text AS amount FROM service_prices WHERE academic_year_id = $1',
      [academicYearId],
    );
    return new Map(rows.map((r) => [r.service, r.amount]));
  }

  /**
   * LES TARIFS D'UN NIVEAU — `PATCH /levels/:id/tarifs`.
   *
   * Un champ absent ne change pas ; un champ vide redevient « non défini ».
   * ⚠ LE NIVEAU SEUL : aucune inscription n'est touchée. Un enfant inscrit à
   * 3 000 continue de devoir 3 000 quand le niveau passe à 3 300.
   */
  async setLevelTarifs(
    levelId: string,
    input: { tarif8h14?: string; tarif8h17?: string; fraisInscription?: string },
    actorId: string,
  ): Promise<TarifsNiveau> {
    await this.exigerServices();
    const { schoolId } = currentTenant();

    const changes: { cle: keyof typeof COLONNES; valeur: string | null }[] = [];
    for (const cle of Object.keys(COLONNES) as (keyof typeof COLONNES)[]) {
      const brut = input[cle];
      if (brut === undefined) continue;
      changes.push({ cle, valeur: montantOuVide(brut, QUOI[cle]) });
    }
    if (changes.length === 0) throw new BadRequestException('Rien à modifier.');

    return this.db.query(async (tx) => {
      const { rows: avant } = await tx.query<LigneNiveau>(
        `SELECT id, name,
                monthly_rate_8h14::text AS rate_8h14,
                monthly_rate_8h17::text AS rate_8h17,
                student_enrolment_fee::text AS enrolment_fee
           FROM levels WHERE id = $1 FOR UPDATE`,
        [levelId],
      );
      if (!avant[0]) throw new NotFoundException('Niveau introuvable.');

      // Les noms de colonne viennent de COLONNES, jamais de l'appelant.
      const set = changes.map((c, i) => `${COLONNES[c.cle]} = $${i + 2}`).join(', ');
      const { rows: apres } = await tx.query<LigneNiveau>(
        `UPDATE levels SET ${set} WHERE id = $1
         RETURNING id, name,
                   monthly_rate_8h14::text AS rate_8h14,
                   monthly_rate_8h17::text AS rate_8h17,
                   student_enrolment_fee::text AS enrolment_fee`,
        [levelId, ...changes.map((c) => c.valeur)],
      );

      const vue = (l: LigneNiveau): TarifsNiveau => ({
        id: l.id,
        nom: l.name,
        tarif8h14: l.rate_8h14,
        tarif8h17: l.rate_8h17,
        fraisInscription: l.enrolment_fee,
      });
      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'level_tarifs_changed',
          entity: 'level',
          entityId: levelId,
          before: vue(avant[0]),
          after: vue(apres[0]!),
        },
        tx,
      );
      return vue(apres[0]!);
    });
  }

  /**
   * LES PRIX DES SERVICES D'UNE ANNÉE — `POST /finance/tarifs/services`.
   *
   * `{ code: montant | '' }` : un montant fixe le prix, une chaîne vide le
   * retire (le service redevient « non défini »). ⚠ UNE ANNÉE CLOSE EST
   * REFUSÉE : ses familles ont souscrit et payé à ces prix-là. Les abonnements
   * en cours gardent le prix de leur souscription, quoi qu'il arrive ici.
   */
  async setServicePrices(
    input: { academicYearId: string; prix: Record<string, string> },
    actorId: string,
  ): Promise<PrixService[]> {
    await this.exigerServices();
    const year = await this.years.assertWritable(input.academicYearId);
    const { schoolId } = currentTenant();

    const entrees = Object.entries(input.prix);
    if (entrees.length === 0) throw new BadRequestException('Rien à modifier.');
    const changes: { code: ServiceOptionnel; valeur: string | null }[] = [];
    for (const [code, brut] of entrees) {
      if (!estServiceOptionnel(code)) {
        throw new BadRequestException(
          code === 'inscription'
            ? "Les frais d'inscription se fixent par niveau, pas parmi les services."
            : `Service inconnu : « ${code} ».`,
        );
      }
      changes.push({ code, valeur: montantOuVide(brut, libelleService(code)) });
    }

    await this.db.query(async (tx) => {
      const avant = await this.prixIn(tx, year.id);
      for (const c of changes) {
        if (c.valeur === null) {
          await tx.query(
            'DELETE FROM service_prices WHERE academic_year_id = $1 AND service = $2',
            [year.id, c.code],
          );
        } else {
          await tx.query(
            `INSERT INTO service_prices (school_id, academic_year_id, service, amount, updated_by)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (school_id, academic_year_id, service)
             DO UPDATE SET amount = EXCLUDED.amount, updated_by = EXCLUDED.updated_by, updated_at = now()`,
            [schoolId, year.id, c.code, c.valeur, actorId],
          );
        }
      }
      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'service_prices_set',
          entity: 'academic_year',
          entityId: year.id,
          before: Object.fromEntries(changes.map((c) => [c.code, avant.get(c.code) ?? null])),
          after: { year: year.label, ...Object.fromEntries(changes.map((c) => [c.code, c.valeur])) },
        },
        tx,
      );
    });

    return (await this.tarifs(year.id)).services;
  }

  /**
   * CE QU'UNE INSCRIPTION VA FIGER (§2, §3, §4, §8), vérifié avant d'écrire.
   *
   * Dans l'ordre où la secrétaire peut corriger : le mode, la cantine, le
   * tarif du mode, les frais d'inscription du niveau, le prix de chaque service
   * coché. Chaque refus nomme ce qui manque et où le poser (« bouton Frais »).
   */
  async planInscription(p: {
    year: AcademicYear;
    group: { name: string; level_id: string | null };
    studyMode?: string | null;
    services?: readonly string[];
  }): Promise<PlanInscription> {
    if (!p.studyMode) throw new BadRequestException(MODE_REQUIS);
    if (!estModeEtude(p.studyMode)) throw new BadRequestException(MODE_REQUIS);
    const mode = p.studyMode;

    const coches = new Set<ServiceOptionnel>();
    for (const s of p.services ?? []) {
      // La photocopie, d'office depuis le 04/10/2026 : un ancien écran qui la
      // coche encore n'est pas refusé — elle est de toute façon ajoutée, une fois.
      if (SERVICES_D_OFFICE.includes(s as ServiceOptionnel)) continue;
      if (!estServiceCochable(s)) {
        throw new BadRequestException(
          s === 'inscription'
            ? "« Frais d'inscription » est ajouté d'office à chaque (ré)inscription : ne le cochez pas."
            : `Service inconnu : « ${s} ».`,
        );
      }
      coches.add(s);
    }
    const services = SERVICES_COCHABLES.filter((s) => coches.has(s));
    if (services.filter((s) => definitionService(s).famille === 'cantine').length > 1) {
      throw new BadRequestException(CANTINE_UNIQUE);
    }

    if (!p.group.level_id) {
      throw new BadRequestException(
        `Le groupe ${p.group.name} n'est rattaché à aucun niveau : son tarif ${libelleMode(mode)} n'est pas défini.`,
      );
    }

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<LigneNiveau>(
        `SELECT id, name,
                monthly_rate_8h14::text AS rate_8h14,
                monthly_rate_8h17::text AS rate_8h17,
                student_enrolment_fee::text AS enrolment_fee
           FROM levels WHERE id = $1`,
        [p.group.level_id],
      );
      const niveau = rows[0];
      if (!niveau) throw new NotFoundException('Niveau introuvable.');

      const fullRate = mode === '8h-14h' ? niveau.rate_8h14 : niveau.rate_8h17;
      if (fullRate === null) throw new BadRequestException(tarifNonDefini(mode, niveau.name));
      if (niveau.enrolment_fee === null) throw new BadRequestException(fraisNonDefinis(niveau.name));

      const prix = await this.prixIn(tx, p.year.id);
      const plan: PlanInscription['services'] = [];
      // ⚠ D'OFFICE, COMME LES FRAIS D'INSCRIPTION (ADR-0079) : un prix non
      // défini REFUSE l'inscription (D4 : non défini n'est pas gratuit) ; un
      // prix de 0 n'écrit rien (comme une inscription gratuite).
      for (const service of SERVICES_D_OFFICE) {
        const amount = prix.get(service);
        if (amount === undefined) throw new BadRequestException(prixNonDefini(service, p.year.label));
        if (money(amount).greaterThan(0)) plan.push({ service, amount });
      }
      for (const service of services) {
        const amount = prix.get(service);
        if (amount === undefined) throw new BadRequestException(prixNonDefini(service, p.year.label));
        plan.push({ service, amount });
      }

      return {
        studyMode: mode,
        fullRate,
        levelName: niveau.name,
        enrolmentFee: niveau.enrolment_fee,
        services: plan,
      };
    });
  }

  /**
   * CHANGER DE MODE EN COURS D'ANNÉE — `POST /finance/concessions/study-mode` (§2).
   *
   * Le geste de la direction. Il pose le mode, le tarif plein du nouveau mode
   * (`full_rate`) et le frais mensuel (= ce tarif ; 0 pour une gratuité), puis
   * réévalue LES SEULS MOIS NON RÉGLÉS — `changeMonthlyFeeWithin`, la même règle
   * que « Modifier le frais mensuel » : un mois payé garde son prix, et la
   * famille garde un reçu qui correspond au grand livre.
   *
   * ⚠ LE MÊME MODE NE CHANGE RIEN. Le redemander écraserait un frais négocié par
   * le tarif plein ; c'est « Modifier le frais mensuel » qui fait cela, pas ceci.
   */
  async changeStudyMode(
    input: { studentId: string; academicYearId?: string; studyMode: string; reason?: string | null },
    actorId: string,
  ): Promise<{
    changed: boolean;
    from: ModeEtude | null;
    to: ModeEtude;
    monthlyFee: string;
    fullRate: string;
    monthsRepriced: number;
    guardianId: string | null;
    academicYearId: string;
  }> {
    await this.exigerServices();
    if (!estModeEtude(input.studyMode)) throw new BadRequestException(MODE_REQUIS);
    const mode = input.studyMode;
    const year = await this.years.assertWritable(
      input.academicYearId ?? (await this.years.enrolmentTarget()).id,
    );
    const { schoolId } = currentTenant();

    return this.db.query(async (tx) => {
      const { rows: eleve } = await tx.query<{ guardian_id: string | null }>(
        'SELECT guardian_id FROM students WHERE id = $1',
        [input.studentId],
      );
      if (!eleve[0]) throw new NotFoundException('Élève introuvable.');
      const guardianId = eleve[0].guardian_id;
      // Le verrou de la famille, celui du reçu groupé : un encaissement
      // simultané ne paie pas un mois pendant qu'on le réévalue.
      if (guardianId) {
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `family-payment:${guardianId}:${year.id}`,
        ]);
      }

      const { rows } = await tx.query<{
        id: string;
        study_mode: ModeEtude | null;
        monthly_fee: string;
        full_rate: string;
        is_free: boolean;
        level_name: string | null;
        rate_8h14: string | null;
        rate_8h17: string | null;
      }>(
        `SELECT e.id, e.study_mode, e.monthly_fee::text AS monthly_fee,
                e.full_rate::text AS full_rate, e.is_free,
                l.name AS level_name,
                l.monthly_rate_8h14::text AS rate_8h14,
                l.monthly_rate_8h17::text AS rate_8h17
           FROM enrollments e
           LEFT JOIN levels l ON l.id = e.level_id
          WHERE e.student_id = $1 AND e.academic_year_id = $2 AND e.status <> 'cancelled'
          FOR UPDATE OF e`,
        [input.studentId, year.id],
      );
      const e = rows[0];
      if (!e) throw new NotFoundException("Cet élève n'est pas inscrit sur cette année.");

      if (e.study_mode === mode) {
        return {
          changed: false,
          from: e.study_mode,
          to: mode,
          monthlyFee: toStorage(e.monthly_fee),
          fullRate: toStorage(e.full_rate),
          monthsRepriced: 0,
          guardianId,
          academicYearId: year.id,
        };
      }

      if (e.level_name === null) {
        throw new BadRequestException(
          `Cet élève n'est rattaché à aucun niveau : son tarif ${libelleMode(mode)} n'est pas défini.`,
        );
      }
      const rate = mode === '8h-14h' ? e.rate_8h14 : e.rate_8h17;
      if (rate === null) throw new BadRequestException(tarifNonDefini(mode, e.level_name));

      const repricing = await this.concessions.changeMonthlyFeeWithin(
        tx,
        {
          studentId: input.studentId,
          academicYearId: year.id,
          amount: e.is_free ? '0' : rate,
          reason:
            input.reason?.trim() ||
            `Mode d'étude : ${libelleMode(e.study_mode) || 'aucun'} → ${libelleMode(mode)}`,
        },
        actorId,
      );
      await tx.query('UPDATE enrollments SET study_mode = $1, full_rate = $2 WHERE id = $3', [
        mode,
        rate,
        e.id,
      ]);

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'study_mode_changed',
          entity: 'enrollment',
          entityId: e.id,
          before: { studyMode: e.study_mode, monthlyFee: e.monthly_fee, fullRate: e.full_rate },
          after: {
            studyMode: mode,
            monthlyFee: repricing.to,
            fullRate: toStorage(rate),
            monthsRepriced: repricing.monthsRepriced,
            year: year.label,
          },
        },
        tx,
      );

      return {
        changed: true,
        from: e.study_mode,
        to: mode,
        monthlyFee: repricing.to,
        fullRate: toStorage(rate),
        monthsRepriced: repricing.monthsRepriced,
        guardianId,
        academicYearId: year.id,
      };
    });
  }
}
