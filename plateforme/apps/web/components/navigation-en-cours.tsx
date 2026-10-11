'use client';

import { useEffect, useRef } from 'react';

/**
 * LE SITE RÉPOND AU CLIC — une barre en haut de l'écran dès qu'on quitte la page.
 *
 * ⚠ « LES PAGES NE CHANGENT PAS » (propriétaire, 10/10/2026, le jour de la mise
 * en ligne). Elles changeaient — mais chaque lien recharge la page entière, comme
 * El Ourwa, et le navigateur garde l'ANCIENNE page à l'écran, immobile, jusqu'au
 * premier octet de la nouvelle. Le serveur met 20 à 500 ms à répondre ; la ligne
 * entre Nouakchott et l'Europe, elle, met de 100 ms à plusieurs secondes, et
 * pendant tout ce temps rien ne disait que le clic avait été compris. On
 * recliquait, on croyait le site en panne.
 *
 * `loading.tsx` dessine la même barre, mais seulement pendant une navigation
 * interne de Next — que les liens du site (`<a href>`) ne déclenchent pas.
 *
 * Ce composant ne change RIEN à la navigation : il montre la barre au moment du
 * clic sur un lien du site, ou de l'envoi d'un formulaire, et le navigateur fait
 * le reste comme avant. La page suivante arrive sans barre.
 *
 * ⚠ CE QUI NE QUITTE PAS LA PAGE NE DOIT PAS LA MONTRER : un clic annulé par une
 * confirmation, un lien vers un autre onglet, un téléchargement (`/api/…`,
 * `download`), une ancre de la même page, un autre site. Et un filet : au bout de
 * vingt secondes elle s'efface d'elle-même — un export servi en pièce jointe ne
 * décharge jamais la page, et une barre qui tourne sans fin serait pire que pas
 * de barre.
 */
const EFFACEE_APRES_MS = 20_000;

export function NavigationEnCours() {
  const barre = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = barre.current;
    if (!el) return;
    let minuterie: number | undefined;

    const cacher = () => {
      window.clearTimeout(minuterie);
      el.hidden = true;
      document.documentElement.classList.remove('navigation-en-cours');
    };
    const montrer = () => {
      el.hidden = false;
      document.documentElement.classList.add('navigation-en-cours');
      window.clearTimeout(minuterie);
      minuterie = window.setTimeout(cacher, EFFACEE_APRES_MS);
    };

    const surClic = (e: MouseEvent) => {
      // Un clic qu'un autre gestionnaire a annulé (une confirmation refusée) ne mène nulle part.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const lien = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(lien instanceof HTMLAnchorElement)) return;
      if (lien.target && lien.target !== '_self') return;
      if (lien.hasAttribute('download')) return;
      let url: URL;
      try {
        url = new URL(lien.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // Les routes /api/ rendent un fichier ou redirigent sans page : rien ne se décharge.
      if (url.pathname.startsWith('/api/')) return;
      // La même page (une ancre, un lien vers soi) : le navigateur ne recharge rien.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      montrer();
    };

    const surEnvoi = (e: SubmitEvent) => {
      // Un formulaire que React (action serveur) ou la validation a pris en main annonce son état lui-même.
      if (e.defaultPrevented) return;
      const formulaire = e.target;
      if (!(formulaire instanceof HTMLFormElement)) return;
      if (formulaire.target && formulaire.target !== '_self') return;
      montrer();
    };

    // Retour par le bouton « Précédent » : la page revient telle qu'on l'a quittée, barre comprise.
    const surRetour = () => cacher();

    document.addEventListener('click', surClic);
    document.addEventListener('submit', surEnvoi);
    window.addEventListener('pageshow', surRetour);
    return () => {
      document.removeEventListener('click', surClic);
      document.removeEventListener('submit', surEnvoi);
      window.removeEventListener('pageshow', surRetour);
      window.clearTimeout(minuterie);
    };
  }, []);

  return <div ref={barre} className="nav-progress" aria-hidden="true" hidden />;
}
