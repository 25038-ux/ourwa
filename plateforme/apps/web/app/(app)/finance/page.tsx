import { apiFetch, requireSession } from '@/lib/session';
import { anneeAffichee, type Annee } from '@/lib/annee';
import { MOIS_NOMS } from '@/lib/mois';
import { PageHeader } from '@/components/page-header';
import { HubNav, mru } from '@/components/hub';
import { MessagePage } from '@/components/message-page';
import { BoutonFrais } from '@/components/bouton-frais';
import { financeTabsFor } from './tabs';
import { MoyensManager, type Moyen } from './moyens-manager';
import { NotifierImpayes } from './notifier';

export const dynamic = 'force-dynamic';

interface Correspondant {
  id: string;
  full_name: string;
  phone: string | null;
  active: boolean;
  nb_enfants: number;
  frais_total: string;
  nb_impayes: number;
  /** L'année réellement listée, annoncée dans l'en-tête « Enfants ». */
}

/**
 * Gestion de Caisse — `pages/super_admin/gestion_caisse.php`, la liste des
 * correspondants.
 *
 * Le panneau des moyens de paiement ; la recherche (nom d'élève, correspondant,
 * matricule ou téléphone) avec le filtre « Mois impayé » — les mois de l'année
 * scolaire consultée — et « Année » — de MIN(paiements) à max(MAX, défaut+1),
 * défaut `annee_defaut()` ; « Filtrer », « Réinitialiser » ; le filtre actif
 * porte « Notifier les impayés ». Puis le tableau, ou l'alerte-info.
 */
export default async function CaissePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; impaye_mois?: string; impaye_annee?: string; annee?: string }>;
}) {
  const params = await searchParams;
  const { user } = await requireSession();
  const peutAdministrer = user.roles.includes('super_admin') || user.roles.includes('admin');

  const [annees, vue, moyens, bornes] = await Promise.all([
    apiFetch<Annee[]>('/academic-years').catch(() => [] as Annee[]),
    anneeAffichee(),
    apiFetch<Moyen[]>('/payment-methods?includeInactive=true').catch(() => [] as Moyen[]),
    apiFetch<{ anneeMin: number | null; anneeMax: number | null }>('/reports/bornes-annees').catch(() => ({ anneeMin: null, anneeMax: null })),
  ]);
  const anneeDefaut = vue?.start_year ?? new Date().getFullYear();

  const fm = /^\d{1,2}$/.test(params.impaye_mois ?? '') ? Number(params.impaye_mois) : 0;
  const fa = /^\d{4}$/.test(params.impaye_annee ?? '') ? Number(params.impaye_annee) : 0;
  const filtreActif = fm >= 1 && fm <= 12 && fa >= 2020;
  const recherche = (params.q ?? '').trim();

  const query = new URLSearchParams();
  if (recherche) query.set('q', recherche);
  if (filtreActif) {
    query.set('month', String(fm));
    query.set('year', String(fa));
  }
  // L'année réellement listée : celle du mois filtré, sinon `annee_defaut()`.
  const anListe = filtreActif ? (fm >= 10 ? fa : fa - 1) : anneeDefaut;
  const anneeListe = annees.find((a) => a.start_year === anListe);
  if (anneeListe) query.set('academicYearId', anneeListe.id);
  const correspondants = await apiFetch<Correspondant[]>(`/finance/correspondents?${query.toString()}`).catch(() => [] as Correspondant[]);

  // Les mois de l'année scolaire consultée (son `$mois_actifs`).
  const md = vue?.start_month ?? 10;
  const mf = vue?.end_month ?? 6;
  const moisActifs: number[] = [];
  for (let m = md; m <= 12; m++) moisActifs.push(m);
  for (let m = 1; m <= mf; m++) moisActifs.push(m);

  const yMin = bornes.anneeMin ?? anneeDefaut;
  const yMax = Math.max(bornes.anneeMax ?? anneeDefaut, anneeDefaut + 1);
  const anneesFiltre: number[] = [];
  for (let y = yMin; y <= yMax; y++) anneesFiltre.push(y);

  const yearActive = annees.find((a) => a.status === 'active');

  return (
    <>
      <PageHeader
        titre="Finance"
        sousTitre="Caisse, revenus, salaires, dettes et dépenses"
        right={<BoutonFrais user={user} />}
      />

      <div className="hub-shell">
        <HubNav tabs={financeTabsFor(user.roles)} active="caisse" label="Sections Finance" />

        <div className="hub-panel">
          <MessagePage>
            <MoyensManager moyens={moyens} peutAdministrer={peutAdministrer} ouvert={false} />

            <form method="GET" className="form-card" style={{ marginBottom: '1.5rem' }}>
              {params.annee && <input type="hidden" name="annee" value={params.annee} />}
              <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <label htmlFor="q">Rechercher (nom d&apos;élève, correspondant, matricule ou téléphone)</label>
                  <input type="text" id="q" name="q" defaultValue={recherche} placeholder="Ex : Bilal, Mohamed, 13691, ou 22 12 34 56" />
                </div>
                <div style={{ minWidth: 130 }}>
                  <label htmlFor="impaye_mois">Mois impayé</label>
                  <select name="impaye_mois" id="impaye_mois" defaultValue={fm ? String(fm) : ''}>
                    <option value="">— Aucun —</option>
                    {moisActifs.map((mn) => (
                      <option key={mn} value={mn}>{MOIS_NOMS[mn]}</option>
                    ))}
                  </select>
                </div>
                <div style={{ minWidth: 110 }}>
                  <label htmlFor="impaye_annee">Année</label>
                  <select name="impaye_annee" id="impaye_annee" defaultValue={String(fa || anneeDefaut)}>
                    <option value="">—</option>
                    {anneesFiltre.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <button className="btn btn-primary" style={{ width: 'auto' }}>Filtrer</button>
                {(recherche !== '' || fm > 0) && (
                  <a href="/finance" className="btn btn-secondary">Réinitialiser</a>
                )}
              </div>
            </form>
            {/* ⚠ HORS du formulaire de filtre. Un <form> dans un <form> est
                interdit en HTML : le navigateur jetait celui-ci, et « Notifier
                les impayés » resoumettait le filtre — « ne marche pas du tout ». */}
            {filtreActif && (
              <div className="form-card" style={{ marginTop: '-.75rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <p style={{ margin: 0, color: 'var(--text-light)', fontSize: '.88rem' }}>
                  Filtre actif : correspondants avec au moins un enfant <strong>impayé</strong> pour{' '}
                  <strong>{MOIS_NOMS[fm]} {fa}</strong>.
                </p>
                {/* ⚠ Jamais l'année active par défaut : un mois qu'aucune année ne
                    couvre notifiait toutes les familles pour un mois que personne ne doit. */}
                {annees.find((a) => a.start_year === anListe) ? (
                  <NotifierImpayes mois={fm} annee={fa} academicYearId={annees.find((a) => a.start_year === anListe)!.id} />
                ) : (
                  <span className="text-muted micro">Aucune année scolaire ne couvre ce mois : rien à notifier.</span>
                )}
              </div>
            )}

            {correspondants.length === 0 ? (
              <div className="alert alert-info">
                {recherche !== '' || filtreActif
                  ? 'Aucun correspondant ne correspond aux critères.'
                  : 'Aucun correspondant enregistré. Utilisez « Inscrire un étudiant » pour en créer.'}
              </div>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Correspondant</th>
                      <th>Téléphone</th>
                      <th>
                        Enfants{' '}
                        <span className="text-muted" style={{ fontWeight: 400, fontSize: '.8em' }}>
                          {anListe}-{anListe + 1}
                        </span>
                      </th>
                      <th>Total mensuel</th>
                      {fm > 0 && <th>Impayés</th>}
                      <th>Statut</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {correspondants.map((p) => (
                      <tr key={p.id}>
                        <td><strong>{p.full_name}</strong></td>
                        <td>{p.phone ?? ''}</td>
                        <td>{p.nb_enfants}</td>
                        <td>{mru(p.frais_total)} MRU</td>
                        {fm > 0 && (
                          <td><span className="badge badge-danger">{p.nb_impayes}</span></td>
                        )}
                        <td>
                          {p.active ? <span style={{ color: '#728157' }}>Actif</span> : <span style={{ color: '#a8341f' }}>Inactif</span>}
                        </td>
                        <td>
                          <a href={`/finance/${p.id}`} className="btn btn-sm btn-primary">Voir le profil →</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </MessagePage>
        </div>
      </div>
    </>
  );
}
