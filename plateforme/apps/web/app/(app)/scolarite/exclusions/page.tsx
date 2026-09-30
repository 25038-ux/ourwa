import { apiFetch, requireSession, can } from '@/lib/session';
import { PageHeader } from '@/components/page-header';
import { HubNav } from '@/components/hub';
import { MessagePage } from '@/components/message-page';
import { SCOLARITE_TABS } from '../tabs';
import { LiftForm } from './forms';

export const dynamic = 'force-dynamic';

interface Expulsion {
  id: string;
  national_id: string | null;
  rim: string | null;
  first_name: string;
  last_name: string;
  reason: string | null;
  expelled_at: string;
  lifted_at: string | null;
}

/** Son `date('d/m/Y H:i')`. */
function dateHeure(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * LISTE DES EXPELLED — `pages/super_admin/expelled.php` : la recherche
 * (« Rechercher par nom, NNI ou RIM », `LIKE` sur nom, prénom, NNI, RIM ;
 * « Réinitialiser » dès qu'il y a un `q`), le tableau « ⚠ Étudiants
 * expulsés » à six colonnes, « ✓ Débloquer », et sa pagination à 25.
 *
 * Volontairement différent : la levée MARQUE la ligne (il l'efface) ; la vue
 * ne montre que les blocages actifs, comme la sienne ; la pagination est par
 * curseur (règle 17), avec ses boutons.
 */
export default async function ExpelledPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const { q, cursor } = await searchParams;
  const { user } = await requireSession();

  const refuse = !can(user, 'scolarite.inscrire', 'scolarite.reinscrire');
  const search = (q ?? '').trim();

  const params = new URLSearchParams();
  if (search) params.set('q', search);
  if (cursor) params.set('cursor', cursor);

  const data = refuse
    ? { rows: [] as Expulsion[], nextCursor: null as string | null, total: 0 }
    : await apiFetch<{ rows: Expulsion[]; nextCursor: string | null; total: number }>(`/expulsions?${params.toString()}`).catch(() => null);

  const mayExpel = can(user, 'scolarite.inscrire');
  const lien = (c?: string) => {
    const p = new URLSearchParams();
    if (search) p.set('q', search);
    if (c) p.set('cursor', c);
    const qs = p.toString();
    return `/scolarite/exclusions${qs ? `?${qs}` : ''}`;
  };

  return (
    <>
      <PageHeader titre="Gestion de scolarité" sousTitre="Emploi du temps, absences, groupes, niveaux, exclusions et notes" />
      <div className="hub-shell">
        <HubNav tabs={SCOLARITE_TABS} active="expelled" label="Sections Scolarité" />
        <div className="hub-panel">
          <MessagePage>
            {refuse ? (
              <div className="form-card">
                <p className="text-muted">
                  Cette page demande <code>scolarite.inscrire</code> ou <code>scolarite.reinscrire</code>.
                </p>
              </div>
            ) : (
              <>
                <div className="form-card" style={{ marginBottom: '1.5rem' }}>
                  <form method="GET" style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ flex: 1, minWidth: 240, marginBottom: 0 }}>
                      <label htmlFor="q">Rechercher par nom, NNI ou RIM</label>
                      <input type="text" id="q" name="q" defaultValue={search} placeholder="Ex : Ahmed, ou un NNI" autoFocus />
                    </div>
                    <button className="btn btn-primary" style={{ width: 'auto' }}>Rechercher</button>
                    {search !== '' && <a href="/scolarite/exclusions" className="btn btn-secondary">Réinitialiser</a>}
                  </form>
                </div>

                <div className="table-container">
                  <div className="table-header">
                    <h3>⚠ Étudiants expulsés</h3>
                    <span className="badge badge-danger">{data?.rows.length ?? 0}</span>
                  </div>
                  <div className="overflow-x">
                    <table>
                      <thead>
                        <tr>
                          <th>Étudiant</th><th>NNI</th><th>RIM</th><th>Motif</th><th>Date</th><th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data === null ? (
                          <tr><td colSpan={6} className="text-center text-muted">Le registre n’a pas pu être chargé.</td></tr>
                        ) : (
                          <>
                            {data.rows.map((ex) => (
                              <tr key={ex.id}>
                                <td><strong>{ex.first_name} {ex.last_name}</strong></td>
                                <td><code>{ex.national_id || '—'}</code></td>
                                <td><code>{ex.rim || '—'}</code></td>
                                <td>{ex.reason || '—'}</td>
                                <td><small>{dateHeure(ex.expelled_at)}</small></td>
                                <td>{mayExpel && <LiftForm expulsionId={ex.id} />}</td>
                              </tr>
                            ))}
                            {data.rows.length === 0 && (
                              <tr><td colSpan={6} className="text-center text-muted">Aucun étudiant expulsé.</td></tr>
                            )}
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Son `afficher_pagination()` — par curseur ici : « ‹ Précédent » ramène au début. */}
                {(data?.nextCursor || cursor) && (
                  <nav className="pagination" style={{ display: 'flex', gap: '.3rem', justifyContent: 'center', margin: '1.5rem 0', flexWrap: 'wrap' }}>
                    {cursor && <a href={lien()} className="btn btn-sm btn-secondary">‹ Précédent</a>}
                    {data?.nextCursor && <a href={lien(data.nextCursor)} className="btn btn-sm btn-secondary">Suivant ›</a>}
                    {data && typeof data.total === 'number' && (
                      <span style={{ margin: '.4rem .75rem', color: 'var(--text-muted)', fontSize: '.85rem' }}>{data.total} résultats</span>
                    )}
                  </nav>
                )}
              </>
            )}
          </MessagePage>
        </div>
      </div>
    </>
  );
}
