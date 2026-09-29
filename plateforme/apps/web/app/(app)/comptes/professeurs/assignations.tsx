'use client';


import { removeTeachingAction, updateTeachingAction } from '@/app/actions';
import { useActionMessage, useMessagePage } from '@/components/message-page';

type Result = { ok?: string; error?: string } | null;

export interface Assignation {
  id: string;
  teacherName: string;
  employment: string | null;
  levelName: string | null;
  groupName: string | null;
  subject: string;
  hoursPerWeek: string | null;
  /** Absent pour qui ne peut pas voir la paie ; NULL = le taux du professeur. */
  hourlyRate?: string | null;
  teacherRate?: string | null;
  monthlyCost?: string;
}

/** Son `number_format($x, 0, ',', ' ')`. */
function mru(v: string | number): string {
  return String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * HEURES/SEM · TAUX — son formulaire `modifier_heures` par ligne : les heures
 * (0.5–40, pas 0.5), le taux de l'assignation pour un intérimaire (vide = taux
 * par défaut du professeur, bordure ambrée), « ✓ », puis « Taux appliqué ».
 */
function EditRow({ a }: { a: Assignation }) {
  const [state, action, pending] = useActionMessage(updateTeachingAction);

  const estInterim = (a.employment ?? 'permanent') === 'interim';
  const tauxEffectif = a.hourlyRate !== null && a.hourlyRate !== undefined ? Number(a.hourlyRate) : Number(a.teacherRate ?? 0);

  return (
    <>
      <form action={action} style={{ display: 'flex', gap: '.3rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="hidden" name="teachingId" value={a.id} />
        <input
          type="number"
          name="hoursPerWeek"
          defaultValue={a.hoursPerWeek ? String(Number(a.hoursPerWeek)) : ''}
          min={0.5}
          max={40}
          step={0.5}
          title="Heures par semaine"
          style={{ width: 70, padding: '.35rem .5rem', border: '2px solid var(--border)', borderRadius: 6, fontSize: '.85rem' }}
        />
        {estInterim ? (
          <input
            type="number"
            name="hourlyRate"
            defaultValue={a.hourlyRate !== null && a.hourlyRate !== undefined ? String(Number(a.hourlyRate)) : ''}
            min={0}
            step={50}
            placeholder={`${Number(a.teacherRate ?? 0)} (défaut)`}
            title="Taux horaire de cette assignation (MRU/h) — vide = taux par défaut du professeur"
            style={{ width: 100, padding: '.35rem .5rem', border: '2px solid #c98a12', borderRadius: 6, fontSize: '.85rem' }}
          />
        ) : (
          <input type="hidden" name="hourlyRate" value={a.hourlyRate !== null && a.hourlyRate !== undefined ? String(Number(a.hourlyRate)) : ''} />
        )}
        <button type="submit" className="btn btn-sm btn-secondary" style={{ padding: '.3rem .6rem' }} disabled={pending}>✓</button>
      </form>
      {estInterim && (
        <small style={{ color: '#92400E', fontWeight: 600 }}>Taux appliqué : {mru(tauxEffectif)} MRU/h</small>
      )}
    </>
  );
}

/** Son `supprimer_assignation` — `confirm('Supprimer ?')`, « Assignation supprimée. » */
function RemoveRow({ a }: { a: Assignation }) {
  // La ligne disparaît avec la suppression : le message est publié au retour.
  const [, action, pending] = useActionMessage<NonNullable<Result>>(removeTeachingAction);
  return (
    <form
      action={action}
      style={{ display: 'inline' }}
      onSubmit={(e) => {
        if (!window.confirm('Supprimer ?')) e.preventDefault();
      }}
    >
      <input type="hidden" name="teachingId" value={a.id} />
      <button type="submit" className="btn btn-sm btn-danger" disabled={pending}>Supprimer</button>
    </form>
  );
}

/**
 * ASSIGNATIONS EXISTANTES — sa seconde table : Professeur / Niveau / Groupe /
 * Matière / « Heures/sem · Taux (MRU/h) » / Coût mensuel (heures × 4 × taux
 * effectif, sur chaque ligne) / Actions.
 */
export function AssignationsExistantes({ assignations }: { assignations: Assignation[] }) {
  return (
    <div className="table-container">
      <div className="table-header">
        <h3>Assignations existantes</h3>
        <span className="badge badge-primary">{assignations.length}</span>
      </div>
      <div className="overflow-x">
        <table>
          <thead>
            <tr><th>Professeur</th><th>Niveau</th><th>Groupe</th><th>Matière</th><th>Heures/sem · Taux (MRU/h)</th><th>Coût mensuel</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {assignations.map((a) => {
              const tauxEffectif = a.hourlyRate !== null && a.hourlyRate !== undefined ? Number(a.hourlyRate) : Number(a.teacherRate ?? 0);
              const cout = Number(a.hoursPerWeek ?? 0) * 4 * tauxEffectif;
              return (
                <tr key={a.id}>
                  <td><strong>{a.teacherName !== '' ? a.teacherName : <span className="text-muted">—</span>}</strong></td>
                  <td><span className="badge badge-primary">{a.levelName ?? '—'}</span></td>
                  <td>{a.groupName}</td>
                  <td>{a.subject}</td>
                  <td><EditRow a={a} /></td>
                  <td>{a.monthlyCost === undefined ? <span className="text-muted">—</span> : `${mru(cout)} MRU`}</td>
                  <td><RemoveRow a={a} /></td>
                </tr>
              );
            })}
            {assignations.length === 0 && (
              <tr><td colSpan={7} className="text-center text-muted">Aucune assignation.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
