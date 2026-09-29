'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

export interface CascadeLevel {
  id: string;
  name: string;
}

export interface CascadeGroup {
  id: string;
  name: string;
  levelId: string | null;
}

export interface CascadeTeaching {
  id: string;
  subject: string;
  groupId: string;
}

/**
 * NIVEAU → GROUPE → MATIÈRE — `saisir_notes.php` : `filtrerGroupes()` et
 * `filtrerEnseignements()` sur `GROUPES` et `ENSEIGNEMENTS` (de l'année
 * consultée — « chaque matière apparaissait DEUX FOIS dans la liste »),
 * « Trimestre * » (1er / 2ème / 3ème), « Charger les étudiants ».
 */
export function NiveauGroupeMatiere({
  levels,
  groups,
  teachings,
  selectedLevel,
  selectedGroup,
  selectedTeaching,
  trimestre,
}: {
  levels: CascadeLevel[];
  groups: CascadeGroup[];
  teachings: CascadeTeaching[];
  selectedLevel: string;
  selectedGroup: string;
  selectedTeaching: string;
  trimestre: number;
}) {
  const anneeId = useSearchParams().get('annee_id') ?? '';
  const [levelId, setLevelId] = useState(selectedLevel);
  const [groupId, setGroupId] = useState(selectedGroup);
  const [ensId, setEnsId] = useState(selectedTeaching);

  const visibleGroups = groups.filter((g) => g.levelId === levelId);
  const visibleTeachings = teachings.filter((t) => t.groupId === groupId);

  return (
    <div className="form-card" style={{ maxWidth: '100%' }}>
      <h3>Sélectionner le niveau, le groupe, la matière et le trimestre</h3>
      <form method="GET" id="form-selection">
        {/* L'année consultée, sinon la feuille retombait sur l'année par défaut. */}
        {anneeId && <input type="hidden" name="annee_id" value={anneeId} />}
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="niveau_id">Niveau *</label>
            <select
              id="niveau_id"
              name="niveau_id"
              required
              value={levelId}
              onChange={(e) => {
                setLevelId(e.target.value);
                // Son `filtrerGroupes()` appelle `filtrerEnseignements()` : le groupe et la matière retombent.
                setGroupId('');
                setEnsId('');
              }}
            >
              <option value="">— Choisir —</option>
              {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="groupe_id">Groupe *</label>
            <select
              id="groupe_id"
              name="groupe_id"
              required
              value={groupId}
              onChange={(e) => {
                setGroupId(e.target.value);
                setEnsId('');
              }}
            >
              <option value="">{levelId ? '— Choisir —' : "— Choisir un niveau d'abord —"}</option>
              {visibleGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="enseignement_id">Matière *</label>
            <select id="enseignement_id" name="enseignement_id" required value={ensId} onChange={(e) => setEnsId(e.target.value)}>
              <option value="">{groupId ? '— Choisir —' : "— Choisir un groupe d'abord —"}</option>
              {visibleTeachings.map((t) => <option key={t.id} value={t.id}>{t.subject}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="trimestre">Trimestre *</label>
            <select id="trimestre" name="trimestre" required defaultValue={String(trimestre)}>
              <option value="1">1er trimestre</option>
              <option value="2">2ème trimestre</option>
              <option value="3">3ème trimestre</option>
            </select>
          </div>
        </div>
        <button type="submit" className="btn btn-secondary">Charger les étudiants</button>
      </form>
    </div>
  );
}
