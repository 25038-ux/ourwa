import { apiFetch, requireSession, can } from '@/lib/session';
import { anneeAffichee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';
import { MessagePage } from '@/components/message-page';
import { MarkSheet } from './mark-sheet';
import { NiveauGroupeMatiere } from './cascade';

export const dynamic = 'force-dynamic';

interface Group {
  group_id: string | null;
  group_name: string | null;
  level_id: string | null;
  level_name: string;
}

/**
 * SAISIR LES NOTES — `pages/super_admin/saisir_notes.php` : « Niveau →
 * Groupe → Matière ». La cascade (`GROUPES`, `ENSEIGNEMENTS` de l'année
 * consultée, filtrés dans le navigateur), « Charger les étudiants », puis la
 * table de saisie quand `enseignement_id` et `trimestre` sont là ; « Aucun
 * étudiant trouvé pour ce groupe. » sinon. Après l'enregistrement, il
 * redirige sur `?enseignement_id=…&trimestre=…&succes=1` et affiche « Notes
 * enregistrées avec succès ! » en haut.
 */
export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ niveau_id?: string; groupe_id?: string; enseignement_id?: string; trimestre?: string; succes?: string }>;
}) {
  const params = await searchParams;
  const { user } = await requireSession();
  const mayEnter = can(user, 'notes.saisir');
  const trimestre = Math.max(1, Math.min(3, Number(params.trimestre ?? 1) || 1));

  const year = await anneeAffichee();
  const coquille = (contenu: React.ReactNode) => (
    <>
      <PageHeader titre="Saisir les notes" sousTitre="Niveau → Groupe → Matière" />
      <MessagePage initial={params.succes ? { type: 'success', texte: 'Notes enregistrées avec succès !' } : null}>{contenu}</MessagePage>
    </>
  );
  if (!year) return coquille(<div className="alert alert-info">Aucune année scolaire.</div>);

  const [hierarchy, levels, allTeachingsBrut] = await Promise.all([
    apiFetch<Group[]>(`/hierarchy?academicYearId=${year.id}`).catch(() => [] as Group[]),
    apiFetch<{ id: string; name: string }[]>('/levels').catch(() => []),
    apiFetch<{ id: string; groupId: string; subject: string; subjectId?: string; teacherName?: string }[]>(`/teachings?academicYearId=${year.id}`).catch(() => []),
  ]);

  // UNE MATIÈRE = UNE FEUILLE (décision du propriétaire, 20/09) : deux
  // professeurs sur la même matière du même groupe partagent la saisie ; la
  // liste ne montre la matière qu'une fois, avec les deux noms.
  const parMatiere = new Map<string, { id: string; groupId: string; subject: string; profs: string[] }>();
  for (const e of allTeachingsBrut) {
    const cle = `${e.groupId}:${e.subjectId ?? e.subject}`;
    const deja = parMatiere.get(cle);
    if (deja) {
      if (e.teacherName && !deja.profs.includes(e.teacherName)) deja.profs.push(e.teacherName);
    } else {
      parMatiere.set(cle, { id: e.id, groupId: e.groupId, subject: e.subject, profs: e.teacherName ? [e.teacherName] : [] });
    }
  }
  const allTeachings = [...parMatiere.values()].map((e) => ({
    id: e.id,
    groupId: e.groupId,
    subject: e.profs.length > 1 ? `${e.subject} — ${e.profs.join(' & ')}` : e.subject,
  }));
  const groups = hierarchy.filter((g) => g.group_id);
  // Ses `ENSEIGNEMENTS` : `ORDER BY m.nom`.
  allTeachings.sort((a, b) => a.subject.localeCompare(b.subject, 'fr'));

  // Sa sélection : seulement quand `enseignement_id` et `trimestre` sont là.
  const ensId = params.enseignement_id && params.trimestre ? params.enseignement_id : null;
  // Un identifiant d'affectation équivalente (le lien d'un professeur) ouvre la même feuille.
  const ens = ensId ? allTeachings.find((t) => t.id === ensId) ?? allTeachingsBrut.find((t) => t.id === ensId) ?? null : null;
  const groupeSel = ens?.groupId ?? params.groupe_id ?? '';
  const niveauSel = (ens ? hierarchy.find((g) => g.group_id === ens.groupId)?.level_id : params.niveau_id) ?? '';

  const sheet = ens
    ? await apiFetch<{
        subject: { subject: string; max_score: string; group_name: string } | null;
        students: { studentId: string; name: string; identifier: string | null; coursework: Record<number, string>; exam: string | null }[];
      }>(`/grades/sheet/${ens.id}?term=${trimestre}&academicYearId=${year.id}`).catch(() => null)
    : null;

  return coquille(
    <>
      <NiveauGroupeMatiere
        levels={levels}
        groups={groups.map((g) => ({ id: g.group_id!, name: g.group_name ?? '', levelId: g.level_id ?? null }))}
        teachings={allTeachings}
        selectedLevel={niveauSel}
        selectedGroup={groupeSel}
        selectedTeaching={ensId ?? ''}
        trimestre={trimestre}
      />

      {sheet?.subject && sheet.students.length > 0 ? (
        <div className="table-container">
          <div className="table-header">
            <h3>Saisie des notes — Trimestre {trimestre}</h3>
            <span className="badge badge-primary">{sheet.students.length} étudiants</span>
          </div>
          <MarkSheet
            teachingId={ens!.id}
            trimestre={trimestre}
            maxScore={sheet.subject.max_score}
            students={sheet.students}
            readOnly={!mayEnter}
          />
        </div>
      ) : params.enseignement_id ? (
        <div className="empty-state">
          <p>Aucun étudiant trouvé pour ce groupe.</p>
        </div>
      ) : null}
    </>,
  );
}
