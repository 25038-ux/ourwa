'use client';


import { changeOwnNameAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';

type Result = { ok?: string; error?: string } | null;

/**
 * MODIFIER MON NOM — `modifier_profil.php`, formulaire `changer_nom` :
 * « Prénom * » / « Nom * » sur une `form-row`, « Enregistrer ». Ses refus
 * viennent du serveur : pas de `required`, sinon React ne soumet pas.
 */
export function NameForm({ prenom, nom }: { prenom: string; nom: string }) {
  const [state, action, pending] = useActionMessage(changeOwnNameAction);


  return (
    <form action={action}>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="prenom">Prénom *</label>
          <input type="text" id="prenom" name="prenom" defaultValue={prenom} maxLength={100} />
        </div>
        <div className="form-group">
          <label htmlFor="nom">Nom *</label>
          <input type="text" id="nom" name="nom" defaultValue={nom} maxLength={100} />
        </div>
      </div>
      <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={pending}>Enregistrer</button>
    </form>
  );
}
