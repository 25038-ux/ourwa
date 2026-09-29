import { apiFetch, requireSession, can } from '@/lib/session';
import { PageHeader } from '@/components/page-header';
import { MOIS_NOMS } from '@/lib/mois';
import { MessagePage } from '@/components/message-page';
import { mru } from '@/components/hub';
import { StaffForm, SupprimerStaff } from './staff-form';

export const dynamic = 'force-dynamic';

interface Staff {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  role_title: string;
  salary: string;
  paid_months?: number[] | null;
  hired_on: string | null;
  is_active: boolean;
  user_id: string | null;
}

/**
 * AJOUTER STAFF — `pages/super_admin/ajouter_staff.php` : « Gérer le
 * personnel non-enseignant ». Sa table `staff` est celle des fiches SANS
 * compte (celles qui en ont un vivent dans « Comptes du personnel ») :
 * « Nouveau personnel », puis « Personnel existant » (Nom / Fonction / Tél /
 * Salaire / Embauche / Statut / Actions), les inactifs estompés.
 */
export default async function AjouterStaffPage() {
  const { user } = await requireSession();

  // Son `require_staff_admin()`.
  if (!can(user, 'comptes.staff')) {
    return (
      <>
        <PageHeader titre="Ajouter Staff" sousTitre="Gérer le personnel non-enseignant" />
        <div className="form-card">
          <p className="text-muted">Cette page demande la permission <code>comptes.staff</code>.</p>
        </div>
      </>
    );
  }

  // Sa table `staff` — le personnel sans compte ; son ordre `actif DESC, nom`.
  const staff = (await apiFetch<Staff[]>('/accounts/staff').catch(() => [] as Staff[])).filter((s) => !s.user_id);

  return (
    <>
      <PageHeader titre="Ajouter Staff" sousTitre="Gérer le personnel non-enseignant" />
      <MessagePage>
        <div className="form-card">
          <h3>Nouveau personnel</h3>
          <StaffForm />
        </div>

        <div className="table-container">
          <div className="table-header"><h3>Personnel existant</h3><span className="badge badge-primary">{staff.length}</span></div>
          <div className="overflow-x">
            <table>
              <thead><tr><th>Nom</th><th>Fonction</th><th>Tél</th><th>Salaire</th><th>Embauche</th><th>Statut</th><th>Actions</th></tr></thead>
              <tbody>
                {staff.length === 0 ? (
                  <tr><td colSpan={7} className="text-center text-muted" style={{ padding: '2rem' }}>Aucun personnel.</td></tr>
                ) : (
                  staff.map((s) => (
                    <tr key={s.id} style={!s.is_active ? { opacity: 0.5 } : undefined}>
                      <td><strong>{s.first_name} {s.last_name}</strong></td>
                      <td>{s.role_title}</td>
                      <td>{s.phone ?? ''}</td>
                      <td>
                        {mru(s.salary)} MRU
                        {Array.isArray(s.paid_months) && s.paid_months.length < 12 && (
                          <><br /><span className="text-muted" style={{ fontSize: '.8rem' }}>payé : {s.paid_months.map((m) => MOIS_NOMS[m]?.slice(0, 3)).join(', ')}</span></>
                        )}
                      </td>
                      <td>{s.hired_on ? String(s.hired_on).slice(0, 10) : ''}</td>
                      <td><span className={`badge ${s.is_active ? 'badge-success' : 'badge-danger'}`}>{s.is_active ? 'Actif' : 'Inactif'}</span></td>
                      <td><SupprimerStaff staffId={s.id} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </MessagePage>
    </>
  );
}
