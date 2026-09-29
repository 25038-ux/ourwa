import { apiFetch, requireSession, can } from '@/lib/session';
import { currentSchool } from '@/lib/tenant';
import { MOIS_NOMS } from '@/lib/mois';
import { RecuDocument, RecuToolbar, dateHeure } from '@/components/recu-document';
import { MARQUE } from '@/lib/brand';

export const dynamic = 'force-dynamic';

interface Groupe {
  receiptNumber: string;
  amount: string;
  paidAt: string;
  yearLabel: string;
  guardianId: string;
  guardianName: string | null;
  guardianPhone: string | null;
  months: { paymentId: string; studentName: string; matricule: string | null; levelName: string | null; groupName: string | null; month: number; year: number; amount: string; reversedBy: string | null }[];
  fees: { id: string; kind: string; label: string; amount: string }[];
  tender: { method: string; amount: string; reference?: string | null }[];
}

const mru = (v: string) => Math.round(Number(v)).toLocaleString('fr-FR');

/**
 * LE REÇU GROUPÉ (0040) — un numéro pour les mois et les frais réglés d'un
 * coup : chaque enfant avec ses mois, chaque frais, les moyens additionnés
 * (avec la référence de l'application de paiement), le total.
 */
export default async function RecuGroupePage({ params }: { params: Promise<{ receiptId: string }> }) {
  const { receiptId } = await params;
  const { user } = await requireSession();
  if (!can(user, 'finance.consulter', 'finance.encaisser', 'scolarite.inscrire', 'scolarite.reinscrire')) {
    return <div className="form-card"><p className="text-muted">Cette page demande <code>finance.consulter</code> ou <code>finance.encaisser</code>.</p></div>;
  }
  const r = await apiFetch<Groupe>(`/finance/receipt-group/${receiptId}`).catch(() => null);
  if (!r) return <div className="form-card"><p className="text-muted">Reçu introuvable.</p></div>;
  const ecole = (await currentSchool())?.name ?? MARQUE.nom;

  const parEleve = new Map<string, typeof r.months>();
  for (const m of r.months) parEleve.set(m.studentName, [...(parEleve.get(m.studentName) ?? []), m]);
  const lignes: [string, string | null][] = [];
  for (const [nom, mois] of parEleve) {
    const premier = mois[0]!;
    lignes.push([`Étudiant`, `${nom}${premier.matricule ? ` · ${premier.matricule}` : ''}${premier.levelName || premier.groupName ? ` · ${premier.levelName ?? ''} ${premier.groupName ?? ''}`.trimEnd() : ''}`]);
    lignes.push([`Scolarité — ${nom}`, mois.map((m) => `${MOIS_NOMS[m.month] ?? ''} ${m.year} : ${mru(m.amount)} MRU${m.reversedBy ? ' (annulé)' : ''}`).join(' · ')]);
  }
  for (const f of r.fees) lignes.push([f.label, `${mru(f.amount)} MRU`]);
  const annule = r.months.filter((m) => m.reversedBy);

  return (
    <>
      <RecuToolbar retourUrl={`/finance/${r.guardianId}`} retourLabel="← Profil du correspondant" />
      {annule.length > 0 && (
        <div className="alert alert-error no-print" role="alert" style={{ maxWidth: 640, margin: '0 auto 1rem' }}>
          ⚠ {annule.length === 1 ? 'Une ligne de ce reçu a été annulée' : `${annule.length} lignes de ce reçu ont été annulées`} ({annule.map((m) => m.reversedBy).join(', ')}). Le reçu ne vaut plus preuve pour {annule.length === 1 ? 'ce mois' : 'ces mois'}.
        </div>
      )}
      <RecuDocument
        type="Reçu de paiement — Scolarité et frais"
        numero={r.receiptNumber}
        date={dateHeure(r.paidAt)}
        lignes={[
          ['Correspondant', `${r.guardianName ?? ''} (${r.guardianPhone ?? ''})`],
          ['Année scolaire', r.yearLabel],
          ...lignes,
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
