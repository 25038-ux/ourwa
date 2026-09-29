import { apiFetch, requireSession } from '@/lib/session';
import { anneeAffichee } from '@/lib/annee';
import { MOIS_NOMS } from '@/lib/mois';
import { PageHeader } from '@/components/page-header';
import { HubNav, mru } from '@/components/hub';
import { AutoSubmitSelect } from '@/components/auto-submit-select';
import { PrintButton } from '@/components/print-button';
import { dateHeure } from '@/components/recu-document';
import { ExporterCsv } from '../rapport/exporter';
import { ImprimerRapport, JourInput } from './boutons';
import { SyntheseAnnuelle, type Bilan } from './synthese-annuelle';
import { financeTabsFor } from '../tabs';
import { money, sum, toStorage } from '@elourwa/shared/money';

export const dynamic = 'force-dynamic';

interface Jour {
  total: string;
  parMoyen: { moyen: string; total: string }[];
  parSource: { source_type: string; label: string; total: string }[];
}

interface Mouvement {
  at: string;
  direction: 'in' | 'out';
  type: string;
  description: string;
  method: string;
  amount: string;
  recordedBy: string | null;
  recordedByRole: string | null;
}

interface Synthese {
  name: string;
  entrant: string;
  sortant: string;
}

/** Son `date('H:i')`. */
function heure(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

const ucfirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Revenue Live — `pages/super_admin/revenue_live.php`, dans le hub Finance.
 *
 * Suivi journalier (`jour`, défaut aujourd'hui) : total encaissé, par moyen
 * (entrées), par origine, transactions du jour. Suivi mensuel (`mois`,
 * `annee`, défaut date du jour ; années civile −2…+1) : synthèse par moyen,
 * « Payé aux professeurs / au staff », journal détaillé du mois. Puis la
 * « Synthèse — Année scolaire » de l'année consultée.
 */
export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ jour?: string; mois?: string; annee?: string }>;
}) {
  const params = await searchParams;
  const { user } = await requireSession();

  const now = new Date();
  const aujourdhui = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const jour = /^\d{4}-\d{2}-\d{2}$/.test(params.jour ?? '') ? params.jour! : aujourdhui;
  const mois = /^\d{1,2}$/.test(params.mois ?? '') && Number(params.mois) >= 1 && Number(params.mois) <= 12
    ? Number(params.mois)
    : now.getMonth() + 1;
  const annee = /^\d{4}$/.test(params.annee ?? '') ? Number(params.annee) : now.getFullYear();

  const vue = await anneeAffichee();
  const [j, jourTx, moisSyn, moisTx, salaires, bilan] = await Promise.all([
    apiFetch<Jour>(`/reports/jour?jour=${jour}`),
    apiFetch<Mouvement[]>(`/reports/transactions?day=${jour}`),
    apiFetch<Synthese[]>(`/reports/methods?month=${mois}&year=${annee}`),
    apiFetch<Mouvement[]>(`/reports/transactions?month=${mois}&year=${annee}`),
    apiFetch<{ professeur: string; staff: string }>(`/reports/salaires?month=${mois}&year=${annee}`),
    apiFetch<Bilan>(`/reports/bilan-annuel${vue ? `?academicYearId=${vue.id}` : ''}`).catch(() => null),
  ]);

  const totE = toStorage(sum(moisSyn.map((r) => r.entrant)));
  const totS = toStorage(sum(moisSyn.map((r) => r.sortant)));
  const solde = money(totE).minus(totS);
  const jourDmy = jour.split('-').reverse().join('/');
  const annees = [now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  const LigneTx = ({ m, date }: { m: Mouvement; date: string }) => (
    <tr>
      <td style={{ whiteSpace: 'nowrap' }}>{date}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {m.recordedBy ? (
          <>
            <strong>{m.recordedBy}</strong>
            <br />
            <small className="text-muted">{ucfirst(m.recordedByRole ?? '')}</small>
          </>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td>
        {m.direction === 'in' ? (
          <span className="badge" style={{ background: '#ECFDF5', color: '#728157', fontWeight: 600 }}>+ Entrée</span>
        ) : (
          <span className="badge" style={{ background: '#FEF2F2', color: '#a8341f', fontWeight: 600 }}>- Sortie</span>
        )}
      </td>
      <td>{m.type}</td>
      <td>{m.description}</td>
      <td>{m.method}</td>
      <td>
        <strong style={{ color: m.direction === 'in' ? '#728157' : '#a8341f' }}>{mru(m.amount)} MRU</strong>
      </td>
    </tr>
  );

  return (
    <>
      <PageHeader titre="Finance" sousTitre="Caisse, revenus, salaires, dettes et dépenses" />

      <div className="hub-shell">
        <HubNav tabs={financeTabsFor(user.roles)} active="revenue" label="Sections Finance" />

        <div className="hub-panel">
          <style>{`
.section-title-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: .5rem; }
.btn-export-group { display: flex; gap: .5rem; }
@media print {
    .no-print, .sidebar, .topbar, form, .btn-export-group, .page-header { display: none !important; }
    .form-card, .table-container { border: none !important; box-shadow: none !important; margin: 0 !important; padding: 0 !important; }
    body { background: #fff !important; color: #000 !important; }
}
`}</style>

          {/* ===== Revenus du jour ===== */}
          <div className="section-title-row">
            <h2 style={{ margin: 0 }}>Suivi journalier</h2>
          </div>

          <form method="GET" className="form-card no-print" style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <label>Sélectionner le jour</label>
                <JourInput name="jour" defaultValue={jour} />
              </div>
              <div style={{ flex: 1 }}></div>
              <div style={{ textAlign: 'right' }}>
                <div className="text-muted" style={{ fontSize: '.85rem' }}>Total encaissé ce jour</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#728157' }}>{mru(j.total)} MRU</div>
              </div>
            </div>
          </form>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }} className="no-print">
            <div className="form-card">
              <h3 style={{ marginTop: 0 }}>Par moyen de paiement</h3>
              {j.parMoyen.length === 0 ? (
                <p className="text-muted">Aucun encaissement ce jour.</p>
              ) : (
                j.parMoyen.map((r) => (
                  <div key={r.moyen} style={{ display: 'flex', justifyContent: 'space-between', padding: '.4rem 0', borderBottom: '1px solid #f0f0f0' }}>
                    <span>{r.moyen}</span>
                    <strong>{mru(r.total)} MRU</strong>
                  </div>
                ))
              )}
            </div>
            <div className="form-card">
              <h3 style={{ marginTop: 0 }}>Par origine</h3>
              {j.parSource.length === 0 ? (
                <p className="text-muted">Aucun encaissement ce jour.</p>
              ) : (
                j.parSource.map((r) => (
                  <div key={r.source_type} style={{ display: 'flex', justifyContent: 'space-between', padding: '.4rem 0', borderBottom: '1px solid #f0f0f0' }}>
                    <span>{r.label}</span>
                    <strong>{mru(r.total)} MRU</strong>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Transactions détaillées du jour */}
          <div className="table-container" style={{ marginBottom: '2.5rem' }}>
            <div className="table-header">
              <div className="section-title-row" style={{ width: '100%', margin: 0 }}>
                <h3 style={{ margin: 0 }}>Transactions du {jourDmy}</h3>
                <div className="btn-export-group">
                  <ExporterCsv tableId="table_jour" filename={`transactions_jour_${jour}.csv`} petit />
                  <ImprimerRapport tableId="table_jour" titre={`Transactions du ${jourDmy}`} />
                  <PrintButton label="Imprimer" className="btn btn-sm btn-secondary" />
                </div>
              </div>
            </div>
            <div className="overflow-x">
              <table id="table_jour">
                <thead>
                  <tr>
                    <th>Heure</th>
                    <th>Enregistré par</th>
                    <th>Sens</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Moyen</th>
                    <th>Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {jourTx.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-muted" style={{ textAlign: 'center' }}>
                        Aucune transaction enregistrée ce jour.
                      </td>
                    </tr>
                  ) : (
                    jourTx.map((m, i) => <LigneTx key={i} m={m} date={heure(m.at)} />)
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ===== Statistiques par mois ===== */}
          <div className="section-title-row">
            <h2 style={{ margin: 0 }}>Suivi mensuel</h2>
          </div>

          <form method="GET" className="form-card no-print" style={{ marginBottom: '1.5rem' }}>
            <input type="hidden" name="jour" value={jour} />
            <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
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
            </div>
          </form>

          <div className="table-container" style={{ marginBottom: '1.5rem' }}>
            <div className="table-header">
              <h3>
                Synthèse - {MOIS_NOMS[mois]} {annee}
              </h3>
            </div>
            <div className="overflow-x">
              <table>
                <thead>
                  <tr>
                    <th>Moyen</th>
                    <th>Encaissé (entrées)</th>
                    <th>Décaissé (sorties)</th>
                    <th>Solde</th>
                  </tr>
                </thead>
                <tbody>
                  {moisSyn.map((r) => {
                    const solde = Number(r.entrant) - Number(r.sortant);
                    return (
                      <tr key={r.name}>
                        <td>
                          <strong>{r.name}</strong>
                        </td>
                        <td style={{ color: '#728157' }}>{mru(r.entrant)} MRU</td>
                        <td style={{ color: '#a8341f' }}>{mru(r.sortant)} MRU</td>
                        <td>
                          <strong style={{ color: solde >= 0 ? '#728157' : '#a8341f' }}>{mru(solde)} MRU</strong>
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: '#f8f8f8', fontWeight: 700 }}>
                    <td>Total</td>
                    <td style={{ color: '#728157' }}>{mru(totE)} MRU</td>
                    <td style={{ color: '#a8341f' }}>{mru(totS)} MRU</td>
                    <td>
                      <span style={{ color: solde.greaterThanOrEqualTo(0) ? '#728157' : '#a8341f' }}>{mru(toStorage(solde))} MRU</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }} className="no-print">
            <div className="form-card">
              <h4 style={{ marginTop: 0 }}>Payé aux professeurs ({MOIS_NOMS[mois]})</h4>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#a8341f' }}>{mru(salaires.professeur)} MRU</div>
            </div>
            <div className="form-card">
              <h4 style={{ marginTop: 0 }}>Payé au staff ({MOIS_NOMS[mois]})</h4>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#a8341f' }}>{mru(salaires.staff)} MRU</div>
            </div>
          </div>

          {/* Transactions détaillées du mois */}
          <div className="table-container" style={{ marginBottom: '2.5rem' }}>
            <div className="table-header">
              <div className="section-title-row" style={{ width: '100%', margin: 0 }}>
                <h3 style={{ margin: 0 }}>
                  Journal détaillé du mois ({MOIS_NOMS[mois]} {annee})
                </h3>
                <div className="btn-export-group">
                  <ExporterCsv tableId="table_mois" filename={`transactions_mois_${mois}_${annee}.csv`} petit />
                  <ImprimerRapport tableId="table_mois" titre={`Journal ${MOIS_NOMS[mois]} ${annee}`} />
                  <PrintButton label="Imprimer" className="btn btn-sm btn-secondary" />
                </div>
              </div>
            </div>
            <div className="overflow-x">
              <table id="table_mois">
                <thead>
                  <tr>
                    <th>Date / Heure</th>
                    <th>Enregistré par</th>
                    <th>Sens</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Moyen</th>
                    <th>Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {moisTx.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-muted" style={{ textAlign: 'center' }}>
                        Aucune transaction ce mois-ci.
                      </td>
                    </tr>
                  ) : (
                    moisTx.map((m, i) => <LigneTx key={i} m={m} date={dateHeure(m.at)} />)
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
