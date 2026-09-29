import { apiFetch, requireSession } from '@/lib/session';
import { PageHeader } from '@/components/page-header';
import { MessagePage } from '@/components/message-page';
import { DecideForm, RaiseForm } from './forms';
import { TYPES_DEMANDE } from './types';

export const dynamic = 'force-dynamic';

interface Demande {
  id: string;
  kind: string;
  description: string;
  amount: string | null;
  status: 'pending' | 'approved' | 'refused';
  comment: string | null;
  raiser_name: string;
  demandeur: string | null;
  created_at: string;
  decided_at: string | null;
}

/** Ses `$statut_labels` : libellé, couleur, fond — par statut (les nôtres en clé). */
const STATUTS: Record<'pending' | 'approved' | 'refused', { cle: string; label: string; color: string; bg: string }> = {
  pending: { cle: 'en_attente', label: 'En attente', color: '#c98a12', bg: '#FFFBEB' },
  approved: { cle: 'approuve', label: 'Approuvée', color: '#728157', bg: '#ECFDF5' },
  refused: { cle: 'rejete', label: 'Rejetée', color: '#a8341f', bg: '#FEF2F2' },
};
const DEPUIS_CLE: Record<string, 'pending' | 'approved' | 'refused'> = { en_attente: 'pending', approuve: 'approved', rejete: 'refused' };

/** Son `number_format($x, 0, ',', ' ')`. */
function mru(v: string | number): string {
  return String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
/** Son `date('d/m/Y H:i', …)`. */
function dateHeure(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function dateJour(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * DEMANDES COMPTABLE — `pages/super_admin/demandes.php` : « comptable : peut
 * créer une demande et voir ses propres demandes ; super_admin / admin :
 * voit toutes les demandes, peut approuver ou rejeter avec commentaire » —
 * et approuver EXÉCUTE la demande. Les quatre cartes-compteurs qui filtrent
 * (`?statut=`), le formulaire du comptable / secrétaire, la table.
 */
export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string }>;
}) {
  const { statut } = await searchParams;
  const { user } = await requireSession();

  // Son `require_role(['super_admin', 'admin', 'comptable', 'secretaire'])`.
  const roles = user.roles;
  const isAdmin = roles.includes('super_admin') || roles.includes('admin');
  const peutSoumettre = roles.includes('comptable') || roles.includes('secretaire');
  const sousTitre = isAdmin ? 'Gestion des demandes du comptable — approbation / rejet' : 'Soumettre et suivre vos demandes';

  if (!isAdmin && !peutSoumettre) {
    return (
      <>
        <PageHeader titre="Demandes comptable" sousTitre={sousTitre} />
        <div className="form-card">
          <p className="text-muted">Cette page est réservée aux rôles super_admin, admin, comptable et secrétaire.</p>
        </div>
      </>
    );
  }

  const filtre = statut && DEPUIS_CLE[statut] ? statut : '';
  const query = filtre ? `?status=${DEPUIS_CLE[filtre]}` : '';
  const data = await apiFetch<{ demandes: Demande[]; counts: Record<string, number> }>(`/requests${query}`)
    .catch(() => ({ demandes: [] as Demande[], counts: { pending: 0, approved: 0, refused: 0 } }));
  const demandes = data.demandes;
  const total = (data.counts.pending ?? 0) + (data.counts.approved ?? 0) + (data.counts.refused ?? 0);
  const typesLabel = Object.fromEntries(TYPES_DEMANDE);

  return (
    <>
      <PageHeader titre="Demandes comptable" sousTitre={sousTitre} />
      <MessagePage>
        {/* ── Statistiques ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          <a
            href="/requests"
            className="form-card"
            style={{ textDecoration: 'none', textAlign: 'center', padding: '1rem', ...(filtre === '' ? { borderColor: '#c67139', boxShadow: '0 0 0 2px rgba(198,113,57,.3)' } : {}) }}
          >
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text)' }}>{total}</div>
            <div className="text-muted" style={{ fontSize: '.85rem' }}>Total</div>
          </a>
          {(['pending', 'approved', 'refused'] as const).map((sk) => {
            const sv = STATUTS[sk];
            return (
              <a
                key={sk}
                href={`/requests?statut=${sv.cle}`}
                className="form-card"
                style={{ textDecoration: 'none', textAlign: 'center', padding: '1rem', ...(filtre === sv.cle ? { borderColor: sv.color, boxShadow: `0 0 0 2px ${sv.color}33` } : {}) }}
              >
                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: sv.color }}>{data.counts[sk] ?? 0}</div>
                <div className="text-muted" style={{ fontSize: '.85rem' }}>{sv.label}</div>
              </a>
            );
          })}
        </div>

        {/* ── Formulaire de soumission (comptable) ── */}
        {peutSoumettre && (
          <div className="form-card" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginTop: 0 }}>Nouvelle demande</h3>
            <RaiseForm />
          </div>
        )}

        {/* ── Liste des demandes ── */}
        <div className="form-card">
          <h3 style={{ marginTop: 0 }}>{isAdmin ? 'Toutes les demandes' : 'Mes demandes'}</h3>

          {demandes.length === 0 ? (
            <div className="alert alert-info">Aucune demande{filtre ? ' avec ce statut' : ''}.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="styled-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Date</th>
                    {isAdmin && <th>Demandeur</th>}
                    <th>Type</th>
                    <th>Description</th>
                    <th>Montant</th>
                    <th>Statut</th>
                    {isAdmin && <th>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {demandes.map((d, i) => {
                    const sl = STATUTS[d.status] ?? STATUTS.pending;
                    return (
                      <tr key={d.id}>
                        {/* Son `#` est l'entier de la ligne ; nos identifiants sont des UUID : le rang dans la liste. */}
                        <td>{demandes.length - i}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{dateHeure(d.created_at)}</td>
                        {isAdmin && <td>{d.demandeur ?? d.raiser_name}</td>}
                        <td>{typesLabel[d.kind] ?? d.kind}</td>
                        <td style={{ maxWidth: 280 }}>
                          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{d.description}</div>
                          {d.comment && (
                            <div style={{ marginTop: '.4rem', padding: '.4rem .6rem', background: '#f3f4f6', borderRadius: 6, fontSize: '.82rem', color: '#4B5563' }}>
                              <strong>Réponse :</strong> {d.comment}
                            </div>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{d.amount !== null ? `${mru(d.amount)} MRU` : '—'}</td>
                        <td>
                          <span style={{ display: 'inline-block', padding: '.2rem .6rem', borderRadius: 20, fontSize: '.78rem', fontWeight: 600, background: sl.bg, color: sl.color }}>
                            {sl.label}
                          </span>
                          {d.decided_at && (
                            <div style={{ fontSize: '.72rem', color: '#82796a', marginTop: '.2rem' }}>{dateJour(d.decided_at)}</div>
                          )}
                        </td>
                        {isAdmin && (
                          <td>
                            {d.status === 'pending' ? (
                              <DecideForm requestId={d.id} />
                            ) : (
                              <span style={{ fontSize: '.8rem', color: '#82796a' }}>Traitée</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </MessagePage>
    </>
  );
}
