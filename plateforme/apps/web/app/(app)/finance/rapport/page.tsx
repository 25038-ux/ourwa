import { apiFetch, requireSession } from '@/lib/session';
import { anneeAffichee } from '@/lib/annee';
import { MOIS_NOMS } from '@/lib/mois';
import { PageHeader } from '@/components/page-header';
import { HubNav, mru } from '@/components/hub';
import { AutoSubmitSelect } from '@/components/auto-submit-select';
import { PrintButton } from '@/components/print-button';
import { dateHeure } from '@/components/recu-document';
import { ExporterCsv } from './exporter';
import { SyntheseAnnuelle, type Bilan } from '../revenue/synthese-annuelle';
import { financeTabsFor } from '../tabs';
import { money, sum, toStorage } from '@elourwa/shared/money';

export const dynamic = 'force-dynamic';

interface Synthese {
  name: string;
  entrant: string;
  sortant: string;
}

interface Transaction {
  at: string;
  direction: 'in' | 'out';
  type: string;
  description: string;
  method: string;
  amount: string;
  recordedBy: string | null;
}


/**
 * Rapport Financier — `pages/super_admin/rapport_financier.php`, dans le hub Finance.
 *
 * Tout vient des lignes de caisse du mois (`paiement_lignes` filtrées sur
 * `MONTH(date_creation)`) : les trois cartes sont les totaux de la synthèse,
 * la synthèse liste TOUS les moyens de paiement avec leur ligne « TOTAL
 * GÉNÉRAL », et le détail est une ligne par mouvement. Puis la « Synthèse —
 * Année scolaire » de l'année consultée, sur les reçus d'archive quand il y en
 * a, sur la caisse sinon, avec son contrôle de ventilation.
 */
export default async function RapportPage({
  searchParams,
}: {
  searchParams: Promise<{ mois?: string; annee?: string }>;
}) {
  const params = await searchParams;
  const { user } = await requireSession();

  const vue = await anneeAffichee();
  const anneeDefaut = vue?.start_year ?? new Date().getFullYear();
  const mois = /^\d{1,2}$/.test(params.mois ?? '') && Number(params.mois) >= 1 && Number(params.mois) <= 12
    ? Number(params.mois)
    : new Date().getMonth() + 1;
  const annee = /^\d{4}$/.test(params.annee ?? '') ? Number(params.annee) : anneeDefaut;

  const [synthese, transactions, bilan, bornes] = await Promise.all([
    apiFetch<Synthese[]>(`/reports/methods?month=${mois}&year=${annee}`),
    apiFetch<Transaction[]>(`/reports/transactions?month=${mois}&year=${annee}`),
    apiFetch<Bilan>(`/reports/bilan-annuel${vue ? `?academicYearId=${vue.id}` : ''}`).catch(() => null),
    apiFetch<{ anneeMin: number | null; anneeMax: number | null }>('/reports/bornes-annees').catch(
      () => ({ anneeMin: null, anneeMax: null }),
    ),
  ]);

  const totEntrant = toStorage(sum(synthese.map((r) => r.entrant)));
  const totSortant = toStorage(sum(synthese.map((r) => r.sortant)));
  const soldeTotal = money(totEntrant).minus(totSortant);

  // Toutes les années pour lesquelles il existe des données.
  const yMin = bornes.anneeMin ?? anneeDefaut;
  const yMax = Math.max(bornes.anneeMax ?? anneeDefaut, anneeDefaut);
  const annees: number[] = [];
  for (let y = yMin; y <= yMax; y++) annees.push(y);

  return (
    <>
      <PageHeader titre="Finance" sousTitre="Caisse, revenus, salaires, dettes et dépenses" />

      <div className="hub-shell">
        <HubNav tabs={financeTabsFor(user.roles)} active="rapport" label="Sections Finance" />

        <div className="hub-panel">
          <div
            className="no-print"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1.5rem',
              flexWrap: 'wrap',
              gap: '.75rem',
            }}
          >
            <form method="GET" style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-end' }}>
              <div>
                <label>Mois</label>
                <AutoSubmitSelect
                  name="mois"
                  defaultValue={String(mois)}
                  options={MOIS_NOMS.slice(1).map((ml, i) => ({ value: String(i + 1), label: ml }))}
                />
              </div>
              <div>
                <label>Année</label>
                <AutoSubmitSelect
                  name="annee"
                  defaultValue={String(annee)}
                  options={annees.map((y) => ({ value: String(y), label: String(y) }))}
                />
              </div>
            </form>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <ExporterCsv tableId="table_rapport" filename={`rapport_finance_${mois}_${annee}.csv`} />
              <PrintButton label="Imprimer / PDF" className="btn btn-primary" />
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '1rem',
              marginBottom: '1.5rem',
            }}
          >
            <div className="form-card" style={{ textAlign: 'center', padding: '1.25rem', borderLeft: '5px solid #728157' }}>
              <div style={{ fontSize: '0.85rem', color: '#645c50', fontWeight: 600, textTransform: 'uppercase' }}>
                Total Revenus (Entrées)
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#728157', marginTop: '.25rem' }}>
                {mru(totEntrant)} MRU
              </div>
            </div>
            <div className="form-card" style={{ textAlign: 'center', padding: '1.25rem', borderLeft: '5px solid #a8341f' }}>
              <div style={{ fontSize: '0.85rem', color: '#645c50', fontWeight: 600, textTransform: 'uppercase' }}>
                Total Dépenses (Sorties)
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#a8341f', marginTop: '.25rem' }}>
                {mru(totSortant)} MRU
              </div>
            </div>
            <div className="form-card" style={{ textAlign: 'center', padding: '1.25rem', borderLeft: '5px solid #c67139' }}>
              <div style={{ fontSize: '0.85rem', color: '#645c50', fontWeight: 600, textTransform: 'uppercase' }}>
                Solde Net
              </div>
              <div
                style={{
                  fontSize: '1.75rem',
                  fontWeight: 700,
                  color: soldeTotal.greaterThanOrEqualTo(0) ? '#728157' : '#a8341f',
                  marginTop: '.25rem',
                }}
              >
                {mru(toStorage(soldeTotal))} MRU
              </div>
            </div>
          </div>

          <div className="table-container" style={{ marginBottom: '1.5rem' }}>
            <div className="table-header">
              <h3>
                Synthèse par moyen de paiement — {MOIS_NOMS[mois]} {annee}
              </h3>
            </div>
            <div className="overflow-x">
              <table>
                <thead>
                  <tr>
                    <th>Moyen de paiement</th>
                    <th>Total Entrées</th>
                    <th>Total Sorties</th>
                    <th>Solde</th>
                  </tr>
                </thead>
                <tbody>
                  {synthese.map((row) => {
                    const solde = Number(row.entrant) - Number(row.sortant);
                    return (
                      <tr key={row.name}>
                        <td>
                          <strong>{row.name}</strong>
                        </td>
                        <td style={{ color: '#728157', fontWeight: 600 }}>{mru(row.entrant)} MRU</td>
                        <td style={{ color: '#a8341f', fontWeight: 600 }}>{mru(row.sortant)} MRU</td>
                        <td>
                          <strong style={{ color: solde >= 0 ? '#728157' : '#a8341f' }}>{mru(solde)} MRU</strong>
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: '#f9fafb', fontWeight: 700, borderTop: '2px solid #dcd3c4' }}>
                    <td>TOTAL GÉNÉRAL</td>
                    <td style={{ color: '#728157' }}>{mru(totEntrant)} MRU</td>
                    <td style={{ color: '#a8341f' }}>{mru(totSortant)} MRU</td>
                    <td style={{ color: soldeTotal.greaterThanOrEqualTo(0) ? '#728157' : '#a8341f' }}>{mru(toStorage(soldeTotal))} MRU</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="table-container">
            <div className="table-header">
              <h3>Détails des transactions de la période</h3>
            </div>
            <div className="overflow-x">
              <table id="table_rapport">
                <thead>
                  <tr>
                    <th>Date / Heure</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Moyen</th>
                    <th>Sens</th>
                    <th>Montant</th>
                    <th>Par</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center text-muted" style={{ padding: '2rem' }}>
                        Aucune transaction enregistrée pour ce mois.
                      </td>
                    </tr>
                  ) : (
                    transactions.map((t, i) => (
                      <tr key={i}>
                        <td>{dateHeure(t.at)}</td>
                        <td>{t.type}</td>
                        <td>{t.description}</td>
                        <td>{t.method}</td>
                        <td>
                          {t.direction === 'in' ? (
                            <span className="badge" style={{ background: '#ECFDF5', color: '#728157', fontWeight: 600 }}>
                              + Entrée
                            </span>
                          ) : (
                            <span className="badge" style={{ background: '#FEF2F2', color: '#a8341f', fontWeight: 600 }}>
                              - Sortie
                            </span>
                          )}
                        </td>
                        <td>
                          <strong style={{ color: t.direction === 'in' ? '#728157' : '#a8341f' }}>
                            {mru(t.amount)} MRU
                          </strong>
                        </td>
                        <td>{t.recordedBy ?? '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {bilan && <SyntheseAnnuelle bilan={bilan} />}
        </div>
      </div>
    </>
  );
}
