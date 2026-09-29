import { apiFetch, requireSession, can } from '@/lib/session';
import { currentSchool } from '@/lib/tenant';
import { RecuDocument, RecuToolbar, dateHeure } from '@/components/recu-document';
import { LIBELLE_FRAIS_PHOTOCOPIE, MARQUE } from '@/lib/brand';

export const dynamic = 'force-dynamic';

interface AnnualReceipt {
  receiptNumber: string | null;
  amount: string;
  kind: 'enrolment' | 'photocopy';
  paidAt: string;
  guardianId: string;
  guardianName: string | null;
  guardianPhone: string | null;
  tender: { method: string; amount: string; reference?: string | null }[];
}

/**
 * LE REÇU D'UN FRAIS ANNUEL — `gestion_caisse.php?print_recu_annuel=…` :
 * « Reçu — Frais d'inscription » ou « Reçu — Frais de photocopie »,
 * Correspondant (téléphone), Type de frais, les moyens, le montant.
 */
export default async function RecuAnnuelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireSession();

  if (!can(user, 'finance.consulter', 'finance.encaisser')) {
    return (
      <div className="form-card">
        <p className="text-muted">
          Cette page demande <code>finance.consulter</code> ou <code>finance.encaisser</code>.
        </p>
      </div>
    );
  }

  const r = await apiFetch<AnnualReceipt>(`/finance/receipt/annual/${id}`).catch(() => null);
  if (!r) {
    return (
      <div className="form-card">
        <p className="text-muted">Reçu introuvable.</p>
      </div>
    );
  }
  const ecole = (await currentSchool())?.name ?? MARQUE.nom;
  const inscription = r.kind === 'enrolment';

  return (
    <>
      <RecuToolbar retourUrl={`/finance/${r.guardianId}`} retourLabel="← Profil du correspondant" />
      <RecuDocument
        type={`Reçu — ${inscription ? "Frais d'inscription" : LIBELLE_FRAIS_PHOTOCOPIE}`}
        numero={r.receiptNumber}
        date={dateHeure(r.paidAt)}
        lignes={[
          ['Correspondant', `${r.guardianName ?? ''} (${r.guardianPhone ?? ''})`],
          ['Type de frais', inscription ? "Frais d'inscription (annuel, par correspondant)" : LIBELLE_FRAIS_PHOTOCOPIE],
        ]}
        moyens={r.tender.map((t) => ({ moyen: t.method, montant: t.amount, reference: t.reference }))}
        montant={r.amount}
        sens="entrant"
        note={`Merci de votre confiance — ${ecole}`}
        ecole={ecole}
      />
      <style>{`@media print { .no-print, .sidebar, .topbar, .page-header { display:none !important; } #recu { border:none !important; } }`}</style>
    </>
  );
}
