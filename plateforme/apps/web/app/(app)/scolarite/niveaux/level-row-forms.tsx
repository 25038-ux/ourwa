'use client';


import {
  deleteGroupAction,
  deleteLevelAction,
  setLevelPassMarkAction,
  setLevelRateAction,
  setSubjectMaxScoreAction,
  toggleFondamentalAction,
} from '@/app/actions';
import { useActionMessage } from '@/components/message-page';

type Result = { ok?: string; error?: string } | null;

/**
 * LES FORMULAIRES EN LIGNE DE `gerer_niveaux.php` : chaque cellule est son
 * propre `<form method="POST">`, avec ses pas (`step`), ses largeurs, son « ✓ »,
 * et son message qui remonte EN HAUT de la page.
 */

/** TARIF MENSUEL — `modifier_tarif` : la boîte (pas de 100), « MRU », ✓. */
export function RateCell({ levelId, monthlyRate }: { levelId: string; monthlyRate: string }) {
  const [state, action, pending] = useActionMessage(setLevelRateAction);


  return (
    <form action={action} style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
      <input type="hidden" name="levelId" value={levelId} />
      <input
        type="number"
        name="monthlyRate"
        defaultValue={String(Number(monthlyRate))}
        min={0}
        step={100}
        style={{ width: 100, padding: '.35rem .5rem', border: '2px solid var(--border)', borderRadius: 6, fontSize: '.85rem' }}
      />
      <span style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>MRU</span>
      <button type="submit" className="btn btn-sm btn-secondary" disabled={pending} style={{ padding: '.3rem .6rem', fontSize: '.8rem' }}>✓</button>
    </form>
  );
}

/** SEUIL D'ADMISSION — `modifier_seuil` : pas de 0,25, « / 20 », son `title`. */
export function PassMarkCell({ levelId, passMark }: { levelId: string; passMark: string }) {
  const [state, action, pending] = useActionMessage(setLevelPassMarkAction);


  return (
    <form action={action} style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
      <input type="hidden" name="levelId" value={levelId} />
      <input
        type="number"
        name="passMark"
        min={0}
        max={20}
        step={0.25}
        defaultValue={String(Number(passMark))}
        required
        title="Moyenne minimale sur 20 pour être admis dans ce niveau"
        style={{ width: 72, padding: '.35rem .5rem', border: '2px solid var(--border)', borderRadius: 6, fontSize: '.85rem' }}
      />
      <span style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>/ 20</span>
      <button type="submit" className="btn btn-sm btn-secondary" disabled={pending} style={{ padding: '.3rem .6rem', fontSize: '.8rem' }}>✓</button>
    </form>
  );
}

/** RENDRE FONDAMENTAL / RENDRE NORMAL — `basculer_fondamental`, avec son `title`. */
export function FondamentalToggle({ levelId, isFondamental }: { levelId: string; isFondamental: boolean }) {
  const [state, action, pending] = useActionMessage(toggleFondamentalAction);


  return (
    <form action={action} style={{ display: 'inline' }}>
      <input type="hidden" name="levelId" value={levelId} />
      <button
        type="submit"
        className="btn btn-sm btn-secondary"
        disabled={pending}
        style={{ padding: '.15rem .45rem', fontSize: '.68rem' }}
        title="Un niveau fondamental note chaque matière sur son propre barème (/50, /30…)"
      >
        {isFondamental ? 'Rendre normal' : 'Rendre fondamental'}
      </button>
    </form>
  );
}

/** SUPPRIMER LE NIVEAU — `supprimer_niveau`, `confirm('Supprimer ce niveau ?')`. */
export function DeleteLevelForm({ levelId }: { levelId: string }) {
  const [state, action, pending] = useActionMessage(deleteLevelAction);


  return (
    <form
      action={action}
      style={{ display: 'inline' }}
      onSubmit={(e) => {
        if (!confirm('Supprimer ce niveau ?')) e.preventDefault();
      }}
    >
      <input type="hidden" name="levelId" value={levelId} />
      <button type="submit" className="btn btn-sm btn-danger" disabled={pending}>Supprimer</button>
    </form>
  );
}

/**
 * SUPPRIMER LA CLASSE — `supprimer_groupe` de `gerer_niveaux.php`, avec SA
 * confirmation : « Supprimer le groupe « X » ET ses N étudiant(s) ? Cette
 * action est irréversible. » Le serveur, chez lui comme ici, refuse dès
 * qu'une inscription y est rattachée ; la phrase est restée la sienne.
 */
export function DeleteGroupForm({ groupId, name, nbEtudiants }: { groupId: string; name: string; nbEtudiants: number }) {
  const [state, action, pending] = useActionMessage(deleteGroupAction);


  return (
    <form
      action={action}
      style={{ display: 'inline' }}
      onSubmit={(e) => {
        if (!confirm(`Supprimer le groupe « ${name} » ET ses ${nbEtudiants} étudiant(s) ? Cette action est irréversible.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="page" value="niveaux" />
      <button className="btn btn-sm btn-danger" disabled={pending}>Supprimer</button>
    </form>
  );
}

/** NOTÉE SUR — `modifier_note_sur` : « / », la boîte (pas de 0,5), ✓. */
export function MaxScoreCell({ subjectId, maxScore }: { subjectId: string; maxScore: string }) {
  const [state, action, pending] = useActionMessage(setSubjectMaxScoreAction);


  return (
    <form action={action} style={{ display: 'flex', gap: '.35rem', alignItems: 'center' }}>
      <input type="hidden" name="subjectId" value={subjectId} />
      / <input
        type="number"
        name="maxScore"
        defaultValue={String(Number(maxScore))}
        min={1}
        max={99}
        step={0.5}
        style={{ width: 70, padding: '.3rem .4rem', border: '2px solid var(--border)', borderRadius: 6, fontSize: '.85rem' }}
      />
      <button className="btn btn-sm btn-secondary" disabled={pending} style={{ padding: '.25rem .5rem' }}>✓</button>
    </form>
  );
}
