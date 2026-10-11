import { apiFetch, requireSession, can } from '@/lib/session';
import { PageHeader } from '@/components/page-header';
import { MessagePage } from '@/components/message-page';
import { GererParent } from './gerer';
import { formatTelephone } from '@/lib/telephone';
import type { Annee } from '@/lib/annee';

export const dynamic = 'force-dynamic';

interface Parent {
  user_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  /** Les numéros supplémentaires (0041), canoniques, avec leur libellé. */
  phones?: { phone: string; label: string | null }[];
  active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  children: number;
  /** Enfants inscrits l'année filtrée ; `null` sans filtre d'année. */
  children_in_year?: number | null;
}

/** Sa `derniere_connexion` telle quelle : « YYYY-MM-DD HH:MM:SS ». */
function dateSql(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * COMPTES DES PARENTS — `pages/super_admin/comptes_parents.php` : la recherche
 * (nom ou téléphone), la table Parent / Identifiant (téléphone) / Enfants /
 * Statut / Dernière connexion / Actions, et par ligne « Identifiant »,
 * « Reset mdp », « Désactiver » / « Réactiver ». Pages de 50.
 *
 * ⚠ DEUX FILTRES QUI NE SONT PAS CHEZ LUI (07/10/2026, demande du propriétaire) :
 * « Année » — les familles ACTIVES d'une année (un enfant inscrit, inscription non
 * annulée) — et « Sans numéro seulement ». Sur 1 372 familles reprises, 1 073
 * n'ont pas de vrai numéro ; il les saisit lui-même, et ne veut voir que celles
 * de l'année. Sans filtre, la page est celle d'avant.
 */
export default async function ComptesParentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string; annee?: string; sans_numero?: string }>;
}) {
  const { user } = await requireSession();

  // Son `require_staff_admin()` : super_admin et admin — ceux qui détiennent `comptes.parents`.
  if (!can(user, 'comptes.parents')) {
    return (
      <>
        <PageHeader titre="Comptes des parents" sousTitre="Identifiants et mots de passe des comptes parents" />
        <div className="form-card">
          <p className="text-muted">Cette page demande la permission <code>comptes.parents</code>.</p>
        </div>
      </>
    );
  }

  const { q, cursor, annee, sans_numero: sansNumeroBrut } = await searchParams;
  const recherche = (q ?? '').trim();
  const annees = await apiFetch<Annee[]>('/academic-years').catch(() => [] as Annee[]);
  // Une année qui n'est pas de la liste est ignorée : jamais un identifiant libre vers l'API.
  const anneeChoisie = annees.find((a) => a.id === annee) ?? null;
  const sansNumero = sansNumeroBrut === '1';
  const filtres: Record<string, string> = {
    ...(recherche ? { q: recherche } : {}),
    ...(anneeChoisie ? { annee: anneeChoisie.id } : {}),
    ...(sansNumero ? { sans_numero: '1' } : {}),
  };
  const query = new URLSearchParams();
  if (recherche) query.set('q', recherche);
  if (anneeChoisie) query.set('academicYearId', anneeChoisie.id);
  if (sansNumero) query.set('sansNumero', '1');
  if (cursor) query.set('cursor', cursor);

  const data = await apiFetch<{ rows: Parent[]; nextCursor: string | null }>(
    `/accounts/parents?${query}`,
  ).catch(() => ({ rows: [] as Parent[], nextCursor: null }));
  const parents = data.rows;

  return (
    <>
      <PageHeader titre="Comptes des parents" sousTitre="Identifiants et mots de passe des comptes parents" />
      <MessagePage>
        <div className="form-card" style={{ marginBottom: '1.5rem' }}>
          <form method="GET" style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label htmlFor="q">Rechercher un parent par identifiant (nom ou téléphone)</label>
              <input type="text" id="q" name="q" defaultValue={recherche} placeholder="Ex : Mohamed, ou 22 12 34 56" autoFocus />
            </div>
            <div style={{ minWidth: 170 }}>
              <label htmlFor="annee">Année (familles actives)</label>
              <select id="annee" name="annee" defaultValue={anneeChoisie?.id ?? ''}>
                <option value="">Toutes les années</option>
                {annees.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </div>
            <label htmlFor="sans_numero" style={{ display: 'flex', alignItems: 'center', gap: '.4rem', margin: 0, paddingBottom: '.55rem' }}>
              <input type="checkbox" id="sans_numero" name="sans_numero" value="1" defaultChecked={sansNumero} style={{ width: 'auto' }} />
              Sans numéro seulement
            </label>
            <button className="btn btn-primary" style={{ width: 'auto' }}>Rechercher</button>
            {Object.keys(filtres).length > 0 && (
              <a href="/comptes/parents" className="btn btn-secondary">Réinitialiser</a>
            )}
          </form>
        </div>

        <div className="table-container">
          <div className="table-header">
            <h3>
              Comptes parents
              {anneeChoisie && <small className="text-muted" style={{ fontWeight: 400 }}> — actifs en {anneeChoisie.label}</small>}
              {sansNumero && <small className="text-muted" style={{ fontWeight: 400 }}> — sans numéro</small>}
            </h3>
            <span className="badge badge-primary">{parents.length}</span>
          </div>
          <div className="overflow-x">
            <table>
              <thead>
                <tr><th>Parent</th><th>Identifiant (téléphone)</th><th>Enfants</th><th>Statut</th><th>Dernière connexion</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {parents.map((p) => (
                  <tr key={p.user_id}>
                    <td>
                      <strong>{p.full_name}</strong>
                      {p.email && <><br /><small className="text-muted">{p.email}</small></>}
                    </td>
                    <td>
                      <code>{p.phone ?? ''}</code>
                      {(p.phones ?? []).map((t) => (
                        <span key={t.phone}><br /><small className="text-muted">+ {formatTelephone(t.phone)}{t.label ? ` (${t.label})` : ''}</small></span>
                      ))}
                      {p.must_change_password && (
                        <><br /><small style={{ color: 'var(--secondary)' }}>⚠ Doit changer mdp</small></>
                      )}
                    </td>
                    <td>
                      {/* Avec le filtre d'année : les enfants inscrits cette année-là, puis le total. */}
                      <span className="badge badge-primary">{anneeChoisie ? (p.children_in_year ?? 0) : p.children}</span>
                      {anneeChoisie && p.children !== (p.children_in_year ?? 0) && (
                        <small className="text-muted"> sur {p.children}</small>
                      )}
                    </td>
                    <td>
                      {p.active
                        ? <span style={{ color: 'var(--success)' }}>Actif</span>
                        : <span style={{ color: 'var(--error)' }}>Inactif</span>}
                    </td>
                    <td><small>{p.last_login_at ? dateSql(p.last_login_at) : 'Jamais'}</small></td>
                    <td>
                      <GererParent
                        parentId={p.user_id}
                        nom={p.full_name}
                        telephone={p.phone}
                        telephones={p.phones ?? []}
                        actif={p.active}
                        // Réinitialiser un mot de passe est au super administrateur seul (décision du propriétaire, 2026-09-04).
                        peutReinitialiser={user.roles.includes('super_admin')}
                      />
                    </td>
                  </tr>
                ))}
                {parents.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-muted">Aucun parent.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Son `afficher_pagination()` — ici un curseur (règle 17), donc « Suivant › » seul. */}
        {data.nextCursor && (
          <nav className="pagination" style={{ display: 'flex', gap: '.3rem', justifyContent: 'center', margin: '1.5rem 0', flexWrap: 'wrap' }}>
            <a
              className="btn btn-sm btn-secondary"
              href={`/comptes/parents?${new URLSearchParams({ ...filtres, cursor: data.nextCursor })}`}
            >
              Suivant ›
            </a>
          </nav>
        )}
      </MessagePage>
    </>
  );
}
