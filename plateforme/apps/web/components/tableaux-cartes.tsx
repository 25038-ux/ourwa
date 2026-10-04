'use client';

import { useEffect } from 'react';

/**
 * LES TABLEAUX DE LISTE EN CARTES SUR TÉLÉPHONE (24/09/2026).
 *
 * Un tableau de six colonnes dans 375 px ne montrait que les trois premières :
 * le montant, le statut et le bouton « Voir le profil » demandaient de faire
 * défiler le tableau de côté, sans que rien ne le dise. Sous 640 px, chaque
 * ligne devient une carte (responsive.css, `table[data-cartes]`) : le nom en
 * tête, puis « COLONNE  valeur » ligne à ligne, les boutons en pied.
 *
 * Ce composant ne fait que MARQUER : il recopie le titre de chaque colonne sur
 * ses cellules (`data-label`) et pose `data-cartes` sur le tableau — la mise en
 * page reste dans la feuille, et au-dessus de 640 px rien ne change.
 *
 * ⚠ SEULEMENT LES LISTES. Un tableau est laissé tel quel quand :
 *   - il a moins de 4 colonnes (il tient déjà) ;
 *   - son en-tête n'est pas une seule ligne simple (colspan, deux lignes) ;
 *   - une cellule du corps fusionne des lignes ou des colonnes (grilles,
 *     emplois du temps, bulletins) — sauf une ligne-message qui couvre tout ;
 *   - il contient des champs de saisie visibles (feuilles de notes, appel) ;
 *   - lui ou un parent porte `data-no-cartes` / `.no-cartes`.
 * Les attributs posés ne sont pas gérés par React : il ne les retire pas.
 */
export function TableauxEnCartes() {
  useEffect(() => {
    const racine = document.querySelector('main') ?? document.body;
    let prevu = 0;

    const texte = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

    const marquer = () => {
      prevu = 0;
      racine.querySelectorAll<HTMLTableElement>('table').forEach((table) => {
        if (table.closest('[data-no-cartes], .no-cartes')) return;
        const lignesEntete = table.tHead?.rows;
        if (!lignesEntete || lignesEntete.length !== 1) return;
        const titres = Array.from(lignesEntete[0]!.cells);
        if (titres.length < 4 || titres.some((c) => c.colSpan > 1 || c.rowSpan > 1)) return;
        const corps = Array.from(table.tBodies);
        if (corps.length === 0) return;
        const saisie = corps.some((b) =>
          b.querySelector('input:not([type=hidden]):not([type=checkbox]), select, textarea'),
        );
        if (saisie) return;
        const lignes = corps.flatMap((b) => Array.from(b.rows));
        const fusion = lignes.some((r) =>
          Array.from(r.cells).some((c) => c.rowSpan > 1 || (c.colSpan > 1 && r.cells.length > 1)),
        );
        if (fusion) return;

        const libelles = titres.map(texte);
        for (const r of lignes) {
          Array.from(r.cells).forEach((c, i) => {
            if (r.cells.length === 1 && c.colSpan > 1) {
              c.setAttribute('data-message', '');
              return;
            }
            const l = libelles[i] ?? '';
            if (c.getAttribute('data-label') !== l) c.setAttribute('data-label', l);
          });
        }
        if (table.getAttribute('data-cartes') !== '1') table.setAttribute('data-cartes', '1');
      });
    };

    /*
     * ⚠ PAS AVANT QUE LA PAGE AIT FINI DE S'HYDRATER (04/10/2026). Cette
     * coquille s'hydrate avant la page qu'elle contient (diffusée en
     * morceaux) : marquer tout de suite posait `data-label` sur des cellules
     * que React n'avait pas encore reprises, et chaque liste levait « A tree
     * hydrated but some attributes … didn't match » — le bandeau rouge
     * « 1 Issue » sur une page sur deux. Après `load` et une pause, React a
     * repris la page ; ensuite l'observateur suit les rendus côté client.
     */
    let observateur: MutationObserver | null = null;
    let minuterie = 0;
    const demarrer = () => {
      minuterie = window.setTimeout(() => {
        marquer();
        observateur = new MutationObserver(() => {
          if (!prevu) prevu = window.requestAnimationFrame(marquer);
        });
        observateur.observe(racine, { childList: true, subtree: true });
      }, 300);
    };
    if (document.readyState === 'complete') demarrer();
    else window.addEventListener('load', demarrer, { once: true });
    return () => {
      window.removeEventListener('load', demarrer);
      window.clearTimeout(minuterie);
      observateur?.disconnect();
      if (prevu) window.cancelAnimationFrame(prevu);
    };
  }, []);

  return null;
}
