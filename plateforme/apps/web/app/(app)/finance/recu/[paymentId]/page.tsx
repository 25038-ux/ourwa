import { redirect } from 'next/navigation';
import { apiFetch, requireSession, can, nulSiIntrouvable } from '@/lib/session';
import { currentSchool } from '@/lib/tenant';
import { MOIS_NOMS } from '@/lib/mois';
import { RecuDocument, RecuToolbar, dateHeure } from '@/components/recu-document';
import { MARQUE } from '@/lib/brand';

export const dynamic = 'force-dynamic';

interface Receipt {
  receiptNumber: string;
  amount: string;
  month: number;
  year: number;
  paidAt: string;
  reversedBy: string | null;
  studentName: string;
  matricule: string | null;
  levelName: string | null;
  groupName: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianId: string | null;
  tender: { method: string; amount: string; reference?: string | null }[];
  discount: string | null;
}

/**
 * LE REÇU DE SCOLARITÉ — `gestion_caisse.php?print_recu=…`, par `recu_document()` :
 * Étudiant, Matricule, Niveau / Groupe, Correspondant (téléphone), Période,
 * les moyens, la réduction du mois s'il y en a une, le montant encaissé.
 *
 * ⚠ Un paiement annulé le dit sur son propre reçu (règle 7 : l'original reste,
 * une écriture inverse le neutralise) — chez lui la ligne est effacée, et le
 * reçu avec elle.
 */
export default async function RecuPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
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

  const r = await apiFetch<Receipt & { receiptId?: string | null }>(`/finance/receipt/${paymentId}`).catch(nulSiIntrouvable);
  // Un mois encaissé dans un reçu groupé (0040) : c'est ce reçu-là qui vaut.
  if (r?.receiptId) redirect(`/finance/recu/groupe/${r.receiptId}`);
  if (!r) {
    return (
      <div className="form-card">
        <p className="text-muted">Reçu introuvable.</p>
      </div>
    );
  }
  const ecole = (await currentSchool())?.name ?? MARQUE.nom;

  return (
    <>
      <RecuToolbar
        retourUrl={r.guardianId ? `/finance/${r.guardianId}` : '/finance'}
        retourLabel="← Profil du correspondant"
      />
      {r.reversedBy && (
        <div className="alert alert-error no-print" role="alert" style={{ maxWidth: 640, margin: '0 auto 1rem' }}>
          ⚠ Ce paiement a été annulé par l’écriture <strong>{r.reversedBy}</strong>. Ce reçu ne vaut plus
          preuve de règlement.
        </div>
      )}
      <RecuDocument
        type="Reçu de paiement — Scolarité"
        numero={r.receiptNumber}
        date={dateHeure(r.paidAt)}
        lignes={[
          ['Étudiant', r.studentName],
          ['Matricule', r.matricule],
          ['Niveau / Groupe', `${r.levelName ?? '—'} — ${r.groupName ?? ''}`],
          ['Correspondant', `${r.guardianName ?? ''} (${r.guardianPhone ?? ''})`],
          ['Période', `${MOIS_NOMS[r.month] ?? ''} ${r.year}`],
        ]}
        moyens={r.tender.map((t) => ({ moyen: t.method, montant: t.amount, reference: t.reference }))}
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
