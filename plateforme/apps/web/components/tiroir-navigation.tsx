'use client';

import { useEffect, useRef } from 'react';

/**
 * LE BOUTON DU MENU SUR TÉLÉPHONE ET TABLETTE — `includes/sidebar.php`
 * (`#sidebar-toggle`) et `assets/js/app.js` (« Tiroir de navigation »).
 *
 * ⚠ SUR UN TÉLÉPHONE, LA BARRE LATÉRALE DISPARAISSAIT SANS RETOUR (propriétaire,
 * 23/09/2026). La feuille de style — copiée de la sienne — range la barre hors
 * de l'écran sous 1024 px et attend un bouton pour l'ouvrir ; le bouton et son
 * script n'avaient jamais été portés. Le personnel sur téléphone n'avait donc
 * plus aucun menu : seulement la page ouverte.
 *
 * Son comportement, point par point : le bouton ouvre et ferme ; son libellé
 * dit l'action disponible ; le voile referme ; Échap referme et rend le focus
 * au bouton ; toucher un lien referme ; toucher à côté referme ; repasser en
 * grand écran referme ; la page ne défile pas derrière le tiroir ouvert.
 * Le seuil est le sien : 1024 px, celui de la feuille de style.
 */
const SEUIL_TIROIR = 1024;

export function TiroirNavigation() {
  const bouton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const toggle = bouton.current;
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (!toggle || !sidebar) return;

    const ouvrir = (etat: boolean) => {
      sidebar.classList.toggle('open', etat);
      toggle.setAttribute('aria-expanded', etat ? 'true' : 'false');
      toggle.setAttribute('aria-label', etat ? 'Fermer le menu' : 'Ouvrir le menu');
      if (backdrop) {
        backdrop.hidden = !etat;
        // Présent dans le flux avant sa classe, sinon la transition ne se joue pas.
        if (etat) requestAnimationFrame(() => backdrop.classList.add('shown'));
        else backdrop.classList.remove('shown');
      }
      document.body.style.overflow = etat ? 'hidden' : '';
    };

    const surBouton = (e: MouseEvent) => {
      e.stopPropagation();
      ouvrir(!sidebar.classList.contains('open'));
    };
    const surVoile = () => ouvrir(false);
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebar.classList.contains('open')) {
        ouvrir(false);
        toggle.focus();
      }
    };
    const surLien = (e: MouseEvent) => {
      const cible = e.target as Element | null;
      if (cible?.closest('a') && window.innerWidth <= SEUIL_TIROIR) ouvrir(false);
    };
    const aCote = (e: MouseEvent) => {
      const cible = e.target as Node | null;
      if (
        window.innerWidth <= SEUIL_TIROIR &&
        sidebar.classList.contains('open') &&
        cible &&
        !sidebar.contains(cible) &&
        !toggle.contains(cible)
      ) {
        ouvrir(false);
      }
    };
    const surTaille = () => {
      if (window.innerWidth > SEUIL_TIROIR && sidebar.classList.contains('open')) ouvrir(false);
    };

    toggle.addEventListener('click', surBouton);
    backdrop?.addEventListener('click', surVoile);
    document.addEventListener('keydown', surTouche);
    sidebar.addEventListener('click', surLien);
    document.addEventListener('click', aCote);
    window.addEventListener('resize', surTaille);
    return () => {
      toggle.removeEventListener('click', surBouton);
      backdrop?.removeEventListener('click', surVoile);
      document.removeEventListener('keydown', surTouche);
      sidebar.removeEventListener('click', surLien);
      document.removeEventListener('click', aCote);
      window.removeEventListener('resize', surTaille);
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <button
      ref={bouton}
      type="button"
      className="sidebar-toggle no-print"
      id="sidebar-toggle"
      aria-label="Ouvrir le menu"
      aria-expanded="false"
      aria-controls="sidebar"
    >
      <svg
        aria-hidden="true"
        focusable="false"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        width="24"
        height="24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
      </svg>
    </button>
  );
}
