import { apiFetch, requireSession, can } from '@/lib/session';
import { anneeAffichee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';
import { HubNav, mru } from '@/components/hub';
import { MessagePage } from '@/components/message-page';
import { BoutonFrais } from '@/components/bouton-frais';
import { PrixAffiche } from '@/components/prix-affiche';
import { TarifNiveauCellule } from '@/components/tarifs-cellules';
import { estEcoleServices } from '@/lib/tenant';
import {
  anneeDesTarifs,
  COLONNES_TARIFS_NIVEAU,
  lireTarifs,
  montantSaisi,
  peutFixerLesTarifs,
  type TarifNiveau,
} from '@/lib/facturation';
import { libelleCycle } from '@elourwa/shared/cycles';
import { SCOLARITE_TABS } from '../tabs';
import { SubjectForm, CoefficientCell, DeleteSubjectForm } from './subject-forms';
import { LevelForm, GroupInLevelForm } from './forms';
import {
  ClassementCell,
  DeleteGroupForm,
  DeleteLevelForm,
  FondamentalToggle,
  MaxScoreCell,
  PassMarkCell,
  RateCell,
} from './level-row-forms';

export const dynamic = 'force-dynamic';

interface Niveau {
  id: string;
  name: string;
  monthly_rate: string;
  pass_mark: string;
  cycle: string;
  sort_order: number;
  is_fondamental: boolean;
  group_count: number;
  student_count: number;
}

interface LevelDetail {
  level: { id: string; name: string; monthly_rate: string; pass_mark: string; cycle: string; is_fondamental: boolean };
  groups: { id: string; name: string; capacity: number; enrolment_count: number; headcount: number; previous: number | null; delta: number | null }[];
  subjects: { id: string; name: string; name_ar: string | null; coefficient: number; max_score: string; teaching_count: number }[];
}

/** Son `rtrim(rtrim(number_format(x, 2, '.', ''), '0'), '.')`. */
const court = (x: string | number) => String(Number(x));

/**
 * GÉRER LES NIVEAUX — `pages/super_admin/gerer_niveaux.php` : « Créer un
 * Niveau », « Niveaux existants » (intertitre à chaque cycle, ligne surlignée
 * quand ouverte, tarif / seuil / fondamental modifiables en place, « Ouvrir »,
 * « Supprimer » sur un niveau sans groupe ni élève), puis, sous un trait, le
 * niveau ouvert : créer un groupe, ses groupes (« Inscrire un étudiant »,
 * « Supprimer »), « Statistiques — évolution des effectifs » (année civile N-1
 * contre N), ajouter une matière, ses matières (coefficient, barème sur un
 * niveau fondamental, enseignements, « Supprimer » / « En utilisation »).
 * Les messages remontent en haut de page.
 */
export default async function NiveauxPage({ searchParams }: { searchParams: Promise<{ niveau_id?: string }> }) {
  const { niveau_id: selected } = await searchParams;
  const { user } = await requireSession();
  const year = await anneeAffichee();

  const levels = await apiFetch<Niveau[]>(year ? `/levels?academicYearId=${year.id}` : '/levels').catch(() => [] as Niveau[]);
  const detail = selected && year
    ? await apiFetch<LevelDetail>(`/levels/${selected}/detail?academicYearId=${year.id}`).catch(() => null)
    : null;

  const mayEdit = can(user, 'scolarite.niveaux');
  const mayGroups = can(user, 'scolarite.groupes');
  const anneeCivile = new Date().getFullYear();

  /*
   * ÉCOLE « SERVICES » (Jinan, spécification §9) : pas de « Tarif mensuel »
   * unique, mais 8h – 14h / 8h – 17h / Frais d'inscription, lus sur
   * `GET /finance/tarifs` (`GET /levels` n'en dit rien, pour rester identique
   * octet pour octet dans une école « famille »). Une école « famille » ne fait
   * pas cet appel et garde sa page telle quelle.
   */
  const services = await estEcoleServices();
  // L'année de l'en-tête (les tarifs d'un niveau ne dépendent pas de l'année ;
  // elle dit seulement si on peut encore les modifier — pas sur une année close).
  const lecture = services ? await lireTarifs((await anneeDesTarifs()).id) : null;
  const tarifsParNiveau = new Map<string, TarifNiveau>((lecture?.tarifs?.niveaux ?? []).map((t) => [t.id, t]));
  const editTarifs = services && !!lecture?.tarifs?.annee.modifiable && peutFixerLesTarifs(user);
  const nbColonnes = services ? 8 : 6;

  let cycleCourant: string | null = null;

  return (
    <>
      <PageHeader
        titre="Gestion de scolarité"
        sousTitre="Emploi du temps, absences, groupes, niveaux, exclusions et notes"
        right={<BoutonFrais user={user} />}
      />
      <div className="hub-shell">
        <HubNav tabs={SCOLARITE_TABS} active="niveaux" label="Sections Scolarité" />
        <div className="hub-panel">
          <MessagePage>
            {mayEdit && (
              <div className="form-card">
                <h3>Créer un Niveau</h3>
                <LevelForm services={services} />
              </div>
            )}

            {lecture?.erreur && (
              <div className="alert alert-warning">
                <span>Tarifs indisponibles : {lecture.erreur}</span>
              </div>
            )}

            <div className="table-container">
              <div className="table-header">
                <h3>Niveaux existants</h3>
                <span className="badge badge-primary">{levels.length} niveaux</span>
              </div>
              <div className="overflow-x">
                <table>
                  <thead>
                    <tr>
                      <th>Niveau</th>
                      {services ? (
                        COLONNES_TARIFS_NIVEAU.map((c) => <th key={c.champ}>{c.titre}</th>)
                      ) : (
                        <th>Tarif mensuel</th>
                      )}
                      <th>Seuil d&apos;admission</th><th>Groupes</th><th>Étudiants</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {levels.flatMap((n) => {
                      const rows = [];
                      if (n.cycle !== cycleCourant) {
                        cycleCourant = n.cycle;
                        rows.push(
                          // Son intertitre de cycle (`libelle_cycle()`), et la
                          // « barrière » demandée par Jinan le 30/09/2026 : un
                          // trait épais au-dessus de chaque cycle.
                          <tr key={`cyc-${n.cycle}`} className="cycle-sep" data-testid={`cycle-${n.cycle}`}>
                            <td colSpan={nbColonnes} style={{ background: 'var(--bg-soft,#F1F5F9)', fontWeight: 700, color: 'var(--primary)', letterSpacing: '.04em', textTransform: 'uppercase', fontSize: '.78rem', padding: '.55rem .75rem', borderTop: '4px solid var(--primary)' }}>
                              {libelleCycle(n.cycle)}
                            </td>
                          </tr>,
                        );
                      }
                      rows.push(
                        <tr key={n.id} style={selected === n.id ? { background: 'rgba(198,113,57,.06)' } : undefined}>
                          <td>
                            <strong>{n.name}</strong>
                            {n.is_fondamental && <span className="badge" style={{ background: '#DBEAFE', color: '#1E40AF' }}>Fondamental</span>}
                            {mayEdit && <FondamentalToggle levelId={n.id} isFondamental={n.is_fondamental} />}
                            {mayEdit && <ClassementCell levelId={n.id} niveau={n.name} cycle={n.cycle} rang={n.sort_order} />}
                          </td>
                          {services ? (
                            COLONNES_TARIFS_NIVEAU.map((c) => {
                              const t = tarifsParNiveau.get(n.id);
                              return (
                                <td key={c.champ}>
                                  {!t ? (
                                    <span className="text-muted">—</span>
                                  ) : editTarifs ? (
                                    <TarifNiveauCellule
                                      levelId={n.id}
                                      niveau={n.name}
                                      champ={c.champ}
                                      libelle={c.titre}
                                      valeur={montantSaisi(t[c.champ])}
                                    />
                                  ) : (
                                    <PrixAffiche valeur={t[c.champ]} />
                                  )}
                                </td>
                              );
                            })
                          ) : (
                            <td>{mayEdit ? <RateCell levelId={n.id} monthlyRate={n.monthly_rate} /> : `${mru(n.monthly_rate)} MRU`}</td>
                          )}
                          <td>{mayEdit ? <PassMarkCell levelId={n.id} passMark={n.pass_mark} /> : `${court(n.pass_mark)} / 20`}</td>
                          <td><span className="badge badge-primary">{n.group_count}</span></td>
                          <td><span className="badge badge-success">{n.student_count}</span></td>
                          <td>
                            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                              <a href={`/scolarite/niveaux?niveau_id=${n.id}`} className="btn btn-sm btn-primary">Ouvrir</a>
                              {mayEdit && n.student_count === 0 && n.group_count === 0 && <DeleteLevelForm levelId={n.id} />}
                            </div>
                          </td>
                        </tr>,
                      );
                      return rows;
                    })}
                    {levels.length === 0 && (
                      <tr><td colSpan={services ? nbColonnes : 5} className="text-center text-muted">Aucun niveau.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {detail && (
              <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '3px solid var(--primary)' }}>
                <h2 style={{ color: 'var(--primary)', marginBottom: '1.5rem' }}>Niveau : {detail.level.name}</h2>

                {mayGroups && (
                  <div className="form-card">
                    <h3>Créer un groupe dans « {detail.level.name} »</h3>
                    <GroupInLevelForm level={{ id: detail.level.id, name: detail.level.name }} />
                  </div>
                )}

                <div className="table-container">
                  <div className="table-header">
                    <h3>Groupes dans « {detail.level.name} »</h3>
                    <span className="badge badge-primary">{detail.groups.length}</span>
                  </div>
                  <div className="overflow-x">
                    <table>
                      <thead><tr><th>Nom</th><th>Capacité</th><th>Inscrits</th><th>Actions</th></tr></thead>
                      <tbody>
                        {detail.groups.map((g) => (
                          <tr key={g.id}>
                            <td><strong>{g.name}</strong></td>
                            <td>{g.capacity}</td>
                            <td>
                              {g.headcount > 0 ? (
                                <span className="badge badge-success">{g.headcount}</span>
                              ) : (
                                <span className="badge badge-warning">Vide</span>
                              )}
                            </td>
                            <td>
                              <a className="btn btn-sm btn-secondary" href="/students/new">
                                Inscrire un étudiant
                              </a>
                              {mayGroups && <DeleteGroupForm groupId={g.id} name={g.name} nbEtudiants={g.headcount} />}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="form-card" style={{ marginTop: '1.5rem' }}>
                  <h3>Statistiques — évolution des effectifs</h3>
                  <p className="text-muted" style={{ fontSize: '.88rem' }}>Comparaison de l&apos;effectif actuel ({anneeCivile}) avec l&apos;année précédente.</p>
                  <div className="overflow-x">
                    <table>
                      <thead><tr><th>Groupe</th><th>{anneeCivile - 1}</th><th>{anneeCivile}</th><th>Évolution</th></tr></thead>
                      <tbody>
                        {detail.groups.map((g) => (
                          <tr key={g.id}>
                            <td><strong>{g.name}</strong></td>
                            <td>{g.previous === null ? <span className="text-muted">—</span> : g.previous}</td>
                            <td>{g.headcount}</td>
                            <td>
                              {g.delta === null ? (
                                <span className="text-muted">Pas de données N-1</span>
                              ) : g.delta > 0 ? (
                                <span style={{ color: '#728157', fontWeight: 600 }}>+{g.delta}</span>
                              ) : g.delta < 0 ? (
                                <span style={{ color: '#a8341f', fontWeight: 600 }}>{g.delta}</span>
                              ) : (
                                <span className="text-muted">= stable</span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {detail.groups.length === 0 && (
                          <tr><td colSpan={4} className="text-center text-muted">Aucun groupe à analyser.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {mayEdit && (
                  <div className="form-card" style={{ marginTop: '1.5rem' }}>
                    <h3>Ajouter une matière dans « {detail.level.name} »</h3>
                    <SubjectForm level={{ id: detail.level.id, name: detail.level.name }} showMaxScore={detail.level.is_fondamental} />
                  </div>
                )}

                <div className="table-container">
                  <div className="table-header">
                    <h3>Matières de « {detail.level.name} »</h3>
                    <span className="badge badge-primary">{detail.subjects.length}</span>
                  </div>
                  <div className="overflow-x">
                    <table>
                      <thead>
                        <tr>
                          <th>Matière</th>
                          <th>Coefficient</th>
                          {detail.level.is_fondamental && <th>Notée sur</th>}
                          <th>Enseignements</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.subjects.map((m) => (
                          <tr key={m.id}>
                            <td><strong>{m.name}</strong></td>
                            <td>{mayEdit ? <CoefficientCell subjectId={m.id} coefficient={m.coefficient} /> : m.coefficient}</td>
                            {detail.level.is_fondamental && (
                              <td>{mayEdit ? <MaxScoreCell subjectId={m.id} maxScore={m.max_score} /> : `/ ${court(m.max_score)}`}</td>
                            )}
                            <td><span className="badge badge-primary">{m.teaching_count}</span></td>
                            <td>
                              {m.teaching_count === 0 ? (
                                mayEdit ? <DeleteSubjectForm subjectId={m.id} /> : null
                              ) : (
                                <span className="text-muted">En utilisation</span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {detail.subjects.length === 0 && (
                          <tr><td colSpan={4} className="text-center text-muted">Aucune matière.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </MessagePage>
        </div>
      </div>
    </>
  );
}
