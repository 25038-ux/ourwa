import { apiFetch, requireSession } from '@/lib/session';
import { currentSchool } from '@/lib/tenant';
import { PageHeader } from '@/components/page-header';
import { HubNav, mru } from '@/components/hub';
import { MessagePage } from '@/components/message-page';
import { RecuDocument, RecuToolbar, dateHeure } from '@/components/recu-document';
import { financeTabsFor } from '../tabs';
import { AjouterAdmin, GestionAdmin, RapportForm } from './forms';
import { MARQUE } from '@/lib/brand';

export const dynamic = 'force-dynamic';

interface Retrait {
  id: string;
  withdrawn_at: string;
  holder: string;
  amount: string;
  reason: string | null;
  receipt_number: string | null;
  recorded_by: string | null;
  tender: { method: string; amount: string }[];
}

interface Rapport {
  rows: Retrait[];
  total: string;
  /** Sa « Répartition par administrateur », du plus gros au plus petit. */
  byHolder: { holder: string; total: string }[];
  truncated: boolean;
}

interface Administrateur {
  id: string;
  full_name: string;
  phone: string | null;
  monthly_limit: string;
  is_active: boolean;
  taken: string;
  remaining: string;
}

interface RecuRetrait {
  id: string;
  numero: string | null;
  date: string;
  nom_complet: string;
  telephone: string | null;
  motif: string | null;
  mois: number;
  annee: number;
  limite_mensuelle: string | null;
  cumul_mois: string | null;
  reste_apres: string | null;
  enregistre_par_nom: string | null;
  moyens: { moyen: string; montant: string }[];
  montant: string;
}

const MOIS = [
  '', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

/**
 * Administrateurs — `pages/super_admin/administrateurs.php`.
 *
 * ⚠ UN « ADMINISTRATEUR » ICI N'EST PAS LE RÔLE `admin`. Sa table
 * `administrateurs` tient des gens avec un plafond mensuel de retrait — une
 * qualité FINANCIÈRE. `utilisateurs.role = 'admin'` est une qualité d'ACCÈS.
 * Même mot, sens sans rapport (GLOSSAIRE §4).
 *
 * Ses quatre parties, dans son ordre : l'ajout (administration seulement), la
 * liste avec la consommation DU MOIS COURANT (`date('n')`, jamais un paramètre),
 * les rapports (journalier / mensuel / annuel, champs `rapport`, `r_date`,
 * `r_mois`, `r_annee`) et la répartition par administrateur. Le comptable ne
 * voit NI la page NI les limites ; seule exception, le reçu du retrait qu'il
 * vient d'enregistrer (`print_recu_retrait`), sans informations de limite.
 */
export default async function AdministrateursPage({
  searchParams,
}: {
  searchParams: Promise<{
    rapport?: string;
    r_date?: string;
    r_mois?: string;
    r_annee?: string;
    print_recu_retrait?: string;
  }>;
}) {
  const params = await searchParams;
  const { user } = await requireSession();
  const comptable = user.roles.includes('comptable');

  const now = new Date();
  const moisC = now.getMonth() + 1;
  const anneeC = now.getFullYear();

  // Reçu de retrait imprimable ?
  const printRecu = /^[0-9a-f-]{36}$/.test(params.print_recu_retrait ?? '')
    ? params.print_recu_retrait!
    : null;
  const recu = printRecu
    ? await apiFetch<RecuRetrait>(`/payroll/withdrawals/${printRecu}/receipt`).catch(() => null)
    : null;

  // ── Accès : le comptable ne voit NI la page NI les limites. Seule exception :
  //    le reçu du retrait qu'il vient d'enregistrer (sans informations de limite). ──
  if (comptable && !printRecu) {
    return (
      <>
        <PageHeader titre="Administrateurs" sousTitre="Accès réservé" />
        <div className="alert alert-error">Cette page est réservée à l&apos;administration.</div>
      </>
    );
  }

  if (recu) {
    const ecole = (await currentSchool())?.name ?? MARQUE.nom;
    return (
      <>
        <PageHeader titre="Finance" sousTitre="Caisse, revenus, salaires, dettes et dépenses" />
        <div className="hub-shell">
          <HubNav tabs={financeTabsFor(user.roles)} active="admins" label="Sections Finance" />
          <div className="hub-panel">
            <RecuToolbar
              retourUrl={comptable ? '/finance/staff?type=admins' : '/finance/administrateurs'}
              retourLabel={
                comptable ? '← Retour au paiement du personnel' : '← Retour aux administrateurs'
              }
            />
            <RecuDocument
              type="Reçu — Retrait administrateur"
              numero={recu.numero}
              date={dateHeure(recu.date)}
              lignes={[
                ['Administrateur', recu.nom_complet + (recu.telephone ? ` (${recu.telephone})` : '')],
                ['Motif', recu.motif || null],
                ['Période', `${MOIS[recu.mois]} ${recu.annee}`],
                // Les informations de limite sont CONFIDENTIELLES : jamais montrées au comptable.
                [
                  'Limite mensuelle',
                  recu.limite_mensuelle === null ? null : `${mru(recu.limite_mensuelle)} MRU`,
                ],
                [
                  'Cumul du mois après ce retrait',
                  recu.cumul_mois === null
                    ? null
                    : `${mru(recu.cumul_mois)} MRU (reste disponible : ${mru(recu.reste_apres ?? '0')} MRU)`,
                ],
                ['Enregistré par', recu.enregistre_par_nom],
              ]}
              moyens={recu.moyens}
              montant={recu.montant}
              sens="sortant"
              note={`Retrait administrateur — ${ecole}`}
              ecole={ecole}
            />
          </div>
        </div>
      </>
    );
  }

  const rapport = ['jour', 'mois', 'annee'].includes(params.rapport ?? '') ? params.rapport! : 'mois';
  const rDate = /^\d{4}-\d{2}-\d{2}$/.test(params.r_date ?? '')
    ? params.r_date!
    : now.toISOString().slice(0, 10);
  const rMois = Math.min(12, Math.max(1, Number(params.r_mois) || moisC));
  let rAnnee = Number(params.r_annee) || anneeC;
  if (rAnnee < 2020 || rAnnee > 2100) rAnnee = anneeC;

  const [admins, retraits] = await Promise.all([
    apiFetch<Administrateur[]>(`/payroll/fund-holders?month=${moisC}&year=${anneeC}`).catch(
      () => [],
    ),
    // ⚠ PAS DE `.catch()` QUI REND UN RAPPORT VIDE : zéro et « je n'ai pas pu
    // lire » ne sont pas le même fait.
    apiFetch<Rapport>(
      `/payroll/withdrawals/report?rapport=${rapport}&date=${rDate}&mois=${rMois}&annee=${rAnnee}`,
    ).catch(() => null),
  ]);

  const titreRapport =
    rapport === 'jour'
      ? `Rapport journalier — ${rDate.split('-').reverse().join('/')}`
      : rapport === 'annee'
        ? `Rapport annuel — ${rAnnee}`
        : `Rapport mensuel — ${MOIS[rMois]} ${rAnnee}`;

  const couleur = (ratio: number) => (ratio >= 100 ? '#a8341f' : ratio >= 80 ? '#c98a12' : '#728157');

  return (
    <>
      <PageHeader titre="Finance" sousTitre="Caisse, revenus, salaires, dettes et dépenses" />

      <div className="hub-shell">
        <HubNav tabs={financeTabsFor(user.roles)} active="admins" label="Sections Finance" />

        <div className="hub-panel">
          <MessagePage>
            {/* ═══════════ AJOUT (administration) ═══════════ */}
            <div className="form-card" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ marginTop: 0 }}>Ajouter un administrateur</h3>
              <p className="text-muted" style={{ fontSize: '.85rem' }}>
                Chaque administrateur dispose d&apos;une{' '}
                <strong>limite mensuelle de retrait</strong> : le cumul de ses retraits
                d&apos;un mois ne peut jamais dépasser cette limite (contrôle strict, retrait
                par retrait). Les retraits s&apos;effectuent dans{' '}
                <strong>Finance → Paiement du personnel → catégorie « Administrateurs »</strong>.
              </p>
              <AjouterAdmin />
            </div>

            {/* ═══════════ LISTE & CONSOMMATION DU MOIS ═══════════ */}
            <div className="table-container" style={{ marginBottom: '1.5rem' }}>
              <div className="table-header">
                <h3>
                  Administrateurs — {MOIS[moisC]} {anneeC}
                </h3>
                <span className="badge badge-primary">{admins.length}</span>
              </div>
              <div className="overflow-x">
                <table>
                  <thead>
                    <tr>
                      <th>Nom complet</th>
                      <th>Téléphone</th>
                      <th>Limite mensuelle</th>
                      <th>Retiré ce mois</th>
                      <th>Reste disponible</th>
                      <th className="no-print">Gestion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {admins.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-muted" style={{ textAlign: 'center' }}>
                          Aucun administrateur enregistré.
                        </td>
                      </tr>
                    ) : (
                      admins.map((a) => {
                        const limite = Number(a.monthly_limit);
                        const pris = Number(a.taken);
                        const resteA = Math.max(0, limite - pris);
                        const ratio = limite > 0 ? Math.min(100, Math.round((pris / limite) * 100)) : 0;
                        return (
                          <tr key={a.id} style={!a.is_active ? { opacity: 0.55 } : undefined}>
                            <td>
                              <strong>{a.full_name}</strong>
                              {!a.is_active && (
                                <span className="badge" style={{ background: '#FEE2E2', color: '#991B1B' }}>
                                  Désactivé
                                </span>
                              )}
                            </td>
                            <td>{a.phone || '—'}</td>
                            <td>{mru(a.monthly_limit)} MRU</td>
                            <td>
                              <span style={{ color: couleur(ratio), fontWeight: 700 }}>
                                {mru(pris)} MRU
                              </span>
                              <div
                                style={{
                                  background: '#dcd3c4',
                                  borderRadius: 6,
                                  height: 6,
                                  marginTop: 4,
                                  maxWidth: 140,
                                }}
                              >
                                <div
                                  style={{
                                    width: `${ratio}%`,
                                    height: 6,
                                    borderRadius: 6,
                                    background: couleur(ratio),
                                  }}
                                />
                              </div>
                            </td>
                            <td>
                              <strong style={{ color: resteA > 0.009 ? 'var(--primary)' : '#a8341f' }}>
                                {mru(resteA)} MRU
                              </strong>
                              {resteA <= 0.009 && limite > 0 && (
                                <>
                                  <br />
                                  <span className="badge" style={{ background: '#FEE2E2', color: '#991B1B' }}>
                                    ⚠ Limite atteinte
                                  </span>
                                </>
                              )}
                            </td>
                            <td className="no-print">
                              <GestionAdmin
                                adminId={a.id}
                                monthlyLimit={a.monthly_limit}
                                phone={a.phone}
                                actif={a.is_active}
                              />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ═══════════ RAPPORTS DÉTAILLÉS ═══════════ */}
            <div className="form-card" style={{ marginBottom: '1rem' }}>
              <h3 style={{ marginTop: 0 }}>Rapports des retraits</h3>
              <RapportForm
                rapport={rapport}
                rDate={rDate}
                rMois={rMois}
                rAnnee={rAnnee}
                anneeCourante={anneeC}
              />
            </div>

            <div className="table-container">
              <div className="table-header">
                <h3>{titreRapport}</h3>
                <span className="badge badge-primary">
                  {retraits?.rows.length ?? 0} retrait{(retraits?.rows.length ?? 0) > 1 ? 's' : ''}
                </span>
              </div>
              <div className="overflow-x">
                <table>
                  <thead>
                    <tr>
                      <th>Date &amp; heure</th>
                      <th>Administrateur</th>
                      <th>Montant</th>
                      <th>Moyens de paiement</th>
                      <th>Motif</th>
                      <th>Enregistré par</th>
                      <th className="no-print">Reçu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retraits === null ? (
                      <tr>
                        <td colSpan={7} className="text-center" style={{ padding: '2rem' }}>
                          <span className="text-danger">
                            Le rapport n’a pas pu être chargé. Réessayez.
                          </span>
                        </td>
                      </tr>
                    ) : retraits.rows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-muted" style={{ textAlign: 'center' }}>
                          Aucun retrait sur cette période.
                        </td>
                      </tr>
                    ) : (
                      retraits.rows.map((r) => (
                        <tr key={r.id}>
                          <td>{dateHeure(r.withdrawn_at)}</td>
                          <td>
                            <strong>{r.holder}</strong>
                          </td>
                          <td>
                            <strong style={{ color: '#a8341f' }}>− {mru(r.amount)} MRU</strong>
                          </td>
                          <td style={{ fontSize: '.82rem' }}>
                            {r.tender.length === 0
                              ? '—'
                              : r.tender.map((t) => `${t.method} : ${mru(t.amount)}`).join(' · ')}
                          </td>
                          <td>{r.reason || '—'}</td>
                          <td>{r.recorded_by || '—'}</td>
                          {/* Son lien est un bouton sans texte : `<a … class="btn btn-sm btn-secondary"></a>`. */}
                          <td className="no-print">
                            <a
                              href={`/finance/administrateurs?print_recu_retrait=${r.id}`}
                              target="_blank"
                              rel="noopener"
                              className="btn btn-sm btn-secondary"
                              aria-label="Reçu"
                            ></a>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {retraits && retraits.rows.length > 0 && (
                    <tfoot>
                      <tr style={{ background: 'var(--bg)', fontWeight: 800 }}>
                        <td colSpan={2}>TOTAL DE LA PÉRIODE</td>
                        <td colSpan={5} style={{ color: '#a8341f' }}>
                          − {mru(retraits.total)} MRU
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {retraits && retraits.byHolder.length > 0 && (
              <div className="form-card" style={{ marginTop: '1rem' }}>
                <h4 style={{ marginTop: 0 }}>Répartition par administrateur — {titreRapport}</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem' }}>
                  {retraits.byHolder.map((b) => (
                    <div
                      key={b.holder}
                      style={{
                        padding: '.55rem .9rem',
                        border: '1.5px solid var(--border)',
                        borderRadius: 10,
                        background: '#fff',
                      }}
                    >
                      <strong>{b.holder}</strong> :{' '}
                      <span style={{ color: '#a8341f', fontWeight: 700 }}>− {mru(b.total)} MRU</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </MessagePage>
        </div>
      </div>
    </>
  );
}
