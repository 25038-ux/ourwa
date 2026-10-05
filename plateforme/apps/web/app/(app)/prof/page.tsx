import { apiFetch, requireSession, nulSiIntrouvable } from '@/lib/session';
import { anneeAffichee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';
import { mru } from '@/components/hub';

export const dynamic = 'force-dynamic';

interface Enseignement {
  id: string;
  heures_par_semaine: string;
  groupe_nom: string;
  niveau_nom: string | null;
  matiere_nom: string;
  nb_etudiants: number;
  nb_notes: number;
}

interface TableauBord {
  prenom: string;
  nom: string;
  nb_classes: number;
  prix_par_heure: string;
  enseignements: Enseignement[];
}

/** Son `number_format($x, 1, ',', ' ')`. */
function h1(v: number): string {
  const [ent, dec] = v.toFixed(1).split('.');
  return `${ent!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${dec}`;
}

/**
 * TABLEAU DE BORD DU PROFESSEUR — `pages/professeur/tableau_bord.php` :
 * « Bienvenue, Prénom Nom » ; quatre tuiles (Mes classes, Heures / semaine,
 * Tarif horaire, Salaire mensuel) ; « Détail de mon salaire mensuel » =
 * heures × 4 semaines × tarif ; ses enseignements groupés par niveau.
 */
export default async function ProfDashboard() {
  const { user } = await requireSession();
  const roles = user.roles;

  // Son `require_role('professeur')`.
  if (!roles.includes('professeur')) {
    return (
      <>
        <PageHeader titre="Tableau de bord" sousTitre="Espace professeur" />
        <div className="form-card">
          <p className="text-muted">Cette page est réservée aux professeurs.</p>
        </div>
      </>
    );
  }

  const annee = await anneeAffichee();
  const tb = await apiFetch<TableauBord | null>(
    `/teacher/tableau-bord${annee ? `?academicYearId=${annee.id}` : ''}`,
  ).catch(nulSiIntrouvable);

  // Son `die('Erreur : profil professeur introuvable.')`.
  if (!tb) {
    return (
      <>
        <PageHeader titre="Tableau de bord" sousTitre="Espace professeur" />
        <div className="alert alert-error">Erreur : profil professeur introuvable.</div>
      </>
    );
  }

  // Group by Niveau for display
  const parNiveau = new Map<string, Enseignement[]>();
  for (const ens of tb.enseignements) {
    const niv = ens.niveau_nom ?? 'Sans niveau';
    if (!parNiveau.has(niv)) parNiveau.set(niv, []);
    parNiveau.get(niv)!.push(ens);
  }

  // Calculs
  const totalHSem = tb.enseignements.reduce((n, e) => n + Number(e.heures_par_semaine), 0);
  const tarif = Number(tb.prix_par_heure);
  const heuresMois = totalHSem * 4;
  const salaire = heuresMois * tarif;

  return (
    <>
      <PageHeader titre="Tableau de bord" sousTitre={`Bienvenue, ${tb.prenom} ${tb.nom}`} />

      {/* KPIs */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347" /></svg>
          </div>
          <p className="kpi-label">Mes classes</p>
          <p className="kpi-value">{tb.nb_classes}</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <p className="kpi-label">Heures / semaine</p>
          <p className="kpi-value">{h1(totalHSem)}h</p>
          <p className="kpi-detail">soit {mru(heuresMois)}h / mois</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <p className="kpi-label">Tarif horaire</p>
          <p className="kpi-value">{mru(tarif)}</p>
          <p className="kpi-detail">MRU / heure</p>
        </div>
        <div className="kpi-card kpi-success">
          <div className="kpi-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" /></svg>
          </div>
          <p className="kpi-label">Salaire mensuel</p>
          <p className="kpi-value" style={{ color: 'var(--success)' }}>{mru(salaire)}</p>
          <p className="kpi-detail">MRU</p>
        </div>
      </div>

      {/* Salary detail */}
      <div className="form-card" style={{ maxWidth: '100%' }}>
        <h3>Détail de mon salaire mensuel</h3>
        <p style={{ fontSize: '1.05rem', color: 'var(--text)', lineHeight: 1.8 }}>
          <strong>{h1(totalHSem)} h/semaine</strong>
          {' × '}<strong>4 semaines</strong>
          {' × '}<strong>{mru(tarif)} MRU/h</strong>
          {' = '}
          <span style={{ color: 'var(--success)', fontWeight: 800, fontSize: '1.3rem' }}>
            {mru(salaire)} MRU
          </span>
        </p>
        {tarif === 0 && (
          <div className="alert alert-info" style={{ marginTop: '.75rem', fontSize: '.85rem' }}>
            Votre tarif horaire n&apos;a pas encore été défini par l&apos;administration.
          </div>
        )}
      </div>

      {/* Enseignements grouped by Niveau */}
      {[...parNiveau.entries()].map(([niveauNom, ensNiv]) => (
        <div key={niveauNom} className="table-container" style={{ marginBottom: '1.5rem' }}>
          <div className="table-header">
            <h3>📚 {niveauNom}</h3>
            <span className="badge badge-primary">{ensNiv.length} matière(s)</span>
          </div>
          <div className="overflow-x">
            <table>
              <thead>
                <tr>
                  <th>Groupe</th>
                  <th>Matière</th>
                  <th>Heures / sem</th>
                  <th>Étudiants</th>
                  <th>Notes saisies</th>
                </tr>
              </thead>
              <tbody>
                {ensNiv.map((ens) => (
                  <tr key={ens.id}>
                    <td><strong>{ens.groupe_nom}</strong></td>
                    <td>{ens.matiere_nom}</td>
                    <td><strong>{h1(Number(ens.heures_par_semaine))}</strong> h</td>
                    <td>{ens.nb_etudiants}</td>
                    <td><span className="badge badge-success">{ens.nb_notes}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {tb.enseignements.length === 0 && (
        <div className="empty-state">
          <p>Aucun enseignement assigné pour le moment.</p>
        </div>
      )}
    </>
  );
}
