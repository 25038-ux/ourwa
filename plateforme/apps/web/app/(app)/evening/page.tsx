import { apiFetch, requireSession, can, peutAdministrerLaDette, nulSiIntrouvable } from '@/lib/session';
import { anneeAffichee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';
import { HubNav, mru } from '@/components/hub';
import { MessagePage } from '@/components/message-page';
import { EVENING_TABS } from './tabs';
import { NouveauGroupeForm } from './forms';
import { FicheGroupe, type Detail, type EveningTeaching, type EveningSlot } from './fiche-groupe';

export const dynamic = 'force-dynamic';

interface EveningGroup {
  id: string;
  name: string;
  monthly_rate: string;
  description: string | null;
  is_active: boolean;
  headcount: number;
}

/**
 * GESTION DE COURS DU SOIR — `pages/super_admin/cours_du_soir.php`.
 *
 * Sans `groupe_id` : la coquille à deux onglets, « Nouveau groupe de cours du
 * soir » et la table « Groupes de cours du soir » (par actif puis nom). Avec
 * `groupe_id` : la fiche du groupe remplace tout — « ← Tous les groupes »,
 * « Année : » (défaut+1 … défaut−6), la carte du groupe (Mois de paiement,
 * Modifier, Supprimer), « Inscrits & paiements », les deux formulaires
 * d'inscription, « Professeurs assignés » + « Assigner un nouveau
 * professeur », la grille 7 × 7, et ses modales.
 */
export default async function EveningPage({
  searchParams,
}: {
  searchParams: Promise<{ groupe_id?: string; cs_annee?: string }>;
}) {
  const params = await searchParams;
  const { user } = await requireSession();
  const comptable = user.roles.includes('comptable');
  const mayCollect = can(user, 'finance.encaisser');
  const mayManage = can(user, 'scolarite.groupes');
  const mayAdminister = !comptable && can(user, 'finance.dette') && peutAdministrerLaDette(user);

  const vue = await anneeAffichee();
  const anneeDefaut = vue?.start_year ?? new Date().getFullYear();
  const groupeId = params.groupe_id ?? null;

  if (!groupeId) {
    const groups = await apiFetch<EveningGroup[]>('/evening/groups').catch(() => [] as EveningGroup[]);
    return (
      <>
        <PageHeader titre="Gestion de cours du soir" sousTitre="Groupes, emplois du temps, professeurs et finance" />
        <MessagePage>
          <div className="hub-shell">
            <HubNav tabs={EVENING_TABS} active="groupes" label="Sections Cours du soir" />
            <div className="hub-panel">
              <NouveauGroupeForm />
              <div className="table-container">
                <div className="table-header"><h3>Groupes de cours du soir</h3><span className="badge badge-primary">{groups.length}</span></div>
                <div className="overflow-x">
                  <table>
                    <thead><tr><th>Groupe</th><th>Tarif/mois</th><th>Inscrits</th><th></th></tr></thead>
                    <tbody>
                      {groups.length === 0 ? (
                        <tr><td colSpan={4} className="text-center text-muted" style={{ padding: '2rem' }}>Aucun groupe. Créez-en un ci-dessus.</td></tr>
                      ) : groups.map((g) => (
                        <tr key={g.id}>
                          <td><strong>{g.name}</strong>{g.description && <><br /><small className="text-muted">{g.description}</small></>}</td>
                          <td>{mru(g.monthly_rate)} MRU</td>
                          <td>{g.headcount}</td>
                          <td><a href={`/evening?groupe_id=${g.id}`} className="btn btn-sm btn-primary">Gérer →</a></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </MessagePage>
      </>
    );
  }

  const anneeDemandee = Number(params.cs_annee ?? 0);
  const anneeCourante = anneeDemandee >= 2020 && anneeDemandee <= 2100 ? anneeDemandee : anneeDefaut;

  const [detail, teachings, creneaux, dayTeachers, externals, moyens, students] = await Promise.all([
    apiFetch<Detail>(`/evening/groups/${groupeId}/detail?year=${anneeCourante}`).catch(nulSiIntrouvable),
    apiFetch<EveningTeaching[]>(`/evening/groups/${groupeId}/teachings`).catch(() => [] as EveningTeaching[]),
    apiFetch<EveningSlot[]>(`/evening/groups/${groupeId}/timetable`).catch(() => [] as EveningSlot[]),
    apiFetch<{ id: string; first_name: string; last_name: string }[]>('/teachers').catch(() => []),
    apiFetch<{ id: string; first_name: string; last_name: string }[]>('/evening/teachers/external').catch(() => []),
    apiFetch<{ id: string; name: string }[]>('/payment-methods').catch(() => []),
    // Ses `CS_ETUDIANTS` : tous les élèves, « Prénom Nom (matricule) », par nom.
    apiFetch<{ id: string; label: string }[]>('/evening/students-index').catch(() => [] as { id: string; label: string }[]),
  ]);

  return (
    <>
      <PageHeader titre="Gestion de cours du soir" sousTitre={detail ? `Groupe : ${detail.groupe.name}` : 'Groupes, emplois du temps, professeurs et finance'} />
      <MessagePage>
        {!detail ? (
          <div className="alert alert-error">Groupe de cours du soir introuvable.</div>
        ) : (
          <FicheGroupe
            detail={detail}
            anneeCourante={anneeCourante}
            anneeDefaut={anneeDefaut}
            teachings={teachings}
            creneaux={creneaux}
            profsEcole={dayTeachers.map((t) => ({ id: t.id, nom: `${t.first_name} ${t.last_name}`.trim() })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))}
            profsExternes={externals.map((t) => ({ id: t.id, nom: `${t.first_name} ${t.last_name}`.trim() })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))}
            moyens={moyens}
            etudiants={students}
            droits={{ mayCollect, mayManage, mayAdminister, comptable }}
          />
        )}
      </MessagePage>
    </>
  );
}
