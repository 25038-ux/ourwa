'use client';


import { deleteTeacherAction, updateTeacherPayAction } from '@/app/actions';
import { useActionMessage, useMessagePage } from '@/components/message-page';

type Result = { ok?: string; error?: string } | null;

/**
 * LE SALAIRE FIXE D'UN PERMANENT, corrigé en ligne — son formulaire
 * `mettre_a_jour_tarif` (situation `permanent`, `step="500"`, bouton « ✓ »).
 */
export function SalaireForm({ teacherId, salaire }: { teacherId: string; salaire: string }) {
  const [state, action, pending] = useActionMessage(updateTeacherPayAction);

  return (
    <form action={action} style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
      <input type="hidden" name="teacherId" value={teacherId} />
      <input type="hidden" name="employment" value="permanent" />
      <input
        type="number"
        name="salary"
        defaultValue={String(Number(salaire))}
        min={0}
        step={500}
        style={{ width: 110, padding: '.35rem .5rem', border: '2px solid var(--border)', borderRadius: 6, fontSize: '.85rem' }}
        title="Salaire mensuel fixe"
      />
      <button type="submit" className="btn btn-sm btn-secondary" style={{ padding: '.3rem .6rem' }} disabled={pending}>✓</button>
    </form>
  );
}

/**
 * SUPPRIMER UN PROFESSEUR — son `supprimer_professeur`, `confirm('Supprimer ce
 * professeur ?')`, « Professeur « X » supprimé. ». Le refus quand des notes en
 * dépendent vient de la base (migration 0025) et s'affiche tel quel.
 */
export function SupprimerProfesseur({ teacherId, nom }: { teacherId: string; nom: string }) {
  // La ligne disparaît avec la suppression : le message est publié au retour.
  const [, action, pending] = useActionMessage<NonNullable<Result>>(deleteTeacherAction);
  return (
    <form
      action={action}
      style={{ display: 'inline' }}
      onSubmit={(e) => {
        if (!window.confirm('Supprimer ce professeur ?')) e.preventDefault();
      }}
    >
      <input type="hidden" name="teacherId" value={teacherId} />
      <input type="hidden" name="nom" value={nom} />
      <button type="submit" className="btn btn-sm btn-danger" disabled={pending}>Supprimer</button>
    </form>
  );
}
