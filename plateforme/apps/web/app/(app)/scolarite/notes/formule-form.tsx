'use client';

import { useState } from 'react';
import { setFormulaAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';

interface Level {
  id: string;
  name: string;
}

type Terms = Record<number, { courseworkWeight: string; examWeight: string; divisor: string }>;

/** Son `(float)` : 2.00 s'affiche « 2 ». */
function coef(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : value;
}

/**
 * FORMULE DE CALCUL DES BULLETINS — `notes_etudiants.php`, `config_formule` :
 * son paragraphe, « Niveau * » dont le changement recharge les trois lignes
 * depuis `FORMULES_NIVEAUX` (2 / 3 / 5 à défaut), la table A / B / C, et
 * « Enregistrer la formule de ce niveau ». Le message remonte en haut.
 */
export function FormuleForm({ levels, formulas }: { levels: Level[]; formulas: Record<string, Terms> }) {
  const [levelId, setLevelId] = useState('');
  const [state, action, pending] = useActionMessage(setFormulaAction);


  const f = (t: number): [string, string, string] => {
    const x = formulas[levelId]?.[t];
    return x ? [coef(x.courseworkWeight), coef(x.examWeight), coef(x.divisor)] : ['2', '3', '5'];
  };

  return (
    <div className="form-card" style={{ maxWidth: '100%', marginBottom: '1.5rem' }}>
      <h3 style={{ marginTop: 0 }}>Formule de calcul des bulletins — par niveau et par trimestre</h3>
      <p className="text-muted" style={{ fontSize: '.85rem' }}>
        Moyenne d&apos;une matière = <strong>(moyenne des devoirs × A + examen × B) ÷ C</strong>.
        Chaque niveau et chaque trimestre peut avoir sa propre formule.
        La moyenne du trimestre reste : Σ (moyenne de matière × coefficient de la matière) ÷ Σ (coefficients).
        Par défaut : A = 2, B = 3, C = 5 (soit 40 % devoirs / 60 % examen).
      </p>
      <form action={action}>
        <div className="form-group" style={{ maxWidth: 340 }}>
          <label>Niveau *</label>
          <select name="levelId" id="bf_niveau" required value={levelId} onChange={(e) => setLevelId(e.target.value)}>
            <option value="">— Choisir un niveau —</option>
            {levels.map((nv) => (
              <option key={nv.id} value={nv.id}>{nv.name}</option>
            ))}
          </select>
        </div>
        <div className="overflow-x">
          <table style={{ maxWidth: 640 }}>
            <thead><tr><th>Trimestre</th><th>A — Coef. moy. devoirs</th><th>B — Coef. examen</th><th>C — Diviseur</th></tr></thead>
            <tbody>
              {[1, 2, 3].map((t) => {
                const [d, e, q] = f(t);
                return (
                  <tr key={`${levelId}-${t}`}>
                    <td><strong>{t}<sup>{t === 1 ? 'er' : 'e'}</sup></strong></td>
                    <td><input type="number" name={`coursework_${t}`} id={`bf_d_${t}`} min={0} step={0.5} defaultValue={d} required style={{ width: 110 }} /></td>
                    <td><input type="number" name={`exam_${t}`} id={`bf_e_${t}`} min={0} step={0.5} defaultValue={e} required style={{ width: 110 }} /></td>
                    <td><input type="number" name={`divisor_${t}`} id={`bf_q_${t}`} min={0.5} step={0.5} defaultValue={q} required style={{ width: 110 }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button className="btn btn-primary" style={{ width: 'auto', marginTop: '.6rem' }} disabled={pending}>Enregistrer la formule de ce niveau</button>
      </form>
    </div>
  );
}
