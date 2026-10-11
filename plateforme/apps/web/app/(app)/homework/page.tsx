import { redirect } from 'next/navigation';
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

  // Un professeur porte `exercices.envoyer` lui aussi, mais cette page est celle
  // de l'administration (son `require_staff_admin()`) : la liste de TOUS les
  // enseignements lui est refusée, et la page lui disait « Vous n'avez aucun
  // enseignement assigné. » — faux. Sa page à lui existe.
  if (user.roles.includes('professeur') && !can(user, 'scolarite.niveaux') && !can(user, 'comptes.professeurs')) {
    redirect('/prof/exercice');
  }

  const year = await anneeAffichee();
  // ⚠ « Rien à montrer » et « je n'ai pas pu lire » ne sont pas la même phrase :
  // une liste vide rendue à la place d'une lecture échouée affichait « aucun
  // enseignement assigné » à une direction qui en a deux cents.
  const lecture = await apiFetch<Teaching[]>('/teachings/courantes').then(
    (liste) => ({ liste, illisible: false }),
    () => ({ liste: [] as Teaching[], illisible: true }),
  );
  const teachings = lecture.liste;
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
        {lecture.illisible ? (
          <div className="alert alert-error">Les enseignements n&apos;ont pas pu être lus. Rechargez la page.</div>
        ) : liste.length === 0 ? (
          <div className="alert alert-info">Vous n&apos;avez aucun enseignement assigné.</div>
        ) : (
          <HomeworkForm teachings={liste} academicYearId={year?.id ?? ''} />
        )}
      </MessagePage>
    </>
  );
}
