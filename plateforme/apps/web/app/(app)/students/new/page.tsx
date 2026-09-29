import { apiFetch, requireSession, can } from '@/lib/session';
import type { Annee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';
import { MessagePage } from '@/components/message-page';
import { catalogueFacturation } from '@/lib/facturation';
import { AdmitForm } from './admit-form';

export const dynamic = 'force-dynamic';

/**
 * INSCRIRE UN ÉTUDIANT — `pages/super_admin/inscrire_etudiant.php`.
 *
 * L'année cible est l'année ACTIVE (`annee_cible_inscription()`) ; sans année
 * ouverte, le refus de `refus_inscription()` s'affiche et le formulaire ne
 * sert à rien. Les groupes « Niveau — Groupe (effectif/capacité) », par nom.
 */
export default async function NewStudentPage() {
  const { user } = await requireSession();

  if (!can(user, 'scolarite.inscrire')) {
    return (
      <>
        <PageHeader titre="Inscrire un étudiant" sousTitre="Nouvel étudiant + rattachement à un correspondant" />
        <div className="form-card"><p className="text-muted">Cette page demande <code>scolarite.inscrire</code>.</p></div>
      </>
    );
  }

  const annees = await apiFetch<Annee[]>('/academic-years').catch(() => [] as Annee[]);
  const cible = annees.find((a) => a.status === 'active') ?? null;
  const refus = !cible ? "Aucune année scolaire n'est ouverte. Ouvrez-en une dans « Années scolaires »." : null;

  // École « services » (Jinan, §8) : le catalogue de l'année cible — modes,
  // frais d'inscription, prix des services. `null` pour une école « famille ».
  const [groups, moyens, facturation] = await Promise.all([
    apiFetch<{ id: string; name: string; level_id: string | null; level_name: string | null; capacity: number; headcount: number; monthly_rate: string | null }[]>(
      cible ? `/groups?academicYearId=${cible.id}` : '/groups',
    ).catch(() => []),
    apiFetch<{ id: string; name: string }[]>('/payment-methods').catch(() => []),
    cible ? catalogueFacturation(cible.id) : Promise.resolve(null),
  ]);
  groups.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  return (
    <>
      <PageHeader titre="Inscrire un étudiant" sousTitre="Nouvel étudiant + rattachement à un correspondant" />
      <MessagePage initial={refus ? { type: 'error', texte: refus } : null}>
        <AdmitForm groups={groups} academicYearId={cible?.id ?? ''} moyens={moyens} facturation={facturation} />
      </MessagePage>
    </>
  );
}
