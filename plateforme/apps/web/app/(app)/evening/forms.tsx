'use client';

import { useActionMessage } from '@/components/message-page';

import { createEveningGroupAction } from '@/app/actions';

/**
 * Enrol into an evening group.
 *
 * Two genuinely different things behind one form: an existing student, or a
 * person who is not one. The choice is explicit rather than inferred, because
 * getting it wrong would either invent a student record for a walk-in adult or
 * fail to link a real pupil to their own family.
 */

/** « Nouveau groupe de cours du soir » — son `creer_groupe`. */
export function NouveauGroupeForm() {
  const [state, action] = useActionMessage(createEveningGroupAction);


  return (
    <div className="form-card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginTop: 0 }}>Nouveau groupe de cours du soir</h3>
      <form action={action}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="form-group"><label>Nom du groupe *</label><input type="text" name="name" required placeholder="ex: Renforcement Maths 3ème, دعم الرياضيات…" /></div>
          <div className="form-group"><label>Tarif mensuel (MRU) *</label><input type="number" name="monthlyRate" min={0} step={0.01} required /></div>
        </div>
        <div className="form-group"><label>Description</label><input type="text" name="description" /></div>
        <button className="btn btn-primary">Créer le groupe</button>
      </form>
    </div>
  );
}
