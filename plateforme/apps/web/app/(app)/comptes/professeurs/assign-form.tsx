'use client';

import { useState } from 'react';
import { assignTeachingAction, carryForwardTeachingsAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';

export interface Prof {
  id: string;
  name: string;
  /** "permanent" ou "interim" — décide si le taux est demandé (son `majTauxAssignation()`). */
  employment: string;
}

export interface Niveau {
  id: string;
  name: string;
}

export interface Groupe {
  id: string;
  name: string;
  levelId: string | null;
  levelName: string | null;
}

export interface Matiere {
  id: string;
  name: string;
  levelId: string;
}

/**
 * NOUVELLE ASSIGNATION — son formulaire `assigner` : « Sélectionnez d'abord un
 * Niveau, puis la Matière de ce niveau sera chargée automatiquement. » Le
 * professeur, puis Niveau / Matière (désactivée tant qu'aucun niveau), puis
 * Groupe (les groupes du niveau choisi — son `chargerMatieres()` masque les
 * autres) / Heures par semaine, et pour un intérimaire la case « Taux horaire
 * de cette assignation (MRU/h) * ».
 */
export function AssignForm({
  profs,
  niveaux,
  groupes,
  matieres,
  academicYearId,
  yearLabel,
}: {
  profs: Prof[];
  niveaux: Niveau[];
  groupes: Groupe[];
  matieres: Matiere[];
  academicYearId: string;
  yearLabel: string;
}) {
  const [state, action, pending] = useActionMessage(assignTeachingAction);

  const [carryState, carryAction, carrying] = useActionMessage(carryForwardTeachingsAction);


  const [profId, setProfId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [groupId, setGroupId] = useState('');

  const prof = profs.find((p) => p.id === profId);
  const estInterim = prof?.employment === 'interim';
  const matieresDuNiveau = levelId ? matieres.filter((m) => m.levelId === levelId) : [];

  return (
    <>
      <div className="form-card">
        <h3>Nouvelle assignation</h3>
        <p className="text-muted" style={{ marginBottom: '1rem', fontSize: '.9rem' }}>
          Sélectionnez d&apos;abord un <strong>Niveau</strong>, puis la <strong>Matière</strong> de ce niveau sera chargée automatiquement.
        </p>
        {/* Son `novalidate` : les refus sont ceux du serveur. (React ne lance pas
            l'action d'un formulaire dont un champ `required` est vide, même sous
            noValidate — les `required` sont donc absents et l'action répond.) */}
        <form action={action} noValidate>
          <input type="hidden" name="academicYearId" value={academicYearId} />
          <div className="form-group">
            <label htmlFor="professeur_id">Professeur *</label>
            <select id="professeur_id" name="professeur_id" value={profId} onChange={(e) => setProfId(e.target.value)}>
              <option value="">— Sélectionner —</option>
              {profs.map((p) => (
                <option key={p.id} value={p.id} data-situation={p.employment}>
                  {p.name} {p.employment === 'interim' ? '— Intérimaire' : '— Permanent'}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="assign_niveau_id">Niveau *</label>
              <select
                id="assign_niveau_id"
                name="assign_niveau_id"
                value={levelId}
                onChange={(e) => { setLevelId(e.target.value); setGroupId(''); }}
              >
                <option value="">— Sélectionner un niveau —</option>
                {niveaux.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="matiere_id">Matière *</label>
              <select id="matiere_id" name="matiere_id" disabled={!levelId || matieresDuNiveau.length === 0} defaultValue="">
                {!levelId || matieresDuNiveau.length === 0 ? (
                  <option value="">— Sélectionnez d&apos;abord un niveau —</option>
                ) : (
                  <>
                    <option value="">— Sélectionner une matière —</option>
                    {matieresDuNiveau.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </>
                )}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="groupe_id">Groupe *</label>
              <select id="groupe_id" name="groupe_id" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">— Sélectionner —</option>
                {groupes.map((g) => (
                  <option
                    key={g.id}
                    value={g.id}
                    data-niveau={g.levelId ?? ''}
                    // Son filtre : les groupes des autres niveaux sont masqués, pas retirés.
                    style={levelId && g.levelId !== levelId ? { display: 'none' } : undefined}
                  >
                    {g.name} ({g.levelName ?? '—'})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="heures_par_semaine">Heures / semaine *</label>
              <input type="number" id="heures_par_semaine" name="heures_par_semaine" min={0.5} max={40} step={0.5} placeholder="ex. 4" />
            </div>
          </div>
          <div className="form-group" id="taux_assignation_box" style={{ display: estInterim ? undefined : 'none' }}>
            <label htmlFor="prix_par_heure_assignation">Taux horaire de cette assignation (MRU/h) *</label>
            <input
              type="number"
              id="prix_par_heure_assignation"
              name="prix_par_heure_assignation"
              min={0}
              step={50}
              placeholder="ex. 5000 pour 7D, 2000 pour 1AS"
              disabled={!estInterim}
            />
            <small className="text-muted">Professeur intérimaire : le salaire dépend du niveau enseigné, chaque assignation a son propre taux horaire.</small>
          </div>
          <button type="submit" className="btn btn-primary" disabled={pending}>Assigner</button>
        </form>
      </div>

      {/* ── Reporter les affectations ───────────────────────────────────────
          Son action `reporter_affectations` existe, avec son raisonnement et son
          message, mais rien chez lui ne poste vers elle. Elle est gardée ici
          (décision antérieure, ADR) : sans elle une année neuve n'a aucune
          affectation et « Saisir les notes » n'a rien à proposer. */}
      {academicYearId && (
        <div className="form-card" style={{ borderLeft: '3px solid #B45309' }}>
          <h3 style={{ marginTop: 0 }}>Reporter les affectations sur {yearLabel}</h3>
          <p className="text-muted" style={{ fontSize: '.85rem' }}>
            Une année scolaire neuve n&apos;a aucune affectation professeur × classe × matière : c&apos;est normal, elles sont datées.
            Mais tant qu&apos;elles n&apos;existent pas, « Saisir les notes » n&apos;a aucune matière à proposer et l&apos;écran paraît cassé.
            On les reporte depuis la dernière année qui en possède. Aucune matière n&apos;est dupliquée : seules les lignes d&apos;affectation sont recréées.
          </p>
          <form action={carryAction}>
            <input type="hidden" name="academicYearId" value={academicYearId} />
            <input type="hidden" name="cible_libelle" value={yearLabel} />
            <button className="btn btn-secondary" style={{ width: 'auto' }} disabled={carrying}>Reporter les affectations</button>
          </form>
        </div>
      )}
    </>
  );
}
