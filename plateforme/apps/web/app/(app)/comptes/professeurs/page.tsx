import { apiFetch, requireSession, can } from '@/lib/session';
import { anneeAffichee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';
import { MessagePage } from '@/components/message-page';
import { AssignForm } from './assign-form';
import { AssignationsExistantes, type Assignation } from './assignations';
import { SalaireForm, SupprimerProfesseur } from './lignes';
import { nomProfesseurAffichable } from '@/lib/professeur';

export const dynamic = 'force-dynamic';

interface Teacher {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  employment: string | null;
  salary?: string;
  hourly_rate?: string;
  user_id: string | null;
  identifiant: string | null;
  assignments: number;
  nb_classes: number;
  heures_courantes: string;
  monthly_pay: string;
}

/** Son `number_format($x, 0, ',', ' ')`. */
function mru(v: string | number): string {
  return String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
/** Son `number_format($h_sem, 1, ',', ' ')`. */
function heures(v: string | number): string {
  const [entier, dec] = Number(v).toFixed(1).split('.');
  return `${mru(entier ?? '0')},${dec ?? '0'}`;
}

/**
 * GÉRER LES PROFESSEURS — `pages/super_admin/gerer_professeurs.php` :
 * « Nouvelle assignation » (niveau d'abord, la matière du niveau ensuite),
 * « Professeurs & salaires » (le salaire fixe d'un permanent se corrige en
 * ligne ; l'intérimaire a « Taux par assignation ↓ »), « Assignations
 * existantes » (heures et taux corrigés en ligne, coût mensuel, suppression).
 */
export default async function GererProfesseursPage() {
  const { user } = await requireSession();

  // Son `require_staff_admin()` : super_admin et admin — ceux qui détiennent `comptes.professeurs`.
  if (!can(user, 'comptes.professeurs')) {
    return (
      <>
        <PageHeader titre="Gérer les professeurs" sousTitre="Assigner matières/groupes, définir tarifs horaires et calculer les salaires" />
        <div className="form-card">
          <p className="text-muted">Cette page demande la permission <code>comptes.professeurs</code>.</p>
        </div>
      </>
    );
  }

  const [teachers, year, niveaux, groupes, matieres, assignations] = await Promise.all([
    apiFetch<Teacher[]>('/accounts/teachers').catch(() => [] as Teacher[]),
    anneeAffichee(),
    apiFetch<{ id: string; name: string }[]>('/levels').catch(() => []),
    apiFetch<{ id: string; name: string; level_id: string | null; level_name: string | null }[]>('/groups').catch(() => []),
    apiFetch<{ id: string; name: string; level_id: string | null }[]>('/subjects').catch(() => []),
    apiFetch<Assignation[]>('/teachings/courantes').catch(() => [] as Assignation[]),
  ]);

  return (
    <>
      <PageHeader
        titre="Gérer les professeurs"
        sousTitre="Assigner matières/groupes, définir tarifs horaires et calculer les salaires"
      />
      <MessagePage>
        <AssignForm
          profs={teachers.map((t) => ({
            id: t.id,
            name: `${t.first_name} ${t.last_name}`.trim(),
            employment: t.employment ?? 'permanent',
          }))}
          niveaux={niveaux}
          groupes={groupes.map((g) => ({ id: g.id, name: g.name, levelId: g.level_id, levelName: g.level_name }))}
          matieres={matieres.filter((m) => m.level_id).map((m) => ({ id: m.id, name: m.name, levelId: m.level_id! }))}
          academicYearId={year?.id ?? ''}
          yearLabel={year?.label ?? ''}
        />

        {/* Professors Table */}
        <div className="table-container">
          <div className="table-header">
            <h3>Professeurs &amp; salaires</h3>
            <span className="badge badge-primary">{teachers.length}</span>
          </div>
          <div className="overflow-x">
            <table>
              <thead>
                <tr>
                  <th>Nom</th><th>Identifiant</th><th>Situation</th><th>Classes</th>
                  <th>Heures/sem</th><th>Rémunération</th><th>Salaire mensuel</th><th>Supprimer</th>
                </tr>
              </thead>
              <tbody>
                {teachers.map((p) => {
                  const sit = p.employment ?? 'permanent';
                  return (
                    <tr key={p.id}>
                      <td><strong>{p.first_name} {p.last_name}</strong></td>
                      <td>{p.identifiant ?? ''}</td>
                      <td>
                        <span className={`badge ${sit === 'permanent' ? 'badge-primary' : 'badge-secondary'}`}>
                          {sit.charAt(0).toUpperCase() + sit.slice(1)}
                        </span>
                      </td>
                      <td><span className="badge badge-primary">{p.nb_classes}</span></td>
                      <td><strong>{heures(p.heures_courantes)}</strong> h</td>
                      <td>
                        {sit === 'permanent' ? (
                          <SalaireForm teacherId={p.id} salaire={p.salary ?? '0'} />
                        ) : (
                          <span
                            style={{ fontSize: '.82rem', color: '#92400E', fontWeight: 600 }}
                            title="Le taux horaire d'un intérimaire se définit sur chaque assignation, dans le tableau « Assignations existantes » ci-dessous."
                          >
                            Taux par assignation ↓
                          </span>
                        )}
                      </td>
                      <td><strong style={{ color: 'var(--success)' }}>{mru(p.monthly_pay ?? '0')} MRU</strong></td>
                      <td>
                        <SupprimerProfesseur teacherId={p.id} nom={`${p.first_name} ${p.last_name}`.trim()} />
                      </td>
                    </tr>
                  );
                })}
                {teachers.length === 0 && (
                  <tr><td colSpan={7} className="text-center text-muted">Aucun professeur.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <AssignationsExistantes
          assignations={assignations.map((a) => ({
            ...a,
            teacherName: nomProfesseurAffichable('', a.teacherName),
          }))}
        />
      </MessagePage>
    </>
  );
}
