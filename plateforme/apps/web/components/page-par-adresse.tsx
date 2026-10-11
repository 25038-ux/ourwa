'use client';

import { Fragment } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * UNE ADRESSE, UNE PAGE NEUVE — rien d'une fiche ne survit dans une autre.
 *
 * ⚠ CE QU'UN RECHARGEMENT COMPLET GARANTISSAIT SANS QU'ON Y PENSE (10/10/2026,
 * avec `navigation-douce.tsx`). Quand seule la chaîne de requête change
 * (`?mois=9` → `?mois=10`, un filtre, « Réinitialiser »), le routeur de Next
 * GARDE les composants de la page et leur état : un champ où l'on a tapé garde
 * ce qu'on y a tapé, une fenêtre ouverte reste ouverte, un `defaultValue` venu
 * du serveur n'est pas réappliqué. Sur une page d'argent, c'est un montant
 * saisi pour un mois qui s'afficherait devant un autre.
 *
 * La clé est l'adresse entière (chemin + requête) : à chaque changement, tout
 * ce qui est sous la coquille est démonté puis remonté, exactement comme après
 * un chargement complet. Un `router.refresh()` (même adresse) ne remonte rien —
 * c'est son rôle.
 *
 * ⚠ ET C'EST CE QUI FAIT ABOUTIR LE SÉLECTEUR D'ANNÉE — « le sélecteur d'année
 * ne marche pas » (propriétaire, 10/10/2026). Il navigue par le routeur vers la
 * MÊME page avec `?annee_id=` : sans cette clé, React met la page à jour SUR
 * PLACE, sous la trame de `loading.tsx` déjà révélée, et attend pour cela que
 * toute la réponse soit là. Mesuré le 10/10/2026 sur les données réelles, la
 * construction de production, cette clé retirée : sur « Dérogations examens »
 * le choix d'une année n'aboutit JAMAIS (12 s d'attente, une seule mutation du
 * DOM, aucune erreur) ; avec la clé, 486 ms. La page remontée arrive sous une
 * trame NEUVE, que React remplit au fil de la réponse — le chemin que prend
 * toute navigation, et qui aboutit partout où il a été essayé.
 *
 * Ce qui restait sur le chemin bloqué, faute de changer d'adresse : toute mise
 * à jour sur place — `router.refresh()` (sur « Finance » il lisait ses 704 ko
 * jusqu'au bout et n'affichait rien) et, surtout, le retour d'une action
 * serveur qui ne redirige pas : on enregistrait, le message disait que c'était
 * fait, et la page ne changeait pas.
 *
 * ⚠ LA CAUSE EST TROUVÉE ET CORRIGÉE (11/10/2026) : un défaut du React que Next
 * embarque, qui jette un réveil arrivé pendant le rendu — voir
 * `correctifs/react-reveil-perdu.cjs`, appliqué à la construction par
 * `next.config.mjs`. Mesuré sur une copie des données réelles, construction de
 * production : « Dérogations examens » passait de 9 blocages sur 10 à 0 sur 24,
 * `router.refresh()` sur « Finance » de 0 réussite sur 4 à 6 sur 6. La clé
 * ci-dessous reste : c'est elle qui garantit qu'une fiche ne garde rien de la
 * précédente, ce que le correctif ne fait pas et n'a pas à faire.
 *
 * Ce composant ne dépend donc PAS de l'interrupteur `NAVIGATION_DOUCE`.
 */
export function PageParAdresse({ children }: { children: React.ReactNode }) {
  const chemin = usePathname();
  const requete = useSearchParams().toString();
  return <Fragment key={`${chemin}?${requete}`}>{children}</Fragment>;
}
