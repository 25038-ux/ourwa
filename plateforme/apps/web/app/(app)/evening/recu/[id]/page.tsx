import { apiFetch, requireSession, can } from '@/lib/session';
import { currentSchool } from '@/lib/tenant';
import { MOIS_NOMS } from '@/lib/mois';
import { RecuDocument, RecuToolbar, dateHeure } from '@/components/recu-document';
import { MARQUE } from '@/lib/brand';

export const dynamic = 'force-dynamic';

interface Recu {
  receipt_number: string;
  paid_at: string;
  amount: string;
  calendar_month: number;
  calendar_year: number;
  student_id: string | null;
  etu_nom: string | null;
  matricule: string | null;
  externe_nom: string | null;
  externe_tel: string | null;
  groupe_nom: string;
  cs_groupe_id: string;
  nom_parent: string | null;
  telephone_parent: string | null;
  discount: string | null;
  moyens: { moyen: string; montant: string }[];
}

/** LE REÇU D'UN PAIEMENT DE COURS DU SOIR — `cours_du_soir.php?print_recu_cs=…`. */
export default async function RecuCoursDuSoirPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireSession();
  if (!can(user, 'finance.consulter', 'finance.encaisser')) {
    return <div className="form-card"><p className="text-muted">Cette page demande <code>finance.consulter</code> ou <code>finance.encaisser</code>.</p></div>;
  }
  const r = await apiFetch<Recu>(`/evening/payments/${id}/receipt`).catch(() => null);
  if (!r) return <div className="form-card"><p className="text-muted">Reçu introuvable.</p></div>;
  const ecole = (await currentSchool())?.name ?? MARQUE.nom;

  const payeur = r.student_id
    ? `${r.nom_parent ?? ''} (${r.telephone_parent ?? ''})`
    : `${r.externe_nom ?? ''}${r.externe_tel ? ` (${r.externe_tel})` : ''}`;

  return (
    <>
      <RecuToolbar retourUrl={`/evening?groupe_id=${r.cs_groupe_id}`} retourLabel="← Retour au groupe" />
      <RecuDocument
        type="Reçu de paiement — Cours du soir"
        numero={r.receipt_number}
        date={dateHeure(r.paid_at)}
        lignes={[
          ['Élève', r.student_id ? r.etu_nom : r.externe_nom],
          ['Matricule', r.student_id ? r.matricule : null],
          ['Groupe cours du soir', r.groupe_nom],
          ['Payeur / Téléphone', payeur],
          ['Période', `${MOIS_NOMS[r.calendar_month] ?? ''} ${r.calendar_year}`],
        ]}
        moyens={r.moyens}
        reduction={r.discount}
        montant={r.amount}
        sens="entrant"
        note={`Merci de votre confiance — ${ecole}`}
        ecole={ecole}
      />
      <style>{`@media print { .no-print, .sidebar, .topbar, .page-header { display:none !important; } #recu { border:none !important; } }`}</style>
    </>
  );
}
