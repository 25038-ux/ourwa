'use client';

import { useActionState } from 'react';
import { setTariffAction } from '@/app/actions';

/**
 * LE TARIF, MODIFIABLE.
 *
 * ⚠ SA TUILE AFFICHAIT UN NOMBRE QUE PERSONNE NE POUVAIT CHANGER. La route
 * existait, gardée et auditée ; aucun écran ne l'appelait. Le seul moyen de
 * changer ce qui facture toutes les écoles était d'écrire dans la base.
 *
 * Il reste dans la carte « Facturation », sous les tuiles : on le change en
 * voyant ce qu'il produit, jamais à l'aveugle.
 */
export function TarifForm({ tariff, currency }: { tariff: string; currency: string }) {
  const [state, action, pending] = useActionState(setTariffAction, null as {
    ok?: string;
    error?: string;
  } | null);

  return (
    <form
      action={action}
      className="no-print"
      style={{
        display: 'flex',
        gap: '.6rem',
        alignItems: 'flex-end',
        flexWrap: 'wrap',
        padding: '0 1rem 1rem',
      }}
    >
      <div className="form-group" style={{ margin: 0, minWidth: 200 }}>
        <label htmlFor="tarif">Tarif par élève ({currency})</label>
        {/*
          ⚠ `defaultValue` PORTE UNE CLÉ. Sans elle le champ reste sur l'ancien
          montant après l'enregistrement, à côté d'un message qui annonce le
          nouveau — la même erreur déjà commise sur la période d'une année.
        */}
        <input
          key={tariff}
          id="tarif"
          name="amount"
          inputMode="decimal"
          pattern="\d{1,7}(\.\d{1,2})?"
          defaultValue={tariff}
          required
        />
      </div>
      <button className="btn btn-secondary" style={{ width: 'auto' }} disabled={pending}>
        {pending ? 'Enregistrement…' : 'Changer le tarif'}
      </button>
      {state?.error && (
        <span className="text-danger" style={{ fontSize: '.8rem' }}>
          {state.error}
        </span>
      )}
      {state?.ok && (
        <span className="text-muted" style={{ fontSize: '.8rem' }}>
          {state.ok}
        </span>
      )}
      <span className="text-muted" style={{ fontSize: '.75rem', flexBasis: '100%' }}>
        Il s’applique à toutes les branches, immédiatement, et le changement est
        inscrit au journal d’audit.
      </span>
    </form>
  );
}
