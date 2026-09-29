import { requireSession, can } from '@/lib/session';
import { PageHeader } from '@/components/page-header';
import { MessagePage } from '@/components/message-page';
import { FormulaireCreerUtilisateur } from './formulaire';

export const dynamic = 'force-dynamic';

/**
 * CRÉER UN UTILISATEUR — `pages/super_admin/creer_utilisateur.php` : « Rôles :
 * professeur, admin (avec palier de pouvoir : restreint / complet). No salary
 * field — admin salary is always 0, professor salary is computed from hours ».
 * Le message en tête, la carte « Nouvel utilisateur », son formulaire.
 */
export default async function CreerUtilisateurPage() {
  const { user } = await requireSession();

  // Son `require_staff_admin()`.
  if (!can(user, 'comptes.staff', 'comptes.professeurs')) {
    return (
      <>
        <PageHeader titre="Créer un utilisateur" sousTitre="Ajouter un professeur ou un administrateur" />
        <div className="form-card">
          <p className="text-muted">Créer un compte demande <code>comptes.staff</code> ou <code>comptes.professeurs</code>.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader titre="Créer un utilisateur" sousTitre="Ajouter un professeur ou un administrateur" />
      <MessagePage>
        <div className="form-card">
          <h3>Nouvel utilisateur</h3>
          <FormulaireCreerUtilisateur />
        </div>
      </MessagePage>
    </>
  );
}
