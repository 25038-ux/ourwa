'use client';


import { changeIdentifierAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';

type Result = { ok?: string; error?: string } | null;

/**
 * MODIFIER MON IDENTIFIANT DE CONNEXION — `modifier_profil.php`, formulaire
 * `changer_identifiant` : « Nouvel identifiant * » (son `pattern` et son
 * `title`), « Mot de passe actuel * », « Modifier l'identifiant ».
 */
export function IdentifiantForm() {
  const [state, action, pending] = useActionMessage(changeIdentifierAction);


  return (
    <form action={action} autoComplete="off">
      <div className="form-group">
        <label htmlFor="nouvel_identifiant">Nouvel identifiant *</label>
        <input
          type="text"
          id="nouvel_identifiant"
          name="nouvel_identifiant"
          placeholder="ex. directeur@supnum.mr"
          maxLength={100}
          pattern="[a-zA-Z0-9._@\-]{3,100}"
          title="3 à 100 caractères : lettres, chiffres, @, . - _"
        />
      </div>
      <div className="form-group">
        <label htmlFor="mdp_actuel_id">Mot de passe actuel *</label>
        <input type="password" id="mdp_actuel_id" name="mdp_actuel_id" autoComplete="current-password" />
      </div>
      <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={pending}>Modifier l&apos;identifiant</button>
    </form>
  );
}
