import { cache } from 'react';
import { headers } from 'next/headers';
import {
  estModeleFacturation,
  MODELE_FACTURATION_DEFAUT,
  type ModeleFacturation,
} from '@elourwa/shared/facturation';
import { slugFromHost } from './brand';

export interface School {
  slug: string;
  locale?: string;
  name: string;
  nameAr: string | null;
  currency: string;
  brandColor: string;
  logoEmoji: string;
  /**
   * COMMENT L'ÉCOLE FACTURE — ADR-0073, docs/specs/jinan-facturation.md §1.
   *
   * `'famille'` (El Ourwa, El Mourad, Nour, Rissala, Salam) : un tarif mensuel
   * par niveau, frais annuels par famille. `'services'` (Jinan) : deux modes
   * d'étude, frais d'inscription par élève, services optionnels. ⚠ TOUT écran
   * nouveau de la facturation « services » se garde sur `=== 'services'` : une
   * école « famille » doit rester exactement comme avant, et l'API refuse (400)
   * un mode d'étude ou des services envoyés à une école « famille ».
   * Toujours présent ici : une réponse sans le champ (API plus ancienne) vaut
   * `'famille'`.
   */
  billingModel: ModeleFacturation;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Which branch this request is for, taken from the Host header.
 *
 * `nour.localhost:3000` -> `nour`. `admin.` is the platform console and is
 * deliberately not a school.
 */
export async function currentSlug(): Promise<string | null> {
  /*
   * ⚠ `x-forwarded-host` D'ABORD. Quand une action serveur finit par
   * `redirect()`, Next rend la page cible DANS la réponse de l'action, et dans
   * ce rendu `host` vaut `localhost:3000` — l'école n'y est plus, seul
   * `x-forwarded-host` la garde (`nour.localhost:3000`). Sans cela le cookie de
   * session est cherché sous le mauvais nom, et chaque paiement enregistré
   * renvoyait… à la page de connexion, reçu jamais montré. C'est aussi ce
   * qu'un mandataire inverse envoie en production.
   */
  const h = await headers();
  // La règle elle-même vit dans @elourwa/shared/tenant-slug — la même que
  // l'API et le middleware ; en école unique, tout hôte est cette école.
  return slugFromHost(h.get('x-forwarded-host') ?? h.get('host'));
}

/**
 * The branch this host names, even when the API cannot be reached.
 *
 * ⚠ `null` means "no branch in this host" — the platform console. It must NOT
 * also mean "a branch, but the lookup failed", because the login page prints
 * "Console plateforme" for null, and printing that on a school's own domain
 * tells the user they are somewhere they are not.
 *
 * So a failed lookup falls back to the slug itself. It is the wrong
 * capitalisation and no Arabic name, and it is still the right school.
 */
export async function currentSchoolOrSlug(): Promise<School | { name: string } | null> {
  const slug = await currentSlug();
  if (!slug) return null;
  return (await currentSchool()) ?? { name: slug.charAt(0).toUpperCase() + slug.slice(1) };
}

export const currentSchool = cache(async function currentSchool(): Promise<School | null> {
  const slug = await currentSlug();
  if (!slug) return null;
  try {
    const response = await fetch(`${API}/school`, {
      headers: { 'X-School-Slug': slug },
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return null;
    const school = (await response.json()) as Omit<School, 'billingModel'> & { billingModel?: unknown };
    return {
      ...school,
      billingModel: estModeleFacturation(school.billingModel) ? school.billingModel : MODELE_FACTURATION_DEFAUT,
    };
  } catch {
    return null;
  }
});

/**
 * LE MODÈLE DE FACTURATION DE L'ÉCOLE DE CETTE REQUÊTE — `'famille'` quand il
 * n'y a pas d'école (console) ou que l'API ne répond pas : l'écran d'El Ourwa,
 * jamais un écran « services » par erreur.
 */
export async function billingModel(): Promise<ModeleFacturation> {
  return (await currentSchool())?.billingModel ?? MODELE_FACTURATION_DEFAUT;
}

/** L'école de cette requête facture-t-elle par élève et par service (Jinan) ? */
export async function estEcoleServices(): Promise<boolean> {
  return (await billingModel()) === 'services';
}

/*
 * ⚠ `studentCount()` LIVED HERE AND WAS DEAD TWICE OVER. It read the cookie
 * `elourwa_at`, a name nothing has written since sessions became per-school
 * (`elourwa_<slug>_access`), so it always found no token and always answered
 * null — "not allowed to see", rendered as a dash. And nothing called it: the
 * platform console gets its figures from the API, per branch, under each
 * branch's own tenant context.
 *
 * Removed rather than repaired. A helper that looks right, compiles, and
 * silently returns null is worse than no helper: the next person to want a
 * headcount would have called it and spent an afternoon on the dash.
 */
