import { apiFetch, requireSession, can } from '@/lib/session';
import { anneeAffichee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';
import { MessagePage } from '@/components/message-page';
import { HomeworkForm } from './forms';

export const dynamic = 'force-dynamic';

interface Teaching {
  id: string;
  subject: string;
  groupName: string | null;
}

/**
 * ENVOYER UN EXERCICE — `pages/super_admin/envoyer_exercice.php` : l'en-tête,
 * le message, puis le formulaire seul (ou « Vous n'avez aucun enseignement
 * assigné. »). « L'administration a accès à toutes les assignations » : ses
 * enseignements courants (`SQL_ENS_COURANTS`), « Groupe — Matière », par
 * groupe puis matière ; les destinataires sont les inscrits de l'année
 * consultée (`$an_page`).
 */
export default async function HomeworkPage() {
  const { user } = await requireSession();
  const maySend = can(user, 'exercices.envoyer');

  if (!maySend) {
    return (
      <>
        <PageHeader titre="Envoyer un exercice" sousTitre="Diffuser un exercice à un groupe (parents notifiés)" />
        <div className="form-card"><p className="text-muted">Cette page demande <code>exercices.envoyer</code>.</p></div>
      </>
    );
  }

  const year = await anneeAffichee();
  const teachings = await apiFetch<Teaching[]>('/teachings/courantes').catch(() => [] as Teaching[]);
  // La classe d'abord, la matière ensuite (décision du propriétaire : « le
  // sélecteur ne choisit que des classes ») — la liste plate « Groupe —
  // Matière » de deux cents lignes est remplacée par deux choix en cascade.
  const liste = teachings
    .map((t) => ({ id: t.id, label: `${t.groupName ?? ''} — ${t.subject ?? ''}`, g: t.groupName ?? '', m: t.subject ?? '' }))
    .sort((a, b) => a.g.localeCompare(b.g, 'fr') || a.m.localeCompare(b.m, 'fr'));

  return (
    <>
      <PageHeader titre="Envoyer un exercice" sousTitre="Diffuser un exercice à un groupe (parents notifiés)" />
      <MessagePage>
        {liste.length === 0 ? (
          <div className="alert alert-info">Vous n&apos;avez aucun enseignement assigné.</div>
        ) : (
          <HomeworkForm teachings={liste} academicYearId={year?.id ?? ''} />
        )}
      </MessagePage>
    </>
  );
}
