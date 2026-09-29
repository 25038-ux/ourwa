import { apiFetch, requireSession, can, peutAdministrerLaDette } from '@/lib/session';
import { PageHeader } from '@/components/page-header';
import { MessagePage } from '@/components/message-page';
import type { Moyen } from '@/components/moyens-paiement';
import { catalogueFacturation } from '@/lib/facturation';
import { CreanceActions, AjouterCreance, CreanceBureau } from './bulk/bulk-forms';
import { ReinscrireModale, ArreterDette, type LigneScolarite, type LigneDiverse } from './forms';

export const dynamic = 'force-dynamic';

interface Child {
  studentId: string;
  name: string;
  matricule: string | null;
  levelName: string | null;
  groupName: string | null;
  outcome: string | null;
  alreadyEnrolled: boolean;
}

interface Family {
  guardianId: string | null;
  guardianName: string;
  guardianPhone: string | null;
  debt: string;
  tuition: LigneScolarite[];
  misc: LigneDiverse[];
  annualFees: { label: string; outstanding: string }[];
  /**
   * École « services » (Jinan, §6) : chaque échéance de service due — un mois
   * de cantine, l'inscription de l'année… Comprise dans `debt` ; `[]` (ou
   * absente) dans une école « famille ».
   */
  services?: { studentName: string; label: string; monthLabel: string | null; outstanding: string }[];
  children: Child[];
}

/** Une créance de `dettes_familles` — les colonnes de son tableau « Gérer les créances ». */
interface Creance {
  id: string;
  guardian_id: string | null;
  start_year: number | null;
  kind: 'arriere' | 'facture';
  invoice_source: number | null;
  total: string;
  remaining: string;
  correction_reason: string | null;
  reason: string | null;
}

/** Son `number_format($x, 0, ',', ' ')`. */
function mru(v: string | number): string {
  return String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Son tableau `$__st` : libellé, fond, couleur — par décision de fin d'année. */
function decision(outcome: string | null): [string, string, string] {
  switch (outcome) {
    case 'passed':
      return ['Admis', 'var(--o-g-100,#f0fae1)', 'var(--o-g-800,#3d472b)'];
    case 'held_back':
      return ['Ajourné', '#fdf1d8', '#7a4b06'];
    case 'expelled':
      return ['Exclu', '#fbe6e1', '#7e2716'];
    default:
      return ['Non statué', 'var(--o-n-200,#eee7db)', 'var(--o-n-700,#645c50)'];
  }
}

/**
 * RÉINSCRIRE UN ÉTUDIANT — `pages/super_admin/reinscrire_etudiant.php`.
 *
 * Une recherche (nom de l'élève, du correspondant, ou téléphone), les résultats
 * REGROUPÉS PAR FOYER — « la dette appartient au correspondant, pas à l'élève »,
 * annoncée une seule fois en tête de foyer, foyers endettés en tête —, le détail
 * exact de ce qui est dû, la gestion des créances (administrateur), puis les
 * enfants avec leur décision de fin d'année et le bouton « Réinscrire » qui
 * ouvre sa modale. Réussie, la fenêtre d'encaissement s'ouvre d'elle-même.
 */
export default async function ReEnrolPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q: brut } = await searchParams;
  const { user } = await requireSession();

  if (!can(user, 'scolarite.reinscrire')) {
    return (
      <>
        <PageHeader titre="Réinscrire un étudiant" sousTitre="Recherche par nom de l'étudiant ou téléphone du correspondant" />
        <div className="form-card">
          <p className="text-muted">Cette page demande la permission <code>scolarite.reinscrire</code>.</p>
        </div>
      </>
    );
  }

  const q = (brut ?? '').trim();
  // Arrêter une dette, gérer les créances, réinscrire malgré une dette :
  // décisions d'administration (`$est_admin_page`).
  const estAdmin = peutAdministrerLaDette(user);
  const estRoleLimite = user.roles.includes('comptable') || user.roles.includes('secretaire');

  let erreurRecherche: string | null = null;
  const resultat =
    q !== ''
      ? await apiFetch<{ year: { id: string; label: string; startYear: number }; families: Family[] }>(
          `/enrollments/re-enrol/search?q=${encodeURIComponent(q)}`,
        ).catch((e: unknown) => {
          erreurRecherche = e instanceof Error ? e.message : 'Erreur.';
          return null;
        })
      : null;
  const familles = resultat?.families ?? [];
  const nbEleves = familles.reduce((n, f) => n + f.children.length, 0);

  const [groupes, moyens, creances, facturation] = await Promise.all([
    // « Tous les groupes », par cycle, ordre du niveau puis nom.
    apiFetch<{ id: string; name: string; level_id: string | null; level_name: string | null }[]>('/groups').catch(() => []),
    apiFetch<Moyen[]>('/payment-methods').catch(() => []),
    estAdmin && familles.length > 0
      ? apiFetch<Creance[]>('/finance/misc-debts?includeSettled=true').catch(() => [] as Creance[])
      : Promise.resolve([] as Creance[]),
    // École « services » : le catalogue de l'année de réinscription (celle que
    // la recherche annonce, `enrolmentTarget`) ; `null` pour une école « famille ».
    familles.length > 0 ? catalogueFacturation(resultat?.year.id) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader titre="Réinscrire un étudiant" sousTitre="Recherche par nom de l'étudiant ou téléphone du correspondant" />
      <MessagePage initial={erreurRecherche ? { type: 'error', texte: erreurRecherche } : null}>
        <div className="form-card" style={{ marginBottom: '1.5rem' }}>
          <h3>Rechercher un étudiant</h3>
          <form method="GET" style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: 1, minWidth: 280, marginBottom: 0 }}>
              <label htmlFor="q">
                Nom de l&apos;étudiant <strong>OU</strong> téléphone du correspondant
              </label>
              <input type="text" id="q" name="q" defaultValue={q} placeholder="Ex : Ahmed, ou 22 12 34 56" autoFocus />
            </div>
            <button className="btn btn-primary" style={{ width: 'auto' }}>Rechercher</button>
            {q !== '' && (
              <a href="/re-enrol" className="btn btn-secondary">Réinitialiser</a>
            )}
          </form>
        </div>

        {q === '' ? (
          <div className="alert alert-info">
            Saisissez un nom d&apos;étudiant ou un numéro de téléphone du correspondant pour commencer.
          </div>
        ) : familles.length === 0 ? (
          !erreurRecherche && <div className="alert alert-info">Aucun étudiant ne correspond à « {q} ».</div>
        ) : (
          <div className="table-container">
            <div className="table-header" style={{ marginBottom: '1rem' }}>
              <h3>Résultats — {familles.length} foyer(s), {nbEleves} élève(s)</h3>
            </div>

            {familles.map((fam) => {
              const fdette = Number(fam.debt);
              const owes = fdette > 0.009;
              const nbe = fam.children.length;
              const lignesCreances = fam.guardianId
                ? creances.filter((c) => c.guardian_id === fam.guardianId)
                : [];
              const cle = fam.guardianId ?? fam.children[0]!.studentId;
              return (
                <div
                  key={cle}
                  className="form-card"
                  style={{
                    marginBottom: '1.25rem',
                    padding: 0,
                    overflow: 'hidden',
                    borderLeft: `5px solid ${owes ? '#B45309' : '#728157'}`,
                  }}
                >
                  {/* ═══ PARENT ═══ */}
                  <div style={{ padding: '.9rem 1.1rem', background: owes ? 'rgba(180,83,9,.07)' : 'rgba(16,185,129,.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '.7rem', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '1.08rem' }}>{fam.guardianName}</strong>
                      {fam.guardianPhone && <span className="text-muted">{fam.guardianPhone}</span>}
                      <span className="text-muted">· {nbe} enfant{nbe > 1 ? 's' : ''}</span>
                      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.45rem', flexWrap: 'wrap' }}>
                        {owes ? (
                          <>
                            {estAdmin && fam.guardianId ? (
                              <ArreterDette guardianId={fam.guardianId} actuel={Math.round(fdette)} />
                            ) : (
                              <>
                                Dette&nbsp;:{' '}
                                <strong style={{ color: '#B45309', fontSize: '1.08rem' }}>{mru(fdette)} MRU</strong>
                              </>
                            )}
                            <span className="badge" style={{ background: '#FEF3C7', color: '#92400E' }}>Réinscription bloquée</span>
                          </>
                        ) : (
                          <strong style={{ color: '#059669' }}>✓ À jour</strong>
                        )}
                      </span>
                    </div>

                    {owes && (
                      /* ═══ SITUATION FINANCIERE — detail exact de ce qui est du ═══ */
                      <details style={{ marginTop: '.5rem' }} open>
                        <summary style={{ cursor: 'pointer', fontSize: '.82rem', color: 'var(--text-light)' }}>Détail de la dette</summary>
                        <table style={{ width: 'auto', fontSize: '.82rem', margin: '.5rem 0 .3rem' }}>
                          <thead>
                            <tr><th>Élève</th><th>Origine</th><th style={{ textAlign: 'right' }}>Montant</th></tr>
                          </thead>
                          <tbody>
                            {fam.tuition.map((l, i) => (
                              <tr key={`s-${i}`}>
                                <td>{l.studentName}</td>
                                <td>
                                  Mensualité {l.label}
                                  {Number(l.paid) > 0.005 && (
                                    <>
                                      {' '}
                                      <span className="text-muted">(versé {mru(l.paid)} sur {mru(l.due)})</span>
                                    </>
                                  )}
                                </td>
                                <td style={{ textAlign: 'right' }}><strong>{mru(l.outstanding)}</strong></td>
                              </tr>
                            ))}
                            {fam.misc.map((l, i) => (
                              <tr key={`d-${i}`}>
                                <td>{l.who}</td>
                                <td>{l.label}</td>
                                <td style={{ textAlign: 'right' }}><strong>{mru(l.outstanding)}</strong></td>
                              </tr>
                            ))}
                            {fam.annualFees.map((l, i) => (
                              <tr key={`f-${i}`}>
                                <td>Famille</td>
                                <td>{l.label}</td>
                                <td style={{ textAlign: 'right' }}><strong>{mru(l.outstanding)}</strong></td>
                              </tr>
                            ))}
                            {(fam.services ?? []).map((l, i) => (
                              <tr key={`v-${i}`}>
                                <td>{l.studentName}</td>
                                <td>{l.label}{l.monthLabel ? ` — ${l.monthLabel}` : ''}</td>
                                <td style={{ textAlign: 'right' }}><strong>{mru(l.outstanding)}</strong></td>
                              </tr>
                            ))}
                            <tr style={{ borderTop: '2px solid var(--border)' }}>
                              <td colSpan={2}><strong>Total dû</strong></td>
                              <td style={{ textAlign: 'right' }}><strong style={{ color: '#B45309' }}>{mru(fdette)} MRU</strong></td>
                            </tr>
                          </tbody>
                        </table>
                      </details>
                    )}

                    {fam.guardianId && estAdmin && (
                      /* ═══ CRUD DES CREANCES ═══ */
                      <details style={{ marginTop: '.35rem' }}>
                        <summary style={{ cursor: 'pointer', fontSize: '.82rem', color: 'var(--text-light)' }}>
                          Gérer les créances ({lignesCreances.length})
                        </summary>
                        <div style={{ margin: '.5rem 0 .2rem' }}>
                          {lignesCreances.length > 0 ? (
                            <table style={{ width: 'auto', fontSize: '.8rem', marginBottom: '.5rem' }}>
                              <thead>
                                <tr><th>Année</th><th>Type</th><th>Réclamé</th><th>Restant</th><th>Note</th><th>Actions</th></tr>
                              </thead>
                              <tbody>
                                {lignesCreances.map((ld) => {
                                  const sol = Number(ld.remaining);
                                  return (
                                    <tr key={ld.id} style={sol <= 0.005 ? { opacity: 0.55 } : undefined}>
                                      <td>{ld.start_year ? `${ld.start_year}-${ld.start_year + 1}` : '—'}</td>
                                      <td>
                                        {ld.kind === 'facture'
                                          ? `Reliquat facture${ld.invoice_source ? ` n° ${ld.invoice_source}` : ''}`
                                          : 'Arriéré'}
                                      </td>
                                      <td>{mru(ld.total)}</td>
                                      <td><strong style={sol > 0.005 ? { color: '#B45309' } : undefined}>{mru(sol)}</strong></td>
                                      <td style={{ maxWidth: '17rem', color: 'var(--text-muted)', fontSize: '.74rem' }}>{ld.correction_reason ?? ld.reason ?? ''}</td>
                                      <td style={{ whiteSpace: 'nowrap' }}>
                                        <CreanceActions id={ld.id} remaining={ld.remaining} />
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          ) : (
                            <p className="text-muted" style={{ fontSize: '.8rem' }}>Aucune créance enregistrée.</p>
                          )}
                          <AjouterCreance
                            guardianId={fam.guardianId}
                            guardianName={fam.guardianName}
                            startYear={resultat?.year.startYear}
                          />
                        </div>
                      </details>
                    )}
                  </div>

                  {/* ═══ ENFANTS ═══ */}
                  <div className="overflow-x">
                    <table style={{ margin: 0 }}>
                      <thead>
                        <tr><th>Élève</th><th>Matricule</th><th>Classe actuelle</th><th>Action</th></tr>
                      </thead>
                      <tbody>
                        {fam.children.map((et) => {
                          const [lib, fond, couleur] = decision(et.outcome);
                          const classe = `${et.levelName ?? '—'} — ${et.groupName ?? ''}`;
                          return (
                            <tr key={et.studentId}>
                              <td style={{ paddingLeft: '1.3rem' }}><strong>{et.name}</strong></td>
                              <td>{et.matricule ?? ''}</td>
                              <td>
                                {classe}
                                <span
                                  className="badge"
                                  title={`Décision de fin d'année${et.levelName ? ` en ${et.levelName}` : ''}`}
                                  style={{ background: fond, color: couleur, marginLeft: '.4rem' }}
                                >
                                  {lib}
                                </span>
                                {et.outcome === 'held_back' && (
                                  <>
                                    <br />
                                    <small className="text-muted">Passage au niveau supérieur réservé à la direction.</small>
                                  </>
                                )}
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <ReinscrireModale
                                  studentId={et.studentId}
                                  studentName={et.name}
                                  classe={classe}
                                  guardianName={fam.guardianName}
                                  groupes={groupes}
                                  aDette={fdette > 0.01}
                                  dette={fdette}
                                  tuition={fam.tuition}
                                  misc={[
                                    ...fam.misc,
                                    ...fam.annualFees.map((f) => ({ who: 'Famille', label: f.label, outstanding: f.outstanding })),
                                    ...(fam.services ?? []).map((l) => ({
                                      who: l.studentName,
                                      label: `${l.label}${l.monthLabel ? ` — ${l.monthLabel}` : ''}`,
                                      outstanding: l.outstanding,
                                    })),
                                  ]}
                                  facturation={facturation}
                                  estAdmin={estAdmin}
                                  estRoleLimite={estRoleLimite}
                                  moyens={moyens}
                                />{' '}
                                <a href={`/search?q=${encodeURIComponent(et.matricule ?? et.name)}`} className="btn btn-sm btn-secondary">Profil</a>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {estAdmin && <CreanceBureau enHaut />}
      </MessagePage>
    </>
  );
}
