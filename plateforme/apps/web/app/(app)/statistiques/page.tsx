import { apiFetch, requireSession, can } from '@/lib/session';
import { anneeAffichee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';

export const dynamic = 'force-dynamic';

interface Sexe {
  m: number;
  f: number;
  nd: number;
  total: number;
}

interface Statistiques {
  profs: Sexe;
  staff: Sexe;
  admins: Sexe;
  etudiants: Sexe;
  parNiveau: { niveau: string; m: number; f: number; total: number }[];
  parGroupe: { groupe: string; niveau: string; m: number; f: number; total: number }[];
}

const VIDE: Sexe = { m: 0, f: 0, nd: 0, total: 0 };

/** Son `carte_sexe($titre, $c)`. */
function CarteSexe({ titre, c }: { titre: string; c: Sexe }) {
  return (
    <div className="form-card">
      <h4 style={{ marginTop: 0 }}>{titre}</h4>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, textAlign: 'center', background: '#eff6ff', borderRadius: 10, padding: '.75rem' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#2563eb' }}>{c.m}</div>
          <div className="text-muted" style={{ fontSize: '.8rem' }}>Masculin</div>
        </div>
        <div style={{ flex: 1, textAlign: 'center', background: '#fdf2f8', borderRadius: 10, padding: '.75rem' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#db2777' }}>{c.f}</div>
          <div className="text-muted" style={{ fontSize: '.8rem' }}>Féminin</div>
        </div>
        <div style={{ flex: 1, textAlign: 'center', background: '#f9fafb', borderRadius: 10, padding: '.75rem' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#645c50' }}>{c.total}</div>
          <div className="text-muted" style={{ fontSize: '.8rem' }}>Total{c.nd > 0 ? ` (${c.nd} n.d.)` : ''}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * STATISTIQUES — `pages/super_admin/statistiques.php` : « Répartition par
 * sexe — personnel et étudiants ». Quatre cartes (Professeurs, Staff,
 * Administrateurs, Étudiants), puis les élèves de l'année consultée par
 * niveau et par groupe.
 */
export default async function StatistiquesPage() {
  const { user } = await requireSession();

  // Son `require_role(['super_admin', 'admin'])` — la permission que ces deux rôles portent.
  if (!can(user, 'statistiques.consulter')) {
    return (
      <>
        <PageHeader titre="Statistiques" sousTitre="Répartition par sexe — personnel et étudiants" />
        <div className="form-card">
          <p className="text-muted">
            Cette page demande la permission <code>statistiques.consulter</code>.
          </p>
        </div>
      </>
    );
  }

  // Son `$an_stat = annee_defaut()` : l'année consultée.
  const annee = await anneeAffichee();
  const stats = annee
    ? await apiFetch<Statistiques>(`/reports/statistics?academicYearId=${annee.id}`).catch(() => null)
    : null;

  return (
    <>
      <PageHeader titre="Statistiques" sousTitre="Répartition par sexe — personnel et étudiants" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <CarteSexe titre="Professeurs" c={stats?.profs ?? VIDE} />
        <CarteSexe titre="Staff" c={stats?.staff ?? VIDE} />
        <CarteSexe titre="Administrateurs" c={stats?.admins ?? VIDE} />
        <CarteSexe titre="Étudiants" c={stats?.etudiants ?? VIDE} />
      </div>

      <div className="table-container" style={{ marginBottom: '1.5rem' }}>
        <div className="table-header"><h3>Étudiants par niveau</h3></div>
        <div className="overflow-x">
          <table>
            <thead><tr><th>Niveau</th><th>Masculin</th><th>Féminin</th><th>Total</th></tr></thead>
            <tbody>
              {(stats?.parNiveau ?? []).map((r) => (
                <tr key={r.niveau}>
                  <td><strong>{r.niveau}</strong></td>
                  <td style={{ color: '#2563eb' }}>{r.m}</td>
                  <td style={{ color: '#db2777' }}>{r.f}</td>
                  <td><strong>{r.total}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="table-container">
        <div className="table-header"><h3>Étudiants par groupe</h3></div>
        <div className="overflow-x">
          <table>
            <thead><tr><th>Niveau</th><th>Groupe</th><th>Masculin</th><th>Féminin</th><th>Total</th></tr></thead>
            <tbody>
              {(stats?.parGroupe ?? []).map((r, i) => (
                <tr key={`${r.niveau}-${r.groupe}-${i}`}>
                  <td>{r.niveau}</td>
                  <td><strong>{r.groupe}</strong></td>
                  <td style={{ color: '#2563eb' }}>{r.m}</td>
                  <td style={{ color: '#db2777' }}>{r.f}</td>
                  <td><strong>{r.total}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
