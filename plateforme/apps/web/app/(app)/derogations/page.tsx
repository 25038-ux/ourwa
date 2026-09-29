import { apiFetch, requireSession, can } from '@/lib/session';
import type { Annee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';
import { MessagePage } from '@/components/message-page';
import { mru } from '@/components/hub';
import { GrantForm, RevokeForm, TermBadge } from './forms';

export const dynamic = 'force-dynamic';

interface Famille {
  guardian_id: string;
  full_name: string;
  phone: string | null;
  solde: string;
  ouvert: boolean;
  gagnes: number[];
  fermes: Record<number, string>;
}

interface Derogation {
  id: string;
  guardian_name: string | null;
  guardian_phone: string | null;
  student_name: string | null;
  term: number | null;
  reason: string;
  granted_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  granted_by_name: string | null;
  revoked_by_name: string | null;
}

const dateFr = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const dateHeure = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dateFr(iso)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * DÉROGATIONS D'ACCÈS AUX RÉSULTATS D'EXAMEN — `pages/super_admin/derogations.php`.
 *
 * Sur l'ANNÉE ACTIVE : « Accorder une dérogation » (famille en dette, trimestre,
 * expiration, motif obligatoire), « Familles en dette — N » (200 au plus, par
 * solde décroissant, toutes années confondues, l'état d'accès et les
 * trimestres acquis / refermés), « Historique des dérogations » (100 au plus,
 * Révoquer sur une dérogation active). Réservée à `derogations.gerer`.
 */
export default async function DerogationsPage() {
  const { user } = await requireSession();

  if (!can(user, 'derogations.gerer')) {
    return (
      <>
        <PageHeader titre="Dérogations — résultats d’examen" sousTitre="Aucune année active" />
        <div className="form-card"><p className="text-muted">Cette page demande <code>derogations.gerer</code>.</p></div>
      </>
    );
  }

  const annees = await apiFetch<Annee[]>('/academic-years').catch(() => [] as Annee[]);
  const annee = annees.find((a) => a.status === 'active') ?? null;

  const [familles, historique] = annee
    ? await Promise.all([
        apiFetch<Famille[]>(`/exam-access?academicYearId=${annee.id}`).catch(() => [] as Famille[]),
        apiFetch<Derogation[]>(`/exam-access/derogations?academicYearId=${annee.id}`).catch(() => [] as Derogation[]),
      ])
    : [[], []];

  return (
    <>
      <PageHeader titre="Dérogations — résultats d’examen" sousTitre={annee ? `Année ${annee.label}` : 'Aucune année active'} />
      <MessagePage>
        {!annee ? (
          <div className="alert alert-warning">
            Aucune année scolaire active : il n’y a pas de dérogation à gérer.
          </div>
        ) : (
          <>
            <div className="form-card" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ marginTop: 0 }}>Accorder une dérogation</h3>
              <p className="text-muted" style={{ fontSize: '.88rem' }}>
                Une famille à jour de ses paiements voit ses résultats sans dérogation.
                N’en accordez une que pour une exception : cas social, solde contesté,
                échéancier accepté. <strong>Seules les notes d’examen et les moyennes sont
                retenues</strong> pour une famille en dette ; les devoirs restent toujours
                visibles, avec ou sans dérogation.
              </p>
              <GrantForm families={familles} academicYearId={annee.id} />
            </div>

            <div className="table-container" style={{ marginBottom: '1.5rem' }}>
              <div className="table-header"><h3>Familles en dette — {familles.length}</h3></div>
              <div className="overflow-x">
                <table>
                  <thead><tr>
                    <th>Famille</th><th>Téléphone</th>
                    <th style={{ textAlign: 'right' }}>Solde</th><th>Accès aux examens</th>
                    <th>Trimestres acquis</th>
                  </tr></thead>
                  <tbody>
                    {familles.length === 0 && (
                      <tr><td colSpan={5} className="text-muted">Aucune famille en dette.</td></tr>
                    )}
                    {familles.map((f) => (
                      <tr key={f.guardian_id}>
                        <td><strong>{f.full_name || '—'}</strong></td>
                        <td>{f.phone ?? ''}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{mru(f.solde)} MRU</td>
                        <td>
                          {f.ouvert ? (
                            <span className="badge" style={{ background: '#e1eecc', color: '#3d472b' }}>Ouvert par dérogation</span>
                          ) : f.gagnes.length > 0 ? (
                            <span className="badge" style={{ background: '#fdf1d6', color: '#6b4a10' }}>Partiel</span>
                          ) : (
                            <span className="badge" style={{ background: '#fbe6e1', color: '#7e2716' }}>Examens masqués</span>
                          )}
                        </td>
                        <td>
                          {[1, 2, 3].map((t) => {
                            const acquis = f.gagnes.includes(t);
                            const ferme = Object.prototype.hasOwnProperty.call(f.fermes, t);
                            if (!acquis && !ferme) return null;
                            return (
                              <TermBadge key={t} guardianId={f.guardian_id} academicYearId={annee.id} term={t} acquis={acquis} motifFermeture={f.fermes[t]} />
                            );
                          })}
                          {f.gagnes.length === 0 && Object.keys(f.fermes).length === 0 && <span className="text-muted">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="table-container">
              <div className="table-header"><h3>Historique des dérogations</h3></div>
              <div className="overflow-x">
                <table>
                  <thead><tr>
                    <th>Famille</th><th>Portée</th><th>Motif</th>
                    <th>Accordée</th><th>État</th><th></th>
                  </tr></thead>
                  <tbody>
                    {historique.length === 0 && (
                      <tr><td colSpan={6} className="text-muted">Aucune dérogation enregistrée.</td></tr>
                    )}
                    {historique.map((h) => {
                      const active = h.revoked_at === null && (h.expires_at === null || new Date(h.expires_at).getTime() > Date.now());
                      return (
                        <tr key={h.id}>
                          <td><strong>{h.guardian_name || h.guardian_phone}</strong></td>
                          <td style={{ fontSize: '.86rem' }}>
                            {h.student_name ? h.student_name : 'Tous les enfants'}<br />
                            <span className="text-muted">
                              {h.term ? `Trimestre ${h.term}` : 'Tous les trimestres'}
                              {h.expires_at ? ` · jusqu’au ${dateFr(h.expires_at)}` : ''}
                            </span>
                          </td>
                          <td style={{ fontSize: '.86rem' }}>{h.reason}</td>
                          <td style={{ fontSize: '.82rem' }}>
                            {dateHeure(h.granted_at)}<br />
                            <span className="text-muted">{h.granted_by_name || '—'}</span>
                          </td>
                          <td>
                            {h.revoked_at ? (
                              <>
                                <span className="badge" style={{ background: '#eee7db', color: '#645c50' }}>Révoquée</span><br />
                                <span className="text-muted" style={{ fontSize: '.78rem' }}>
                                  {dateFr(h.revoked_at)} · {h.revoked_by_name || '—'}
                                </span>
                              </>
                            ) : !active ? (
                              <span className="badge" style={{ background: '#fdf1d8', color: '#7a4b06' }}>Expirée</span>
                            ) : (
                              <span className="badge" style={{ background: '#e1eecc', color: '#3d472b' }}>Active</span>
                            )}
                          </td>
                          <td>{active && <RevokeForm id={h.id} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </MessagePage>
    </>
  );
}
