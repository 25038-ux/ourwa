'use client';


import { notifyUnpaidAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';

/**
 * « Notifier les impayés » — `gestion_caisse.php`, action `notifier_impayes`,
 * derrière son `confirm('Envoyer une notification à tous les parents impayés
 * de ce mois (hors exemptés) ?')`.
 */
export function NotifierImpayes({ mois, annee, academicYearId }: { mois: number; annee: number; academicYearId: string }) {
  const [state, action] = useActionMessage(notifyUnpaidAction);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm('Envoyer une notification à tous les parents impayés de ce mois (hors exemptés) ?')) e.preventDefault();
      }}
    >
      <input type="hidden" name="academicYearId" value={academicYearId} />
      <input type="hidden" name="calendarMonth" value={mois} />
      <input type="hidden" name="calendarYear" value={annee} />
      <button className="btn btn-sm btn-primary">Notifier les impayés</button>
    </form>
  );
}
