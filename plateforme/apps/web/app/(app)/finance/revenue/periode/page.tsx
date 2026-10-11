import { ApiError, apiFetch, requireSession } from '@/lib/session';
import { PageHeader } from '@/components/page-header';
import { HubNav, mru } from '@/components/hub';
import { PrintButton } from '@/components/print-button';
import { ExporterCsv } from '../../rapport/exporter';
import { ImprimerRapport } from '../boutons';
import { financeTabsFor } from '../../tabs';

export const dynamic = 'force-dynamic';

interface Mouvement {
  at: string;
  jour: string;
  direction: 'in' | 'out';
  type: string;
  description: string;
  method: string;
  amount: string;
  recordedBy: string | null;
  recordedByRole: string | null;
}

interface MoyenLigne {
  moyen: string;
  entrant: string;
  sortant: string;
}

interface Periode {
  du: string;
  au: string;
  entrant: string;
  sortant: string;
  solde: string;
  moyens: MoyenLigne[];
  origines: { source_type: string; label: string; entrant: string; sortant: string }[];
  jours: { jour: string; entrant: string; sortant: string; solde: string; moyens: MoyenLigne[]; transactions: Mouvement[] }[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dmy = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const nomDuJour = (j: string) => JOURS[new Date(`${j}T12:00:00Z`).getUTCDay()] ?? '';
function heure(at: string): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
const couleur = (v: string | number) => (Number(v) >= 0 ? '#728157' : '#a8341f');

/**
 * LE RAPPORT D'UNE PÉRIODE — demande d'El Mourad (30/09, 0.7.9) : « a button
 * that make us select a start day and an end day and load a full rapport for
 * the in between period : per payement method (in and out), merged daily
 * rapports for every day in between and total ins and outs ».
 *
 * Du … au … (inclus, 366 jours au plus) : les totaux, chaque moyen (entrées,
 * sorties, solde), chaque origine, puis chaque jour qui a bougé avec ses
 * moyens et ses transactions. Une écriture annulée et son annulation n'y sont
 * pas (la caisse ne les a jamais vues).
 */
export default async function PeriodePage({ searchParams }: { searchParams: Promise<{ du?: string; au?: string }> }) {
  const params = await searchParams;
  const { user } = await requireSession();

  const now = new Date();
  const aujourdhui = iso(now);
  const du = DATE.test(params.du ?? '') ? params.du! : '';
  const au = DATE.test(params.au ?? '') ? params.au! : '';

  let rapport: Periode | null = null;
  let erreur: string | null = null;
  if (du && au) {
    try {
      rapport = await apiFetch<Periode>(`/reports/periode?du=${du}&au=${au}`);
    } catch (e) {
      erreur = e instanceof ApiError ? e.message : 'Le rapport n’a pas pu être chargé.';
    }
  }

  // Raccourcis : cette semaine (depuis lundi), ce mois, le mois dernier.
  const lundi = new Date(now);
  lundi.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const debutMois = new Date(now.getFullYear(), now.getMonth(), 1);
  const debutMoisDernier = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const finMoisDernier = new Date(now.getFullYear(), now.getMonth(), 0);
  const raccourcis: [string, string, string][] = [
    ["Aujourd'hui", aujourdhui, aujourdhui],
    ['Cette semaine', iso(lundi), aujourdhui],
    ['Ce mois', iso(debutMois), aujourdhui],
    ['Le mois dernier', iso(debutMoisDernier), iso(finMoisDernier)],
  ];

  const titre = rapport ? `Rapport du ${dmy(rapport.du)} au ${dmy(rapport.au)}` : 'Rapport sur une période';

  return (
    <>
      <PageHeader titre="Finance" sousTitre="Caisse, revenus, salaires, dettes et dépenses" />
      <div className="hub-shell">
        <HubNav tabs={financeTabsFor(user.roles)} active="revenue" label="Sections Finance" />
        <div className="hub-panel">
          <style>{`
.periode-tuiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
.periode-jour { border-left: 4px solid var(--primary); }
@media print {
  .no-print, .sidebar, .topbar, .page-header, .hub-nav { display: none !important; }
  .form-card, .table-container { border: none !important; box-shadow: none !important; }
  .periode-jour { break-inside: avoid; }
  body { background: #fff !important; }
}
`}</style>
          <a href="/finance/revenue" className="btn btn-secondary no-print" style={{ marginBottom: '1rem' }}>
            ← Revenue Live
          </a>

          <form method="GET" className="form-card no-print" style={{ marginBottom: '1.5rem' }}>
            <h2 style={{ marginTop: 0 }}>Rapport sur une période</h2>
            <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <label htmlFor="periode-du">Du (premier jour)</label>
                <input id="periode-du" type="date" name="du" defaultValue={du || aujourdhui} max={aujourdhui} required />
              </div>
              <div>
                <label htmlFor="periode-au">Au (dernier jour)</label>
                <input id="periode-au" type="date" name="au" defaultValue={au || aujourdhui} required />
              </div>
              <button className="btn btn-primary">Charger le rapport</button>
            </div>
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginTop: '.75rem' }}>
              {raccourcis.map(([nom, d, a]) => (
                <a key={nom} href={`/finance/revenue/periode?du=${d}&au=${a}`} className="btn btn-sm btn-secondary">
                  {nom}
                </a>
              ))}
            </div>
          </form>

          {erreur && <div className="alert alert-danger" role="alert">{erreur}</div>}

          {rapport && (
            <>
              <div className="section-title-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem', marginBottom: '1rem' }}>
                <h2 style={{ margin: 0 }}>{titre}</h2>
                <div className="no-print" style={{ display: 'flex', gap: '.5rem' }}>
                  <ExporterCsv tableId="table_periode" filename={`rapport_${rapport.du}_${rapport.au}.csv`} petit />
                  <ImprimerRapport tableId="table_periode_moyens" titre={`${titre} — par moyen de paiement`} />
                  <PrintButton label="Imprimer tout" className="btn btn-sm btn-secondary" />
                </div>
              </div>

              <div className="periode-tuiles">
                <div className="form-card" style={{ margin: 0 }}>
                  <div className="text-muted" style={{ fontSize: '.85rem' }}>Total entrées</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#728157' }}>{mru(rapport.entrant)} MRU</div>
                </div>
                <div className="form-card" style={{ margin: 0 }}>
                  <div className="text-muted" style={{ fontSize: '.85rem' }}>Total sorties</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#a8341f' }}>{mru(rapport.sortant)} MRU</div>
                </div>
                <div className="form-card" style={{ margin: 0 }}>
                  <div className="text-muted" style={{ fontSize: '.85rem' }}>Solde de la période</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 700, color: couleur(rapport.solde) }}>{mru(rapport.solde)} MRU</div>
                </div>
                <div className="form-card" style={{ margin: 0 }}>
                  <div className="text-muted" style={{ fontSize: '.85rem' }}>Jours avec mouvements</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{rapport.jours.length}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div className="table-container" style={{ margin: 0 }}>
                  <div className="table-header"><h3 style={{ margin: 0 }}>Par moyen de paiement</h3></div>
                  <div className="overflow-x">
                    <table id="table_periode_moyens">
                      <thead><tr><th>Moyen</th><th>Entrées</th><th>Sorties</th><th>Solde</th></tr></thead>
                      <tbody>
                        {rapport.moyens.length === 0 ? (
                          <tr><td colSpan={4} className="text-muted" style={{ textAlign: 'center' }}>Aucun mouvement sur la période.</td></tr>
                        ) : (
                          rapport.moyens.map((m) => {
                            const sol = Number(m.entrant) - Number(m.sortant);
                            return (
                              <tr key={m.moyen}>
                                <td><strong>{m.moyen}</strong></td>
                                <td style={{ color: '#728157' }}>{mru(m.entrant)} MRU</td>
                                <td style={{ color: '#a8341f' }}>{mru(m.sortant)} MRU</td>
                                <td><strong style={{ color: couleur(sol) }}>{mru(sol)} MRU</strong></td>
                              </tr>
                            );
                          })
                        )}
                        <tr style={{ background: '#f8f8f8', fontWeight: 700 }}>
                          <td>Total</td>
                          <td style={{ color: '#728157' }}>{mru(rapport.entrant)} MRU</td>
                          <td style={{ color: '#a8341f' }}>{mru(rapport.sortant)} MRU</td>
                          <td style={{ color: couleur(rapport.solde) }}>{mru(rapport.solde)} MRU</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="table-container" style={{ margin: 0 }}>
                  <div className="table-header"><h3 style={{ margin: 0 }}>Par origine</h3></div>
                  <div className="overflow-x">
                    <table>
                      <thead><tr><th>Origine</th><th>Entrées</th><th>Sorties</th></tr></thead>
                      <tbody>
                        {rapport.origines.length === 0 ? (
                          <tr><td colSpan={3} className="text-muted" style={{ textAlign: 'center' }}>—</td></tr>
                        ) : (
                          rapport.origines.map((o) => (
                            <tr key={o.source_type}>
                              <td>{o.label}</td>
                              <td style={{ color: '#728157' }}>{Number(o.entrant) > 0 ? `${mru(o.entrant)} MRU` : '—'}</td>
                              <td style={{ color: '#a8341f' }}>{Number(o.sortant) > 0 ? `${mru(o.sortant)} MRU` : '—'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <h2>Jour par jour</h2>
              {rapport.jours.length === 0 && <p className="text-muted">Aucun mouvement entre le {dmy(rapport.du)} et le {dmy(rapport.au)}.</p>}
              {rapport.jours.map((j) => (
                <div key={j.jour} className="table-container periode-jour" style={{ marginBottom: '1.25rem' }}>
                  <div className="table-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
                    <h3 style={{ margin: 0 }}>
                      {nomDuJour(j.jour)} {dmy(j.jour)}
                    </h3>
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '.9rem' }}>
                      <span>Entrées <strong style={{ color: '#728157' }}>{mru(j.entrant)} MRU</strong></span>
                      <span>Sorties <strong style={{ color: '#a8341f' }}>{mru(j.sortant)} MRU</strong></span>
                      <span>Solde <strong style={{ color: couleur(j.solde) }}>{mru(j.solde)} MRU</strong></span>
                      <a href={`/finance/revenue?jour=${j.jour}`} className="no-print" style={{ fontSize: '.85rem' }}>ouvrir le jour →</a>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', padding: '.5rem .75rem' }}>
                    {j.moyens.map((m) => (
                      <span key={m.moyen} className="badge badge-secondary" style={{ fontWeight: 500 }}>
                        {m.moyen} : +{mru(m.entrant)}{Number(m.sortant) > 0 ? ` / −${mru(m.sortant)}` : ''}
                      </span>
                    ))}
                  </div>
                  <div className="overflow-x">
                    <table>
                      <thead>
                        <tr><th>Heure</th><th>Enregistré par</th><th>Sens</th><th>Type</th><th>Description</th><th>Moyen</th><th>Montant</th></tr>
                      </thead>
                      <tbody>
                        {j.transactions.map((m, i) => (
                          <tr key={i}>
                            <td style={{ whiteSpace: 'nowrap' }}>{heure(m.at)}</td>
                            <td>{m.recordedBy ?? '—'}</td>
                            <td>{m.direction === 'in' ? '+ Entrée' : '− Sortie'}</td>
                            <td>{m.type}</td>
                            <td>{m.description}</td>
                            <td>{m.method}</td>
                            <td><strong style={{ color: m.direction === 'in' ? '#728157' : '#a8341f' }}>{mru(m.amount)} MRU</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {/* Toutes les transactions de la période, pour l'export CSV. */}
              <table id="table_periode" style={{ display: 'none' }}>
                <thead>
                  <tr><th>Date</th><th>Heure</th><th>Enregistré par</th><th>Sens</th><th>Type</th><th>Description</th><th>Moyen</th><th>Montant</th></tr>
                </thead>
                <tbody>
                  {rapport.jours.flatMap((j) =>
                    j.transactions.map((m, i) => (
                      <tr key={`${j.jour}-${i}`}>
                        <td>{dmy(j.jour)}</td>
                        <td>{heure(m.at)}</td>
                        <td>{m.recordedBy ?? ''}</td>
                        <td>{m.direction === 'in' ? 'Entrée' : 'Sortie'}</td>
                        <td>{m.type}</td>
                        <td>{m.description}</td>
                        <td>{m.method}</td>
                        <td>{m.direction === 'in' ? m.amount : `-${m.amount}`}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </>
  );
}
