import { deploiementDepuisEnv, libelleFraisPhotocopie, marqueDepuisEnv, type Marque } from '@elourwa/shared/brand';
import { hoteAvecSlug, slugDepuisHote } from '@elourwa/shared/tenant-slug';

/**
 * LA MARQUE ET LE MODE DE DÉPLOIEMENT DU SITE — lus une fois par processus.
 *
 * Côté serveur seulement (composants serveur, actions, routes, middleware).
 * Un composant client lit le nom depuis `data-marque` sur `<html>`, posé par
 * la mise en page racine : voir `lib/brand-client.ts`.
 *
 * ⚠ Rien d'affiché ne doit plus dire « El Ourwa » en dur : c'est `MARQUE.nom`.
 * Le préfixe des cookies suit `MARQUE.slug` — une installation « El Mourad »
 * n'écrit donc aucun cookie `elourwa_*`.
 */
export const MARQUE: Marque = marqueDepuisEnv(process.env);
export const DEPLOIEMENT = deploiementDepuisEnv(process.env);
/** Le nom du frais annuel « photocopie » (El Mourad : « Frais Graytna ») — FEE_PHOTOCOPY_LABEL. */
export const LIBELLE_FRAIS_PHOTOCOPIE = libelleFraisPhotocopie(process.env);

/** Le préfixe de tous les cookies de session de cette installation. */
export const COOKIE_PREFIX = `${MARQUE.slug}_`;

export function cookieName(slug: string | null, kind: 'access' | 'refresh'): string {
  return `${COOKIE_PREFIX}${slug ?? 'platform'}_${kind}`;
}

/** L'école que ce nom d'hôte désigne — toujours la même en école unique. */
export function slugFromHost(host: string | null | undefined): string | null {
  return slugDepuisHote(host, DEPLOIEMENT.ecoleUnique);
}

export { hoteAvecSlug };
