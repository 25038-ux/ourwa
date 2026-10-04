import { libelleMode, type Periodicite, type ServiceOptionnel } from '@elourwa/shared/facturation';
import { apiFetch, ApiError, type SessionUser } from '@/lib/session';
import { anneeConsultee, type Annee } from '@/lib/annee';
import { estEcoleServices } from '@/lib/tenant';
import type { CatalogueFacturation } from '@/components/choix-facturation';

/**
 * LA FACTURATION « SERVICES » CÔTÉ SITE — ADR-0073, docs/specs/jinan-facturation.md.
 *
 * Côté serveur seulement (pages, actions). Le catalogue (modes, services,
 * libellés) vit dans `@elourwa/shared/facturation` ; ici, ce que le site lit de
 * l'API et qui peut le modifier.
 *
 * ⚠ RIEN D'ICI NE S'APPELLE POUR UNE ÉCOLE « FAMILLE ». Chaque appelant se garde
 * d'abord sur `School.billingModel === 'services'` (`estEcoleServices()`,
 * lib/tenant.ts) : El Mourad, Nour, Rissala et Salam ne font aucune requête de
 * plus et ne voient aucun écran de plus.
 */

/** `GET /finance/tarifs` — un niveau. Montants en chaînes ('3000.00') ; `null` = « non défini ». */
export interface TarifNiveau {
  id: string;
  nom: string;
  tarif8h14: string | null;
  tarif8h17: string | null;
  /** `null` = non défini (l'inscription est refusée) ; '0.00' = gratuit. */
  fraisInscription: string | null;
}

/** `GET /finance/tarifs` — le prix d'un service optionnel pour l'année. */
export interface PrixService {
  code: ServiceOptionnel;
  libelle: string;
  periodicite: Periodicite;
  /** Créé d'office à chaque (ré)inscription — la photocopie (ADR-0079) ; sinon coché. */
  obligatoire: boolean;
  prix: string | null;
}

/** `GET /finance/tarifs` — la page « Frais », telle que l'API la rend. */
export interface PageTarifs {
  billingModel: 'famille' | 'services';
  annee: {
    id: string;
    label: string;
    startYear: number;
    status: 'future' | 'active' | 'closed';
    /** `false` pour une année close : ses prix se lisent, ne se modifient plus. */
    modifiable: boolean;
  };
  /** Dans l'ordre des niveaux (cycle, ordre, nom). */
  niveaux: TarifNiveau[];
  /** Les services au prix de l'école (transport et photocopie compris), dans l'ordre du catalogue. */
  services: PrixService[];
}

/** Les trois tarifs d'un niveau, tels que `PATCH /levels/:id/tarifs` les nomme. */
export const CHAMPS_TARIF_NIVEAU = ['tarif8h14', 'tarif8h17', 'fraisInscription'] as const;
export type ChampTarifNiveau = (typeof CHAMPS_TARIF_NIVEAU)[number];

/**
 * Les trois colonnes « tarifs » d'un tableau de niveaux (page « Frais »,
 * « Gérer les niveaux »), dans l'ordre de la spécification §9 :
 * 8h – 14h | 8h – 17h | Frais d'inscription.
 */
export const COLONNES_TARIFS_NIVEAU: readonly { champ: ChampTarifNiveau; titre: string }[] = [
  { champ: 'tarif8h14', titre: libelleMode('8h-14h') },
  { champ: 'tarif8h17', titre: libelleMode('8h-17h') },
  { champ: 'fraisInscription', titre: "Frais d'inscription" },
];

/**
 * L'ANNÉE DONT ON LIT LES TARIFS — celle que le sélecteur de l'en-tête montre,
 * par la même règle que lui (`PageHeader`) : le choix du sélecteur s'il est
 * une année de cette école, sinon l'année active, sinon la première de la
 * liste. L'en-tête et le tableau ne peuvent donc pas parler de deux années
 * différentes — et une année « à venir », encore sans inscrit (que
 * `/academic-years/default` ignore), a bien ses tarifs.
 */
export async function anneeDesTarifs(): Promise<{ id: string | null; annees: Annee[] }> {
  const [annees, choisie] = await Promise.all([
    apiFetch<Annee[]>('/academic-years').catch(() => [] as Annee[]),
    anneeConsultee(),
  ]);
  const id =
    (choisie && annees.some((a) => a.id === choisie) ? choisie : null) ??
    annees.find((a) => a.status === 'active')?.id ??
    annees[0]?.id ??
    null;
  return { id, annees };
}

/**
 * LES TARIFS D'UNE ANNÉE — `GET /finance/tarifs?academicYearId=…`.
 *
 * Sans année : l'année active (l'API retombe ensuite sur la plus récente).
 * Rend `{ erreur }` plutôt que de lever : une page « Frais » dont l'API refuse
 * (aucune année, droits) affiche la phrase de l'API, jamais une erreur 500.
 */
export async function lireTarifs(
  academicYearId?: string | null,
): Promise<{ tarifs: PageTarifs; erreur?: undefined } | { tarifs?: undefined; erreur: string }> {
  const q = academicYearId ? `?academicYearId=${encodeURIComponent(academicYearId)}` : '';
  try {
    return { tarifs: await apiFetch<PageTarifs>(`/finance/tarifs${q}`) };
  } catch (error) {
    return { erreur: error instanceof ApiError ? error.message : 'Les tarifs sont indisponibles pour le moment.' };
  }
}

/**
 * PEUT-IL FIXER LES TARIFS ET LES PRIX ? — la garde de `PATCH /levels/:id/tarifs`
 * et de `POST /finance/tarifs/services` : `scolarite.niveaux` ET le rôle
 * direction (super_admin, admin). Elle double celle de l'API, elle ne la
 * remplace pas : elle évite seulement d'offrir un champ qui répondrait 403.
 */
export function peutFixerLesTarifs(user: SessionUser | undefined): boolean {
  if (!user) return false;
  const direction = user.roles.includes('super_admin') || user.roles.includes('admin');
  return direction && user.permissions.includes('scolarite.niveaux');
}

/**
 * Un montant de l'API (« 3000.00 ») tel qu'on le propose dans un champ :
 * « 3000 », « 3000.5 ». Chaîne à chaîne — aucun nombre JS ne touche le montant.
 * `null` (non défini) donne le champ vide.
 */
export function montantSaisi(v: string | null | undefined): string {
  if (v === null || v === undefined) return '';
  return v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v;
}

/**
 * LE CATALOGUE QU'UN FORMULAIRE D'INSCRIPTION LIT (§8) — les tarifs de chaque
 * niveau par mode, ses frais d'inscription, les six prix de l'année — pour
 * `<ChoixFacturation>`. `null` pour une école « famille » (aucune requête) ou
 * quand l'API refuse : le formulaire reste alors celui d'El Ourwa, et c'est
 * l'API qui dira ce qui manque.
 */
export async function catalogueFacturation(
  academicYearId: string | null | undefined,
): Promise<CatalogueFacturation | null> {
  if (!(await estEcoleServices())) return null;
  const { tarifs } = await lireTarifs(academicYearId);
  if (!tarifs) return null;
  return {
    anneeLabel: tarifs.annee.label,
    niveaux: Object.fromEntries(
      tarifs.niveaux.map((n) => [n.id, { nom: n.nom, tarif8h14: n.tarif8h14, tarif8h17: n.tarif8h17, fraisInscription: n.fraisInscription }]),
    ),
    services: tarifs.services.map((s) => ({
      code: s.code,
      libelle: s.libelle,
      periodicite: s.periodicite,
      // Une API d'avant 0047 ne le dit pas : la photocopie était cochée.
      obligatoire: s.obligatoire ?? false,
      prix: s.prix,
    })),
  };
}
