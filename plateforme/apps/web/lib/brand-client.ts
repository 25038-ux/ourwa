/**
 * LA MARQUE, VUE D'UN COMPOSANT CLIENT.
 *
 * Un composant client ne lit pas l'environnement du serveur. La mise en page
 * racine pose `data-marque` (et `data-marque-ar`) sur `<html>` ; c'est la
 * seule source, et elle vaut pour toute la page. Le repli « El Ourwa » ne sert
 * qu'au rendu côté serveur d'un composant client, avant que le document existe.
 */
export function marqueClient(): string {
  if (typeof document === 'undefined') return 'El Ourwa';
  return document.documentElement.dataset.marque || 'El Ourwa';
}

export function marqueClientAr(): string {
  if (typeof document === 'undefined') return 'العروة';
  return document.documentElement.dataset.marqueAr || 'العروة';
}
