import { apiFetch, requireSession, peutAdministrerLaDette } from '@/lib/session';
import { estEcoleServices } from '@/lib/tenant';
import { PageHeader } from '@/components/page-header';
import { MessagePage } from '@/components/message-page';
import { AutoSubmitSelect } from '@/components/auto-submit-select';
import {
  BulkSelection,
  CreanceActions,
  CreanceBureau,
  AjouterCreance,
  AutoriserForm,
  PrefRemise,
  RemiseForm,
} from './bulk-forms';

export const dynamic = 'force-dynamic';

interface Ligne {
  who: string;
  origin: string;
  paid: string;
  full: string;
  amount: string;
}

interface Enfant {
  studentId: string;
  name: string;
  matricule: string | null;
  fromGroup: string | null;
  outcome: string | null;
  verdict: { status: string; label: string; labelAr: string } | null;
  alreadyEnrolled: boolean;
  authorised: boolean;
  blocked: boolean;
}

interface Famille {
  key: string;
  guardianId: string | null;
  guardianName: string;
  debt: string;
  authorised: boolean;
  blocked: boolean;
  lines: Ligne[];
  children: Enfant[];
}

interface Page {
  target: { id: string; label: string; startYear: number };
  source: { id: string; label: string } | null;
  previous: { label: string } | null;
  families: Famille[];
  nextCursor: string | null;
  blockedCount: number;
}

/** Une créance de `dettes_familles` — les colonnes de son tableau « Gérer les créances ». */
interface Creance {
  id: string;
  guardian_id: string | null;
  student_name: string | null;
  start_year: number | null;
  kind: 'arriere' | 'facture';
  invoice_source: number | null;
  total: string;
  remaining: string;
  correction_reason: string | null;
  reason: string | null;
}

/** Son `number_format($x, 0, ',', ' ')`. */
function mru(v: string | number): string {
  return String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Son `number_format($x, 2, ',', ' ')`. */
function mru2(v: string | number): string {
  const [entier, cents] = Number(v).toFixed(2).split('.');
  return `${mru(entier ?? '0')},${cents ?? '00'}`;
}

/** Son `badge_admission()` : la pastille du verdict, libellé et arabe. */
function BadgeAdmission({ verdict }: { verdict: { status: string; label: string; labelAr: string } }) {
  const couleurs: Record<string, [string, string]> = {
    admis: ['#065F46', '#D1FAE5'],
    ajourne: ['#991B1B', '#FEE2E2'],
    non_evalue: ['#4B5563', '#F3F4F6'],
  };
  const [txt, fond] = couleurs[verdict.status] ?? couleurs.non_evalue!;
  return (
    <span style={{ display: 'inline-block', padding: '.12rem .5rem', borderRadius: 3, fontWeight: 700, color: txt, background: fond }}>
      {verdict.label} <span dir="rtl">{verdict.labelAr}</span>
    </span>
  );
}

/**
 * RÉINSCRIPTIONS — `pages/super_admin/reinscriptions.php` : « repeupler les
 * classes de l'année active. Personne ne passe d'une année à l'autre tout
 * seul : chaque élève, y compris un redoublant, doit être réinscrit. Une
 * famille qui doit de l'argent est bloquée tant qu'un administrateur n'a pas
 * autorisé la réinscription — et l'autorisation est tracée. »
 *
 * Les élèves de l'année d'origine (par défaut l'année précédente), regroupés
 * par famille — la dette annoncée une seule fois, les familles bloquées en
 * tête —, le détail de ce qui est dû, les créances (administrateur), la case
 * par enfant (grisée s'il est bloqué ou déjà réinscrit), le résultat de fin
 * d'année, l'état ; la classe de destination et « Réinscrire la sélection » ;
 * puis, pour l'administrateur, la remise et l'autorisation malgré la dette.
 */
export default async function BulkReEnrolPage({
  searchParams,
}: {
  searchParams: Promise<{ source_id?: string; de_groupe?: string; cursor?: string }>;
}) {
  const { source_id: sourceId, de_groupe: deGroupe, cursor } = await searchParams;
  const { user } = await requireSession();

  // Son `require_role(['super_admin', 'admin', 'secretaire'])`.
  if (!user.roles.some((r) => ['super_admin', 'admin', 'secretaire'].includes(r))) {
    return (
      <>
        <PageHeader titre="Réinscriptions" />
        <div className="form-card">
          <p className="text-muted">Cette page est réservée aux rôles super_admin, admin et secrétaire.</p>
        </div>
      </>
    );
  }

  // « Autoriser », la remise et les créances : décision d'administration (`$peut_autoriser`).
  const peutAutoriser = peutAdministrerLaDette(user);

  const query = new URLSearchParams();
  if (sourceId) query.set('sourceYearId', sourceId);
  if (deGroupe) query.set('fromGroupId', deGroupe);
  if (cursor) query.set('cursor', cursor);

  let refus: string | null = null;
  const [data, years, groups] = await Promise.all([
    apiFetch<Page>(`/enrollments/re-enrol/candidates?${query}`).catch((e: unknown) => {
      refus = e instanceof Error ? e.message : 'Erreur.';
      return null;
    }),
    apiFetch<{ id: string; label: string }[]>('/academic-years').catch(() => []),
    apiFetch<{ id: string; name: string; level_name: string | null }[]>('/groups').catch(() => []),
  ]);

  // Son `refus_inscription($cible)` : la page s'arrête là.
  if (!data) {
    return (
      <>
        <PageHeader titre="Réinscriptions" />
        <div className="alert alert-warning">{refus}</div>
      </>
    );
  }

  // « Creances de TOUTES les familles affichees, en UNE seule requete ».
  const creances = peutAutoriser && data.families.length > 0
    ? await apiFetch<Creance[]>('/finance/misc-debts?includeSettled=true').catch(() => [] as Creance[])
    : [];

  const nbBloques = data.blockedCount;
  const candidats = data.families.flatMap((f) => f.children.map((c) => ({ ...c, famille: f })));

  return (
    <>
      <PageHeader titre="Réinscriptions" />
      <MessagePage>
        <div className="alert alert-info">
          <div>
            Réinscription vers <strong>{data.target.label}</strong>.
            Un élève qui redouble doit être réinscrit lui aussi — dans la même classe.
            Une famille qui doit de l&apos;argent est bloquée jusqu&apos;à autorisation.
            {nbBloques > 0 && (
              <>
                <br /><strong>{nbBloques}</strong> élève{nbBloques > 1 ? 's' : ''} bloqué{nbBloques > 1 ? 's' : ''} pour dette sur cette page.
              </>
            )}
          </div>
        </div>

        <form method="GET" className="form-card" style={{ display: 'flex', gap: '.8rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <div>
            <label htmlFor="source_id">Élèves de l&apos;année</label>
            <AutoSubmitSelect
              id="source_id"
              name="source_id"
              defaultValue={data.source?.id ?? ''}
              options={years.map((y) => ({ value: y.id, label: y.label }))}
            />
          </div>
          <div>
            <label htmlFor="de_groupe">Classe d&apos;origine</label>
            <AutoSubmitSelect
              id="de_groupe"
              name="de_groupe"
              defaultValue={deGroupe ?? ''}
              options={[{ value: '', label: '— Toutes —' }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
            />
          </div>
        </form>

        {data.families.length === 0 ? (
          <div className="alert alert-warning">Aucun élève inscrit sur cette année d&apos;origine.</div>
        ) : (
          <>
            <BulkSelection groups={groups} cible={data.target} modesEtude={await estEcoleServices()}>
              <div className="table-container"><div className="overflow-x">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: '2rem' }}></th>
                      <th>Élève</th>
                      <th>Classe {data.previous?.label ?? ''}</th>
                      <th>Résultat</th>
                      <th>État</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.families.map((fam) => {
                      const dette = Number(fam.debt);
                      const famBloquee = dette > 0.009 && !fam.authorised;
                      const cre = fam.guardianId ? creances.filter((c) => c.guardian_id === fam.guardianId) : [];
                      const nbEnf = fam.children.length;
                      return (
                        <FamilleRows
                          key={fam.key}
                          fam={fam}
                          dette={dette}
                          famBloquee={famBloquee}
                          cre={cre}
                          nbEnf={nbEnf}
                          peutAutoriser={peutAutoriser}
                          startYear={data.target.startYear}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div></div>
            </BulkSelection>

            {/* « Formulaire hors du formulaire de reinscription : imbriquer deux
                <form> est invalide en HTML et le navigateur supprime le second. » */}
            {peutAutoriser && <CreanceBureau enHaut />}

            {peutAutoriser && nbBloques > 0 && (
              <>
                <RemiseForm
                  familles={candidats
                    .filter((c) => Number(c.famille.debt) > 0.009 && c.famille.guardianId)
                    .map((c) => ({ id: c.famille.guardianId!, name: c.famille.guardianName, debt: mru2(c.famille.debt) }))}
                />
                <AutoriserForm
                  eleves={candidats
                    .filter((c) => Number(c.famille.debt) > 0.009 && !c.authorised && !c.alreadyEnrolled)
                    .map((c) => ({ id: c.studentId, name: c.name, debt: mru2(c.famille.debt) }))}
                />
              </>
            )}
          </>
        )}

        {/* Son `afficher_pagination()` — ici un curseur sur la famille (règle 17 :
            pas d'OFFSET), donc « Suivant › » seulement. */}
        {data.nextCursor && (
          <nav className="pagination" style={{ display: 'flex', gap: '.3rem', justifyContent: 'center', margin: '1.5rem 0', flexWrap: 'wrap' }}>
            <a
              className="btn btn-sm btn-secondary"
              href={`/re-enrol/bulk?${new URLSearchParams({
                ...(sourceId ? { source_id: sourceId } : {}),
                ...(deGroupe ? { de_groupe: deGroupe } : {}),
                cursor: data.nextCursor,
              })}`}
            >
              Suivant ›
            </a>
          </nav>
        )}
      </MessagePage>
    </>
  );
}

/**
 * L'EN-TÊTE DE FAMILLE puis ses enfants — « Parent -> enfants -> situation
 * financiere. La dette appartient au correspondant : elle est annoncee UNE
 * SEULE fois ici, jamais repetee sur chaque enfant. »
 */
function FamilleRows({
  fam,
  dette,
  famBloquee,
  cre,
  nbEnf,
  peutAutoriser,
  startYear,
}: {
  fam: Famille;
  dette: number;
  famBloquee: boolean;
  cre: Creance[];
  nbEnf: number;
  peutAutoriser: boolean;
  startYear: number;
}) {
  return (
    <>
      <tr className="fam-head" style={{ background: famBloquee ? 'rgba(180,83,9,.10)' : 'rgba(198,113,57,.06)' }}>
        <td colSpan={5} style={{ padding: '.65rem .7rem', borderTop: `2px solid ${famBloquee ? '#B45309' : 'var(--primary)'}` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '.6rem', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '1.02rem' }}>{fam.guardianName}</strong>
            <span className="text-muted">{nbEnf} enfant{nbEnf > 1 ? 's' : ''}</span>
            {dette > 0.009 ? (
              <span style={{ marginLeft: 'auto' }}>
                Dette&nbsp;: <strong style={{ color: '#B45309', fontSize: '1.02rem' }}>{mru(dette)} MRU</strong>{' '}
                {fam.authorised ? (
                  <span className="badge badge-primary">Autorisée malgré dette</span>
                ) : (
                  <span className="badge" style={{ background: '#FEF3C7', color: '#92400E' }}>Réinscription bloquée</span>
                )}
              </span>
            ) : (
              <span style={{ marginLeft: 'auto', color: '#059669', fontWeight: 600 }}>✓ À jour</span>
            )}
          </div>

          {dette > 0.009 && (
            /* Detail de ce qui est du, ligne par ligne */
            <table style={{ width: 'auto', fontSize: '.8rem', margin: '.45rem 0 .2rem', fontWeight: 400 }}>
              <thead><tr><th>Élève</th><th>Origine</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
              <tbody>
                {fam.lines.map((l, i) => (
                  <tr key={`${l.origin}-${i}`}>
                    <td>{l.who}</td>
                    <td>
                      {l.origin}
                      {Number(l.paid) > 0.005 && (
                        <>
                          {' '}
                          <span className="text-muted">(versé {mru(l.paid)} sur {mru(l.full)})</span>
                        </>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}><strong>{mru(l.amount)}</strong></td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td colSpan={2}><strong>Total dû</strong></td>
                  <td style={{ textAlign: 'right' }}><strong style={{ color: '#B45309' }}>{mru(dette)} MRU</strong></td>
                </tr>
              </tbody>
            </table>
          )}

          {peutAutoriser && fam.guardianId && (
            <details style={{ marginTop: '.5rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '.8rem', color: 'var(--text-light)' }}>
                Gérer les créances — {cre.length} ligne{cre.length > 1 ? 's' : ''}
              </summary>
              <div style={{ margin: '.5rem 0 .2rem', fontWeight: 400 }}>
                {cre.length > 0 ? (
                  <table style={{ width: 'auto', fontSize: '.8rem', marginBottom: '.5rem' }}>
                    <thead>
                      <tr><th>Année</th><th>Élève</th><th>Type</th><th>Réclamé</th><th>Restant dû</th><th>Note</th><th>Actions</th></tr>
                    </thead>
                    <tbody>
                      {cre.map((ld) => {
                        const sol = Number(ld.remaining);
                        return (
                          <tr key={ld.id} style={sol <= 0.005 ? { opacity: 0.55 } : undefined}>
                            <td>{ld.start_year ? `${ld.start_year}-${ld.start_year + 1}` : '—'}</td>
                            <td>{ld.student_name?.trim() || 'Famille'}</td>
                            <td>
                              {ld.kind === 'facture'
                                ? `Reliquat facture${ld.invoice_source ? ` n° ${ld.invoice_source}` : ''}`
                                : 'Arriéré'}
                            </td>
                            <td>{mru(ld.total)}</td>
                            <td><strong style={sol > 0.005 ? { color: '#B45309' } : undefined}>{mru(sol)}</strong></td>
                            <td style={{ maxWidth: '18rem', color: 'var(--text-muted)', fontSize: '.75rem' }}>{ld.correction_reason ?? ld.reason ?? ''}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <CreanceActions id={ld.id} remaining={ld.remaining} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-muted" style={{ fontSize: '.8rem' }}>Aucune créance enregistrée.</p>
                )}
                <AjouterCreance guardianId={fam.guardianId} guardianName={fam.guardianName} startYear={startYear} />
                {dette > 0.009 && <PrefRemise guardianId={fam.guardianId} />}
              </div>
            </details>
          )}
        </td>
      </tr>

      {fam.children.map((c) => {
        const bloque = dette > 0.009 && !c.authorised;
        return (
          <tr key={c.studentId} style={c.alreadyEnrolled ? { background: 'rgba(16,185,129,.07)' } : undefined}>
            <td style={{ paddingLeft: '1.4rem' }}>
              <input type="checkbox" className="chk-eleve" name="eleves[]" value={c.studentId} disabled={bloque || c.alreadyEnrolled} />
            </td>
            <td style={{ paddingLeft: '1.4rem' }}>
              <strong>{c.name}</strong>{' '}
              <small className="text-muted">{c.matricule ?? ''}</small>
            </td>
            <td>{c.fromGroup || '—'}</td>
            <td>
              {c.verdict ? <BadgeAdmission verdict={c.verdict} /> : <span className="text-muted">—</span>}
            </td>
            <td>
              {c.alreadyEnrolled ? (
                <span className="badge badge-success">Réinscrit</span>
              ) : c.authorised ? (
                <span className="badge badge-primary">Autorisé</span>
              ) : bloque ? (
                <span className="badge" style={{ background: '#FEF3C7', color: '#92400E' }}>Bloqué — dette</span>
              ) : (
                <span className="badge" style={{ background: '#dcd3c4', color: '#374151' }}>À réinscrire</span>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}
