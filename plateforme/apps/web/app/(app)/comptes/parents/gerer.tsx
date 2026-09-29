'use client';

import { useEffect, useState } from 'react';
import { Modale } from '@/components/modale';
import { MotDePasseGenere } from '@/components/mot-de-passe-genere';
import { useActionMessage } from '@/components/message-page';
import { TelephonesFamille, type TelephoneFamille } from '@/components/telephones-famille';
import { parentActifAction, parentMdpAction, parentTelephoneAction } from '@/app/actions';

type Result = { ok?: string; error?: string } | null;

/**
 * LES TROIS COMMANDES D'UNE LIGNE DE `comptes_parents.php` : « Identifiant »
 * et « Reset mdp » ouvrent sa modale (le nom du parent dans le titre) ;
 * « Désactiver » / « Réactiver » est un formulaire direct avec `confirm`.
 * Sa page se recharge après chaque POST : la modale se referme et le message
 * est en tête de page.
 *
 * Et une quatrième, à nous (0041) : « Numéros » — les numéros supplémentaires
 * de la famille, qui ouvrent tous le même compte.
 */
export function GererParent({
  parentId,
  nom,
  telephone,
  telephones,
  actif,
  peutReinitialiser,
}: {
  parentId: string;
  nom: string;
  telephone: string | null;
  telephones: TelephoneFamille[];
  actif: boolean;
  peutReinitialiser: boolean;
}) {
  const [idOuvert, setIdOuvert] = useState(false);
  const [mdpOuvert, setMdpOuvert] = useState(false);
  const [telOuvert, setTelOuvert] = useState(false);
  const [idState, idAction, idPending] = useActionMessage(parentTelephoneAction);

  const [mdpState, mdpAction, mdpPending] = useActionMessage(parentMdpAction);

  const [actifState, actifAction, actifPending] = useActionMessage(parentActifAction);

  void (actifState as Result);

  useEffect(() => { if (idState) setIdOuvert(false); }, [idState]);
  useEffect(() => { if (mdpState) setMdpOuvert(false); }, [mdpState]);

  return (
    <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
      <button className="btn btn-sm btn-secondary" type="button" onClick={() => setIdOuvert(true)}>Identifiant</button>
      <button className="btn btn-sm btn-secondary" type="button" onClick={() => setTelOuvert(true)}>
        Numéros{telephones.length > 0 ? ` (${telephones.length + 1})` : ''}
      </button>
      {peutReinitialiser && (
        <button className="btn btn-sm btn-secondary" type="button" onClick={() => setMdpOuvert(true)}>Reset mdp</button>
      )}
      <form
        action={actifAction}
        style={{ display: 'inline' }}
        onSubmit={(e) => {
          if (!window.confirm(`${actif ? 'Désactiver' : 'Réactiver'} ce compte ?`)) e.preventDefault();
        }}
      >
        <input type="hidden" name="parent_id" value={parentId} />
        <input type="hidden" name="vers" value={actif ? '0' : '1'} />
        <button className={`btn btn-sm ${actif ? 'btn-danger' : 'btn-success'}`} disabled={actifPending}>
          {actif ? 'Désactiver' : 'Réactiver'}
        </button>
      </form>

      <Modale ouverte={idOuvert} onFermer={() => setIdOuvert(false)} titre={`Modifier l'identifiant — ${nom}`} largeur={480}>
        <form action={idAction}>
          <input type="hidden" name="parent_id" value={parentId} />
          <div className="form-group">
            <label>Identifiant actuel</label>
            <input type="text" value={telephone ?? ''} disabled readOnly />
          </div>
          <div className="form-group">
            <label>Nouveau numéro de téléphone *</label>
            <input type="text" name="nouveau_telephone" required placeholder="+222 XX XX XX XX" />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={() => setIdOuvert(false)}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={idPending}>Enregistrer</button>
          </div>
        </form>
      </Modale>

      <Modale ouverte={telOuvert} onFermer={() => setTelOuvert(false)} titre={`Numéros de téléphone — ${nom}`} largeur={560}>
        <TelephonesFamille parentId={parentId} principal={telephone} telephones={telephones} />
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={() => setTelOuvert(false)}>Fermer</button>
        </div>
      </Modale>

      <Modale ouverte={mdpOuvert} onFermer={() => setMdpOuvert(false)} titre={`Réinitialiser le mot de passe — ${nom}`} largeur={480}>
        <form action={mdpAction}>
          <input type="hidden" name="parent_id" value={parentId} />
          <div className="form-group">
            <label>Nouveau mot de passe * (généré — à remettre au parent)</label>
            <MotDePasseGenere name="nouveau_mdp" placeholder="Minimum 8 caractères, 3 types" />
            <small className="text-muted">Le parent sera obligé de le changer à la prochaine connexion. ↻ en propose un autre.</small>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={() => setMdpOuvert(false)}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={mdpPending}>Réinitialiser</button>
          </div>
        </form>
      </Modale>
    </div>
  );
}
