'use client';


import { deleteGroupAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';

/**
 * SUPPRIMER UNE CLASSE — `gestion_groupes.php`, `supprimer_groupe` : le bouton
 * n'existe que sur une classe vide (`nb_etudiants == 0`), demande
 * `confirm('Supprimer ce groupe ?')`, et « Groupe supprimé avec succès. »
 * remonte en haut de page.
 */
export function SupprimerGroupe({ groupId, nom }: { groupId: string; nom: string }) {
  const [state, action, pending] = useActionMessage(deleteGroupAction);


  return (
    <form
      action={action}
      style={{ display: 'inline' }}
      onSubmit={(e) => {
        if (!confirm('Supprimer ce groupe ?')) e.preventDefault();
      }}
    >
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="nom" value={nom} />
      <button type="submit" className="btn btn-sm btn-danger" disabled={pending}>
        Supprimer
      </button>
    </form>
  );
}
