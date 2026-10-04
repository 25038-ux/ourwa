/**
 * LA FACTURATION « SERVICES » — le catalogue partagé par l'API et le site.
 *
 * ADR-0073, docs/specs/jinan-facturation.md. Une école facture soit comme
 * El Ourwa (`famille` : un tarif mensuel par niveau, des frais d'inscription et
 * de photocopie PAR FAMILLE), soit comme Jinan (`services` : deux modes d'étude
 * au tarif différent, des frais d'inscription par niveau et PAR ÉLÈVE, des
 * services optionnels par élève, chacun exemptable seul). Le choix est posé à
 * la création de l'école (`schools.billing_model`) et ne change plus.
 *
 * ⚠ CES VALEURS SONT AUSSI DANS LA BASE. Les CHECK de la migration 0042 listent
 * les mêmes modes et les mêmes codes : les ajouter ici sans migration, c'est un
 * écran qui propose ce que la base refusera. `facturation.spec.ts` les épingle.
 *
 * Aucun montant ici : les prix sont des données de l'école (`service_prices`,
 * par année scolaire ; `levels.student_enrolment_fee`, par niveau), figés sur
 * l'abonnement à la souscription — jamais une constante du code.
 */
import { libelleFraisPhotocopie } from './brand.js';

// ── Le modèle de facturation, par école (§1) ────────────────────────────────

export const MODELES_FACTURATION = ['famille', 'services'] as const;
export type ModeleFacturation = (typeof MODELES_FACTURATION)[number];

/** El Ourwa, inchangé : la valeur par défaut de `schools.billing_model`. */
export const MODELE_FACTURATION_DEFAUT: ModeleFacturation = 'famille';

export function estModeleFacturation(v: unknown): v is ModeleFacturation {
  return typeof v === 'string' && (MODELES_FACTURATION as readonly string[]).includes(v);
}

// ── Les modes d'étude (§2) ──────────────────────────────────────────────────

/** Les deux modes, fixes. `enrollments.study_mode` (NULL dans une école « famille »). */
export const MODES_ETUDE = ['8h-14h', '8h-17h'] as const;
export type ModeEtude = (typeof MODES_ETUDE)[number];

const LIBELLES_MODE: Readonly<Record<ModeEtude, string>> = Object.freeze({
  '8h-14h': '8h – 14h',
  '8h-17h': '8h – 17h',
});

export function estModeEtude(v: unknown): v is ModeEtude {
  return typeof v === 'string' && (MODES_ETUDE as readonly string[]).includes(v);
}

/**
 * « 8h – 14h », « 8h – 17h ». Une inscription sans mode (école « famille »,
 * toute ligne antérieure à 0042) n'affiche rien.
 */
export function libelleMode(mode: ModeEtude | null | undefined): string {
  return mode ? LIBELLES_MODE[mode] : '';
}

// ── Les services (§4) ───────────────────────────────────────────────────────

/**
 * Les huit codes, dans l'ordre de l'affichage. `transport` (mensuel, coché) et
 * la photocopie devenue obligatoire : 04/10/2026, migration 0047, ADR-0079.
 */
export const SERVICE_CODES = [
  'cantine_petit_dejeuner',
  'cantine_dejeuner',
  'cantine_complet',
  'piscine',
  'docteur',
  'transport',
  'photocopie',
  'inscription',
] as const;
export type ServiceCode = (typeof SERVICE_CODES)[number];

/**
 * Un service au PRIX DE L'ÉCOLE (`service_prices`, par année) — tout sauf
 * l'inscription, dont le prix est celui du niveau. Il se fixe sur la page
 * « Frais » et se souscrit depuis la fiche. (Le nom est resté : jusqu'au
 * 04/10/2026 ils étaient tous optionnels ; la photocopie est désormais
 * d'office — voir `SERVICES_COCHABLES`.)
 */
export type ServiceOptionnel = Exclude<ServiceCode, 'inscription'>;

export const SERVICES_CANTINE = ['cantine_petit_dejeuner', 'cantine_dejeuner', 'cantine_complet'] as const;
export type ServiceCantine = (typeof SERVICES_CANTINE)[number];

/**
 * La famille d'un service — la colonne générée `student_services.famille`.
 * Un seul abonnement ACTIF par élève, par année et par famille : les trois
 * cantines sont donc exclusives (changer de formule = arrêter, puis souscrire).
 */
export type FamilleService = 'cantine' | 'piscine' | 'docteur' | 'transport' | 'photocopie' | 'inscription';

/**
 * `tender_lines.source_type` des moyens encaissés pour un service : un par
 * famille, pour que « Revenue Live → Par origine » sépare les revenus sans
 * jointure. Colonne libre (0014) : aucune migration.
 */
export const SOURCES_SERVICES = [
  'service_cantine',
  'service_piscine',
  'service_docteur',
  'service_transport',
  'service_photocopie',
  'service_inscription',
] as const;
export type SourceService = (typeof SOURCES_SERVICES)[number];

export type Periodicite = 'mensuel' | 'annuel';

export interface DefinitionService {
  code: ServiceCode;
  /** Le nom affiché. Celui de la photocopie est lu à chaque lecture (FEE_PHOTOCOPY_LABEL). */
  readonly libelle: string;
  /** Pour une cantine : « petit déjeuner », « déjeuner », « petit déjeuner + déjeuner ». */
  formule: string | null;
  /** `mensuel` : une ligne d'échéancier par mois payable ; `annuel` : une seule ligne. */
  periodicite: Periodicite;
  famille: FamilleService;
  sourceType: SourceService;
  /**
   * Coché ou non par la famille. Faux pour l'inscription et (04/10/2026) la
   * photocopie : créées d'office à chaque (ré)inscription.
   */
  optionnel: boolean;
  /**
   * S'arrête en cours d'année. Faux pour les services d'office (inscription,
   * photocopie) : ils s'exemptent, ils ne s'arrêtent pas.
   */
  arretable: boolean;
  /** `ecole` : `service_prices`, par année ; `niveau` : `levels.student_enrolment_fee`. */
  prixPar: 'ecole' | 'niveau';
}

const CANTINE = 'Cantine — ';

function definir(d: Omit<DefinitionService, 'libelle'> & { libelle: string }): DefinitionService {
  return Object.freeze(d);
}

/**
 * LE CATALOGUE. Figé : le prix n'y est pas (c'est une donnée de l'école), le
 * libellé de la photocopie non plus — il est lu à l'affichage, comme partout
 * ailleurs (un reçu réimprimé porte le nom d'aujourd'hui).
 */
export const SERVICES: readonly DefinitionService[] = Object.freeze([
  definir({
    code: 'cantine_petit_dejeuner', libelle: `${CANTINE}petit déjeuner`, formule: 'petit déjeuner',
    periodicite: 'mensuel', famille: 'cantine', sourceType: 'service_cantine', optionnel: true, arretable: true, prixPar: 'ecole',
  }),
  definir({
    code: 'cantine_dejeuner', libelle: `${CANTINE}déjeuner`, formule: 'déjeuner',
    periodicite: 'mensuel', famille: 'cantine', sourceType: 'service_cantine', optionnel: true, arretable: true, prixPar: 'ecole',
  }),
  definir({
    code: 'cantine_complet', libelle: `${CANTINE}petit déjeuner + déjeuner`, formule: 'petit déjeuner + déjeuner',
    periodicite: 'mensuel', famille: 'cantine', sourceType: 'service_cantine', optionnel: true, arretable: true, prixPar: 'ecole',
  }),
  definir({
    code: 'piscine', libelle: 'Piscine', formule: null,
    periodicite: 'mensuel', famille: 'piscine', sourceType: 'service_piscine', optionnel: true, arretable: true, prixPar: 'ecole',
  }),
  definir({
    code: 'docteur', libelle: 'Docteur', formule: null,
    periodicite: 'mensuel', famille: 'docteur', sourceType: 'service_docteur', optionnel: true, arretable: true, prixPar: 'ecole',
  }),
  // 04/10/2026 (ADR-0079) : facturé chaque mois, coché à l'inscription comme
  // la piscine, ajouté ou arrêté ensuite depuis la fiche.
  definir({
    code: 'transport', libelle: 'Transport', formule: null,
    periodicite: 'mensuel', famille: 'transport', sourceType: 'service_transport', optionnel: true, arretable: true, prixPar: 'ecole',
  }),
  // Le libellé est un accesseur : `libelleFraisPhotocopie()` lit l'environnement
  // au moment de la lecture, jamais au chargement du module.
  Object.freeze({
    code: 'photocopie' as const,
    get libelle(): string {
      return libelleFraisPhotocopie();
    },
    formule: null,
    periodicite: 'annuel' as const,
    famille: 'photocopie' as const,
    sourceType: 'service_photocopie' as const,
    // 04/10/2026 (ADR-0079) : obligatoire, comme les frais d'inscription — un
    // prix pour toute l'école (pas par niveau), créée d'office à chaque
    // (ré)inscription, exemptable, jamais arrêtée.
    optionnel: false,
    arretable: false,
    prixPar: 'ecole' as const,
  }),
  definir({
    code: 'inscription', libelle: "Frais d'inscription", formule: null,
    periodicite: 'annuel', famille: 'inscription', sourceType: 'service_inscription', optionnel: false, arretable: false, prixPar: 'niveau',
  }),
]);

/** Les services au prix de l'école, dans l'ordre du catalogue : la page « Frais ». */
export const SERVICES_OPTIONNELS: readonly ServiceOptionnel[] = Object.freeze(
  SERVICES.filter((s) => s.prixPar === 'ecole').map((s) => s.code as ServiceOptionnel),
);

/** Ce qu'une famille COCHE à l'inscription : cantines, piscine, docteur, transport. */
export const SERVICES_COCHABLES: readonly ServiceOptionnel[] = Object.freeze(
  SERVICES.filter((s) => s.optionnel).map((s) => s.code as ServiceOptionnel),
);

/** Au prix de l'école ET créés d'office à chaque (ré)inscription : la photocopie. */
export const SERVICES_D_OFFICE: readonly ServiceOptionnel[] = Object.freeze(
  SERVICES.filter((s) => !s.optionnel && s.prixPar === 'ecole').map((s) => s.code as ServiceOptionnel),
);

export function estServiceCode(v: unknown): v is ServiceCode {
  return typeof v === 'string' && (SERVICE_CODES as readonly string[]).includes(v);
}

export function estServiceOptionnel(v: unknown): v is ServiceOptionnel {
  return estServiceCode(v) && v !== 'inscription';
}

export function estServiceCochable(v: unknown): v is ServiceOptionnel {
  return estServiceCode(v) && definitionService(v).optionnel;
}

/**
 * La définition d'un service. ⚠ Un code inconnu LÈVE : rendre `undefined`
 * laisserait un libellé vide sur un reçu, ou une ligne comptée sans nom.
 */
export function definitionService(code: ServiceCode): DefinitionService {
  const d = SERVICES.find((s) => s.code === code);
  if (!d) throw new Error(`Service inconnu : « ${String(code)} ».`);
  return d;
}

/**
 * Le nom affiché d'un service. `libellePhotocopie` : le nom de la photocopie
 * quand l'appelant le tient d'ailleurs (le site le lit côté serveur,
 * `LIBELLE_FRAIS_PHOTOCOPIE`) ; sinon, l'environnement du processus.
 */
export function libelleService(code: ServiceCode, libellePhotocopie?: string): string {
  if (code === 'photocopie') return libellePhotocopie ?? libelleFraisPhotocopie();
  return definitionService(code).libelle;
}

export function familleService(code: ServiceCode): FamilleService {
  return definitionService(code).famille;
}

export function sourceTypeService(code: ServiceCode): SourceService {
  return definitionService(code).sourceType;
}

/** Une échéance de service telle qu'on la range : son service et son mois d'échéancier. */
export interface EcheanceRangeable {
  service: ServiceCode;
  month: number;
  year: number;
}

/**
 * L'ORDRE D'UNE LISTE D'ÉCHÉANCES DE SERVICE (§7) — celui de la fenêtre
 * d'encaissement, donc celui dans lequel le reçu groupé découpe les moyens de
 * paiement, et celui dans lequel le reçu imprime ses lignes : les services
 * ANNUELS d'abord (inscription, photocopie : dus dès l'inscription), dans
 * l'ordre du catalogue ; puis les MENSUELS, mois par mois, et dans un mois
 * l'ordre du catalogue.
 *
 * ⚠ UN SEUL ORDRE, ICI. Si la fenêtre, l'encaissement et le reçu rangeaient
 * chacun à sa façon, un reçu payé moitié en espèces, moitié par Bankily ne
 * dirait plus quel moyen a réglé quelle ligne.
 */
export function comparerEcheancesService(a: EcheanceRangeable, b: EcheanceRangeable): number {
  const annuelA = definitionService(a.service).periodicite === 'annuel' ? 0 : 1;
  const annuelB = definitionService(b.service).periodicite === 'annuel' ? 0 : 1;
  if (annuelA !== annuelB) return annuelA - annuelB;
  const rang = SERVICE_CODES.indexOf(a.service) - SERVICE_CODES.indexOf(b.service);
  const mois = a.year * 12 + a.month - (b.year * 12 + b.month);
  return annuelA === 0 ? rang || mois : mois || rang;
}

export function estSourceService(v: unknown): v is SourceService {
  return typeof v === 'string' && (SOURCES_SERVICES as readonly string[]).includes(v);
}

const LIBELLES_SOURCE: Readonly<Record<Exclude<SourceService, 'service_photocopie'>, string>> = Object.freeze({
  service_cantine: 'Cantine',
  service_piscine: 'Piscine',
  service_docteur: 'Docteur',
  service_transport: 'Transport',
  service_inscription: "Frais d'inscription (élève)",
});

/** Le libellé d'origine des rapports (`SOURCE_LABELS`, §10). */
export function libelleSourceService(source: SourceService, libellePhotocopie?: string): string {
  if (source === 'service_photocopie') return libellePhotocopie ?? libelleFraisPhotocopie();
  return LIBELLES_SOURCE[source];
}
