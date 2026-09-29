import { apiFetch, requireSession } from '@/lib/session';
import { anneeAffichee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';
import { MessagePage } from '@/components/message-page';
import { MarkSheet } from '../../notes/mark-sheet';

interface Enseignement {
  id: string;
  groupe_nom: string;
  matiere_nom: string;
}

interface Feuille {
  subject: { subject: string; max_score: string; group_name: string } | null;
  students: { studentId: string; name: string; identifier: string | null; coursework: Record<number, string>; exam: string | null }[];
}

export const dynamic = 'force-dynamic';

/**
 * SAISIR LES NOTES — LE PROFESSEUR (décision du propriétaire, 2026-09-17).
 *
 * La même feuille que `saisir_notes.php` (`/notes`), restreinte à SES
 * enseignements : la liste est celle de son tableau de bord (ses matières
 * dans ses groupes, l'année consultée), rien d'autre ne s'y choisit, et l'API
 * refuse une feuille qui n'est pas la sienne (`assertOwnTeaching`). Choix de
 * l'enseignement et du trimestre par GET, comme chez lui ; après
 * l'enregistrement, `?succes=1` et « Notes enregistrées avec succès ! ».
 */
export default async function ProfNotesPage({
  searchParams,
}: {
  searchParams: Promise<{ enseignement_id?: string; trimestre?: string; succes?: string }>;
}) {
  const params = await searchParams;
  await requireSession();
  const annee = await anneeAffichee();
  const trimestre = [1, 2, 3].includes(Number(params.trimestre)) ? Number(params.trimestre) : 1;

  const tb = await apiFetch<{ enseignements: Enseignement[] } | null>(
    `/teacher/tableau-bord${annee ? `?academicYearId=${annee.id}` : ''}`,
  ).catch(() => null);
  const enseignements = [...(tb?.enseignements ?? [])].sort(
    (a, b) => a.groupe_nom.localeCompare(b.groupe_nom) || a.matiere_nom.localeCompare(b.matiere_nom),
  );
  const ens = enseignements.find((e) => e.id === params.enseignement_id) ?? null;

  const feuille = ens
    ? await apiFetch<Feuille>(`/teacher/sheet/${ens.id}?term=${trimestre}`).catch(() => null)
    : null;

  return (
    <MessagePage initial={params.succes ? { type: 'success', texte: 'Notes enregistrées avec succès !' } : null}>
      <PageHeader titre="Saisir les notes" sousTitre="Vos classes, vos matières — devoirs et examen du trimestre" />

      {tb === null ? (
        <div className="alert alert-danger" role="alert">
          Vos enseignements n&apos;ont pas pu être chargés : le serveur n&apos;a pas répondu. <a href="">Réessayez</a>.
        </div>
      ) : enseignements.length === 0 ? (
        <div className="alert alert-info">Vous n&apos;avez aucun enseignement assigné{annee ? ` pour ${annee.label}` : ''}.</div>
      ) : (
        <form method="GET" className="form-card" style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          <div className="form-group" style={{ margin: 0, minWidth: 280 }}>
            <label htmlFor="enseignement_id">Classe — Matière</label>
            <select id="enseignement_id" name="enseignement_id" defaultValue={ens?.id ?? ''}>
              <option value="">— Choisir —</option>
              {enseignements.map((e) => (
                <option key={e.id} value={e.id}>{e.groupe_nom} — {e.matiere_nom}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="trimestre">Trimestre</label>
            <select id="trimestre" name="trimestre" defaultValue={String(trimestre)}>
              <option value="1">Trimestre 1</option>
              <option value="2">Trimestre 2</option>
              <option value="3">Trimestre 3</option>
            </select>
          </div>
          <button className="btn btn-primary" style={{ width: 'auto' }}>Afficher</button>
        </form>
      )}

      {ens && feuille?.subject && feuille.students.length > 0 ? (
        <div className="table-container">
          <div className="table-header">
            <h3>
              {feuille.subject.group_name} — {feuille.subject.subject} · Trimestre {trimestre}
            </h3>
            <span className="badge badge-primary">{feuille.students.length} étudiants</span>
          </div>
          <MarkSheet
            teachingId={ens.id}
            trimestre={trimestre}
            maxScore={feuille.subject.max_score}
            students={feuille.students}
            readOnly={false}
            espace="prof"
          />
        </div>
      ) : ens ? (
        <div className="empty-state">
          <p>{feuille ? 'Aucun étudiant trouvé pour ce groupe.' : 'Cette feuille ne peut pas être ouverte.'}</p>
        </div>
      ) : null}
    </MessagePage>
  );
}
