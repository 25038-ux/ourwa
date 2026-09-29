import { apiFetch, requireSession, can } from '@/lib/session';
import { PageHeader } from '@/components/page-header';
import { MessagePage } from '@/components/message-page';
import {
  FicheEtudiant,
  FicheProfesseur,
  type Enseignement,
  type Etudiant,
  type Note,
  type Professeur,
} from './profils';

export const dynamic = 'force-dynamic';

interface Results {
  query: string;
  total: number;
  students: {
    id: string;
    first_name: string;
    last_name: string;
    matricule: string | null;
    group_name: string | null;
    level_name: string | null;
  }[];
  teachers: {
    id: string;
    first_name: string;
    last_name: string;
    identifiant: string | null;
    nb_classes: number;
  }[];
}

/**
 * RECHERCHE — `pages/super_admin/recherche.php` : « Rechercher un étudiant ou
 * un professeur ». La carte de recherche, puis SOIT la fiche demandée
 * (`?type=etudiant|professeur&profil_id=…`, avec « ← Retour » vers la même
 * recherche), SOIT « Étudiants trouvés » et « Professeurs trouvés », SOIT son
 * état vide « Aucun résultat trouvé pour « q » ».
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; profil_id?: string }>;
}) {
  const { q, type, profil_id: profilId } = await searchParams;
  const { user } = await requireSession();

  // Son `require_staff_admin()`.
  if (!can(user, 'recherche.globale')) {
    return (
      <>
        <PageHeader titre="Recherche" sousTitre="Rechercher un étudiant ou un professeur" />
        <div className="form-card">
          <p className="text-muted">Cette page demande la permission <code>recherche.globale</code>.</p>
        </div>
      </>
    );
  }

  const query = (q ?? '').trim();

  const fiche =
    (type === 'etudiant' || type === 'professeur') && profilId
      ? await apiFetch<
          | { student: Etudiant; grades: Note[] }
          | { teacher: Professeur; teachings: Enseignement[] }
        >(`/search/${type === 'etudiant' ? 'student' : 'teacher'}/${profilId}`).catch(() => null)
      : null;

  // Son « ← Retour » : `recherche.php?q=…`.
  const retour = `/search?q=${encodeURIComponent(query)}`;

  // Sa règle : rien en dessous de deux caractères — et alors « Aucun résultat ».
  const results =
    !fiche && query.length >= 2
      ? await apiFetch<Results>(`/search?q=${encodeURIComponent(query)}`).catch(() => null)
      : null;
  const etudiants = results?.students ?? [];
  const profs = results?.teachers ?? [];

  return (
    <>
      <PageHeader titre="Recherche" sousTitre="Rechercher un étudiant ou un professeur" />
      <MessagePage>
        {/* Search Form */}
        <div className="form-card" style={{ maxWidth: '100%' }}>
          <h3>Rechercher</h3>
          <form method="GET" id="form-recherche">
            <div className="form-row">
              <div className="form-group" style={{ flex: 3 }}>
                <label htmlFor="q">Nom, prénom ou identifiant</label>
                <input type="text" id="q" name="q" defaultValue={query} placeholder="Tapez au moins 2 caractères..." autoFocus required minLength={2} />
              </div>
              <div className="form-group" style={{ flex: 1, display: 'flex', alignItems: 'flex-end' }}>
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Rechercher</button>
              </div>
            </div>
          </form>
        </div>

        {fiche && 'student' in fiche ? (
          <FicheEtudiant etudiant={fiche.student} notes={fiche.grades} retour={retour} peutExpulser={can(user, 'scolarite.inscrire')} />
        ) : fiche && 'teacher' in fiche ? (
          <FicheProfesseur professeur={fiche.teacher} enseignements={fiche.teachings} retour={retour} />
        ) : query !== '' ? (
          <>
            {/* Search Results */}
            {etudiants.length > 0 && (
              <div className="table-container">
                <div className="table-header"><h3>Étudiants trouvés</h3><span className="badge badge-primary">{etudiants.length}</span></div>
                <div className="overflow-x">
                  <table>
                    <thead><tr><th>Identifiant</th><th>Nom</th><th>Niveau</th><th>Groupe</th><th>Action</th></tr></thead>
                    <tbody>
                      {etudiants.map((et) => (
                        <tr key={et.id}>
                          <td><strong>{et.matricule ?? ''}</strong></td>
                          <td>{et.first_name} {et.last_name}</td>
                          <td><span className="badge badge-primary">{et.level_name ?? '—'}</span></td>
                          <td>{et.group_name ?? ''}</td>
                          <td><a href={`/search?type=etudiant&profil_id=${et.id}&q=${encodeURIComponent(query)}`} className="btn btn-sm btn-secondary">Voir profil</a></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {profs.length > 0 && (
              <div className="table-container">
                <div className="table-header"><h3>Professeurs trouvés</h3><span className="badge badge-primary">{profs.length}</span></div>
                <div className="overflow-x">
                  <table>
                    <thead><tr><th>Identifiant</th><th>Nom</th><th>Classes</th><th>Action</th></tr></thead>
                    <tbody>
                      {profs.map((p) => (
                        <tr key={p.id}>
                          <td><strong>{p.identifiant ?? ''}</strong></td>
                          <td>{p.first_name} {p.last_name}</td>
                          <td><span className="badge badge-primary">{p.nb_classes}</span></td>
                          <td><a href={`/search?type=professeur&profil_id=${p.id}&q=${encodeURIComponent(query)}`} className="btn btn-sm btn-secondary">Voir profil</a></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {etudiants.length === 0 && profs.length === 0 && (
              <div className="empty-state">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
                <p>Aucun résultat trouvé pour « {query} »</p>
              </div>
            )}
          </>
        ) : null}
      </MessagePage>
    </>
  );
}
