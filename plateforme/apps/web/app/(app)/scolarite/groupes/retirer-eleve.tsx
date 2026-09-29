'use client';


import { cancelEnrolmentAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';

/**
 * RETIRER UN ÉLÈVE DE SA CLASSE — le « Supprimer » de `gestion_groupes.php`.
 *
 * ⚠ SON BOUTON DÉTRUIT L'ARGENT, LE NÔTRE NON, ET LA CONFIRMATION LE DIT.
 * Sa phrase est « Supprimer cet étudiant ? Ses notes et paiements seront aussi
 * supprimés. » — et son code fait bien les trois DELETE. La règle 7 l'interdit
 * ici : un reçu remis à une famille ne peut pas cesser d'avoir existé.
 *
 * Le geste est donc le même — l'élève quitte la liste — et la confirmation
 * annonce ce qui se passe VRAIMENT. Promettre une suppression qu'on ne fait pas
 * serait pire que la faire : l'opérateur croirait la trace effacée.
 */
export function RetirerEleve({
  studentId,
  academicYearId,
  nom,
}: {
  studentId: string;
  academicYearId: string;
  nom: string;
}) {
  const [state, action, pending] = useActionMessage(cancelEnrolmentAction);


  return (
    <form
      action={action}
      style={{ display: 'inline' }}
      onSubmit={(e) => {
        if (
          !confirm(
            `Retirer ${nom} de cette classe ?\n\n` +
              'Son inscription est annulée : il quitte la liste, les appels et les ' +
              'bulletins. Ses paiements et ses notes sont conservés — ils font ' +
              'partie de l’histoire de l’école.',
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="academicYearId" value={academicYearId} />
      <button type="submit" className="btn btn-sm btn-danger" disabled={pending}>
        {pending ? '…' : 'Retirer'}
      </button>
    </form>
  );
}
