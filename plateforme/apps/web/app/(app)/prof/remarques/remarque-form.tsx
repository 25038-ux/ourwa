'use client';


import { addRemarkAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';

type Result = { ok?: string; error?: string } | null;

/**
 * Son formulaire `form-card` (max-width 680) : « Élève * » (« — Choisir — »,
 * « Prénom Nom (Groupe) »), « Type de remarque » (Information / Positif /
 * félicitations / Avertissement / Grave — ses valeurs), « Remarque * » (5
 * lignes), « 📝 Envoyer la remarque ».
 */
export function RemarqueForm({
  eleves,
  academicYearId,
}: {
  eleves: { id: string; first_name: string; last_name: string; group_name: string }[];
  academicYearId: string;
}) {
  const [state, action, pending] = useActionMessage(addRemarkAction);


  return (
    <form action={action} className="form-card" style={{ maxWidth: 680 }}>
      <input type="hidden" name="academicYearId" value={academicYearId} />
      <div className="form-group">
        <label>Élève *</label>
        <select name="etudiant_id" required defaultValue="">
          <option value="">— Choisir —</option>
          {eleves.map((el) => (
            <option key={el.id} value={el.id}>{el.first_name} {el.last_name} ({el.group_name})</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Type de remarque</label>
        <select name="gravite" defaultValue="info">
          <option value="info">Information</option>
          <option value="positif">Positif / félicitations</option>
          <option value="avertissement">Avertissement</option>
          <option value="grave">Grave</option>
        </select>
      </div>
      <div className="form-group"><label>Remarque *</label><textarea name="contenu" rows={5} required /></div>
      <button className="btn btn-primary" disabled={pending}>📝 Envoyer la remarque</button>
    </form>
  );
}
