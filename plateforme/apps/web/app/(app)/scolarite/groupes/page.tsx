import { apiFetch, requireSession } from '@/lib/session';
import { anneeAffichee } from '@/lib/annee';
import { currentSchool } from '@/lib/tenant';
import { PageHeader } from '@/components/page-header';
import { HubNav, mru } from '@/components/hub';
import { MessagePage } from '@/components/message-page';
import { SupprimerGroupe } from './supprimer-groupe';
import { RetirerEleve } from './retirer-eleve';
import { BoutonsListe } from './boutons-liste';
import { SCOLARITE_TABS } from '../tabs';
import { MARQUE } from '@/lib/brand';

export const dynamic = 'force-dynamic';

/** One joined row from `/hierarchy`: a level, and one of its groups. */
interface Row {
  level_id: string | null;
  level_name: string | null;
  monthly_rate: string | null;
  level_headcount: number;
  group_id: string | null;
  group_name: string | null;
  capacity: number | null;
  headcount: number;
}

interface Groupe {
  group_id: string;
  group_name: string;
  capacity: number | null;
  headcount: number;
}

interface Niveau {
  level_id: string | null;
  level_name: string | null;
  monthlyRate: string | null;
  headcount: number;
  groups: Groupe[];
}

interface Eleve {
  id: string;
  matricule: string | null;
  rim: string | null;
  national_id: string | null;
  first_name: string;
  last_name: string;
  sex: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  date_inscription: string;
}

const dateFr = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

/**
 * GESTION DE GROUPES — `pages/super_admin/gestion_groupes.php` : « Vue
 * hiérarchique : Niveau → Groupes → Étudiants ».
 *
 * Deux vues EXCLUSIVES. Avec `groupe_id` : « ← Retour », « Exporter Excel »,
 * « Imprimer / PDF », le titre à badge, « Capacité : N · Tarif : X MRU/mois »,
 * l'en-tête d'impression, puis la table « Étudiants » à onze colonnes. Sinon :
 * un bloc par niveau (tarif dans le titre, badge « N étudiant(s) » de l'année
 * consultée), ses groupes par nom avec le badge « inscrits / capacité »,
 * « Voir étudiants » et « Supprimer » sur une classe vide ; ou « Aucun niveau
 * créé ». Les effectifs sont ceux de l'ANNÉE CONSULTÉE.
 */
export default async function GroupesPage({
  searchParams,
}: {
  searchParams: Promise<{ groupe_id?: string }>;
}) {
  await requireSession();
  const { groupe_id: groupeId } = await searchParams;
  const year = await anneeAffichee();

  const coquille = (contenu: React.ReactNode) => (
    <>
      <PageHeader titre="Gestion de scolarité" sousTitre="Emploi du temps, absences, groupes, niveaux, exclusions et notes" />
      <div className="hub-shell">
        <HubNav tabs={SCOLARITE_TABS} active="groupes" label="Sections Scolarité" />
        <div className="hub-panel">
          <MessagePage>{contenu}</MessagePage>
        </div>
      </div>
    </>
  );

  const rows = year
    ? await apiFetch<Row[]>(`/hierarchy?academicYearId=${year.id}`).catch(() => [] as Row[])
    : [];

  // `/hierarchy` returns the join flat — one row per group, repeating its level.
  const hierarchy: Niveau[] = [];
  for (const row of rows) {
    let niveau = hierarchy.find((n) => n.level_id === row.level_id);
    if (!niveau) {
      niveau = {
        level_id: row.level_id,
        level_name: row.level_name,
        monthlyRate: row.monthly_rate,
        headcount: row.level_headcount ?? 0,
        groups: [],
      };
      hierarchy.push(niveau);
    }
    if (row.group_id && row.group_name) {
      niveau.groups.push({ group_id: row.group_id, group_name: row.group_name, capacity: row.capacity, headcount: row.headcount });
    }
  }
  for (const n of hierarchy) n.groups.sort((a, b) => a.group_name.localeCompare(b.group_name, 'fr'));

  // ══ La liste d'une classe ═══════════════════════════════════════════════
  if (groupeId) {
    const niveau = hierarchy.find((n) => n.groups.some((g) => g.group_id === groupeId));
    const groupe = niveau?.groups.find((g) => g.group_id === groupeId);
    if (!groupe) return coquille(null);

    const [etudiants, ecole] = await Promise.all([
      apiFetch<Eleve[]>(`/groups/${groupeId}/roster${year ? `?academicYearId=${year.id}` : ''}`).catch(() => [] as Eleve[]),
      currentSchool().then((s) => s?.name ?? MARQUE.nom),
    ]);
    const maintenant = new Date();
    const imprimeLe = `${dateFr(maintenant.toISOString())} ${String(maintenant.getHours()).padStart(2, '0')}:${String(maintenant.getMinutes()).padStart(2, '0')}`;

    return coquille(
      <>
        <BoutonsListe nomFichier={`liste_groupe_${groupe.group_name.replace(/ /g, '_')}.csv`} />

        <h2 style={{ color: 'var(--primary)' }}>
          <span className="badge badge-primary">{niveau?.level_name ?? '—'}</span> {groupe.group_name}
        </h2>
        <p className="text-muted" style={{ marginBottom: '1.5rem' }}>
          Capacité : {groupe.capacity ?? ''} · Tarif : {mru(niveau?.monthlyRate ?? '0')} MRU/mois
        </p>

        <div className="print-header" style={{ display: 'none' }}>
          <h1 style={{ textAlign: 'center', margin: '0 0 .25rem' }}>{ecole}</h1>
          <h2 style={{ textAlign: 'center', margin: '0 0 1rem', color: '#333' }}>
            Liste des étudiants — {niveau?.level_name ?? ''} / {groupe.group_name}
          </h2>
          <p style={{ textAlign: 'center', color: '#666', fontSize: '.9rem' }}>Imprimé le {imprimeLe}</p>
        </div>

        <div className="table-container">
          <div className="table-header">
            <h3>Étudiants</h3>
            <span className="badge badge-primary">{etudiants.length}</span>
          </div>
          <div className="overflow-x">
            <table id="table_etudiants">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Matricule</th>
                  <th>Prénom</th>
                  <th>Nom</th>
                  <th>Sexe</th>
                  <th>Parent</th>
                  <th>Tél. Parent</th>
                  <th>NNI</th>
                  <th>RIM</th>
                  <th>Inscrit le</th>
                  <th className="no-print">Action</th>
                </tr>
              </thead>
              <tbody>
                {etudiants.map((et, i) => (
                  <tr key={et.id}>
                    <td>{i + 1}</td>
                    <td><strong>{et.matricule ?? ''}</strong></td>
                    <td>{et.first_name}</td>
                    <td><strong>{et.last_name}</strong></td>
                    <td>
                      {et.sex === 'M' ? (
                        <span className="badge" style={{ background: '#E0F2FE', color: '#0369A1' }}>M</span>
                      ) : et.sex === 'F' ? (
                        <span className="badge" style={{ background: '#FCE7F3', color: '#B91C1C' }}>F</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>{et.guardian_name ?? ''}</td>
                    <td>{et.guardian_phone ?? ''}</td>
                    <td><code style={{ fontSize: '0.9rem' }}>{et.national_id || '—'}</code></td>
                    <td><code style={{ fontSize: '0.9rem' }}>{et.rim || '—'}</code></td>
                    <td>{dateFr(et.date_inscription)}</td>
                    <td className="no-print">
                      {year?.id && (
                        <RetirerEleve studentId={et.id} academicYearId={year.id} nom={`${et.first_name} ${et.last_name}`.trim()} />
                      )}
                    </td>
                  </tr>
                ))}
                {etudiants.length === 0 && (
                  <tr><td colSpan={11} className="text-center text-muted">Aucun étudiant dans ce groupe.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <style>{`
@media print {
    body { background:#fff !important; color:#000 !important; font-family: 'Inter', sans-serif !important; }
    .sidebar, .topbar, .page-header, .no-print, .alert { display:none !important; }
    .main-content { margin:0 !important; padding:0 !important; }
    .print-header { display:block !important; margin-bottom: 2rem; }
    .table-container { border: none !important; box-shadow: none !important; }
    table { width:100% !important; border-collapse:collapse !important; margin-top: 1rem; }
    th, td { border:1px solid #ddd !important; padding:8px 12px !important; font-size:.85rem !important; text-align: left; }
    th { background-color: #f3f4f6 !important; font-weight: bold !important; color: #201e1d !important; }
    tr:nth-child(even) { background-color: #f9fafb !important; }
    .badge { background:transparent !important; color:#000 !important; border:1px solid #ccc !important; padding:2px 6px !important; border-radius: 4px; }
}`}</style>
      </>,
    );
  }

  // ══ Niveau → Groupes ════════════════════════════════════════════════════
  return coquille(
    <>
      {hierarchy.map((niveau) => (
        <div key={niveau.level_id ?? 'sans'} className="table-container" style={{ marginBottom: '1.5rem' }}>
          <div className="table-header">
            <h3>
              {niveau.level_name}{' '}
              <span style={{ fontWeight: 400, fontSize: '.85rem', color: 'var(--text-muted)' }}>
                ({mru(niveau.monthlyRate ?? '0')} MRU/mois)
              </span>
            </h3>
            <span className="badge badge-primary">{niveau.headcount} étudiant(s)</span>
          </div>
          <div className="overflow-x">
            <table>
              <thead><tr><th>Groupe</th><th>Capacité</th><th>Inscrits</th><th>Actions</th></tr></thead>
              <tbody>
                {niveau.groups.map((g) => (
                  <tr key={g.group_id}>
                    <td><strong>{g.group_name}</strong></td>
                    <td>{g.capacity ?? ''}</td>
                    <td>
                      <span className={`badge ${g.headcount > 0 ? 'badge-success' : 'badge-warning'}`}>
                        {g.headcount} / {g.capacity ?? ''}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '.5rem' }}>
                        <a href={`/scolarite/groupes?groupe_id=${g.group_id}`} className="btn btn-sm btn-secondary">Voir étudiants</a>
                        {g.headcount === 0 && <SupprimerGroupe groupId={g.group_id} nom={g.group_name} />}
                      </div>
                    </td>
                  </tr>
                ))}
                {niveau.groups.length === 0 && (
                  <tr><td colSpan={4} className="text-center text-muted">Aucun groupe dans ce niveau.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {hierarchy.length === 0 && (
        <div className="empty-state">
          <p>Aucun niveau créé. <a href="/scolarite/niveaux">Créer un niveau</a> pour commencer.</p>
        </div>
      )}
    </>,
  );
}
