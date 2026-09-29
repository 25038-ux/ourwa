'use client';


import { createSubjectAction, setSubjectCoefficientAction, deleteSubjectAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';

type Result = { ok?: string; error?: string } | null;

/**
 * AJOUTER UNE MATIÈRE DANS « … » — `gerer_niveaux.php`, `creer_matiere` :
 * `niveau_id` caché, « Nom de la matière * » (« Ex: Mathématiques »),
 * « Coefficient * » (1 à 10, 1), et — sur un niveau fondamental seulement —
 * « Notée sur * (barème : 50, 30, 20…) » (1 à 99, pas de 0,5, 20).
 *
 * Le nom arabe est à nous : l'application des parents existe en arabe, et le
 * bulletin l'imprime à côté du nom français. Facultatif.
 */
export function SubjectForm({ level, showMaxScore }: { level: { id: string; name: string }; showMaxScore: boolean }) {
  const [state, action, pending] = useActionMessage(createSubjectAction);


  return (
    <form action={action}>
      <input type="hidden" name="levelId" value={level.id} />
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="nom_matiere">Nom de la matière *</label>
          <input type="text" id="nom_matiere" name="name" placeholder="Ex: Mathématiques" required />
        </div>
        <div className="form-group">
          <label htmlFor="coefficient">Coefficient *</label>
          <input type="number" id="coefficient" name="coefficient" min={1} max={10} defaultValue={1} required />
        </div>
        {showMaxScore && (
          <div className="form-group">
            <label htmlFor="note_sur">Notée sur * <small className="text-muted">(barème : 50, 30, 20…)</small></label>
            <input type="number" id="note_sur" name="maxScore" min={1} max={99} step={0.5} defaultValue={20} required />
          </div>
        )}
        <div className="form-group">
          <label htmlFor="nom_arabe">Nom en arabe</label>
          <input type="text" id="nom_arabe" name="nameAr" maxLength={80} dir="rtl" lang="ar" />
        </div>
      </div>
      <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={pending}>Ajouter la matière</button>
    </form>
  );
}

/** COEFFICIENT — `modifier_coef` : la boîte (1 à 10) et ✓. */
export function CoefficientCell({ subjectId, coefficient }: { subjectId: string; coefficient: number }) {
  const [state, action, pending] = useActionMessage(setSubjectCoefficientAction);


  return (
    <form action={action} style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem' }}>
      <input type="hidden" name="subjectId" value={subjectId} />
      <input
        type="number"
        name="coefficient"
        defaultValue={coefficient}
        min={1}
        max={10}
        style={{ width: 70, padding: '.3rem .5rem', border: '2px solid var(--border)', borderRadius: 8, textAlign: 'center' }}
      />
      <button type="submit" className="btn btn-sm btn-secondary" disabled={pending}>✓</button>
    </form>
  );
}

/** SUPPRIMER — `supprimer_matiere`, `confirm('Supprimer cette matière ?')`, sur une matière sans enseignement. */
export function DeleteSubjectForm({ subjectId }: { subjectId: string }) {
  const [state, action, pending] = useActionMessage(deleteSubjectAction);


  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm('Supprimer cette matière ?')) e.preventDefault();
      }}
      style={{ display: 'inline' }}
    >
      <input type="hidden" name="subjectId" value={subjectId} />
      <button type="submit" className="btn btn-sm btn-danger" disabled={pending}>Supprimer</button>
    </form>
  );
}
