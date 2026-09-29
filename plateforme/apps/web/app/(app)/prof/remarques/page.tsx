import { apiFetch, requireSession } from '@/lib/session';
import { anneeAffichee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';
import { MessagePage } from '@/components/message-page';
import { RemarqueForm } from './remarque-form';

export const dynamic = 'force-dynamic';

interface Eleve {
  id: string;
  first_name: string;
  last_name: string;
  group_name: string;
}

/**
 * REMARQUES ÉLÈVES — `pages/professeur/remarques.php` : « Communiquer une
 * remarque au parent ». Les élèves accessibles = les inscrits des groupes
 * qu'il enseigne (par groupe puis nom) ; son formulaire `form-card` ; son
 * message en tête de page.
 */
export default async function ProfRemarquesPage() {
  const { user } = await requireSession();

  // Son `require_role('professeur')`.
  if (!user.roles.includes('professeur')) {
    return (
      <>
        <PageHeader titre="Remarques élèves" sousTitre="Communiquer une remarque au parent" />
        <div className="form-card">
          <p className="text-muted">Cette page est réservée aux professeurs.</p>
        </div>
      </>
    );
  }

  const annee = await anneeAffichee();
  const eleves = await apiFetch<Eleve[]>(
    `/teacher/my-students${annee ? `?academicYearId=${annee.id}` : ''}`,
  ).catch(() => [] as Eleve[]);

  return (
    <>
      <PageHeader titre="Remarques élèves" sousTitre="Communiquer une remarque au parent" />
      <MessagePage>
        {eleves.length === 0 ? (
          <div className="alert alert-info">Aucun élève accessible (vous n&apos;avez pas encore d&apos;enseignement assigné).</div>
        ) : (
          <RemarqueForm eleves={eleves} academicYearId={annee?.id ?? ''} />
        )}
      </MessagePage>
    </>
  );
}
