import { apiFetch, requireSession } from '@/lib/session';
import { PageHeader } from '@/components/page-header';

export const dynamic = 'force-dynamic';

interface Slot {
  day_of_week: number;
  slot: number;
  group_name: string;
  level_name: string | null;
  subject: string | null;
}

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const CRENEAUX = ['8h-9h45', '10h-11h45', '12h-14h'];

/**
 * MON EMPLOI DU TEMPS — `pages/professeur/emploi.php`.
 *
 * Son sous-titre est le nom du professeur. La grille est la sienne : six jours
 * par trois créneaux, et les libellés sont les siens — « 8h-9h45 », pas
 * « 08:00 – 09:45 », parce que c'est ce qui est affiché en salle des profs.
 *
 * Son état vide (l'alerte, pas une grille de tirets), son pied de page, son
 * en-tête « ⏰ » et ses jours sur fond primaire ; toutes les cases où ce
 * professeur est l'enseignant assigné, sans filtre d'année (sa table
 * `emplois_du_temps` n'en connaît pas).
 */
export default async function MonEmploiPage() {
  const { user } = await requireSession();

  // Son `require_role(['professeur'])`.
  if (!user.roles.includes('professeur')) {
    return (
      <>
        <PageHeader titre="Mon emploi du temps" sousTitre="" />
        <div className="form-card">
          <p className="text-muted">Cette page est réservée aux professeurs.</p>
        </div>
      </>
    );
  }

  // Son sous-titre : `prenom nom` de la fiche `professeurs`, vide sans fiche.
  const [{ slots }, prof] = await Promise.all([
    apiFetch<{ slots: Slot[] }>('/teacher/my-timetable').catch(() => ({ slots: [] as Slot[] })),
    apiFetch<{ prenom: string; nom: string } | null>('/teacher/tableau-bord').catch(() => null),
  ]);

  const cell = (day: number, slot: number) =>
    slots.find((s) => s.day_of_week === day && s.slot === slot);

  return (
    <>
      <PageHeader titre="Mon emploi du temps" sousTitre={prof ? `${prof.prenom} ${prof.nom}` : ''} />

      {slots.length === 0 ? (
        <div className="alert alert-info">
          Aucun créneau ne vous est encore attribué dans l&apos;emploi du temps.
          <br />
          L&apos;administration le configurera depuis « Emploi du temps ».
        </div>
      ) : (
        <>
          <div className="table-container">
            <div className="overflow-x">
              <table className="edt-grille" style={{ minWidth: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ background: 'var(--bg)', fontWeight: 700 }}>⏰</th>
                    {JOURS.map((j) => (
                      <th
                        key={j}
                        style={{
                          background: 'var(--primary)',
                          color: '#fff',
                          textAlign: 'center',
                          fontWeight: 700,
                        }}
                      >
                        {j}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CRENEAUX.map((label, i) => (
                    <tr key={label}>
                      <th
                        style={{
                          background: 'var(--bg)',
                          fontWeight: 700,
                          textAlign: 'center',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {label}
                      </th>
                      {JOURS.map((jour, d) => {
                        const c = cell(d + 1, i + 1);
                        return (
                          <td
                            key={jour}
                            style={{
                              verticalAlign: 'top',
                              padding: '.3rem',
                              minWidth: 140,
                              height: 90,
                            }}
                          >
                            {c ? (
                              <div
                                style={{
                                  background: 'linear-gradient(135deg,#eef2ff,#e0e7ff)',
                                  padding: '.6rem',
                                  borderRadius: 8,
                                  borderLeft: '4px solid var(--primary)',
                                  height: '100%',
                                }}
                              >
                                <strong
                                  style={{
                                    display: 'block',
                                    color: 'var(--primary)',
                                    fontSize: '.92rem',
                                  }}
                                >
                                  {c.subject ?? '—'}
                                </strong>
                                <small style={{ color: 'var(--text-light)' }}>
                                  {c.level_name ?? '—'}
                                </small>
                                <br />
                                <small style={{ color: 'var(--text)' }}>
                                  <strong>{c.group_name}</strong>
                                </small>
                              </div>
                            ) : (
                              <div
                                style={{
                                  height: '100%',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: 'var(--text-muted)',
                                  fontSize: '.85rem',
                                  background: '#fafafa',
                                  borderRadius: 8,
                                }}
                              >
                                —
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p
            className="text-muted"
            style={{ fontSize: '.85rem', marginTop: '1rem', textAlign: 'center' }}
          >
            📅 Cet emploi du temps est défini par l&apos;administration. Pour toute
            modification, contactez-la.
          </p>
        </>
      )}
    </>
  );
}
