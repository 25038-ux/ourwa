'use client';

import { useActionState } from 'react';
import { setBranchActiveAction } from '@/app/actions';

/**
 * SUSPENDRE / RÉOUVRIR UNE BRANCHE.
 *
 * ⚠ LA CONSOLE MONTRAIT L'ÉTAT SANS POUVOIR LE POSER. Elle rend
 * « active / suspendue » sur chaque ligne depuis le début, et `schools.active`
 * existe depuis la première migration — mais rien ne l'écrivait. Un état
 * affiché sans commande laisse chercher un bouton qui n'est nulle part.
 *
 * ⚠ ET SUSPENDRE N'EST PAS SUPPRIMER : la branche garde ses élèves, ses
 * paiements et son historique. La confirmation le dit, parce que « suspendre »
 * sur une école entière est le genre de bouton qu'on veut relire avant de
 * cliquer.
 */
export function SuspendreBranche({
  branchId,
  nom,
  active,
}: {
  branchId: string;
  nom: string;
  active: boolean;
}) {
  const [state, action, pending] = useActionState(
    setBranchActiveAction,
    null as { ok?: string; error?: string } | null,
  );

  return (
    <form
      action={action}
      style={{ display: 'inline' }}
      onSubmit={(e) => {
        const message = active
          ? `Suspendre ${nom} ?\n\nSes comptes ne pourront plus ouvrir la branche. ` +
            `Ses élèves, ses paiements et son historique sont conservés, et la ` +
            `suspension se lève du même bouton.`
          : `Réouvrir ${nom} ?`;
        if (!confirm(message)) e.preventDefault();
      }}
    >
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="active" value={active ? 'false' : 'true'} />
      {state?.error && (
        <span className="badge badge-danger" style={{ marginInlineEnd: '.35rem' }}>
          {state.error}
        </span>
      )}
      <button
        type="submit"
        className={`btn btn-sm ${active ? 'btn-danger' : 'btn-secondary'}`}
        disabled={pending}
      >
        {pending ? '…' : active ? 'Suspendre' : 'Réouvrir'}
      </button>
    </form>
  );
}
