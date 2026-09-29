'use client';

import { useEffect, useMemo, useState } from 'react';
import { encaisserGroupeAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';
import { MoyensPaiement, type LigneMoyen, type Moyen, fr } from '@/components/moyens-paiement';

export interface FenetreMois {
  mois: number;
  annee: number;
  libelle: string;
  du: string;
  paye: string;
  reste: string;
  etat: 'du' | 'partiel' | 'paye' | 'exempte';
}

export interface FenetreData {
  eleve: {
    id: string;
    prenom: string;
    nom: string;
    matricule: string | null;
    parent_id: string | null;
    telephone_parent: string | null;
    frais_mensuel: string;
    niveau_nom: string | null;
    groupe_nom: string | null;
  };
  annee: { id: string; label: string; start_year: number };
  mois: FenetreMois[];
  moisPayables: { mois: number; annee: number; libelle: string }[];
  annexes: Record<string, { libelle: string; bareme: string; paye: string; reste: string; exempte: boolean }>;
}

const mru = (v: string | number) => fr(Math.round(Number(v)));
const cle = (m: { mois: number; annee: number }) => `${m.annee}-${m.mois}`;

/**
 * LA FENÊTRE D'ENCAISSEMENT — à l'inscription, à la réinscription et à la
 * caisse, la même : TOUS les mois de l'année affichée, une case à cocher sur
 * chacun, une case sur chaque frais annuel ; l'agent coche ce que la famille
 * règle, le total suit, les moyens de paiement suivent, et l'encaissement
 * remet UN SEUL reçu (décision du propriétaire, 2026-09-20 — 0040).
 *
 * Rien n'est obligatoire : les frais annuels se décochent comme les mois ; ce
 * qui n'est pas encaissé reste dû dans la caisse. Un mois coché se règle en
 * entier (son reste) ; le règlement partiel d'un mois passe par sa carte.
 */
export function FenetreEncaissement({
  data,
  moyens,
  titre,
  sousTitre,
  avis,
  lienTerminer,
  libelleTerminer,
  preselection,
  onFermer,
}: {
  data: FenetreData;
  moyens: Moyen[];
  titre: string;
  sousTitre?: string;
  avis?: React.ReactNode;
  lienTerminer: string;
  libelleTerminer: string;
  /** Les mois déjà cochés à l'ouverture (la caisse) ; à défaut, le premier mois dû. */
  preselection?: { mois: number; annee: number }[];
  /** La caisse ferme la fenêtre sans quitter la page ; l'inscription a son lien. */
  onFermer?: () => void;
}) {
  const [state, action, pending] = useActionMessage(encaisserGroupeAction);
  const [ouverte, setOuverte] = useState(true);

  const encaissables = useMemo(() => data.mois.filter((m) => m.etat === 'du' || m.etat === 'partiel'), [data.mois]);
  const [moisCoches, setMoisCoches] = useState<Set<string>>(() => {
    if (preselection && preselection.length > 0) return new Set(preselection.map(cle));
    return new Set(encaissables.length > 0 ? [cle(encaissables[0]!)] : []);
  });
  const fraisDus = useMemo(
    () => Object.entries(data.annexes).filter(([, f]) => !f.exempte && Number(f.reste) > 0.005),
    [data.annexes],
  );
  const [fraisCoches, setFraisCoches] = useState<Set<string>>(() => new Set(fraisDus.map(([type]) => type)));

  const cible = useMemo(() => {
    const m = encaissables.filter((x) => moisCoches.has(cle(x))).reduce((a, x) => a + Number(x.reste), 0);
    const f = fraisDus.filter(([type]) => fraisCoches.has(type)).reduce((a, [, x]) => a + Number(x.reste), 0);
    return Math.round((m + f) * 100) / 100;
  }, [encaissables, moisCoches, fraisDus, fraisCoches]);

  const [lignes, setLignes] = useState<LigneMoyen[]>(() => (moyens[0] ? [{ moyenId: moyens[0].id, montant: String(cible) }] : []));
  // Le total attendu suit les cases ; une seule ligne de moyens le suit aussi (son `recalc`).
  useEffect(() => {
    setLignes((l) => (l.length === 1 ? [{ ...l[0]!, montant: String(cible) }] : l));
  }, [cible]);
  useEffect(() => {
    document.body.style.overflow = ouverte ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [ouverte]);

  const fermer = () => { setOuverte(false); onFermer?.(); };
  if (!ouverte) return null;

  const toutCocher = (oui: boolean) => setMoisCoches(oui ? new Set(encaissables.map(cle)) : new Set());
  const nbCoches = encaissables.filter((x) => moisCoches.has(cle(x))).length;

  return (
    <div className="modal-overlay active" role="dialog" aria-modal="true">
      <div className="modal" style={{ maxWidth: 680 }}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>{titre}</h3>
          <button type="button" className="modal-close" aria-label="Fermer" onClick={fermer}>&times;</button>
        </div>
        <form action={action}>
          <input type="hidden" name="studentId" value={data.eleve.id} />
          <input type="hidden" name="academicYearId" value={data.annee.id} />
          <input type="hidden" name="tender" value={JSON.stringify(lignes)} />
          <input type="hidden" name="mois" value={JSON.stringify(encaissables.filter((x) => moisCoches.has(cle(x))).map(({ mois, annee }) => ({ mois, annee })))} />
          <p style={{ margin: '0 0 .75rem' }}>
            <strong>{`${data.eleve.prenom} ${data.eleve.nom}`.trim()}</strong>
            {sousTitre && <><br /><span className="text-muted">{sousTitre}</span></>}
          </p>
          {avis}
          {state?.error && <div className="alert alert-danger" role="alert">{state.error}</div>}

          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <h4 style={{ margin: '.25rem 0' }}>Scolarité {data.annee.label}</h4>
            {encaissables.length > 1 && (
              <span style={{ fontSize: '.85rem' }}>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => toutCocher(nbCoches < encaissables.length)}>
                  {nbCoches < encaissables.length ? 'Tout cocher' : 'Tout décocher'}
                </button>
              </span>
            )}
          </div>
          {data.mois.length === 0 ? (
            <p className="text-muted">Aucun mois exigible pour {data.annee.label} (élève gratuit ou année sans mois à payer).</p>
          ) : (
            <div className="enc-mois" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '.4rem', marginBottom: '1rem' }}>
              {data.mois.map((m) => {
                const k = cle(m);
                const encaissable = m.etat === 'du' || m.etat === 'partiel';
                const coche = moisCoches.has(k);
                return (
                  <label
                    key={k}
                    style={{
                      display: 'flex', gap: '.5rem', alignItems: 'center', padding: '.45rem .6rem', borderRadius: 8,
                      border: `1.5px solid ${coche ? 'var(--primary)' : 'var(--border)'}`,
                      background: coche ? '#fff2eb' : encaissable ? '#fff' : '#fafafa',
                      opacity: encaissable ? 1 : 0.6, cursor: encaissable ? 'pointer' : 'default', fontSize: '.88rem',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={coche}
                      disabled={!encaissable}
                      onChange={(e) => setMoisCoches((s) => { const n = new Set(s); if (e.target.checked) n.add(k); else n.delete(k); return n; })}
                    />
                    <span style={{ flex: 1 }}>
                      <strong>{m.libelle}</strong>
                      <br />
                      <small className="text-muted">
                        {m.etat === 'paye' ? `Réglé (${mru(m.paye)})` : m.etat === 'exempte' ? 'Exempté' : m.etat === 'partiel' ? `Reste ${mru(m.reste)} sur ${mru(m.du)}` : `${mru(m.du)} MRU`}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {Object.keys(data.annexes).length > 0 && (
            <>
              <h4 style={{ margin: '.25rem 0' }}>Frais annuels — dus une fois par famille et par année</h4>
              <div style={{ display: 'grid', gap: '.4rem', marginBottom: '1rem' }}>
                {Object.entries(data.annexes).map(([type, f]) => {
                  const encaissable = !f.exempte && Number(f.reste) > 0.005;
                  const coche = fraisCoches.has(type);
                  return (
                    <label
                      key={type}
                      style={{
                        display: 'flex', gap: '.5rem', alignItems: 'center', padding: '.45rem .6rem', borderRadius: 8,
                        border: `1.5px solid ${coche && encaissable ? 'var(--primary)' : 'var(--border)'}`,
                        background: coche && encaissable ? '#fff2eb' : '#fff', opacity: encaissable ? 1 : 0.6, fontSize: '.88rem',
                      }}
                    >
                      <input
                        type="checkbox"
                        name={`frais_${type}`}
                        value="1"
                        checked={encaissable && coche}
                        disabled={!encaissable}
                        onChange={(e) => setFraisCoches((s) => { const n = new Set(s); if (e.target.checked) n.add(type); else n.delete(type); return n; })}
                      />
                      <span style={{ flex: 1 }}>
                        <strong>{f.libelle}</strong>{' '}
                        <small className="text-muted">
                          {f.exempte
                            ? `— famille exemptée pour ${data.annee.label}`
                            : !encaissable
                              ? `— déjà réglés pour ${data.annee.label} (${mru(f.paye)} MRU)`
                              : `— barème ${mru(f.bareme)} MRU${Number(f.paye) > 0.005 ? `, déjà réglé ${mru(f.paye)}` : ''} ; décoché, ils restent dus.`}
                        </small>
                      </span>
                      <strong style={{ whiteSpace: 'nowrap' }}>{encaissable ? `${mru(f.reste)} MRU` : '—'}</strong>
                    </label>
                  );
                })}
              </div>
            </>
          )}

          <table className="table" style={{ marginBottom: '1rem' }}>
            <tfoot>
              <tr>
                <th style={{ textAlign: 'right' }}>Total à encaisser ({nbCoches} mois{fraisDus.filter(([t]) => fraisCoches.has(t)).length > 0 ? ' + frais' : ''})</th>
                <th style={{ textAlign: 'right', width: 160 }}>{cible.toLocaleString('fr-FR')} MRU</th>
              </tr>
            </tfoot>
          </table>

          <MoyensPaiement moyens={moyens} cible={String(cible)} lignes={lignes} onChange={setLignes} currency="MRU" sens="entrant" />

          <div className="modal-footer">
            {onFermer ? (
              <button type="button" className="btn btn-secondary" onClick={fermer}>{libelleTerminer}</button>
            ) : (
              <a href={lienTerminer} className="btn btn-secondary">{libelleTerminer}{cible <= 0 ? ' (rien à encaisser)' : ''}</a>
            )}
            <button className="btn btn-primary" disabled={pending || cible <= 0}>Encaisser &amp; imprimer le reçu</button>
          </div>
        </form>
      </div>
    </div>
  );
}
