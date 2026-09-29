'use client';

import { useLayoutEffect } from 'react';

/**
 * ⚠ LA DIRECTION DU DOCUMENT, PAS SEULEMENT CELLE DU CADRE.
 *
 * La page légale en arabe posait `dir="rtl"` sur son propre conteneur et se
 * lisait bien — mais `<html>` disait toujours `lang="fr" dir="ltr"`. Un lecteur
 * d'écran annonçait donc de l'arabe en français, et le navigateur plaçait sa
 * barre de défilement, sa sélection et sa recherche comme pour du français.
 *
 * La racine est dans `app/layout.tsx`, qui ne connaît que la langue de l'école ;
 * une page ne peut pas y toucher côté serveur. Ceci le fait au premier rendu,
 * avant la peinture, sans script en ligne — la CSP n'en autorise aucun sans
 * nonce.
 */
export function DocumentDirection({ lang, dir }: { lang: 'fr' | 'ar'; dir: 'rtl' | 'ltr' }) {
  useLayoutEffect(() => {
    const html = document.documentElement;
    const before = { lang: html.lang, dir: html.dir };
    html.lang = lang;
    html.dir = dir;
    return () => {
      html.lang = before.lang;
      html.dir = before.dir;
    };
  }, [lang, dir]);
  return null;
}
