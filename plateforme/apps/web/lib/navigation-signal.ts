/**
 * DEUX SIGNAUX ENTRE COMPOSANTS CLIENT : « une navigation interne part » et
 * « elle est arrivée » (10/10/2026).
 *
 * La barre du haut (`components/navigation-en-cours.tsx`) sait montrer qu'un
 * clic a été compris ; elle ne peut pas savoir, seule, qu'une navigation
 * interne de Next est finie — la page ne se décharge pas. Ceux qui lancent une
 * telle navigation (`navigation-douce.tsx`, `selecteur-annee.tsx`) le lui
 * disent par ces deux événements de `window`, sans se connaître les uns les
 * autres : une barre, un seul endroit qui la dessine.
 */
export const NAVIGATION_DEBUT = 'navigation-douce:debut';
export const NAVIGATION_FIN = 'navigation-douce:fin';

export function signalerNavigation(etape: 'debut' | 'fin'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(etape === 'debut' ? NAVIGATION_DEBUT : NAVIGATION_FIN));
}
