import { redirect } from 'next/navigation';
import { apiFetch, requireSession, nulSiIntrouvable } from '@/lib/session';
import { anneeAffichee, type Annee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';
import { currentSchool } from '@/lib/tenant';
import { PrintButton } from '@/components/print-button';
import { BulletinOfficiel, type BulletinCard } from '@/components/bulletin-officiel';
import { MARQUE } from '@/lib/brand';

export const dynamic = 'force-dynamic';

/** Ce que la route de classe renvoie : les champs de l'élève sont à plat. */
type CarteClasse = Omit<BulletinCard, 'groupName' | 'levelName'> & {
  studentId: string;
  name: string;
  rank: number | null;
};

interface ClassCards {
  regime: 'classic' | 'fondamental';
  group: string | null;
  level: string | null;
  academicYear: string;
  term: number;
  students: CarteClasse[];
}

/**
 * BULLETINS DE LA CLASSE — `pages/super_admin/bulletins_classe.php` : une page
 * à part entière (titre « Bulletins de la classe », sous-titre « Niveau /
 * Groupe »), ses styles d'impression (une feuille A4 par élève), sa barre
 * (« ← Retour à la classe », « Imprimer toute la classe », « Enregistrer en
 * PDF », le badge « N bulletins », le rappel), puis `bulletin_vue.php` une fois
 * par élève, ou « Aucun élève dans cette classe. ». Sans `groupe_id`, retour
 * aux notes.
 */
export default async function ClassBulletinsPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ trimestre?: string; annee_notes?: string }>;
}) {
  const { groupId } = await params;
  const sp = await searchParams;
  await requireSession();
  if (!groupId) redirect('/scolarite/notes');
  const trimestre = Math.max(1, Math.min(3, Number(sp.trimestre ?? 1) || 1));

  const [school, annees, vue] = await Promise.all([
    currentSchool(),
    apiFetch<Annee[]>('/academic-years').catch(() => [] as Annee[]),
    anneeAffichee(),
  ]);
  const anneeNotes = /^\d{4}$/.test(sp.annee_notes ?? '') ? Number(sp.annee_notes) : (vue?.start_year ?? new Date().getFullYear());
  const annee = annees.find((a) => a.start_year === anneeNotes) ?? vue;

  const data = await apiFetch<ClassCards>(`/grades/class/${groupId}?term=${trimestre}${annee ? `&academicYearId=${annee.id}` : ''}`).catch(nulSiIntrouvable);
  if (!data) return <p className="text-muted">Groupe introuvable.</p>;

  const libelle = `${data.level ?? ''} / ${data.group ?? ''}`;
  const n = data.students.length;

  return (
    <>
      <PageHeader titre="Bulletins de la classe" sousTitre={libelle} />
      <style>{`
@page { size: A4 portrait; margin: 8mm; }
.bulletin-lot { page-break-after: always; break-after: page; }
.bulletin-lot:last-child { page-break-after: auto; break-after: auto; }
@media print {
    .no-print, .sidebar, .app-sidebar, .topbar, .app-topbar { display: none !important; }
    body, .main-content, .page-content { background: #fff !important; margin: 0 !important; padding: 0 !important; }
    .bulletin-lot { transform: scale(.92); transform-origin: top center; }
}
@media screen {
    .bulletin-lot { margin-bottom: 2rem; padding-bottom: 1.5rem; border-bottom: 3px dashed var(--border); }
}`}</style>

      <div className="no-print" style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1.2rem' }}>
        <a href={`/scolarite/notes?groupe_id=${groupId}&trimestre=${trimestre}&annee_notes=${anneeNotes}`} className="btn btn-secondary">← Retour à la classe</a>
        <PrintButton label="Imprimer toute la classe" />
        <PrintButton label="Enregistrer en PDF" title="Dans la fenêtre d'impression, choisissez « Enregistrer en PDF » comme destination." />
        <span className="badge badge-primary">{n} bulletin{n > 1 ? 's' : ''}</span>
        <span className="text-muted" style={{ fontSize: '.85rem' }}>
          {libelle} · {trimestre}<sup>{trimestre === 1 ? 'er' : 'e'}</sup> trimestre · {anneeNotes}
        </span>
      </div>

      {n === 0 ? (
        <div className="alert alert-warning no-print">Aucun élève dans cette classe.</div>
      ) : (
        data.students.map((c) => (
          <div className="bulletin-lot" key={c.studentId}>
            <BulletinOfficiel card={{ ...c, groupName: data.group, levelName: data.level }} schoolName={school?.name ?? MARQUE.nom} />
          </div>
        ))
      )}
    </>
  );
}
