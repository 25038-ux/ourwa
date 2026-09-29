import { apiFetch, requireSession } from '@/lib/session';
import { anneeAffichee } from '@/lib/annee';
import { currentSchool } from '@/lib/tenant';
import { PageHeader } from '@/components/page-header';
import { HubNav } from '@/components/hub';
import { RecuDocument, RecuToolbar, dateHeure } from '@/components/recu-document';
import { financeTabsFor } from '../tabs';
import { MOIS_NOMS } from '@/lib/mois';
import { PaiementStaff, type LignePersonnel } from './paiement-staff';
import { MARQUE } from '@/lib/brand';

export const dynamic = 'force-dynamic';

interface Page {
  mois: number;
  moisDisponibles: number[];
  anneeMin: number | null;
  anneeMax: number | null;
  lignes: LignePersonnel[];
}

interface RecuSalaire {
  id: string;
  numero: string | null;
  date: string;
  benef_nom: string;
  benef_tel: string | null;
  benef_fonction: string | null;
  motif: string | null;
  mois: number;
  annee: number;
  paye_par_nom: string | null;
  moyens: { moyen: string; montant: string }[];
  montant: string;
}

/**
 * Paiement du personnel — `pages/super_admin/paiement_staff.php`, dans le hub Finance.
 *
 * `type` ∈ {staff, profs, admins} (défaut staff) ; `annee` par défaut
 * `annee_defaut()` — l'année civile de début de l'année scolaire consultée ;
 * `mois` par défaut le mois courant, et pour les professeurs seulement les
 * mois actifs de l'année scolaire (repli : mois courant s'il est actif, sinon
 * le premier actif). Après un paiement, la page revient sur elle-même avec
 * `print_recu_salaire=` et ne rend QUE le reçu — son `exit`.
 */
export default async function StaffPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    mois?: string;
    annee?: string;
    print_recu_salaire?: string;
  }>;
}) {
  const params = await searchParams;
  const { user } = await requireSession();
  const comptable = user.roles.includes('comptable');

  const type = (['staff', 'profs', 'admins'].includes(params.type ?? '') ? params.type : 'staff') as
    | 'staff'
    | 'profs'
    | 'admins';

  // `annee_defaut()`.
  const vue = await anneeAffichee();
  const anneeDefaut = vue?.start_year ?? new Date().getFullYear();
  const annee = /^\d{4}$/.test(params.annee ?? '') ? Number(params.annee) : anneeDefaut;
  const moisDemande = /^\d{1,2}$/.test(params.mois ?? '') ? `&mois=${params.mois}` : '';

  const page = await apiFetch<Page>(`/payroll/staff-pay?type=${type}${moisDemande}&annee=${annee}`);
  const mois = page.mois;

  // Reçu de salaire imprimable ?
  const printRecu = /^[0-9a-f-]{36}$/.test(params.print_recu_salaire ?? '')
    ? params.print_recu_salaire!
    : null;
  const recu = printRecu
    ? await apiFetch<RecuSalaire>(`/payroll/salaries/${printRecu}/receipt`).catch(() => null)
    : null;
  const ecole = (await currentSchool())?.name ?? MARQUE.nom;

  // Toutes les années qui portent des données, pas une fenêtre glissante.
  const yMin = page.anneeMin ?? anneeDefaut;
  const yMax = Math.max(page.anneeMax ?? anneeDefaut, anneeDefaut + 1);
  const annees: number[] = [];
  for (let y = yMin; y <= yMax; y++) annees.push(y);

  const moyens = await apiFetch<{ id: string; name: string }[]>('/payment-methods').catch(() => []);

  return (
    <>
      <PageHeader titre="Finance" sousTitre="Caisse, revenus, salaires, dettes et dépenses" />

      <div className="hub-shell">
        <HubNav tabs={financeTabsFor(user.roles)} active="staff" label="Sections Finance" />

        <div className="hub-panel">
          {recu ? (
            <>
              <div
                className="alert alert-success no-print"
                style={{ maxWidth: 640, margin: '0 auto 1rem' }}
              >
                ✓ Paiement enregistré avec succès. Vous pouvez imprimer le reçu ci-dessous.
              </div>
              <RecuToolbar
                retourUrl={`/finance/staff?type=${type}&mois=${mois}&annee=${annee}`}
                retourLabel="← Retour aux paiements"
              />
              <RecuDocument
                type="Reçu de paiement — Salaire"
                numero={recu.numero}
                date={dateHeure(recu.date)}
                lignes={[
                  ['Bénéficiaire', recu.benef_nom + (recu.benef_tel ? ` (${recu.benef_tel})` : '')],
                  ['Fonction', recu.benef_fonction],
                  ['Motif', recu.motif || 'Salaire'],
                  ['Période', `${MOIS_NOMS[recu.mois] ?? ''} ${recu.annee}`],
                  ['Payé par', recu.paye_par_nom],
                ]}
                moyens={recu.moyens}
                montant={recu.montant}
                sens="sortant"
                note={`Paiement de salaire — ${ecole}`}
                ecole={ecole}
              />
            </>
          ) : (
            <PaiementStaff
              type={type}
              mois={mois}
              annee={annee}
              moisDisponibles={page.moisDisponibles}
              annees={annees}
              lignes={page.lignes}
              comptable={comptable}
              moyens={moyens}
            />
          )}
        </div>
      </div>
    </>
  );
}
