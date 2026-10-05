import { apiFetch, requireSession, nulSiIntrouvable } from '@/lib/session';
import { currentSchool } from '@/lib/tenant';
import { PageHeader } from '@/components/page-header';
import { HubNav, mru } from '@/components/hub';
import { RecuDocument, RecuToolbar, dateHeure } from '@/components/recu-document';
import { MOIS_NOMS } from '@/lib/mois';
import { financeTabsFor } from '../tabs';
import { PretsPersonnel, type Pret } from './prets';
import { RemboursementDette } from './remboursement';
import { MARQUE } from '@/lib/brand';

export const dynamic = 'force-dynamic';

interface FormData_ {
  staff: { id: string; nom_complet: string; fonction: string | null }[];
  profs: { id: string; nom_complet: string }[];
  moisMotif: number[];
  annees: number[];
}

interface Contrat {
  id: string;
  numero: string | null;
  date: string;
  benef_nom: string;
  benef_tel: string | null;
  benef_fonction: string | null;
  motif: string | null;
  echeances: { mois: number; annee: number; montant: string }[];
  moyens: { moyen: string; montant: string }[];
  montant: string;
}

interface RecuAvance {
  id: string;
  numero: string | null;
  date: string;
  benef_nom: string;
  benef_tel: string | null;
  montant_total: string;
  reste_apres: string;
  moyens: { moyen: string; montant: string }[];
  montant: string;
}

interface Debiteur {
  id: string;
  debtor_name: string;
  phone: string | null;
  total: string;
  repaid: string;
  reste: string;
}

interface ProfilDette {
  id: string;
  debtor_name: string;
  phone: string | null;
  reason: string | null;
  total: string;
  repaid: string;
  remaining: string;
  remboursements: { id: string; montant: string; date: string; numero: string | null; moyens: string }[];
}

interface RecuRemb {
  id: string;
  dette_id: string;
  numero: string;
  date: string;
  montant: string;
  debiteur_nom: string;
  debiteur_tel: string | null;
  motif: string | null;
  montant_total: string;
  reste_apres: string;
  moyens: { moyen: string; montant: string }[];
}

/**
 * Dettes — `pages/super_admin/dette.php`, dans le hub Finance.
 *
 * ⚠ SA SECTION « DÉBITEURS » (table `dettes`) NE SE RENDE QUE `if ($dettes ||
 * $q !== '')`. La création de dettes diverses est désactivée chez lui —
 * « l'école ne prête qu'à son personnel » — et la table est vide dans les
 * données réelles (0 ligne, 0 remboursement). Ce que la page montre au
 * quotidien, c'est donc le prêt au personnel : le formulaire, le tableau
 * « Prêts en cours & soldés », la modale d'avance, et les deux reçus
 * (`print_recu_pret`, `print_recu_avance`). Les créances des familles
 * (`dettes_familles`) ne sont pas ici mais dans Impayés et Réinscriptions.
 *
 * Ses « Débiteurs » (table `dettes`) sont chez nous les `misc_debts` SANS
 * foyer — celles qu'une demande de type `dette` approuvée crée. Leur profil
 * (`?dette_id=`) porte ses trois cartes, « Enregistrer un remboursement » à
 * moyens multiples, l'historique et le reçu `REMB-…` (`?print_recu_remb=`).
 */
export default async function DettesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    dette_id?: string;
    print_recu_remb?: string;
    print_recu_pret?: string;
    print_recu_avance?: string;
  }>;
}) {
  const params = await searchParams;
  const { user } = await requireSession();
  const ecole = (await currentSchool())?.name ?? MARQUE.nom;

  const entete = (
    <>
      <PageHeader titre="Finance" sousTitre="Caisse, revenus, salaires, dettes et dépenses" />
    </>
  );
  const uuid = /^[0-9a-f-]{36}$/;

  if (uuid.test(params.print_recu_remb ?? '')) {
    const r = await apiFetch<RecuRemb>(
      `/finance/misc-debt-repayments/${params.print_recu_remb}/receipt`,
    ).catch(nulSiIntrouvable);
    if (r) {
      return (
        <>
          {entete}
          <div className="hub-shell">
            <HubNav tabs={financeTabsFor(user.roles)} active="dette" label="Sections Finance" />
            <div className="hub-panel">
              <RecuToolbar retourUrl={`/finance/dettes?dette_id=${r.dette_id}`} retourLabel="← Profil de la dette" />
              <RecuDocument
                type="Reçu — Remboursement de dette"
                numero={r.numero}
                date={dateHeure(r.date)}
                lignes={[
                  ['Débiteur', r.debiteur_nom + (r.debiteur_tel ? ` (${r.debiteur_tel})` : '')],
                  ['Motif de la dette', r.motif || null],
                  ['Dette totale', `${mru(r.montant_total)} MRU`],
                  ['Reste dû après ce versement', `${mru(r.reste_apres)} MRU`],
                ]}
                moyens={r.moyens}
                montant={r.montant}
                sens="entrant"
                note={`Remboursement encaissé — ${ecole}`}
                ecole={ecole}
              />
            </div>
          </div>
        </>
      );
    }
  }

  if (uuid.test(params.print_recu_pret ?? '')) {
    const c = await apiFetch<Contrat>(`/payroll/loans/${params.print_recu_pret}/contract`).catch(
      () => null,
    );
    if (c) {
      const ech = c.echeances
        .map((e) => `${MOIS_NOMS[e.mois] ?? e.mois} ${e.annee} : ${mru(e.montant)} MRU`)
        .join(' · ');
      return (
        <>
          {entete}
          <div className="hub-shell">
            <HubNav tabs={financeTabsFor(user.roles)} active="dette" label="Sections Finance" />
            <div className="hub-panel">
              <RecuToolbar retourUrl="/finance/dettes" retourLabel="← Retour aux dettes & prêts" />
              <RecuDocument
                type="Contrat de prêt — Personnel"
                numero={c.numero}
                date={dateHeure(c.date)}
                lignes={[
                  ['Bénéficiaire', c.benef_nom + (c.benef_tel ? ` (${c.benef_tel})` : '')],
                  ['Fonction', c.benef_fonction],
                  ['Motif', c.motif || null],
                  ['Échéancier (retenues sur salaire)', ech],
                ]}
                moyens={c.moyens}
                montant={c.montant}
                sens="sortant"
                note={`Prêt remboursable par retenue mensuelle sur salaire — ${ecole}`}
                ecole={ecole}
              />
            </div>
          </div>
        </>
      );
    }
  }

  if (uuid.test(params.print_recu_avance ?? '')) {
    const r = await apiFetch<RecuAvance>(
      `/payroll/loan-repayments/${params.print_recu_avance}/receipt`,
    ).catch(nulSiIntrouvable);
    if (r) {
      return (
        <>
          {entete}
          <div className="hub-shell">
            <HubNav tabs={financeTabsFor(user.roles)} active="dette" label="Sections Finance" />
            <div className="hub-panel">
              <RecuToolbar retourUrl="/finance/dettes" retourLabel="← Retour aux dettes & prêts" />
              <RecuDocument
                type="Reçu — Avance de remboursement (prêt personnel)"
                numero={r.numero}
                date={dateHeure(r.date)}
                lignes={[
                  ['Bénéficiaire du prêt', r.benef_nom + (r.benef_tel ? ` (${r.benef_tel})` : '')],
                  ['Prêt total', `${mru(r.montant_total)} MRU`],
                  [
                    'Reste dû après ce versement',
                    `${mru(r.reste_apres)} MRU (échéances recalculées automatiquement)`,
                  ],
                ]}
                moyens={r.moyens}
                montant={r.montant}
                sens="entrant"
                note={`Remboursement anticipé encaissé — ${ecole}`}
                ecole={ecole}
              />
            </div>
          </div>
        </>
      );
    }
  }

  const q = (params.q ?? '').trim();
  const [form, prets, moyens, debiteurs] = await Promise.all([
    apiFetch<FormData_>('/payroll/loans/form').catch(() => null),
    apiFetch<Pret[]>('/payroll/loans').catch(() => null),
    apiFetch<{ id: string; name: string }[]>('/payment-methods').catch(() => []),
    apiFetch<Debiteur[]>(`/finance/misc-debts/debiteurs?q=${encodeURIComponent(q)}`).catch(
      () => [] as Debiteur[],
    ),
  ]);

  // Profil d'une dette ? — son bloc `elseif ($dette)`.
  const dette = uuid.test(params.dette_id ?? '')
    ? await apiFetch<ProfilDette>(`/finance/misc-debts/${params.dette_id}`).catch(nulSiIntrouvable)
    : null;
  if (dette) {
    const reste = Number(dette.remaining);
    return (
      <>
        {entete}
        <div className="hub-shell">
          <HubNav tabs={financeTabsFor(user.roles)} active="dette" label="Sections Finance" />
          <div className="hub-panel">
            <a href="/finance/dettes" className="btn btn-secondary" style={{ marginBottom: '1rem' }}>
              ← Toutes les dettes
            </a>
            <div className="form-card" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ marginTop: 0 }}>{dette.debtor_name}</h3>
              <p className="text-muted">
                {dette.phone || '—'}
                {dette.reason ? ` · ${dette.reason}` : ''}
              </p>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '.5rem' }}>
                <div style={{ flex: 1, textAlign: 'center', background: '#f9fafb', borderRadius: 10, padding: '.75rem' }}>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{mru(dette.total)}</div>
                  <div className="text-muted" style={{ fontSize: '.8rem' }}>Dette totale (MRU)</div>
                </div>
                <div style={{ flex: 1, textAlign: 'center', background: '#ecfdf5', borderRadius: 10, padding: '.75rem' }}>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#728157' }}>{mru(dette.repaid)}</div>
                  <div className="text-muted" style={{ fontSize: '.8rem' }}>Remboursé</div>
                </div>
                <div style={{ flex: 1, textAlign: 'center', background: '#fef2f2', borderRadius: 10, padding: '.75rem' }}>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#a8341f' }}>{mru(dette.remaining)}</div>
                  <div className="text-muted" style={{ fontSize: '.8rem' }}>Reste dû</div>
                </div>
              </div>
            </div>

            {reste > 0.01 ? (
              <RemboursementDette detteId={dette.id} moyens={moyens} />
            ) : (
              <div className="alert alert-success" style={{ marginBottom: '1.5rem' }}>✓ Dette entièrement remboursée.</div>
            )}

            <div className="table-container">
              <div className="table-header"><h3>Historique des remboursements</h3></div>
              <div className="overflow-x">
                <table>
                  <thead><tr><th>Date</th><th>Montant</th><th>Moyen(s)</th><th className="no-print">Reçu</th></tr></thead>
                  <tbody>
                    {dette.remboursements.length === 0 ? (
                      <tr><td colSpan={3} className="text-center text-muted">Aucun remboursement.</td></tr>
                    ) : (
                      dette.remboursements.map((r) => (
                        <tr key={r.id}>
                          <td>{dateHeure(r.date)}</td>
                          <td><strong style={{ color: '#728157' }}>{mru(r.montant)} MRU</strong></td>
                          <td>{r.moyens}</td>
                          <td>
                            <a
                              href={`/finance/dettes?dette_id=${dette.id}&print_recu_remb=${r.id}`}
                              target="_blank"
                              rel="noopener"
                              className="btn btn-sm btn-secondary"
                              title="Imprimer le reçu"
                            >
                              Reçu
                            </a>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {entete}
      <div className="hub-shell">
        <HubNav tabs={financeTabsFor(user.roles)} active="dette" label="Sections Finance" />

        <div className="hub-panel">
          {/* La création de « dette diverse » a été retirée : l'école ne prête
              qu'à son PERSONNEL, via la section « Prêt au personnel » ci-dessous.
              Les anciennes dettes restent consultables et remboursables. */}
          {(debiteurs.length > 0 || q !== '') && (
            <>
              <form method="GET" className="form-card" style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label>Rechercher un débiteur</label>
                    <input type="text" name="q" defaultValue={q} placeholder="Nom ou téléphone" />
                  </div>
                  <button className="btn btn-primary">Chercher</button>
                  {q !== '' && (
                    <a href="/finance/dettes" className="btn btn-secondary">
                      Réinitialiser
                    </a>
                  )}
                </div>
              </form>
              <div className="table-container">
                <div className="table-header">
                  <h3>Débiteurs</h3>
                  <span className="badge badge-primary">{debiteurs.length}</span>
                </div>
                <div className="overflow-x">
                  <table>
                    <thead>
                      <tr>
                        <th>Débiteur</th>
                        <th>Tél</th>
                        <th>Total</th>
                        <th>Remboursé</th>
                        <th>Reste</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {debiteurs.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center text-muted" style={{ padding: '2rem' }}>
                            Aucune dette enregistrée.
                          </td>
                        </tr>
                      ) : (
                        debiteurs.map((d) => {
                          const reste = Number(d.reste);
                          return (
                            <tr key={d.id}>
                              <td><strong>{d.debtor_name}</strong></td>
                              <td>{d.phone || '—'}</td>
                              <td>{mru(d.total)}</td>
                              <td style={{ color: '#728157' }}>{mru(d.repaid)}</td>
                              <td><strong style={{ color: reste > 0.01 ? '#a8341f' : '#728157' }}>{mru(d.reste)}</strong></td>
                              <td><a href={`/finance/dettes?dette_id=${d.id}`} className="btn btn-sm btn-primary">Profil →</a></td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {form === null || prets === null ? (
            <div className="alert alert-error">
              La section « Prêt au personnel » n’a pas pu être chargée. Réessayez.
            </div>
          ) : (
            <PretsPersonnel
              staff={form.staff}
              profs={form.profs}
              moisMotif={form.moisMotif}
              annees={form.annees}
              prets={prets}
              moyens={moyens}
            />
          )}
        </div>
      </div>
    </>
  );
}
