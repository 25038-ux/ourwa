'use client';

import { usePathname } from 'next/navigation';

/**
 * LES ENTRÉES DU MENU, ET CELLE OÙ L'ON EST.
 *
 * ⚠ L'ENTRÉE ACTIVE ÉTAIT DÉCIDÉE PAR LE SERVEUR, UNE FOIS PAR CHARGEMENT
 * (`x-pathname`, son `$_SERVER['SCRIPT_NAME']`). Depuis que les liens changent
 * de page sans recharger la coquille (`navigation-douce.tsx`, 10/10/2026), la
 * coquille n'est plus rendue à chaque clic : le menu serait resté sur la page
 * d'arrivée. Elle suit maintenant l'adresse du navigateur — même règle, même
 * classe : `/` seulement pour lui-même, les autres pour tout ce qui commence
 * par leur chemin.
 *
 * `current` est le chemin vu par le serveur : la valeur du premier rendu, que
 * `usePathname()` confirme.
 */
export function SidebarLiens({
  items,
  current,
}: {
  items: { titre: string; href: string; icon: string }[];
  current: string;
}) {
  const chemin = usePathname() ?? current;
  return (
    <>
      {items.map((item) => {
        const path = item.href.split('?')[0]!;
        const active = path === '/' ? chemin === '/' : chemin.startsWith(path);
        return (
          <a
            key={item.href}
            href={item.href}
            className={`sidebar-link${active ? ' active' : ''}`}
          >
            <span className="sidebar-icon" dangerouslySetInnerHTML={{ __html: item.icon }} />
            <span>{item.titre}</span>
          </a>
        );
      })}
    </>
  );
}
