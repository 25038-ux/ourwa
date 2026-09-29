'use client';


import { decideRequestAction, raiseRequestAction } from '@/app/actions';
import { useActionMessage, useMessagePage } from '@/components/message-page';

type Result = { ok?: string; error?: string } | null;

import { TYPES_DEMANDE } from './types';

/**
 * NOUVELLE DEMANDE — son formulaire `soumettre` (comptable / secrétaire) :
 * « Type de demande * » / « Montant (MRU) — optionnel » en deux colonnes,
 * « Description * », « ✓ Soumettre la demande ».
 */
export function RaiseForm() {
  const [state, action, pending] = useActionMessage(raiseRequestAction);


  return (
    <form action={action}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Type de demande *</label>
          <select name="type_demande" required defaultValue="">
            <option value="">— Choisir —</option>
            {TYPES_DEMANDE.map(([tk, tl]) => <option key={tk} value={tk}>{tl}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Montant (MRU) — optionnel</label>
          <input type="number" name="montant" min={0} step={0.01} placeholder="Ex : 5000" />
        </div>
      </div>
      <div className="form-group">
        <label>Description *</label>
        <textarea name="description" rows={3} required placeholder="Décrivez votre demande en détail..." style={{ width: '100%', resize: 'vertical' }} />
      </div>
      <button className="btn btn-primary" disabled={pending}>✓ Soumettre la demande</button>
    </form>
  );
}

/**
 * DÉCIDER — son formulaire `decider` par ligne : « Commentaire (opt.) »,
 * « ✓ Approuver » / « ✕ Rejeter » (avec `confirm('Rejeter cette demande ?')`).
 * La ligne change d'état avec la décision : le message est publié au retour.
 */
export function DecideForm({ requestId }: { requestId: string }) {
  const [, action, pending] = useActionMessage<NonNullable<Result>>(decideRequestAction);

  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: '.3rem', minWidth: 180 }}>
      <input type="hidden" name="demande_id" value={requestId} />
      <input type="text" name="commentaire" placeholder="Commentaire (opt.)" style={{ fontSize: '.8rem', padding: '.3rem .5rem' }} />
      <div style={{ display: 'flex', gap: '.3rem' }}>
        <button name="decision" value="approuve" className="btn btn-sm btn-primary" style={{ flex: 1, fontSize: '.78rem' }} disabled={pending}>✓ Approuver</button>
        <button
          name="decision"
          value="rejete"
          className="btn btn-sm btn-danger"
          style={{ flex: 1, fontSize: '.78rem' }}
          disabled={pending}
          onClick={(e) => { if (!window.confirm('Rejeter cette demande ?')) e.preventDefault(); }}
        >
          ✕ Rejeter
        </button>
      </div>
    </form>
  );
}
