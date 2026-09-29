import { apiFetch, requireSession, can } from '@/lib/session';
import { anneeAffichee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';
import { HubNav } from '@/components/hub';
import { AutoSubmitSelect } from '@/components/auto-submit-select';
import { MessagePage } from '@/components/message-page';
import { SCOLARITE_TABS } from '../tabs';
import { GrilleEmploi, type Case, type Enseignement } from './grille';

export const dynamic = 'force-dynamic';

interface Group {
  id: string;
  name: string;
  level_id: string | null;
  level_name: string | null;
}

interface Level {
  id: string;
  name: string;
}

/**
 * EMPLOI DU TEMPS — `pages/super_admin/emploi_du_temps.php`.
 *
 * Trois étapes EXCLUSIVES : sans `niveau_id`, le choix du niveau (soumis au
 * changement) ; sans `groupe_id`, « ← Changer de niveau » et les groupes du
 * niveau en boutons ; puis les deux liens de retour et, soit l'avertissement
 * « Aucune matière n'a encore été assignée à ce groupe », soit le récapitulatif
 * des quotas, la grille 7 jours × 3 créneaux, le bouton de validation et la
 * modale de choix. Les enseignements sont ses `SQL_ENS_COURANTS` : une
 * affectation par matière, la plus récente, toutes années confondues.
 *
 * Son `$titre_page` n'est jamais vu : le hub charge l'onglet en `?embed=1` et
 * `layout_header.php` sort avant le `page-header`. Le titre est celui de la
 * coquille.
 */
export default async function TimetablePage({
  searchParams,
}: {
  searchParams: Promise<{ niveau_id?: string; groupe_id?: string }>;
}) {
  const params = await searchParams;
  const { user } = await requireSession();

  const mayRead = can(user, 'scolarite.groupes', 'notes.consulter', 'absences.consulter');
  const mayEdit = can(user, 'scolarite.groupes');

  const coquille = (contenu: React.ReactNode) => (
    <>
      <PageHeader titre="Gestion de scolarité" sousTitre="Emploi du temps, absences, groupes, niveaux, exclusions et notes" />
      <div className="hub-shell">
        <HubNav tabs={SCOLARITE_TABS} active="emploi" label="Sections Scolarité" />
        <div className="hub-panel">
          <MessagePage>{contenu}</MessagePage>
        </div>
      </div>
    </>
  );

  if (!mayRead) {
    return coquille(
      <div className="form-card">
        <p className="text-muted">
          Cette page demande <code>scolarite.groupes</code>, <code>notes.consulter</code> ou{' '}
          <code>absences.consulter</code>.
        </p>
      </div>,
    );
  }

  const niveauId = params.niveau_id ?? '';
  const groupeId = params.groupe_id ?? '';

  // ÉTAPE 1 : tous les niveaux, `ORDER BY cycle, ordre, nom`.
  if (!niveauId) {
    const niveaux = await apiFetch<Level[]>('/levels').catch(() => [] as Level[]);
    return coquille(
      <div className="form-card">
        <h3>Étape 1 : Sélectionner un niveau</h3>
        <form method="GET">
          <div className="form-group">
            <label htmlFor="niveau_id">Niveau</label>
            <AutoSubmitSelect
              id="niveau_id"
              name="niveau_id"
              defaultValue=""
              options={[{ value: '', label: '— Choisir un niveau —' }, ...niveaux.map((n) => ({ value: n.id, label: n.name }))]}
            />
          </div>
        </form>
      </div>,
    );
  }

  const groups = await apiFetch<Group[]>('/groups').catch(() => [] as Group[]);
  const groupesDuNiveau = groups.filter((g) => g.level_id === niveauId).sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  // ÉTAPE 2 : les groupes du niveau.
  if (!groupeId) {
    return coquille(
      <>
        <div style={{ marginBottom: '1rem' }}>
          <a href="/scolarite/emploi" className="btn btn-secondary">← Changer de niveau</a>
        </div>
        <div className="form-card">
          <h3>Étape 2 : Sélectionner un groupe</h3>
          {groupesDuNiveau.length === 0 ? (
            <div className="alert alert-info">Aucun groupe dans ce niveau.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: '.75rem', marginTop: '1rem' }}>
              {groupesDuNiveau.map((g) => (
                <a
                  key={g.id}
                  href={`/scolarite/emploi?niveau_id=${niveauId}&groupe_id=${g.id}`}
                  className="btn btn-primary"
                  style={{ width: 'auto', justifyContent: 'center' }}
                >
                  {g.name}
                </a>
              ))}
            </div>
          )}
        </div>
      </>,
    );
  }

  // ÉTAPE 3 : la grille. L'année de la validation est `annee_defaut()`.
  const [cases, enseignements, vue] = await Promise.all([
    apiFetch<Case[]>(`/timetable/group/${groupeId}`).catch(() => [] as Case[]),
    apiFetch<Enseignement[]>(`/timetable/group/${groupeId}/teachings`).catch(() => [] as Enseignement[]),
    anneeAffichee(),
  ]);

  return coquille(
    <>
      <div style={{ marginBottom: '1rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
        <a href={`/scolarite/emploi?niveau_id=${niveauId}`} className="btn btn-secondary">← Changer de groupe</a>
        <a href="/scolarite/emploi" className="btn btn-secondary">← Changer de niveau</a>
      </div>

      {enseignements.length === 0 ? (
        <div className="alert alert-warning">
          ⚠ Aucune matière n&apos;a encore été assignée à ce groupe.<br />
          Allez dans « Gérer les professeurs » pour assigner des matières + heures avant de bâtir l&apos;emploi du temps.
        </div>
      ) : (
        <GrilleEmploi
          groupeId={groupeId}
          academicYearId={vue?.id ?? ''}
          cases={cases}
          enseignements={enseignements}
          editable={mayEdit}
        />
      )}
    </>,
  );
}
