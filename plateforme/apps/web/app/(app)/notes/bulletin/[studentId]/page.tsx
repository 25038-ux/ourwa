import { apiFetch, requireSession, nulSiIntrouvable } from '@/lib/session';
import { currentSchool } from '@/lib/tenant';
import { anneeAffichee, type Annee } from '@/lib/annee';
import { PrintButton } from '@/components/print-button';
import { BulletinOfficiel, type BulletinCard } from '@/components/bulletin-officiel';
import { MARQUE } from '@/lib/brand';

export const dynamic = 'force-dynamic';

/** Ce que la route individuelle renvoie : l'élève y est un objet imbriqué. */
interface Reponse extends Omit<BulletinCard, 'firstName' | 'lastName' | 'rim' | 'matricule' | 'sex' | 'groupName' | 'levelName' | 'guardianName'> {
  student: {
    first_name: string;
    last_name: string;
    rim: string;
    matricule: string | null;
    sex: string | null;
    group_id: string | null;
    group_name: string | null;
    level_name: string | null;
    guardian_name: string | null;
  } | null;
}

/**
 * LE BULLETIN D'UN ÉLÈVE — `notes_etudiants.php?etudiant_id=…&trimestre=…&annee_notes=…`,
 * rendu par `includes/bulletin_vue.php` : « ← Retour à la liste » (la classe,
 * le trimestre et l'année), « Imprimer le bulletin », puis le document —
 * le même que celui de l'impression d'une classe.
 */
export default async function BulletinPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ trimestre?: string; annee_notes?: string }>;
}) {
  const { studentId } = await params;
  const sp = await searchParams;
  await requireSession();
  const trimestre = Math.max(1, Math.min(3, Number(sp.trimestre ?? 1) || 1));

  const [school, annees, vue] = await Promise.all([
    currentSchool(),
    apiFetch<Annee[]>('/academic-years').catch(() => [] as Annee[]),
    anneeAffichee(),
  ]);
  const anneeNotes = /^\d{4}$/.test(sp.annee_notes ?? '') ? Number(sp.annee_notes) : (vue?.start_year ?? new Date().getFullYear());
  const annee = annees.find((a) => a.start_year === anneeNotes) ?? vue;

  const reponse = await apiFetch<Reponse>(
    `/grades/report-card/${studentId}?term=${trimestre}${annee ? `&academicYearId=${annee.id}` : ''}`,
  ).catch(nulSiIntrouvable);

  if (!reponse?.student) {
    return <p className="text-muted">Étudiant introuvable.</p>;
  }

  const { student, ...reste } = reponse;
  const card: BulletinCard = {
    ...reste,
    firstName: student.first_name,
    lastName: student.last_name,
    rim: student.rim,
    matricule: student.matricule,
    sex: student.sex,
    groupName: student.group_name,
    levelName: student.level_name,
    guardianName: student.guardian_name,
  };

  return (
    <>
      <div className="no-print" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <a href={`/scolarite/notes?groupe_id=${student.group_id ?? ''}&trimestre=${trimestre}&annee_notes=${anneeNotes}`} className="btn btn-secondary">
          ← Retour à la liste
        </a>
        <PrintButton label="Imprimer le bulletin" />
      </div>

      <BulletinOfficiel card={card} schoolName={school?.name ?? MARQUE.nom} />
    </>
  );
}
