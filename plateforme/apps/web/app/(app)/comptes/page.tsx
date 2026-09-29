import { apiFetch, requireSession, can } from '@/lib/session';
import { PageHeader } from '@/components/page-header';
import { ComptesPersonnel, type Compte } from './carte';

export const dynamic = 'force-dynamic';

/**
 * COMPTES DU PERSONNEL — `pages/super_admin/comptes_staffs.php`.
 *
 * « Un même agent peut cumuler plusieurs rôles ; il obtient l'union de leurs
 * permissions. » « Un compte n'est JAMAIS supprimé : il est désactivé. »
 *
 * Le message et le mot de passe provisoire en tête, les quatre compteurs, le
 * renvoi vers « Créer un utilisateur », puis une carte par compte — tout le
 * personnel de direction, professeurs compris — avec ses panneaux Modifier /
 * Rôles / Identifiant et ses boutons Mot de passe / Désactiver / Activer.
 */
export default async function ComptesPersonnelPage() {
  const { user } = await requireSession();

  // Son `exiger_permission('comptes.staff', …)`.
  if (!can(user, 'comptes.staff')) {
    return (
      <>
        <PageHeader titre="Comptes du personnel" sousTitre="Comptables, secrétaires et collecteurs d'absence — un agent peut cumuler plusieurs rôles" />
        <div className="alert alert-error">La gestion des comptes du personnel est réservée aux administrateurs.</div>
      </>
    );
  }

  const [comptes, catalogue] = await Promise.all([
    apiFetch<Compte[]>('/accounts/comptes-personnel').catch(() => [] as Compte[]),
    apiFetch<{ code: string; label: string; description: string | null }[]>('/accounts/roles').catch(() => []),
  ]);

  return (
    <>
      <PageHeader
        titre="Comptes du personnel"
        sousTitre="Comptables, secrétaires et collecteurs d'absence — un agent peut cumuler plusieurs rôles"
      />
      <ComptesPersonnel
        comptes={comptes}
        catalogue={catalogue}
        moi={user.id}
        // Réinitialiser un mot de passe est au super administrateur seul (décision du propriétaire, 2026-09-04).
        peutReinitialiser={user.roles.includes('super_admin')}
      />
    </>
  );
}
