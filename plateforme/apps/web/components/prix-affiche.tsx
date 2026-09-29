import { mru } from '@/components/hub';

/**
 * UN PRIX EN LECTURE SEULE — « 3 000 MRU », ou « non défini » en gris quand
 * l'API rend `null`. L'arrondi d'affichage est celui de `mru()` (le
 * `number_format` d'El Ourwa), et lui seul : le montant reste une chaîne
 * jusque-là. Pour les pages de la facturation « services » (Jinan).
 */
export function PrixAffiche({ valeur }: { valeur: string | null }) {
  if (valeur === null) return <span className="text-muted">non défini</span>;
  return <>{mru(valeur)} MRU</>;
}
