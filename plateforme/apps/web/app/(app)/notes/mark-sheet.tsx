'use client';

import { useActionState, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { recordMarksAction, recordOwnMarksAction } from '@/app/actions';
import { useMessagePage } from '@/components/message-page';

interface Student {
  studentId: string;
  name: string;
  identifier?: string | null;
  coursework: Record<number, string>;
  exam: string | null;
}

const inputStyle = (w: number): React.CSSProperties => ({
  width: w, padding: '.35rem .4rem', border: '2px solid var(--border)', borderRadius: 8, textAlign: 'center', fontSize: '.9rem',
});

/**
 * SAISIE DES NOTES — la table de `saisir_notes.php` : #, Identifiant, Nom
 * complet, « Devoirs » (D1…Dn, « + Devoir » qui ajoute une colonne à toutes
 * les lignes, « × » qui en retire une et renumérote — son `ajouterDevoir` /
 * `supprimerDevoir`), « Examen /20 », « Moy. matière » recalculée à la frappe
 * (son `recalcMoy` : moy. devoirs × 0,4 + examen × 0,6, badge vert dès 10),
 * sa phrase de pied et « ✓ Enregistrer les notes ».
 *
 * Gardé : le barème de la matière comme plafond des cases (« Examen /20 »
 * reste son libellé) — il fige `max="20"` dans le formulaire alors que son
 * serveur accepte jusqu'à `note_sur` : sur un niveau fondamental noté /50, une
 * note de 35 serait refusée par le navigateur avant d'atteindre le serveur.
 * Et `min="-1"` au lieu de son `min="0"` : ses données portent 1 021 examens
 * à −1 (l'absence de l'ancien logiciel) ; une case qui en affiche un rend son
 * formulaire insoumissible.
 */
export function MarkSheet({
  teachingId,
  trimestre,
  maxScore,
  students,
  readOnly,
  espace = 'direction',
}: {
  teachingId: string;
  trimestre: number;
  maxScore: string;
  students: Student[];
  readOnly: boolean;
  /** `prof` : la feuille du professeur (ses enseignements seuls, `/prof/notes`). */
  espace?: 'direction' | 'prof';
}) {
  const [state, action, pending] = useActionState(
    espace === 'prof' ? recordOwnMarksAction : recordMarksAction,
    null as { error: string } | null,
  );

  // ⚠ LE REFUS ÉTAIT MUET : `state` n'était rendu nulle part. Une année
  // clôturée, une note hors barème, un professeur qui n'enseigne pas ici —
  // l'action rendait { error }, le bouton se rallumait, l'opérateur croyait
  // ses notes enregistrées. Le bandeau de page ET une alerte dans le formulaire.
  useMessagePage(state);
  // L'année consultée suit la feuille (le sélecteur d'en-tête l'écrit dans l'adresse).
  const anneeId = useSearchParams().get('annee_id') ?? '';

  const ceiling = Number(maxScore);

  // Son `$max_num` : la plus grande numérotation déjà enregistrée, au moins 1.
  const initialColumns = useMemo(
    () => Math.max(1, students.reduce((n, s) => Math.max(n, ...Object.keys(s.coursework).map(Number), 0), 0)),
    [students],
  );
  const [columns, setColumns] = useState(initialColumns);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const s of students) {
      for (const [n, v] of Object.entries(s.coursework)) seed[`${s.studentId}:d:${n}`] = v;
      if (s.exam !== null) seed[`${s.studentId}:e`] = s.exam;
    }
    return seed;
  });
  const set = (name: string, value: string) => setValues((v) => ({ ...v, [name]: value }));

  /** Son `recalcMoy()` : 0,4 / 0,6, valeurs hors 0..20 ignorées. */
  const moyenne = (studentId: string): number | null => {
    const devVals: number[] = [];
    for (let n = 1; n <= columns; n += 1) {
      const v = parseFloat(values[`${studentId}:d:${n}`] ?? '');
      if (!Number.isNaN(v) && v >= 0 && v <= 20) devVals.push(v);
    }
    const moyDev = devVals.length > 0 ? devVals.reduce((a, b) => a + b, 0) / devVals.length : null;
    const exVal = parseFloat(values[`${studentId}:e`] ?? '');
    const exam = !Number.isNaN(exVal) && exVal >= 0 && exVal <= 20 ? exVal : null;
    if (moyDev !== null && exam !== null) return moyDev * 0.4 + exam * 0.6;
    if (moyDev !== null) return moyDev;
    if (exam !== null) return exam;
    return null;
  };

  /** Son `supprimerDevoir` : la colonne disparaît, les suivantes se renumérotent. */
  const removeColumn = (n: number) => {
    setValues((v) => {
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(v)) {
        const m = /^(.+):d:(\d+)$/.exec(key);
        if (!m) { next[key] = value; continue; }
        const num = Number(m[2]);
        if (num === n) continue;
        next[`${m[1]}:d:${num > n ? num - 1 : num}`] = value;
      }
      return next;
    });
    setColumns((c) => Math.max(1, c - 1));
  };

  return (
    <form action={action} id="form-notes">
      <input type="hidden" name="enseignement_id" value={teachingId} />
      <input type="hidden" name="trimestre" value={trimestre} />
      {anneeId && <input type="hidden" name="annee_id" value={anneeId} />}
      {state?.error && (
        <div className="alert alert-error" role="alert">{state.error}</div>
      )}

      <div className="overflow-x">
        <table id="table-notes">
          <thead>
            <tr id="thead-row">
              <th>#</th>
              <th>Identifiant</th>
              <th>Nom complet</th>
              <th id="devoirs-header" style={{ background: 'rgba(198,113,57,.08)', minWidth: 280 }}>
                Devoirs
                {!readOnly && (
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setColumns((c) => c + 1)} style={{ marginLeft: '.5rem', padding: '.2rem .6rem', fontSize: '.75rem' }}>
                    + Devoir
                  </button>
                )}
                <span id="nb-devoirs-badge" style={{ fontSize: '.7rem', color: '#888', marginLeft: '.3rem' }}>{columns} devoir(s)</span>
              </th>
              <th style={{ background: 'rgba(245,158,11,.08)' }}>Examen /20</th>
              <th>Moy. matière</th>
            </tr>
          </thead>
          <tbody id="tbody-notes">
            {students.map((s, i) => {
              const moy = moyenne(s.studentId);
              return (
                <tr key={s.studentId} data-etudiant={s.studentId}>
                  <td>{i + 1}</td>
                  <td><strong>{s.identifier ?? ''}</strong></td>
                  <td>{s.name}</td>
                  <td style={{ background: 'rgba(198,113,57,.03)' }}>
                    <div className="devoirs-container" style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', alignItems: 'center' }}>
                      {Array.from({ length: columns }, (_, k) => k + 1).map((n) => {
                        const name = `${s.studentId}:d:${n}`;
                        return (
                          <div key={n} className="devoir-item" style={{ display: 'flex', alignItems: 'center', gap: '.2rem' }}>
                            <span style={{ fontSize: '.7rem', color: '#888' }}>D{n}</span>
                            <input
                              type="number"
                              name={`devoirs[${s.studentId}][]`}
                              value={values[name] ?? ''}
                              min={-1}
                              max={ceiling}
                              step={0.25}
                              placeholder="—"
                              className="note-input devoir-input"
                              style={inputStyle(70)}
                              onChange={(e) => set(name, e.target.value)}
                              readOnly={readOnly}
                            />
                            {!readOnly && n > 1 && (
                              <button type="button" onClick={() => removeColumn(n)} style={{ background: 'none', border: 'none', color: '#a8341f', cursor: 'pointer', padding: '.2rem', fontSize: '.9rem' }} title="Supprimer ce devoir">×</button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </td>
                  <td style={{ background: 'rgba(245,158,11,.03)' }}>
                    <input
                      type="number"
                      name={`examens[${s.studentId}]`}
                      value={values[`${s.studentId}:e`] ?? ''}
                      min={-1}
                      max={ceiling}
                      step={0.25}
                      placeholder="—"
                      className="note-input examen-input"
                      style={inputStyle(80)}
                      onChange={(e) => set(`${s.studentId}:e`, e.target.value)}
                      readOnly={readOnly}
                    />
                  </td>
                  <td>
                    <span className={`moy-display badge ${moy === null ? '' : moy >= 10 ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '.85rem' }}>
                      {moy === null ? '—' : moy.toFixed(2)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', margin: 0 }}>
          Les moyennes affichées sont indicatives et recalculées en temps réel.<br />
          <strong>Formule :</strong> Moy = (Moy.Devoirs × 0.4) + (Examen × 0.6)
        </p>
        {!readOnly && (
          <button type="submit" className="btn btn-success" disabled={pending}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="18" height="18"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
            Enregistrer les notes
          </button>
        )}
      </div>
    </form>
  );
}
