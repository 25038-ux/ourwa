'use client';

import { useState } from 'react';
import { enregistrerAppelAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';

export interface Etudiant {
  id: string;
  prenom: string;
  nom: string;
  matricule: string | null;
  /** `null` : rien de saisi — la case « Présent » est alors cochée, comme chez lui. */
  statut: 'present' | 'absent' | 'late' | null;
}

type Result = { ok?: string; error?: string } | null;

/**
 * LA FEUILLE D'APPEL DE `gerer_absence.php` : « Appel du jj/mm/aaaa — N
 * étudiant(s) », « Tous présents » / « Tous absents » (son `tous(val)`), la
 * table Étudiant · Matricule · Présent · Absent · Retard à un bouton radio par
 * colonne, et « Enregistrer l'appel & notifier les parents ». Le message
 * remonte en haut de page.
 */
export function Appel({
  groupeId,
  dateAbs,
  dateFr,
  academicYearId,
  enseignementId,
  etudiants,
  readOnly,
}: {
  groupeId: string;
  dateAbs: string;
  dateFr: string;
  academicYearId: string;
  enseignementId: string;
  etudiants: Etudiant[];
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionMessage(enregistrerAppelAction);


  const initial = (liste: Etudiant[]) =>
    Object.fromEntries(liste.map((e) => [e.id, e.statut === 'late' ? 'retard' : (e.statut ?? 'present')]));
  const [statuts, setStatuts] = useState<Record<string, string>>(() => initial(etudiants));
  // Sa page se rend à nouveau après le POST : la feuille repart de ce qui est
  // enregistré. Les élèves arrivent du serveur à chaque rendu ; quand ils
  // changent, les cases suivent.
  const [source, setSource] = useState(etudiants);
  if (source !== etudiants) {
    setSource(etudiants);
    setStatuts(initial(etudiants));
  }
  // React remet le formulaire à ses valeurs par défaut après l'action ; la
  // signature de ce qui est enregistré recrée le formulaire à jour.
  const signature = etudiants.map((e) => `${e.id}:${e.statut ?? ''}`).join('|');
  const tous = (val: string) => setStatuts(Object.fromEntries(etudiants.map((e) => [e.id, val])));

  return (
    <form key={signature} action={action} className="form-card">
      <input type="hidden" name="groupe_id" value={groupeId} />
      <input type="hidden" name="date_abs" value={dateAbs} />
      <input type="hidden" name="academicYearId" value={academicYearId} />
      <input type="hidden" name="enseignement_id" value={enseignementId} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0 }}>Appel du {dateFr} — {etudiants.length} étudiant(s)</h3>
        {!readOnly && (
          <div style={{ display: 'flex', gap: '.5rem' }}>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => tous('present')}>Tous présents</button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => tous('absent')}>Tous absents</button>
          </div>
        )}
      </div>
      <div className="table-responsive">
        <table className="data-table">
          <thead><tr><th>Étudiant</th><th>Matricule</th><th>Présent</th><th>Absent</th><th>Retard</th></tr></thead>
          <tbody>
            {etudiants.map((e) => {
              const cur = statuts[e.id] ?? 'present';
              return (
                <tr key={e.id}>
                  <td><strong>{e.prenom} {e.nom}</strong></td>
                  <td>{e.matricule ?? ''}</td>
                  {(['present', 'absent', 'retard'] as const).map((val) => (
                    <td key={val} style={{ textAlign: 'center' }}>
                      <input
                        type="radio"
                        name={`statut[${e.id}]`}
                        value={val}
                        checked={cur === val}
                        disabled={readOnly}
                        onChange={() => setStatuts((prev) => ({ ...prev, [e.id]: val }))}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <div style={{ marginTop: '1.5rem' }}>
          <button className="btn btn-primary" disabled={pending}>Enregistrer l&apos;appel &amp; notifier les parents</button>
        </div>
      )}
    </form>
  );
}
