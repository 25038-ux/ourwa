import { apiFetch, requireSession, can } from '@/lib/session';
import { PageHeader } from '@/components/page-header';
import { Empty } from '@/components/states';
import { JourForm } from './jour-form';

export const dynamic = 'force-dynamic';

interface Connexion {
  full_name: string;
  phone: string | null;
  role: string | null;
  connected_at: string;
  disconnected_at: string | null;
  ip: string | null;
}

interface Reponse {
  rows: Connexion[];
  truncated: boolean;
  max: number;
}

/** `date('d/m/Y')` — le format de son titre. */
function jourFr(iso: string): string {
  const [a, m, j] = iso.split('-');
  return `${j}/${m}/${a}`;
}

/** `date('d/m/Y H:i:s')` — le format de ses cellules. */
function horodatage(value: string): string {
  const d = new Date(value);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * HISTORIQUE DES CONNEXIONS — `pages/super_admin/historique.php`.
 *
 * ⚠ PAS UNE COLONNE NE CORRESPONDAIT. Nous affichions « Quand · Qui · Depuis ·
 * Résultat », lu depuis `login_attempts` — un journal de TENTATIVES. Sa page
 * montre les CONNEXIONS d'une journée : Nom Complet, Téléphone, Rôle, Date /
 * Heure Connexion, Déconnexion, Adresse IP. Ce n'est pas la même question : on
 * ouvre cet écran pour savoir qui était connecté ce jour-là.
 *
 * ⚠ ET IL MANQUAIT SES DEUX COMMANDES : le sélecteur « Jour à afficher », et les
 * onglets « Personnel & Enseignants » / « Parents d'élèves ». Sans le premier,
 * l'écran ne peut répondre à « qui s'est connecté mardi ».
 */
export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ jour?: string; tab?: string }>;
}) {
  const { user } = await requireSession();
  const params = await searchParams;

  const jour = /^\d{4}-\d{2}-\d{2}$/.test(params.jour ?? '')
    ? params.jour!
    : new Date().toISOString().slice(0, 10);
  const tab = params.tab === 'parent' ? 'parent' : 'staff';

  if (!can(user, 'journal.consulter')) {
    return (
      <>
        <PageHeader
          titre="Historique des connexions"
          sousTitre="Suivi de l'accès à la plateforme par date"
        />
        <div className="table-container">
          <Empty mark="🔒" title="Journal réservé">
            Il demande <code>journal.consulter</code>.
          </Empty>
        </div>
      </>
    );
  }

  /**
   * ⚠ UN `.catch()` QUI REND UNE LISTE VIDE A DÉJÀ MENTI UNE FOIS ICI. La
   * requête nommait `user_roles`, une table qui n'existe pas — la vraie est
   * `user_school_roles` — et l'écran affichait tranquillement « Aucune connexion
   * enregistrée pour ce jour » un jour où je venais de me connecter cinq fois.
   *
   * L'échec se distingue donc du vide : la page dit qu'elle n'a pas pu lire.
   */
  const data = await apiFetch<Reponse>(
    `/accounts/connection-history?jour=${jour}&tab=${tab}`,
  ).catch(() => null);

  const colonnes = tab === 'staff' ? 6 : 5;
  const lignes = data?.rows ?? [];

  return (
    <>
      <PageHeader
        titre="Historique des connexions"
        sousTitre="Suivi de l'accès à la plateforme par date"
      />

      <div
        style={{
          display: 'flex',
          gap: '1rem',
          marginBottom: '1.5rem',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
        }}
      >
        <JourForm jour={jour} tab={tab} />
      </div>

      {/* Tabs — ses deux onglets, avec ses styles en ligne. */}
      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1rem', borderBottom: '2px solid var(--border)', paddingBottom: '.5rem' }}>
        <a
          href={`/journal?tab=staff&jour=${jour}`}
          className={`btn btn-sm ${tab === 'staff' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ borderRadius: 'var(--radius) var(--radius) 0 0', marginBottom: '-0.6rem', width: 'auto' }}
        >
          Personnel &amp; Enseignants
        </a>
        <a
          href={`/journal?tab=parent&jour=${jour}`}
          className={`btn btn-sm ${tab === 'parent' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ borderRadius: 'var(--radius) var(--radius) 0 0', marginBottom: '-0.6rem', width: 'auto' }}
        >
          Parents d&apos;élèves
        </a>
      </div>

      <div className="table-container">
        <div className="table-header">
          <h3>Connexions du {jourFr(jour)}</h3>
          <span className="badge badge-primary">{lignes.length}</span>
          {/* ⚠ Une liste plafonnée qui ne le dit pas se lit comme une liste
              complète. Sa formule, au mot près. */}
          {data?.truncated && (
            <span className="badge" style={{ background: '#fdf1d8', color: '#7a4b06' }}>
              {data.max} premières — journée plus chargée
            </span>
          )}
        </div>
        <div className="overflow-x">
          <table>
            <thead>
              <tr>
                <th>Nom Complet</th>
                <th>Téléphone</th>
                {tab === 'staff' && <th>Rôle</th>}
                <th>Date / Heure Connexion</th>
                <th>Déconnexion</th>
                <th>Adresse IP</th>
              </tr>
            </thead>
            <tbody>
              {data === null ? (
                <tr>
                  <td colSpan={colonnes} className="text-center" style={{ padding: '2rem' }}>
                    <span className="text-danger">
                      L’historique n’a pas pu être chargé. Réessayez.
                    </span>
                  </td>
                </tr>
              ) : lignes.length === 0 ? (
                <tr>
                  <td
                    colSpan={colonnes}
                    className="text-center text-muted"
                    style={{ padding: '2rem' }}
                  >
                    Aucune connexion enregistrée pour ce jour.
                  </td>
                </tr>
              ) : (
                lignes.map((c, i) => (
                  <tr key={`${c.connected_at}-${i}`}>
                    <td>
                      <strong>{c.full_name}</strong>
                    </td>
                    <td>{c.phone || '—'}</td>
                    {tab === 'staff' && (
                      <td>
                        <span className="badge" style={{ background: '#fff2eb', color: '#8c491a', fontSize: '.8rem', fontWeight: 600 }}>
                          {c.role ? c.role.charAt(0).toUpperCase() + c.role.slice(1) : ''}
                        </span>
                      </td>
                    )}
                    <td>{horodatage(c.connected_at)}</td>
                    <td>
                      {c.disconnected_at
                        ? horodatage(c.disconnected_at)
                        : <span className="text-muted" style={{ fontSize: '.85rem', fontStyle: 'italic' }}>Session expirée ou active</span>}
                    </td>
                    <td><code style={{ fontSize: '.85rem', background: '#F3F4F6', padding: '.2rem .4rem', borderRadius: 4 }}>{c.ip ?? ''}</code></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
