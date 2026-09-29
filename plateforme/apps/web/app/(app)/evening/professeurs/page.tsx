import { apiFetch, requireSession, can } from '@/lib/session';
import { anneeAffichee } from '@/lib/annee';
import { MOIS_NOMS } from '@/lib/mois';
import { PageHeader } from '@/components/page-header';
import { HubNav } from '@/components/hub';
import { MessagePage } from '@/components/message-page';
import { AutoSubmitSelect } from '@/components/auto-submit-select';
import { EVENING_TABS } from '../tabs';
import { PaiementProfs, type Row } from './paiement-profs';

export const dynamic = 'force-dynamic';

/**
 * PAIEMENT DES PROFESSEURS — le second onglet de `cours_du_soir.php` :
 * « Mois » / « Année » (défaut−2 … défaut+1) soumis au changement, la table
 * « Professeurs & Rémunérations Cours du Soir — Mois Année » (enseignants dont
 * le groupe tourne ce mois), « Rémunérer » (modale à moyens), « Reçu »,
 * « ✕ Annuler » (pas pour le comptable).
 */
export default async function PaiementProfesseursPage({
  searchParams,
}: {
  searchParams: Promise<{ prof_mois?: string; prof_annee?: string }>;
}) {
  const params = await searchParams;
  const { user } = await requireSession();
  const comptable = user.roles.includes('comptable');
  const vue = await anneeAffichee();
  const anneeDefaut = vue?.start_year ?? new Date().getFullYear();

  const pMois = Math.max(1, Math.min(12, Number(params.prof_mois ?? new Date().getMonth() + 1) || 1));
  const pAnneeDemandee = Number(params.prof_annee ?? 0);
  const pAnnee = pAnneeDemandee >= 2020 ? pAnneeDemandee : anneeDefaut;

  const mayPay = can(user, 'finance.depenser');
  const mayView = can(user, 'finance.depenser', 'finance.consulter');

  const [rows, moyens] = mayView
    ? await Promise.all([
        apiFetch<Row[]>(`/evening/teachers/payroll?month=${pMois}&year=${pAnnee}`).catch(() => [] as Row[]),
        apiFetch<{ id: string; name: string }[]>('/payment-methods').catch(() => []),
      ])
    : [[], []];

  return (
    <>
      <PageHeader titre="Gestion de cours du soir" sousTitre="Groupes, emplois du temps, professeurs et finance" />
      <MessagePage>
        <div className="hub-shell">
          <HubNav tabs={EVENING_TABS} active="profs" label="Sections Cours du soir" />
          <div className="hub-panel">
            {!mayView ? (
              <div className="form-card"><p className="text-muted">Cette page demande <code>finance.depenser</code> ou <code>finance.consulter</code>.</p></div>
            ) : (
              <>
                <form method="GET" className="form-card" style={{ marginBottom: '1.5rem' }}>
                  <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 160 }}>
                      <label>Mois</label>
                      <AutoSubmitSelect name="prof_mois" defaultValue={String(pMois)} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: MOIS_NOMS[i + 1]! }))} />
                    </div>
                    <div style={{ minWidth: 120 }}>
                      <label>Année</label>
                      <AutoSubmitSelect name="prof_annee" defaultValue={String(pAnnee)} options={Array.from({ length: 4 }, (_, i) => anneeDefaut - 2 + i).map((y) => ({ value: String(y), label: String(y) }))} />
                    </div>
                  </div>
                </form>

                <PaiementProfs rows={rows} mois={pMois} annee={pAnnee} moyens={moyens} mayPay={mayPay} comptable={comptable} />
              </>
            )}
          </div>
        </div>
      </MessagePage>
    </>
  );
}
