'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * LA MODALE D'EL OURWA — `assets/js/app.js`, `ouvrirModale()` / `fermerModale()`.
 *
 * ⚠ SEPT DE SES PAGES OUVRENT UNE MODALE LÀ OÙ NOUS DÉPLIONS UN `<details>`.
 * `comptes_parents`, `comptes_profs`, `paiement_staff`, `recherche`,
 * `emploi_du_temps`, `gerer_niveaux`, `cours_du_soir` : partout où l'on décide
 * quelque chose sur UNE ligne d'un tableau, elle sort une fenêtre par-dessus.
 * Un repli, lui, pousse la table vers le bas et fait perdre la ligne qu'on
 * regardait — sur une liste de quarante comptes, on ne la retrouve pas.
 *
 * Rien à inventer : `.modal-overlay`, `.modal`, `.modal-header`, `.modal-close`
 * et `.modal-footer` sont dans notre feuille de style depuis le premier jour,
 * copiée au caractère près de la sienne. Quatre de nos pages s'en servaient
 * déjà. Ceci n'ajoute pas un motif, il finit de l'appliquer.
 *
 * Ses trois comportements, portés tels quels :
 *
 *   1. `.active` sur l'enveloppe — c'est la classe qui déclenche sa transition.
 *   2. `document.body.style.overflow = 'hidden'` à l'ouverture, rendu à la
 *      fermeture. Sans cela la page défile DERRIÈRE la fenêtre, et l'on perd sa
 *      place dans la liste en refermant.
 *   3. Échap ferme.
 *
 * ⚠ UN CLIC SUR LE FOND NE FERME PAS, et c'est le sien : ses modales portent
 * des formulaires à demi remplis — un montant, un motif — et une fermeture
 * accidentelle les jetterait. On ferme par « × » ou par « Annuler ».
 */
export function Modale({
  déclencheur,
  titre,
  children,
  largeur = 480,
  classeDéclencheur = 'btn btn-sm btn-secondary',
  ouverte,
  onFermer,
}: {
  /** Le bouton qui l'ouvre. Omis quand le parent pilote `ouverte` lui-même. */
  déclencheur?: React.ReactNode;
  titre: string;
  children: React.ReactNode;
  largeur?: number;
  classeDéclencheur?: string;
  /** Pour une modale pilotée de l'extérieur (une action a réussi, on ferme). */
  ouverte?: boolean;
  onFermer?: () => void;
}) {
  const contrôlée = ouverte !== undefined;
  const [interne, setInterne] = useState(false);
  const visible = contrôlée ? ouverte : interne;
  const id = useId();
  const boîte = useRef<HTMLDivElement>(null);

  const fermer = () => {
    if (contrôlée) onFermer?.();
    else setInterne(false);
  };

  useEffect(() => {
    if (!visible) return;

    // Règle 2 : la page ne défile plus derrière la fenêtre.
    const avant = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Règle 3 : Échap ferme.
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fermer();
    };
    document.addEventListener('keydown', surTouche);

    // Le focus entre dans la fenêtre : sans cela le clavier reste derrière, et
    // ce qui suit — Échap, la tabulation — s'applique à la page cachée.
    boîte.current?.querySelector<HTMLElement>(
      'input:not([type=hidden]):not([disabled]), select, textarea, button',
    )?.focus();

    return () => {
      document.body.style.overflow = avant;
      document.removeEventListener('keydown', surTouche);
    };
    // `fermer` est stable pour la durée de vie de l'ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <>
      {déclencheur !== undefined && (
        <button type="button" className={classeDéclencheur} onClick={() => setInterne(true)}>
          {déclencheur}
        </button>
      )}

      {visible && (
        <div
          className="modal-overlay active"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-t`}
        >
          <div className="modal" style={{ maxWidth: largeur }} ref={boîte}>
            <div className="modal-header">
              <h3 id={`${id}-t`}>{titre}</h3>
              {/* Son « × », et son `aria-label` pour que ce ne soit pas un
                  bouton sans nom pour qui n'en voit pas le glyphe. */}
              <button
                type="button"
                className="modal-close"
                aria-label="Fermer"
                onClick={fermer}
              >
                &times;
              </button>
            </div>
            {children}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Le pied de ses modales : « Annuler » à gauche du bouton d'action, tous deux
 * poussés à droite. `.modal-footer` porte déjà le `justify-content: flex-end`.
 */
export function PiedModale({
  onAnnuler,
  children,
}: {
  onAnnuler: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-footer">
      <button type="button" className="btn btn-secondary" onClick={onAnnuler}>
        Annuler
      </button>
      {children}
    </div>
  );
}
