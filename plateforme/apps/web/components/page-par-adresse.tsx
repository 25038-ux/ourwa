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
 * Ce qui reste sur le chemin bloqué, faute de changer d'adresse : une mise à
 * jour sur place — `router.refresh()`, que rien n'appelle ici (sur « Finance »
 * il lit ses 704 ko jusqu'au bout et n'affiche rien). Le retour d'une action
 * serveur qui ne redirige pas met lui aussi la page à jour sur place : il n'a
 * PAS été essayé (aucune écriture n'a été faite sur les données réelles), et
 * la cause du blocage n'est pas comprise à ce jour — à vérifier sur les deux
 * pages les plus lourdes avant de le tenir pour acquis.
 *
 * Ce composant ne dépend donc PAS de l'interrupteur `NAVIGATION_DOUCE`.
 */
export function PageParAdresse({ children }: { children: React.ReactNode }) {
  const chemin = usePathname();
  const requete = useSearchParams().toString();
  return <Fragment key={`${chemin}?${requete}`}>{children}</Fragment>;
}
