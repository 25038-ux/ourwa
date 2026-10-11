'use client';

import { useEffect } from 'react';

/**
 * LE TITRE DE L'ONGLET — son `<title><?= e($titre_page ?? 'El Ourwa') ?> — El Ourwa</title>`
 * (`includes/layout_header.php`).
 *
 * ⚠ TOUS LES ONGLETS S'APPELAIENT « El Ourwa — El Ourwa » (balayage du
 * 11/10/2026 : 182 visites sur 182). Le titre venait de la coquille — le nom de
 * l'école, puis celui de la marque, qui sont le même en école unique — et jamais
 * de la page : trois onglets ouverts sur la caisse, les notes et une fiche de
 * famille ne se distinguaient pas, et l'historique du navigateur non plus.
 *
 * Chaque page donne déjà son titre à `PageHeader` : il le pose ici. Côté
 * navigateur, parce que l'en-tête est rendu dans la page et que la coquille,
 * elle, ne se rend plus à chaque clic (`navigation-douce.tsx`). En quittant la
 * page, le titre de la coquille revient — une page sans en-tête ne garde pas le
 * titre de la précédente.
 */
export function TitreOnglet({ titre, marque }: { titre: string; marque: string }) {
  useEffect(() => {
    const avant = document.title;
    document.title = `${titre} — ${marque}`;
    return () => {
      document.title = avant;
    };
  }, [titre, marque]);
  return null;
}
