'use client';

import { useState } from 'react';
import { addPaymentMethodAction, togglePaymentMethodAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';

export interface Moyen {
  id: string;
  name: string;
  isActive: boolean;
}

/**
 * « MOYENS DE PAIEMENT » — le panneau en tête de `gestion_caisse.php` :
 * `.mp-manager`, son badge « N actifs », « Gérer » (administration) ou la
 * mention « Gestion réservée à l'administration », le corps replié avec le
 * formulaire d'ajout, la phrase d'aide et les puces à interrupteur.
 */
export function MoyensManager({ moyens, peutAdministrer, ouvert }: { moyens: Moyen[]; peutAdministrer: boolean; ouvert: boolean }) {
  const [open, setOpen] = useState(ouvert);
  const [addState, addAction] = useActionMessage(addPaymentMethodAction);
  const [toggleState, toggleAction] = useActionMessage(togglePaymentMethodAction);



  const actifs = moyens.filter((m) => m.isActive).length;

  return (
    <div className="form-card mp-manager">
      <div className="mp-manager-head">
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          Moyens de paiement
          <span className="badge badge-primary">{actifs} actif{actifs > 1 ? 's' : ''}</span>
        </h3>
        {peutAdministrer ? (
          <button type="button" className="btn btn-sm btn-secondary" id="btn_panneau_moyens" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            Gérer
          </button>
        ) : (
          <span className="text-muted" style={{ fontSize: '.8rem' }} title="La gestion des moyens de paiement (ajout, activation, désactivation) est réservée à l'administration.">
            Gestion réservée à l&apos;administration
          </span>
        )}
      </div>
      {peutAdministrer && (
        <div id="panneau_moyens" className="mp-manager-body" hidden={!open}>
          <form action={addAction} className="mp-add-form">
            <div style={{ flex: 1, minWidth: 220 }}>
              <label htmlFor="moyen_nom">Nouveau moyen (ex : Bankily, Masrvi, …)</label>
              <input type="text" id="moyen_nom" name="name" placeholder="Nom du moyen de paiement" required minLength={2} maxLength={60} />
            </div>
            <button className="btn btn-primary" style={{ width: 'auto' }}>+ Ajouter</button>
          </form>
          {moyens.length > 0 ? (
            <>
              <p className="text-muted" style={{ fontSize: '.83rem', margin: '.25rem 0 .65rem' }}>
                Cliquez sur l&apos;interrupteur pour activer / désactiver un moyen. Un moyen désactivé
                n&apos;apparaît plus dans les formulaires de paiement, mais l&apos;historique est conservé.
              </p>
              <div className="mp-chips">
                {moyens.map((mo) => (
                  <div key={mo.id} className={`mp-chip ${mo.isActive ? 'is-on' : 'is-off'}`}>
                    <span className="mp-chip-dot" aria-hidden="true"></span>
                    <span className="mp-chip-name">{mo.name}</span>
                    <form action={toggleAction} style={{ display: 'inline-flex' }}>
                      <input type="hidden" name="methodId" value={mo.id} />
                      <button type="submit" className="mp-switch" role="switch" aria-checked={mo.isActive} title={`${mo.isActive ? 'Désactiver' : 'Activer'} ${mo.name}`}>
                        <span className="mp-switch-knob"></span>
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-muted">Aucun moyen de paiement. Ajoutez-en au moins un pour pouvoir encaisser.</p>
          )}
        </div>
      )}
    </div>
  );
}
