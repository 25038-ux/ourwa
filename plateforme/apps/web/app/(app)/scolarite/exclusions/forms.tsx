'use client';


import { liftExpulsionAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';

/**
 * ✓ Débloquer — `expelled.php`, `debloquer` : `confirm('Débloquer cet
 * étudiant ? Il pourra à nouveau être inscrit.')`, puis le message en haut.
 */
export function LiftForm({ expulsionId }: { expulsionId: string }) {
  const [state, action, pending] = useActionMessage(liftExpulsionAction);


  return (
    <form
      action={action}
      style={{ display: 'inline' }}
      onSubmit={(e) => {
        if (!confirm('Débloquer cet étudiant ? Il pourra à nouveau être inscrit.')) e.preventDefault();
      }}
    >
      <input type="hidden" name="expulsionId" value={expulsionId} />
      <button className="btn btn-sm btn-success" type="submit" disabled={pending}>✓ Débloquer</button>
    </form>
  );
}
