import { redirect } from 'next/navigation';
import { apiFetch, requireSession, can } from '@/lib/session';
import { anneeAffichee, type Annee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';
import { HubNav } from '@/components/hub';
import { MessagePage } from '@/components/message-page';
import { PrintButton } from '@/components/print-button';
import { SCOLARITE_TABS } from '../tabs';
import { FormuleForm } from './formule-form';
import { ClassementFiltre } from './classement-filtre';

export const dynamic = 'force-dynamic';

interface Group {
  id: string;
  name: string;
  level_id: string | null;
  level_name?: string | null;
}

interface Card {
  studentId: string;
  firstName: string;
  lastName: string;
  matricule: string | null;
  classicAverage: string | null;
}

interface Classement {
  rows: { rang: number | null; nom: string; matricule: string | null; moyenne: string | null; aff: string | null; appreciation: string }[];
  fondamental: boolean;
}

/** Son `appreciation_pour()`. */
function appreciationPour(m: number): string {
  if (m >= 16) return 'Très Bien';
  if (m >= 14) return 'Bien';
  if (m >= 12) return 'Assez Bien';
  if (m >= 10) return 'Passable';
  return 'Insuffisant';
}

/** `number_format($x, 2)` — virgule des milliers, point décimal. */
const nf2 = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * BULLETIN DE NOTES — `pages/super_admin/notes_etudiants.php`, quatre modes
 * exclusifs : `classement=1` (le classement d'un groupe), `etudiant_id` (le
 * bulletin — rendu à `/notes/bulletin/[id]`), `groupe_id` (« Résultats —
 * Trimestre N »), sinon la formule de calcul (administration) et
 * « Sélectionner un groupe et un trimestre ».
 */
export default async function NotesBulletinsPage({
  searchParams,
}: {
  searchParams: Promise<{
    classement?: string; cl_groupe_id?: string; cl_base?: string; cl_annee?: string;
    groupe_id?: string; trimestre?: string; annee_notes?: string; etudiant_id?: string;
  }>;
}) {
  const sp = await searchParams;
  const { user } = await requireSession();
  const mayConfigure = can(user, 'scolarite.niveaux');

  const trimestre = Math.max(1, Math.min(3, Number(sp.trimestre ?? 1) || 1));

  const [groups, annees, vue, avecNotes] = await Promise.all([
    apiFetch<Group[]>('/groups').catch(() => [] as Group[]),
    apiFetch<Annee[]>('/academic-years').catch(() => [] as Annee[]),
    anneeAffichee(),
    apiFetch<number[]>('/grades/annees-avec-notes').catch(() => [] as number[]),
  ]);
  // Son `annee_notes_defaut()` : l'année par défaut si elle porte des notes, sinon la dernière qui en porte.
  const anDefaut = vue?.start_year ?? new Date().getFullYear();
  const anneeNotesDefaut = avecNotes.includes(anDefaut) ? anDefaut : (avecNotes[0] ?? anDefaut);
  const anneeNotesDemandee = Number(sp.annee_notes ?? 0);
  const anneeNotes = anneeNotesDemandee >= 2020 && anneeNotesDemandee <= 2100 ? anneeNotesDemandee : anneeNotesDefaut;

  if (sp.etudiant_id) {
    redirect(`/notes/bulletin/${sp.etudiant_id}?trimestre=${trimestre}&annee_notes=${anneeNotes}`);
  }

  const coquille = (contenu: React.ReactNode) => (
    <>
      <PageHeader titre="Gestion de scolarité" sousTitre="Emploi du temps, absences, groupes, niveaux, exclusions et notes" />
      <div className="hub-shell">
        <HubNav tabs={SCOLARITE_TABS} active="notes" label="Sections Scolarité" />
        <div className="hub-panel">
          <MessagePage>{contenu}</MessagePage>
        </div>
      </div>
    </>
  );

  const libelle = (g: Group) => `${g.level_name ?? ''} — ${g.name}`;

  // ═══ CLASSEMENT D'UN GROUPE ═══
  if (sp.classement) {
    const clGroupe = sp.cl_groupe_id ?? '';
    const clBase = (['1', '2', '3', 'annee'] as const).find((b) => b === sp.cl_base) ?? '1';
    const anCivile = new Date().getFullYear();
    const clAnneeDemandee = Number(sp.cl_annee ?? 0);
    // Par défaut : la dernière année qui contient réellement des notes.
    const clAnnee = clAnneeDemandee >= 2020 && clAnneeDemandee <= 2100 ? clAnneeDemandee : anneeNotesDefaut;
    const info = groups.find((g) => g.id === clGroupe) ?? null;
    const niveaux = [...new Map(groups.filter((g) => g.level_id).map((g) => [g.level_id!, { id: g.level_id!, name: g.level_name ?? '' }])).values()];
    const classement = info ? await apiFetch<Classement>(`/grades/classement/${clGroupe}?base=${clBase}&annee=${clAnnee}`).catch(() => ({ rows: [], fondamental: false })) : null;
    const rangAff = (r: number) => (r === 1 ? '1er' : r === 2 ? '2e' : r === 3 ? '3e' : `${r}e`);

    return coquille(
      <>
        <style>{`
@page { size: A4 portrait; margin: 8mm; }
@media print { .no-print { display:none !important; } .classement-table th, .classement-table td { border:1px solid #000 !important; } }`}</style>
        <div className="no-print" style={{ marginBottom: '1rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <a href="/scolarite/notes" className="btn btn-secondary">← Notes &amp; Bulletins</a>
          {classement && classement.rows.length > 0 && <PrintButton label="Imprimer le classement" />}
        </div>

        <form method="GET" className="form-card no-print" style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <input type="hidden" name="classement" value="1" />
          <ClassementFiltre
            niveaux={niveaux}
            groupes={groups.map((g) => ({ id: g.id, label: libelle(g), levelId: g.level_id }))}
            groupeChoisi={clGroupe}
          />
          <div><label>Base du classement</label>
            <select name="cl_base" defaultValue={clBase}>
              <option value="1">1er trimestre</option>
              <option value="2">2e trimestre</option>
              <option value="3">3e trimestre</option>
              <option value="annee">Moyenne annuelle (T1+T2+T3)</option>
            </select></div>
          <div><label>Année</label>
            <select name="cl_annee" defaultValue={String(clAnnee)}>
              {Array.from({ length: 5 }, (_, i) => anCivile - i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select></div>
          <button className="btn btn-primary">Classer</button>
        </form>

        {info && classement ? (
          <div className="table-container">
            <div className="table-header">
              <h3>Classement — {info.level_name ?? ''} / {info.name}
                {' · '}{clBase === 'annee' ? 'Moyenne annuelle' : `${clBase}${clBase === '1' ? 'er' : 'e'} trimestre`}
                {' · '}{clAnnee}</h3>
              <span className="badge badge-primary">{classement.rows.length} élève{classement.rows.length > 1 ? 's' : ''}</span>
            </div>
            <div className="overflow-x">
              <table className="classement-table">
                <thead><tr><th style={{ width: 70 }}>Rang</th><th>Élève</th><th>Matricule</th><th>Moyenne / 20</th><th>Appréciation</th></tr></thead>
                <tbody>
                  {classement.rows.length === 0 ? (
                    <tr><td colSpan={5} className="text-muted" style={{ textAlign: 'center' }}>Aucun élève dans ce groupe.</td></tr>
                  ) : classement.rows.map((r, i) => (
                    <tr key={i}>
                      <td><strong style={{ fontSize: '1.05rem' }}>{r.rang !== null ? rangAff(r.rang) : '—'}</strong></td>
                      <td><strong>{r.nom}</strong></td>
                      <td>{r.matricule ?? ''}</td>
                      <td><strong style={{ color: r.moyenne !== null && Number(r.moyenne) >= 10 ? '#728157' : '#a8341f' }}>{r.aff ? r.aff : r.moyenne !== null ? nf2(Number(r.moyenne)) : '—'}</strong></td>
                      <td>{r.appreciation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : clGroupe ? (
          <div className="alert alert-error">Groupe introuvable.</div>
        ) : null}
      </>,
    );
  }

  // ═══ RÉSULTATS D'UN GROUPE ═══
  if (sp.groupe_id) {
    const groupeId = sp.groupe_id;
    const annee = annees.find((a) => a.start_year === anneeNotes);
    const cards = annee
      ? await apiFetch<{ students: Card[] }>(`/grades/class/${groupeId}?term=${trimestre}&academicYearId=${annee.id}`).catch(() => ({ students: [] as Card[] }))
      : { students: [] as Card[] };
    // Par nom puis prénom, puis par moyenne décroissante (les « null » valent 0).
    const avecMoy = [...cards.students]
      .sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr') || a.firstName.localeCompare(b.firstName, 'fr'))
      .sort((a, b) => Number(b.classicAverage ?? 0) - Number(a.classicAverage ?? 0));

    return coquille(
      <>
        <div className="no-print" style={{ marginBottom: '1rem' }}>
          <a href={`/notes/bulletins/${groupeId}?trimestre=${trimestre}&annee_notes=${anneeNotes}`} className="btn btn-primary" style={{ width: 'auto' }}>
            Imprimer TOUS les bulletins de la classe (PDF)
          </a>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <a href="/scolarite/notes" className="btn btn-secondary">← Changer de groupe</a>
        </div>
        <div className="table-container">
          <div className="table-header">
            <h3>Résultats — Trimestre {trimestre}</h3>
            <span className="badge badge-primary">{avecMoy.length} étudiants</span>
          </div>
          <div className="overflow-x">
            <table>
              <thead><tr><th>Rang</th><th>Identifiant</th><th>Nom complet</th><th>Moyenne</th><th>Appréciation</th><th>Bulletin</th></tr></thead>
              <tbody>
                {avecMoy.map((et, i) => {
                  const moy = et.classicAverage === null ? null : Number(et.classicAverage);
                  return (
                    <tr key={et.studentId}>
                      <td><strong>{i + 1}</strong></td>
                      <td>{et.matricule ?? ''}</td>
                      <td><strong>{et.firstName} {et.lastName}</strong></td>
                      <td><span className={`badge ${moy !== null && moy >= 10 ? 'badge-success' : 'badge-danger'}`}>{moy !== null ? `${nf2(moy)}/20` : 'N/A'}</span></td>
                      <td>{moy === null ? 'Non évalué' : appreciationPour(moy)}</td>
                      <td><a href={`/notes/bulletin/${et.studentId}?trimestre=${trimestre}&annee_notes=${anneeNotes}`} className="btn btn-sm btn-primary">Voir bulletin</a></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </>,
    );
  }

  // ═══ CONFIGURATION + SÉLECTION ═══
  const levels = mayConfigure ? await apiFetch<{ id: string; name: string }[]>('/levels').catch(() => []) : [];
  const formulas: Record<string, Record<number, { courseworkWeight: string; examWeight: string; divisor: string }>> = {};
  if (mayConfigure) {
    await Promise.all(
      levels.map(async (l) => {
        formulas[l.id] = await apiFetch<Record<number, { courseworkWeight: string; examWeight: string; divisor: string }>>(`/grades/formulas/${l.id}`).catch(() => ({}));
      }),
    );
  }

  return coquille(
    <>
      {mayConfigure && <FormuleForm levels={levels} formulas={formulas} />}

      <div className="form-card" style={{ maxWidth: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
          <h3 style={{ margin: 0 }}>Sélectionner un groupe et un trimestre</h3>
          <a href="/scolarite/notes?classement=1" className="btn btn-secondary">Classement d&apos;un groupe</a>
        </div>
        <form method="GET">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="groupe_id">Groupe *</label>
              <select id="groupe_id" name="groupe_id" required defaultValue="">
                <option value="">— Sélectionner —</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{libelle(g)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="trimestre">Trimestre *</label>
              <select id="trimestre" name="trimestre" required defaultValue="1">
                <option value="1">1er trimestre</option>
                <option value="2">2e trimestre</option>
                <option value="3">3e trimestre</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="annee_notes">Année</label>
              <select id="annee_notes" name="annee_notes" defaultValue={String(anneeNotes)}>
                {annees.map((a) => (
                  <option key={a.id} value={String(a.start_year)}>{a.label}</option>
                ))}
              </select>
            </div>
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}>Afficher les résultats</button>
        </form>
      </div>
    </>,
  );
}
