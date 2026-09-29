'use client';

import { useActionState, useState } from 'react';
import { repayMiscDebtAction } from '@/app/actions';
import { MoyensPaiement, type LigneMoyen, type Moyen } from '@/components/moyens-paiement';

/**
 * « Enregistrer un remboursement » — `dette.php`, le formulaire `rembourser` :
 * son `widget_moyens_paiement('entrant', 0, 'detpay')` sans montant cible, puis
 * « Confirmer le remboursement ». Le montant est la somme des lignes ; le refus
 * (« Le remboursement (…) dépasse le reste dû (…) ») vient du serveur, en tête.
 */
export function RemboursementDette({ detteId, moyens }: { detteId: string; moyens: Moyen[] }) {
  const [lignes, setLignes] = useState<LigneMoyen[]>([{ moyenId: '', montant: '' }]);
  const [state, action, pending] = useActionState<{ error?: string } | null, FormData>(
    repayMiscDebtAction,
    null,
  );
  return (
    <div className="form-card" style={{ marginBottom: '1.5rem' }}>
      <h4 style={{ marginTop: 0 }}>Enregistrer un remboursement</h4>
      {state?.error && <div className="alert alert-error">{state.error}</div>}
      <form action={action}>
        <input type="hidden" name="id" value={detteId} />
        <input type="hidden" name="tender" value={JSON.stringify(lignes)} />
        <MoyensPaiement moyens={moyens} cible="0" lignes={lignes} onChange={setLignes} currency="MRU" sens="entrant" />
        <button className="btn btn-primary" style={{ marginTop: '.75rem' }} disabled={pending}>
          Confirmer le remboursement
        </button>
      </form>
    </div>
  );
}
