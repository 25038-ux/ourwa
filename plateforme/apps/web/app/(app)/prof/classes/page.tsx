import { apiFetch, requireSession } from '@/lib/session';
import { anneeAffichee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';

export const dynamic = 'force-dynamic';

interface Classe {
  group_id: string;
  group_name: string;
  level_name: string | null;
  subjects: string;
  headcount: number;
  capacity: number;
}

interface Detail {
  groupe: { name: string; level_name: string | null };
  etudiants: { id: string; matricule: string | null; first_name: string; last_name: string }[];
}

/**
 * MES CLASSES — `pages/professeur/mes_classes.php` : « Détail de vos groupes
 * assignés par niveau ». Un `table-container` par niveau (Groupe / Matières
 * enseignées / Étudiants `effectif / capacité` / « Voir les étudiants ») et,
 * au-dessus, la liste du groupe demandé (`?groupe=`) : # / Identifiant / Nom
 * complet, « ← Retour ». Un groupe qui n'est pas le sien n'affiche rien.
 */
export default async function MesClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ groupe?: string }>;
}) {
  const { user } = await requireSession();
  const { groupe } = await searchParams;

  // Son `require_role('professeur')`.
  if (!user.roles.includes('professeur')) {
    return (
      <>
        <PageHeader titre="Mes classes" sousTitre="Détail de vos groupes assignés par niveau" />
        <div className="form-card">
          <p className="text-muted">Cette page est réservée aux professeurs.</p>
        </div>
      </>
    );
  }

  const annee = await anneeAffichee();
  const q = annee ? `?academicYearId=${annee.id}` : '';
  const classes = await apiFetch<Classe[]>(`/teacher/my-groups${q}`).catch(() => [] as Classe[]);

  // Détail d'un groupe si demandé — la garde est celle de l'API ; refusé, rien n'est rendu.
  const detail = groupe
    ? await apiFetch<Detail>(`/teacher/my-roster/${encodeURIComponent(groupe)}${q}`).catch(() => null)
    : null;

  // Group by niveau for display
  const parNiveau = new Map<string, Classe[]>();
  for (const c of classes) {
    const cle = c.level_name ?? 'Sans niveau';
    if (!parNiveau.has(cle)) parNiveau.set(cle, []);
    parNiveau.get(cle)!.push(c);
  }

  return (
    <>
      <PageHeader titre="Mes classes" sousTitre="Détail de vos groupes assignés par niveau" />

      {detail && (
        <div className="table-container mb-2">
          <div className="table-header">
            <h3>📋 {detail.groupe.name} — {detail.groupe.level_name ?? '—'}</h3>
            <a href="/prof/classes" className="btn btn-sm btn-secondary">← Retour</a>
          </div>
          <div className="overflow-x">
            <table>
              <thead><tr><th>#</th><th>Identifiant</th><th>Nom complet</th></tr></thead>
              <tbody>
                {detail.etudiants.map((et, i) => (
                  <tr key={et.id}>
                    <td>{i + 1}</td>
                    <td><strong>{et.matricule ?? ''}</strong></td>
                    <td>{et.first_name} {et.last_name}</td>
                  </tr>
                ))}
                {detail.etudiants.length === 0 && (
                  <tr><td colSpan={3} className="text-center text-muted" style={{ padding: '2rem' }}>Aucun étudiant.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {[...parNiveau.entries()].map(([niveauNom, groupesNiv]) => (
        <div key={niveauNom} className="table-container" style={{ marginBottom: '1.5rem' }}>
          <div className="table-header"><h3>📚 {niveauNom}</h3></div>
          <div className="overflow-x">
            <table>
              <thead><tr><th>Groupe</th><th>Matières enseignées</th><th>Étudiants</th><th>Actions</th></tr></thead>
              <tbody>
                {groupesNiv.map((g) => (
                  <tr key={g.group_id}>
                    <td><strong>{g.group_name}</strong></td>
                    <td>{g.subjects}</td>
                    <td>{g.headcount} / {g.capacity}</td>
                    <td><a href={`?groupe=${g.group_id}`} className="btn btn-sm btn-secondary">Voir les étudiants</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {classes.length === 0 && (
        <div className="empty-state">
          <p>Aucun groupe assigné.</p>
        </div>
      )}
    </>
  );
}
