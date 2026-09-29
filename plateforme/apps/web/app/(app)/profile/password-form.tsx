'use client';


import { changePasswordAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';

type Result = { ok?: string; error?: string } | null;

/**
 * MODIFIER MON MOT DE PASSE — `modifier_profil.php`, formulaire `changer_mdp` :
 * « Mot de passe actuel * », puis « Nouveau mot de passe * » / « Confirmer * »
 * sur une `form-row`, « Modifier le mot de passe ».
 */
export function PasswordForm() {
  const [state, action, pending] = useActionMessage(changePasswordAction);


  return (
    <form action={action} autoComplete="off">
      <div className="form-group">
        <label htmlFor="ancien_mdp">Mot de passe actuel *</label>
        <input type="password" id="ancien_mdp" name="ancien_mdp" autoComplete="current-password" />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="nouveau_mdp">Nouveau mot de passe *</label>
          <input type="password" id="nouveau_mdp" name="nouveau_mdp" autoComplete="new-password" />
        </div>
        <div className="form-group">
          <label htmlFor="confirmer_mdp">Confirmer *</label>
          <input type="password" id="confirmer_mdp" name="confirmer_mdp" autoComplete="new-password" />
        </div>
      </div>
      <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={pending}>Modifier le mot de passe</button>
    </form>
  );
}
