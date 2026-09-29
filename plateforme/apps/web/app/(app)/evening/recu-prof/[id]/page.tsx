import { apiFetch, requireSession, can } from '@/lib/session';
import { currentSchool } from '@/lib/tenant';
import { MOIS_NOMS } from '@/lib/mois';
import { RecuDocument, RecuToolbar, dateHeure } from '@/components/recu-document';
import { MARQUE } from '@/lib/brand';

export const dynamic = 'force-dynamic';

interface Recu {
  numero: string;
  paid_at: string;
  amount: string;
  calendar_month: number;
  calendar_year: number;
  groupe_nom: string;
  cs_groupe_id: string;
  matiere: string | null;
  prof_nom: string | null;
  prof_tel: string | null;
  est_interne: boolean;
  moyens: { moyen: string; montant: string }[];
}

/** LE REÇU D'UN PAIEMENT DE PROFESSEUR — `cours_du_soir.php?print_recu_prof_cs=…`, « CSP-000123 ». */
export default async function RecuProfCoursDuSoirPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireSession();
  if (!can(user, 'finance.consulter', 'finance.encaisser', 'finance.salaires')) {
    return <div className="form-card"><p className="text-muted">Cette page demande <code>finance.consulter</code>.</p></div>;
  }
  const r = await apiFetch<Recu>(`/evening/teacher-payments/${id}/receipt`).catch(() => null);
  if (!r) return <div className="form-card"><p className="text-muted">Reçu introuvable.</p></div>;
  const ecole = (await currentSchool())?.name ?? MARQUE.nom;

  return (
    <>
      <RecuToolbar retourUrl={`/evening?groupe_id=${r.cs_groupe_id}`} retourLabel="← Retour au groupe" />
      <RecuDocument
        type="Reçu de paiement — Professeur cours du soir"
        numero={r.numero}
        date={dateHeure(r.paid_at)}
        lignes={[
          ['Professeur', `${r.prof_nom ?? ''}${r.prof_tel ? ` (${r.prof_tel})` : ''}`],
          ['Statut', r.est_interne ? "Professeur de l'école" : 'Professeur externe'],
          ['Groupe', r.groupe_nom],
          ['Matière', r.matiere || null],
          ['Période', `${MOIS_NOMS[r.calendar_month] ?? ''} ${r.calendar_year}`],
        ]}
        moyens={r.moyens}
        montant={r.amount}
        sens="sortant"
        note={`Paiement de salaire — ${ecole}`}
        ecole={ecole}
      />
      <style>{`@media print { .no-print, .sidebar, .topbar, .page-header { display:none !important; } #recu { border:none !important; } }`}</style>
    </>
  );
}
