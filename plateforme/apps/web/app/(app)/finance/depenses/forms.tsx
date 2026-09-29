'use client';

import { useState } from 'react';
import { recordExpenseAction, reverseExpenseAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';
import { MoyensPaiement, type LigneMoyen, type Moyen } from '@/components/moyens-paiement';

/**
 * « Nouvelle dépense » — le formulaire de `depenses.php` : montant, description,
 * et le widget des moyens de paiement (sortant, préfixe `depmp`) dont la somme
 * doit égaler le montant.
 */
export function ExpenseForm({ moyens }: { moyens: Moyen[] }) {
  const [state, action, pending] = useActionMessage(recordExpenseAction);

  const [montant, setMontant] = useState('');
  const [lignes, setLignes] = useState<LigneMoyen[]>([{ moyenId: '', montant: '' }]);

  return (
    <form action={action}>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="montant">Montant (MRU) *</label>
          <input
            type="number"
            id="montant"
            name="montant"
            min="1"
            step="1"
            required
            placeholder="Ex: 5000"
            value={montant}
            onChange={(e) => setMontant(e.currentTarget.value)}
          />
        </div>
      </div>
      <div className="form-group">
        <label htmlFor="description">Description du paiement *</label>
        <textarea
          id="description"
          name="description"
          rows={3}
          required
          placeholder="Ex: Achat de fournitures scolaires, réparation climatisation..."
          style={{
            width: '100%',
            padding: '.75rem 1rem',
            border: '2px solid var(--border)',
            borderRadius: 'var(--radius)',
            fontSize: '.9rem',
            fontFamily: 'inherit',
            resize: 'vertical',
          }}
        />
      </div>
      <input type="hidden" name="tender" value={JSON.stringify(lignes)} />
      <MoyensPaiement
        moyens={moyens}
        cible={montant || '0'}
        lignes={lignes}
        onChange={setLignes}
        currency="MRU"
        sens="sortant"
      />
      <button
        type="submit"
        className="btn btn-primary"
        style={{ width: 'auto', marginTop: '.75rem' }}
        disabled={pending}
      >
        Enregistrer la dépense
      </button>
    </form>
  );
}

/** Son « Supprimer », derrière `confirm('Supprimer cette dépense ?')`. */
export function SupprimerDepense({ id }: { id: string }) {
  const [state, action, pending] = useActionMessage(reverseExpenseAction);

  return (
    <form
      action={action}
      style={{ display: 'inline' }}
      onSubmit={(e) => {
        if (!confirm('Supprimer cette dépense ?')) e.preventDefault();
      }}
    >
      <input type="hidden" name="expenseId" value={id} />
      <button type="submit" className="btn btn-sm btn-danger" disabled={pending}>
        Supprimer
      </button>
    </form>
  );
}
