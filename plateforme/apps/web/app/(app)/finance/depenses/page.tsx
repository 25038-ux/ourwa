import { apiFetch, requireSession } from '@/lib/session';
import { currentSchool } from '@/lib/tenant';
import { PageHeader } from '@/components/page-header';
import { HubNav, mru } from '@/components/hub';
import { MessagePage } from '@/components/message-page';
import { RecuDocument, RecuToolbar, dateHeure } from '@/components/recu-document';
import { financeTabsFor } from '../tabs';
import { ExpenseForm, SupprimerDepense } from './forms';
import { MARQUE } from '@/lib/brand';

export const dynamic = 'force-dynamic';

interface Depense {
  id: string;
  amount: string;
  description: string;
  spent_at: string;
  numero: string | null;
  moyens: string;
}

interface Bon {
  id: string;
  numero: string | null;
  date: string;
  description: string;
  cree_par_nom: string | null;
  moyens: { moyen: string; montant: string }[];
  montant: string;
}

/** Son `e($d['date_depense'])` — la date MySQL telle quelle, `Y-m-d H:i:s`. */
function dateBrute(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Dépenses supplémentaires — `pages/super_admin/depenses.php`, dans le hub Finance.
 *
 * Sa carte KPI (le total de TOUTES les dépenses), son formulaire, son historique
 * entier — pas de filtre par mois — avec « Moyen(s) » et « Action » (le bon,
 * et « Supprimer » pour l'administration), et le bon de dépense `DEP-000123`
 * quand `print_bon` est présent. Le comptable ne crée pas la dépense : il
 * soumet une demande, que l'administration exécute depuis « Demandes ».
 */
export default async function DepensesPage({
  searchParams,
}: {
  searchParams: Promise<{ print_bon?: string }>;
}) {
  const params = await searchParams;
  const { user } = await requireSession();
  const comptable = user.roles.includes('comptable');

  const printBon = /^[0-9a-f-]{36}$/.test(params.print_bon ?? '') ? params.print_bon! : null;
  const bon = printBon
    ? await apiFetch<Bon>(`/expenses/${printBon}/receipt`).catch(() => null)
    : null;

  if (bon) {
    const ecole = (await currentSchool())?.name ?? MARQUE.nom;
    return (
      <>
        <PageHeader titre="Finance" sousTitre="Caisse, revenus, salaires, dettes et dépenses" />
        <div className="hub-shell">
          <HubNav tabs={financeTabsFor(user.roles)} active="depenses" label="Sections Finance" />
          <div className="hub-panel">
            <RecuToolbar retourUrl="/finance/depenses" retourLabel="← Retour aux dépenses" />
            <RecuDocument
              type="Bon de dépense"
              numero={bon.numero}
              date={dateHeure(bon.date)}
              lignes={[
                ['Description', bon.description],
                ['Enregistrée par', bon.cree_par_nom],
              ]}
              moyens={bon.moyens}
              montant={bon.montant}
              sens="sortant"
              note={`Justificatif de sortie de caisse — ${ecole}`}
              ecole={ecole}
            />
          </div>
        </div>
      </>
    );
  }

  const [{ depenses, total }, moyens] = await Promise.all([
    apiFetch<{ depenses: Depense[]; total: string }>('/expenses'),
    apiFetch<{ id: string; name: string }[]>('/payment-methods').catch(() => []),
  ]);

  return (
    <>
      <PageHeader titre="Finance" sousTitre="Caisse, revenus, salaires, dettes et dépenses" />

      <div className="hub-shell">
        <HubNav tabs={financeTabsFor(user.roles)} active="depenses" label="Sections Finance" />

        <div className="hub-panel">
          <MessagePage>
            {/* KPI */}
            <div className="kpi-grid" style={{ gridTemplateColumns: '1fr' }}>
              <div className="kpi-card kpi-danger">
                <div className="kpi-icon">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <p className="kpi-label">Total des dépenses supplémentaires</p>
                <p className="kpi-value">{mru(total)}</p>
                <p className="kpi-detail">MRU</p>
              </div>
            </div>

            {/* Add Depense Form */}
            <div className="form-card">
              <h3>Nouvelle dépense</h3>
              <ExpenseForm moyens={moyens} />
            </div>

            {/* Depenses List */}
            <div className="table-container">
              <div className="table-header">
                <h3>Historique des dépenses</h3>
                <span className="badge badge-primary">{depenses.length}</span>
              </div>
              <div className="overflow-x">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Montant</th>
                      <th>Description</th>
                      <th>Moyen(s)</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {depenses.map((d) => (
                      <tr key={d.id}>
                        <td>{dateBrute(d.spent_at)}</td>
                        <td>
                          <strong style={{ color: 'var(--danger)' }}>{mru(d.amount)} MRU</strong>
                        </td>
                        <td>{d.description}</td>
                        <td>{d.moyens}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <a
                            href={`/finance/depenses?print_bon=${d.id}`}
                            target="_blank"
                            rel="noopener"
                            className="btn btn-sm btn-secondary"
                            title="Imprimer le bon de dépense"
                          >
                            Bon
                          </a>{' '}
                          {!comptable && <SupprimerDepense id={d.id} />}
                        </td>
                      </tr>
                    ))}
                    {depenses.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center text-muted">
                          Aucune dépense enregistrée.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </MessagePage>
        </div>
      </div>
    </>
  );
}
