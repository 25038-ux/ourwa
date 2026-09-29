import { apiFetch, requireSession } from '@/lib/session';
import { anneeAffichee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';
import { MessagePage } from '@/components/message-page';
import { ExerciceForm } from './exercice-form';

export const dynamic = 'force-dynamic';

interface Enseignement {
  id: string;
  groupe_nom: string;
  matiere_nom: string;
}

/**
 * ENVOYER UN EXERCICE — `pages/professeur/envoyer_exercice.php` : « Diffuser
 * un exercice à un groupe (parents notifiés) ». Ses enseignements courants
 * (`SQL_ENS_COURANTS`, « Groupe — Matière », par groupe puis matière), son
 * formulaire `form-card`, sa zone de dépôt, son message en tête de page.
 */
export default async function ProfExercicePage() {
  const { user } = await requireSession();

  // Son `require_role('professeur')`.
  if (!user.roles.includes('professeur')) {
    return (
      <>
        <PageHeader titre="Envoyer un exercice" sousTitre="Diffuser un exercice à un groupe (parents notifiés)" />
        <div className="form-card">
          <p className="text-muted">Cette page est réservée aux professeurs.</p>
        </div>
      </>
    );
  }

  const annee = await anneeAffichee();
  const tb = await apiFetch<{ enseignements: Enseignement[] } | null>(
    `/teacher/tableau-bord${annee ? `?academicYearId=${annee.id}` : ''}`,
  ).catch(() => null);
  // Son ordre : `g.nom, m.nom`.
  const enseignements = [...(tb?.enseignements ?? [])].sort(
    (a, b) => a.groupe_nom.localeCompare(b.groupe_nom) || a.matiere_nom.localeCompare(b.matiere_nom),
  );

  return (
    <>
      <PageHeader titre="Envoyer un exercice" sousTitre="Diffuser un exercice à un groupe (parents notifiés)" />
      <MessagePage>
        {!tb ? (
          <div className="alert alert-error">Profil professeur introuvable.</div>
        ) : enseignements.length === 0 ? (
          <div className="alert alert-info">Vous n&apos;avez aucun enseignement assigné.</div>
        ) : (
          <ExerciceForm
            enseignements={enseignements.map((e) => ({ id: e.id, groupe: e.groupe_nom, matiere: e.matiere_nom }))}
            academicYearId={annee?.id ?? ''}
          />
        )}
      </MessagePage>
    </>
  );
}
