'use client';

import { useState } from 'react';
import { useActionMessage } from '@/components/message-page';
import { parentTelephoneAjouterAction, parentTelephoneRetirerAction } from '@/app/actions';
import { formatTelephone } from '@/lib/telephone';

export interface TelephoneFamille {
  phone: string;
  label: string | null;
}

/**
 * LES NUMÉROS D'UNE FAMILLE (0041) — le principal (l'identifiant, qui se
 * change par « Identifiant » / « Modifier le correspondant ») et les numéros
 * supplémentaires, que l'on ajoute et retire ici. Chacun ouvre le compte de
 * la famille avec le même mot de passe. Partagé entre « Comptes des parents »
 * et le dossier de la famille.
 */
export function TelephonesFamille({
  parentId,
  principal,
  telephones,
}: {
  parentId: string;
  principal: string | null;
  telephones: TelephoneFamille[];
}) {
  const [ajoutState, ajoutAction, ajoutPending] = useActionMessage(parentTelephoneAjouterAction);
  const [retraitState, retraitAction, retraitPending] = useActionMessage(parentTelephoneRetirerAction);
  // L'alerte est celle de la DERNIÈRE action : un ajout réussi restait affiché
  // en vert au-dessus d'un retrait refusé.
  const [derniere, setDerniere] = useState<'ajout' | 'retrait' | null>(null);
  const etat = derniere === 'retrait' ? retraitState : derniere === 'ajout' ? ajoutState : null;

  return (
    <div>
      {etat?.error && <div className="alert alert-danger" role="alert">{etat.error}</div>}
      {etat?.ok && <div className="alert alert-success" role="status">{etat.ok}</div>}
      <table style={{ marginBottom: '1rem' }}>
        <thead>
          <tr><th>Numéro</th><th>Libellé</th><th></th></tr>
        </thead>
        <tbody>
          <tr>
            <td><code>{formatTelephone(principal) || '—'}</code></td>
            <td><span className="badge badge-primary">Identifiant principal</span></td>
            <td></td>
          </tr>
          {telephones.map((t) => (
            <tr key={t.phone}>
              <td><code>{formatTelephone(t.phone)}</code></td>
              <td>{t.label ?? <span className="text-muted">—</span>}</td>
              <td style={{ textAlign: 'right' }}>
                <form
                  action={retraitAction}
                  style={{ display: 'inline' }}
                  onSubmit={(e) => {
                    if (!window.confirm(`Retirer le numéro ${formatTelephone(t.phone)} ? Il n'ouvrira plus le compte de la famille.`)) {
                      e.preventDefault();
                      return;
                    }
                    setDerniere('retrait');
                  }}
                >
                  <input type="hidden" name="parent_id" value={parentId} />
                  <input type="hidden" name="telephone" value={t.phone} />
                  <button className="btn btn-sm btn-danger" disabled={retraitPending}>Retirer</button>
                </form>
              </td>
            </tr>
          ))}
          {telephones.length === 0 && (
            <tr><td colSpan={3} className="text-muted">Aucun numéro supplémentaire.</td></tr>
          )}
        </tbody>
      </table>

      <form action={ajoutAction} onSubmit={() => setDerniere('ajout')} style={{ display: 'flex', gap: '.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <input type="hidden" name="parent_id" value={parentId} />
        <div className="form-group" style={{ flex: '1 1 160px', marginBottom: 0 }}>
          <label htmlFor={`tel-${parentId}`}>Nouveau numéro *</label>
          <input id={`tel-${parentId}`} type="tel" name="telephone" required maxLength={40} placeholder="+222 XX XX XX XX" />
        </div>
        <div className="form-group" style={{ flex: '1 1 120px', marginBottom: 0 }}>
          <label htmlFor={`lib-${parentId}`}>Libellé</label>
          <input id={`lib-${parentId}`} type="text" name="libelle" maxLength={40} placeholder="Mère, père, oncle…" />
        </div>
        <button className="btn btn-primary" style={{ width: 'auto' }} disabled={ajoutPending}>Ajouter</button>
      </form>
      <p className="text-muted" style={{ fontSize: '.82rem', marginTop: '.6rem' }}>
        Chaque numéro ouvre le compte de la famille dans l'application, avec le même mot de passe. Un numéro n'appartient
        qu'à un seul compte.
      </p>
    </div>
  );
}
