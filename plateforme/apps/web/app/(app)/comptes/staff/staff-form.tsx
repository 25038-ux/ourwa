'use client';


import { addStaffAction, deleteStaffAction } from '@/app/actions';
import { useActionMessage, useMessagePage } from '@/components/message-page';
import { MOIS_NOMS } from '@/lib/mois';

/**
 * NOUVEAU PERSONNEL — le formulaire `ajouter` de `ajouter_staff.php` : une
 * fiche, pas un compte (« Gérer le personnel non-enseignant »). Ses quatre
 * rangées : Prénom / Nom, Fonction / Sexe, Téléphone / (vide), Salaire / Date
 * d'embauche (aujourd'hui) ; « Ajouter ». Le message monte en tête de page.
 */
export function StaffForm() {
  const [state, action, pending] = useActionMessage(addStaffAction);

  const aujourdhui = new Date().toISOString().slice(0, 10);

  return (
    <form action={action}>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="prenom">Prénom *</label>
          <input type="text" id="prenom" name="prenom" required />
        </div>
        <div className="form-group">
          <label htmlFor="nom">Nom *</label>
          <input type="text" id="nom" name="nom" required />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="fonction">Fonction *</label>
          <input type="text" id="fonction" name="fonction" placeholder="Agent de nettoyage, Gardien..." required />
        </div>
        <div className="form-group">
          <label htmlFor="sexe">Sexe</label>
          <select id="sexe" name="sexe" defaultValue="">
            <option value="">— Choisir —</option>
            <option value="M">Masculin</option>
            <option value="F">Féminin</option>
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="telephone">Téléphone</label>
          <input type="text" id="telephone" name="telephone" placeholder="+222 XX XX XX XX" />
        </div>
        <div className="form-group"></div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="salaire">Salaire mensuel (MRU) *</label>
          <input type="number" id="salaire" name="salaire" step={0.01} min={0} required />
        </div>
        <div className="form-group">
          <label htmlFor="date_embauche">Date d&apos;embauche *</label>
          <input type="date" id="date_embauche" name="date_embauche" defaultValue={aujourdhui} required />
        </div>
      </div>
      <div className="form-group">
        <label>Mois payés</label>
        <span className="text-muted" style={{ display: 'block', fontSize: '.85rem', marginBottom: '.4rem' }}>
          Les mois de l&apos;année où ce membre reçoit un salaire (un gardien : les douze ; une cantinière : ceux de l&apos;année scolaire). Tout coché par défaut.
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem .9rem' }}>
          {MOIS_NOMS.slice(1).map((nom, i) => (
            <label key={nom} style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontWeight: 400 }}>
              <input type="checkbox" name="mois_payes" value={i + 1} defaultChecked /> {nom}
            </label>
          ))}
        </div>
      </div>
      <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={pending}>Ajouter</button>
    </form>
  );
}

/** Son « Supprimer » par ligne : `confirm('Supprimer ?')`. La ligne disparaît : message publié au retour. */
export function SupprimerStaff({ staffId }: { staffId: string }) {
  const [, action, pending] = useActionMessage<{ ok?: string; error?: string }>(deleteStaffAction);
  return (
    <form
      action={action}
      style={{ display: 'inline' }}
      onSubmit={(e) => {
        if (!window.confirm('Supprimer ?')) e.preventDefault();
      }}
    >
      <input type="hidden" name="staff_id" value={staffId} />
      <button type="submit" className="btn btn-sm btn-danger" disabled={pending}>Supprimer</button>
    </form>
  );
}
