'use client';

import { useState } from 'react';
import { creerUtilisateurAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';

/**
 * NOUVEL UTILISATEUR — le formulaire de `creer_utilisateur.php`, champ pour
 * champ et dans son ordre : Identifiant / Mot de passe (avec l'œil), Rôle,
 * les rôles supplémentaires (ni professeur ni administrateur), Situation /
 * Salaire / Tarif horaire (professeur), Niveau d'accès (administrateur),
 * Nom / Prénom, Téléphone, Sexe, Fonction (administrateur restreint).
 * `novalidate` : ce sont ses refus qui répondent, en tête de page.
 */
export function FormulaireCreerUtilisateur() {
  const [state, action, pending] = useActionMessage(creerUtilisateurAction);

  const [role, setRole] = useState('');
  const [situation, setSituation] = useState<'permanent' | 'interim'>('permanent');
  const [palier, setPalier] = useState<'restreint' | 'complet'>('restreint');
  const [voirMdp, setVoirMdp] = useState(false);

  const isAdmin = role === 'admin';
  const isProf = role === 'professeur';
  const cumulPossible = !isProf && !isAdmin && role !== '';

  return (
    <form action={action} id="form-creer-utilisateur" noValidate>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="identifiant">Identifiant *</label>
          <input type="text" id="identifiant" name="identifiant" placeholder="user@supnum.mr" />
          <span className="field-error" id="err-identifiant"></span>
        </div>
        <div className="form-group">
          <label htmlFor="mot_de_passe">Mot de passe *</label>
          <div style={{ position: 'relative' }}>
            <input type={voirMdp ? 'text' : 'password'} id="mot_de_passe" name="mot_de_passe" placeholder="Minimum 6 caractères" style={{ paddingRight: '3rem' }} />
            <button
              type="button"
              className={`toggle-mdp${voirMdp ? ' shown' : ''}`}
              id="toggle-mdp-creer"
              aria-label="Afficher/masquer le mot de passe"
              tabIndex={-1}
              onClick={() => setVoirMdp((v) => !v)}
              style={{ position: 'absolute', right: '.75rem', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '.4rem', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={18} height={18}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
          <span className="field-error" id="err-mot_de_passe"></span>
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="role">Rôle *</label>
        <select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">— Sélectionner un rôle —</option>
          <option value="professeur">Professeur</option>
          <option value="admin">Administrateur</option>
          <option value="collecteur_absence">Collecteur d&apos;absence</option>
          <option value="secretaire">Secrétaire (saisie des notes uniquement)</option>
          <option value="comptable">Comptable (finances uniquement)</option>
        </select>
        <span className="field-error" id="err-role"></span>
      </div>

      {/* « Administrateur » ne figure pas ici : ce rôle englobe déjà les autres. */}
      <div className={`form-group${cumulPossible ? '' : ' hidden'}`} id="champ-roles-sup">
        <label>Rôles supplémentaires — le compte cumule leurs permissions</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(13rem,1fr))', gap: '.5rem' }}>
          {[
            ['comptable', 'Comptable — caisse, dépenses, dettes'],
            ['secretaire', 'Secrétaire — inscriptions, notes'],
            ['collecteur_absence', "Collecteur d'absence — appel"],
          ].map(([rc, lib]) => {
            const meme = rc === role;
            return (
              <label
                key={rc}
                className="st-check"
                style={{ display: 'flex', gap: '.55rem', alignItems: 'flex-start', padding: '.55rem .7rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', opacity: meme ? 0.45 : 1 }}
                title={meme ? 'Déjà choisi comme rôle principal' : ''}
              >
                <input type="checkbox" name="roles_sup[]" value={rc} disabled={meme || !cumulPossible} style={{ width: 'auto', marginTop: '.15rem' }} />
                <span style={{ fontSize: '.85rem' }}>{lib}</span>
              </label>
            );
          })}
        </div>
        <small className="text-muted">Le rôle principal ci-dessus décide de la page d&apos;accueil. Les rôles cochés s&apos;y ajoutent.</small>
      </div>

      <div className={`form-group${isProf ? '' : ' hidden'}`} id="champ-situation">
        <label htmlFor="situation">Situation *</label>
        <select id="situation" name="situation" value={situation} onChange={(e) => setSituation(e.target.value as 'permanent' | 'interim')} disabled={!isProf}>
          <option value="permanent">Permanent</option>
          <option value="interim">Interim</option>
        </select>
      </div>

      <div className={`form-group${isProf && situation === 'permanent' ? '' : ' hidden'}`} id="champ-salaire">
        <label htmlFor="salaire">Salaire mensuel (MRU) *</label>
        <input type="number" step={0.01} id="salaire" name="salaire" defaultValue={0} disabled={!(isProf && situation === 'permanent')} />
      </div>

      <div className={`form-group${isProf && situation === 'interim' ? '' : ' hidden'}`} id="champ-prix-heure">
        <label htmlFor="prix_par_heure">Tarif horaire (MRU/h) *</label>
        <input type="number" step={0.01} id="prix_par_heure" name="prix_par_heure" defaultValue={0} disabled={!(isProf && situation === 'interim')} />
      </div>

      <div className={`form-group${isAdmin ? '' : ' hidden'}`} id="champ-palier">
        <label htmlFor="palier_admin">Niveau d&apos;accès de l&apos;administrateur *</label>
        <select id="palier_admin" name="palier_admin" value={palier} onChange={(e) => setPalier(e.target.value as 'restreint' | 'complet')} disabled={!isAdmin}>
          <option value="restreint">Administrateur — accès complet SAUF la finance</option>
          <option value="complet">Super Administrateur — accès TOTAL (finance incluse)</option>
        </select>
        <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '.35rem' }}>
          « Super Administrateur » voit tout, y compris la Gestion de Caisse et les Dépenses.
          « Administrateur » gère tout le reste mais n&apos;accède pas aux pages financières.
        </small>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label htmlFor="nom">Nom *</label>
          <input type="text" id="nom" name="nom" />
          <span className="field-error" id="err-nom"></span>
        </div>
        <div className="form-group">
          <label htmlFor="prenom">Prénom *</label>
          <input type="text" id="prenom" name="prenom" />
          <span className="field-error" id="err-prenom"></span>
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="telephone">Téléphone</label>
        <input type="text" id="telephone" name="telephone" placeholder="+222 XX XX XX XX" />
        <span className="field-error" id="err-telephone"></span>
      </div>

      <div className="form-group">
        <label htmlFor="sexe">Sexe</label>
        <select id="sexe" name="sexe" defaultValue="">
          <option value="">— Choisir —</option>
          <option value="M">Masculin</option>
          <option value="F">Féminin</option>
        </select>
      </div>

      {/* « Le champ fonction libre n'a de sens que pour un admin restreint. » */}
      <div className={`form-group${isAdmin && palier === 'restreint' ? '' : ' hidden'}`} id="champ-fonction">
        <label htmlFor="fonction">Fonction</label>
        <input type="text" id="fonction" name="fonction" placeholder="Ex: Secrétaire, Comptable..." disabled={!(isAdmin && palier === 'restreint')} />
      </div>

      <button type="submit" className="btn btn-primary" disabled={pending}>Créer l&apos;utilisateur</button>
    </form>
  );
}
