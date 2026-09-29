import { apiFetch, requireSession } from '@/lib/session';
import { anneeAffichee, type Annee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';
import { HubNav, mru, mruOrDash } from '@/components/hub';
import { PrintButton } from '@/components/print-button';
import { AutoSubmitSelect } from '@/components/auto-submit-select';
import { financeTabsFor } from '../tabs';
import { sum, toStorage } from '@elourwa/shared/money';

export const dynamic = 'force-dynamic';

interface Ligne {
  guardianId: string;
  name: string;
  phone: string | null;
  total: string;
  scolarite: string;
  diverses: string;
  months: number;
}

/**
 * Impayés — `pages/super_admin/impayes.php`.
 *
 * ⚠ "CORRESPONDANT", NOT "FAMILLE". That is the word the school uses for the
 * person who owes, and it is deliberate: the debtor is whoever the school
 * corresponds with about money, who is not always a parent.
 *
 * Son filtre : `annee_id` — « Toutes les années » ou une année scolaire — qui
 * se soumet au changement ; « toutes » additionne les dettes de toutes les
 * années, une famille pouvant devoir depuis plusieurs. Sans paramètre, l'année
 * consultée. « Notifier les impayés » n'est pas ici mais sur Gestion de Caisse.
 *
 * The screen exists to be printed and handed round, so the print rules are part
 * of it rather than an afterthought — the sidebar and every control disappear,
 * and the table takes hard black borders that survive a cheap printer.
 */
export default async function ImpayesPage({
  searchParams,
}: {
  searchParams: Promise<{ annee_id?: string }>;
}) {
  const params = await searchParams;
  const { user } = await requireSession();

  /*
   * ⚠ UN `.catch()` QUI REND UNE LISTE VIDE ANNONCE ICI « tous les
   * correspondants sont à jour ».
   *
   * C'est la phrase la plus coûteuse que cet écran puisse dire à tort : on la
   * lit, on ne relance personne, et le mois passe. Une panne et une école sans
   * impayés ne sont pas le même fait — la troisième fois que ce même motif se
   * présente (après `/journal` et le rapport des retraits).
   */
  const annees = await apiFetch<Annee[]>('/academic-years').catch(() => []);
  const vue = await anneeAffichee();
  const toutes = params.annee_id === 'toutes';
  const choisie = !toutes && params.annee_id ? annees.find((a) => a.id === params.annee_id) : null;
  const anneeFiltre = toutes ? null : (choisie ?? vue);
  const anneeLibelle = anneeFiltre ? anneeFiltre.label : 'Toutes les années';

  const donnees = await apiFetch<{ families: Ligne[] }>(
    `/finance/outstanding?academicYearId=${anneeFiltre ? anneeFiltre.id : 'toutes'}`,
  ).catch(() => null);

  // Its own ordering: largest debt first, because that is the call to make next.
  const lignes = [...(donnees?.families ?? [])].sort(
    (a, b) => Number(b.total) - Number(a.total),
  );
  const totalImpayes = toStorage(sum(lignes.map((l) => l.total)));

  const now = new Date();
  const dmy = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  const dmyhm = `${dmy} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  return (
    <>
      <PageHeader titre="Finance" sousTitre="Caisse, revenus, salaires, dettes et dépenses" />

      <div className="hub-shell">
        <HubNav
          tabs={financeTabsFor(user.roles)}
          active="impayes"
          label="Sections Finance"
        />

        <div className="hub-panel">
          <div
            className="no-print"
            style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}
          >
            <a href="/finance" className="btn btn-secondary">
              ← Finance
            </a>
            <a href="/finance/impayes" className="btn btn-secondary" title="Recalculer immédiatement">
              Actualiser
            </a>
            <PrintButton label="Imprimer" />
            <PrintButton
              label="Enregistrer en PDF"
              title="Dans la fenêtre d'impression, choisissez « Enregistrer en PDF » comme destination."
            />
          </div>

          <form
            method="GET"
            className="form-card no-print"
            style={{ display: 'flex', gap: '.8rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1rem' }}
          >
            <div>
              <label htmlFor="annee_id">Année scolaire</label>
              <AutoSubmitSelect
                id="annee_id"
                name="annee_id"
                defaultValue={anneeFiltre ? anneeFiltre.id : 'toutes'}
                options={[
                  { value: 'toutes', label: 'Toutes les années' },
                  ...annees.map((a) => ({
                    value: a.id,
                    label: `${a.label}${a.status === 'active' ? ' — en cours' : ''}`,
                  })),
                ]}
              />
            </div>
            <PrintButton label="Imprimer la liste" />
            <a className="btn btn-secondary" href={`/finance/impayes?annee_id=${anneeFiltre ? anneeFiltre.id : 'toutes'}&refresh=1`}>
              Recalculer
            </a>
            <span className="text-muted" style={{ fontSize: '.85rem' }}>
              Affichage : <strong>{anneeLibelle}</strong>
            </span>
          </form>

          <div className="table-container impayes-print">
            <div className="table-header impayes-head">
              <h3>Impayés — {dmy}</h3>
              <span className="badge badge-primary">
                {lignes.length} correspondant{lignes.length > 1 ? 's' : ''}
              </span>
            </div>
            <div className="overflow-x">
              <table className="impayes-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Correspondant</th>
                    <th>Téléphone</th>
                    <th>Scolarité due</th>
                    <th>Dettes diverses</th>
                    <th>TOTAL DÛ</th>
                    <th>Mois impayés</th>
                    <th className="no-print">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        style={{
                          textAlign: 'center',
                          color: '#728157',
                          fontWeight: 700,
                          padding: '1.5rem',
                        }}
                      >
                        {donnees === null ? (
                          <span className="text-danger">
                            La liste des impayés n’a pas pu être chargée.
                            Réessayez avant de conclure que tout est à jour.
                          </span>
                        ) : (
                          'Aucun impayé : tous les correspondants sont à jour.'
                        )}
                      </td>
                    </tr>
                  ) : (
                    lignes.map((l, i) => (
                      <tr key={l.guardianId}>
                        <td>{i + 1}</td>
                        <td>
                          <strong>{l.name}</strong>
                        </td>
                        <td>{l.phone || '—'}</td>
                        <td>{mruOrDash(l.scolarite)}</td>
                        <td>{mruOrDash(l.diverses)}</td>
                        <td>
                          <strong style={{ color: '#a8341f' }}>{mru(l.total)} MRU</strong>
                        </td>
                        <td>{l.months || '—'}</td>
                        <td className="no-print">
                          <a
                            href={`/finance/${l.guardianId}`}
                            className="btn btn-sm btn-primary"
                          >
                            Encaisser →
                          </a>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {lignes.length > 0 && (
                  <tfoot>
                    <tr style={{ background: 'var(--bg)', fontWeight: 800 }}>
                      <td colSpan={5}>TOTAL GÉNÉRAL DES IMPAYÉS</td>
                      <td colSpan={3} style={{ color: '#a8341f' }}>
                        {mru(totalImpayes)} MRU
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <p className="text-muted" style={{ padding: '.5rem 1rem', fontSize: '.75rem' }}>
              Montants exacts : frais mensuels dus (réductions et exemptions déduites,
              mois avant inscription exclus) + dettes diverses. Édité le {dmyhm} — El
              Ourwa.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
