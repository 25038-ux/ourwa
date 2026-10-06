'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Modale } from '@/components/modale';
import { useActionMessage } from '@/components/message-page';
import { MoyensPaiement, type LigneMoyen, type Moyen } from '@/components/moyens-paiement';
import { FenetreEncaissement, type FenetreData } from '@/components/fenetre-encaissement';
import { arreterDetteAction, payerDetteMoisAction, reEnrolAction } from '@/app/actions';
import { MOIS_NOMS } from '@/lib/mois';
import { ChoixFacturation, tarifDuMode, type CatalogueFacturation } from '@/components/choix-facturation';
import { PourcentagesProposes } from '@/components/pourcentages';
import type { ModeEtude } from '@elourwa/shared/facturation';
import { OptionsParCycle } from '@/components/options-par-cycle';

/** Une ligne de `dettes_scolarite` d'`obtenir_dette_parent_detaillee()`. */
export interface LigneScolarite {
  studentId: string;
  studentName: string;
  label: string;
  calendarMonth: number;
  calendarYear: number;
  due: string;
  paid: string;
  outstanding: string;
}

/** Une ligne de ses `dettes_diverses`. */
export interface LigneDiverse {
  who: string;
  label: string;
  outstanding: string;
}

/** Son `number_format($x, 0, ',', ' ')`. */
function mru(v: string | number): string {
  return String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

type Etat = { ok?: string; error?: string; fenetre?: FenetreData } | null;

/**
 * RÉINSCRIRE UN ÉLÈVE — la modale `#m-<id>` de `reinscrire_etudiant.php`, et
 * la « Modale paiement dette » qu'un de ses boutons « Payer » ouvre par-dessus.
 * Réussie, la fenêtre d'encaissement (`encaissement_fenetre()`) s'ouvre.
 */
export function ReinscrireModale({
  studentId,
  studentName,
  classe,
  guardianName,
  groupes,
  aDette,
  dette,
  tuition,
  misc,
  estAdmin,
  estRoleLimite,
  moyens,
  facturation = null,
}: {
  studentId: string;
  studentName: string;
  classe: string;
  guardianName: string;
  groupes: { id: string; name: string; level_id?: string | null; level_name: string | null; cycle?: string | null }[];
  aDette: boolean;
  dette: number;
  tuition: LigneScolarite[];
  misc: LigneDiverse[];
  estAdmin: boolean;
  estRoleLimite: boolean;
  moyens: Moyen[];
  /** École « services » (Jinan, §8) : mode obligatoire et services ; `null` ailleurs. */
  facturation?: CatalogueFacturation | null;
}) {
  const [state, action, pending] = useActionMessage(reEnrolAction);
  const [groupeId, setGroupeId] = useState('');
  const [mode, setMode] = useState<ModeEtude | null>(null);
  const levelId = groupes.find((g) => g.id === groupeId)?.level_id ?? null;

  const [ouvert, setOuvert] = useState(false);
  const [bypass, setBypass] = useState(false);
  const [paiement, setPaiement] = useState<LigneScolarite | null>(null);

  // Sa page se recharge après le POST : la modale n'est plus là, le message
  // est en haut — et, réussie, la fenêtre d'encaissement est ouverte.
  useEffect(() => {
    if (state) setOuvert(false);
  }, [state]);

  return (
    <>
      <button className="btn btn-sm btn-primary" type="button" onClick={() => setOuvert(true)}>
        Réinscrire
      </button>

      {state?.fenetre && (
        <FenetreEncaissement
          data={state.fenetre}
          moyens={moyens}
          titre="Réinscription réussie — encaisser"
          sousTitre={`Année ${state.fenetre.annee.label} · scolarité ${mru(state.fenetre.eleve.frais_mensuel)} MRU / mois`}
          lienTerminer="/re-enrol"
          libelleTerminer="Terminer"
        />
      )}

      <Modale ouverte={ouvert} onFermer={() => setOuvert(false)} titre={`Réinscrire ${studentName}`} largeur={640}>
        {aDette && (
          /* ===== DEBT WARNING SECTION ===== */
          <div style={{ padding: '1rem 1.5rem', background: '#fef2f2', borderBottom: '1px solid #fecaca' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.75rem' }}>
              <span style={{ fontSize: '1.3rem' }}>⚠️</span>
              <strong style={{ color: '#DC2626' }}>Dette en cours : {mru(dette)} MRU</strong>
            </div>
            <p style={{ fontSize: '.85rem', color: '#7f1d1d', margin: '0 0 .75rem' }}>
              Le correspondant <strong>{guardianName}</strong> a une dette impayée.
              La réinscription est bloquée tant que la dette n&apos;est pas réglée{estAdmin ? ' (ou autorisée par un administrateur)' : ''}.
            </p>

            {tuition.length > 0 && (
              <details style={{ marginBottom: '.5rem' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '.85rem', color: '#991b1b' }}>
                  Détail scolarité ({tuition.length} mois impayé{tuition.length > 1 ? 's' : ''})
                </summary>
                <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: '.5rem' }}>
                  <table style={{ width: '100%', fontSize: '.82rem', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#fee2e2' }}>
                        <th style={{ padding: '.3rem .5rem', textAlign: 'left' }}>Étudiant</th>
                        <th style={{ padding: '.3rem .5rem', textAlign: 'left' }}>Mois</th>
                        <th style={{ padding: '.3rem .5rem', textAlign: 'right' }}>Reste dû</th>
                        <th style={{ padding: '.3rem .5rem' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {tuition.map((ds, i) => (
                        <tr key={`${ds.studentId}-${ds.calendarYear}-${ds.calendarMonth}-${i}`} style={{ borderBottom: '1px solid #fecaca' }}>
                          <td style={{ padding: '.3rem .5rem' }}>{ds.studentName}</td>
                          <td style={{ padding: '.3rem .5rem' }}>{MOIS_NOMS[ds.calendarMonth]} {ds.calendarYear}</td>
                          <td style={{ padding: '.3rem .5rem', textAlign: 'right', fontWeight: 600, color: '#DC2626' }}>
                            {mru(ds.outstanding)}
                            {Number(ds.paid) > 0 && (
                              <>
                                <br />
                                <small style={{ color: '#888' }}>payé: {mru(ds.paid)}/{mru(ds.due)}</small>
                              </>
                            )}
                          </td>
                          <td style={{ padding: '.3rem .5rem' }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              style={{ padding: '.2rem .4rem', fontSize: '.75rem' }}
                              onClick={() => setPaiement(ds)}
                            >
                              Payer
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {misc.length > 0 && (
              <details style={{ marginBottom: '.5rem' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '.85rem', color: '#991b1b' }}>
                  Dettes diverses ({misc.length})
                </summary>
                <ul style={{ fontSize: '.82rem', margin: '.5rem 0 0 1rem' }}>
                  {misc.map((dd, i) => (
                    <li key={i}>
                      {dd.who} — {mru(dd.outstanding)} MRU ({dd.label})
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {/* ===== RESUBSCRIPTION FORM ===== */}
        <form action={action} style={{ padding: '1rem 1.5rem' }}>
          <input type="hidden" name="etudiant_id" value={studentId} />

          <p className="text-muted" style={{ fontSize: '.88rem', marginBottom: '1rem' }}>
            Classe actuelle : <strong>{classe}</strong>.<br />
            Les frais s&apos;aligneront automatiquement sur le tarif du nouveau niveau.
          </p>

          <div className="form-group">
            <label>Nouveau groupe *</label>
            <select name="nouveau_groupe_id" required value={groupeId} onChange={(e) => setGroupeId(e.target.value)}>
              <option value="">— Choisir —</option>
              <OptionsParCycle rubriques={facturation !== null} elements={groupes} libelle={(tg) => (tg.level_name ?? 'Sans niveau') + ' — ' + tg.name} />
            </select>
          </div>

          <div className="form-group">
            <label>Frais mensuel personnalisé (MRU) — optionnel</label>
            {/* Une réduction en pourcentage du tarif du niveau pour le mode choisi. */}
            {facturation && (
              <PourcentagesProposes base={tarifDuMode(facturation, levelId, mode)} cible="frais_personnalise" sens="reste" libelleBase="tarif du niveau" />
            )}
            <input
              type="number"
              name="frais_personnalise"
              min={0}
              step={1}
              placeholder={facturation ? 'Laisser vide = tarif du niveau pour le mode choisi' : 'Laisser vide = tarif du niveau'}
            />
            <small className="text-muted">
              {estRoleLimite ? (
                <>Tout frais différent du tarif du niveau devra être <strong>validé par l&apos;administrateur</strong> avant d&apos;être appliqué.</>
              ) : (
                'Appliqué immédiatement (administrateur).'
              )}
            </small>
          </div>

          {facturation && (
            <ChoixFacturation catalogue={facturation} levelId={levelId} mode={mode} onMode={setMode} />
          )}

          {aDette && estAdmin && (
            <div style={{ margin: '.75rem 0', padding: '.75rem', background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', fontSize: '.88rem' }}>
                <input type="checkbox" name="bypass_dette" value="1" checked={bypass} onChange={(e) => setBypass(e.target.checked)} />
                <span><strong>Autoriser la réinscription malgré la dette</strong> (admin uniquement)</span>
              </label>
            </div>
          )}

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={() => setOuvert(false)}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={(aDette && !bypass) || pending}>
              Confirmer la réinscription
            </button>
          </div>
        </form>
      </Modale>

      {paiement && (
        <PaiementDetteModale
          ligne={paiement}
          moyens={moyens}
          onFermer={() => setPaiement(null)}
          // Sa page se recharge après le paiement : les deux modales sont refermées.
          onSucces={() => { setPaiement(null); setOuvert(false); }}
        />
      )}
    </>
  );
}

/**
 * « Modale paiement dette » — `#modal_paiement_dette` : « Payer une dette de
 * scolarité », la ligne « Nom — Mois Année · Reste dû : N MRU », le widget
 * des moyens pré-rempli du reste dû, « ✓ Confirmer le paiement » / « Annuler ».
 */
function PaiementDetteModale({
  ligne,
  moyens,
  onFermer,
  onSucces,
}: {
  ligne: LigneScolarite;
  moyens: Moyen[];
  onFermer: () => void;
  onSucces: () => void;
}) {
  const [state, action, pending] = useActionMessage(payerDetteMoisAction);

  const reste = Math.round(Number(ligne.outstanding) * 100) / 100;
  const [lignes, setLignes] = useState<LigneMoyen[]>(() =>
    moyens[0] ? [{ moyenId: moyens[0].id, montant: String(reste) }] : [],
  );

  // Réussi, sa page se recharge : les modales sont refermées.
  useEffect(() => {
    if (state?.ok) onSucces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <div
      id="modal_paiement_dette"
      style={{
        display: 'flex',
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.5)',
        zIndex: 1100,
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div className="form-card" style={{ maxWidth: 480, width: '100%', background: '#fff' }}>
        <h3 style={{ marginTop: 0 }}>Payer une dette de scolarité</h3>
        <p id="dette_pay_info" className="text-muted">
          {ligne.studentName} — {MOIS_NOMS[ligne.calendarMonth]} {ligne.calendarYear} · Reste dû : {reste.toLocaleString('fr-FR')} MRU
        </p>
        <form action={action} id="form_dette_pay">
          <input type="hidden" name="etudiant_id" value={ligne.studentId} />
          <input type="hidden" name="mois" value={ligne.calendarMonth} />
          <input type="hidden" name="annee" value={ligne.calendarYear} />
          <input type="hidden" name="reste" value={reste} />
          <input type="hidden" name="tender" value={JSON.stringify(lignes)} />
          <MoyensPaiement moyens={moyens} cible={String(reste)} lignes={lignes} onChange={setLignes} currency="MRU" sens="entrant" />
          <div style={{ display: 'flex', gap: '.5rem', marginTop: '1rem' }}>
            <button className="btn btn-primary" disabled={pending}>✓ Confirmer le paiement</button>
            <button type="button" className="btn btn-secondary" onClick={onFermer}>Annuler</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * ARRÊTER LA DETTE D'UNE FAMILLE — son champ « Dette : [montant] MRU
 * [Appliquer] » en tête de foyer (administrateur), et son `arreterDette()` :
 * montant valide, strictement inférieur à la dette actuelle, motif demandé,
 * confirmation, puis l'envoi. L'écart est enregistré comme remise.
 */
export function ArreterDette({ guardianId, actuel }: { guardianId: string; actuel: number }) {
  const id = useId();
  const [state, action] = useActionMessage(arreterDetteAction);

  const [valeur, setValeur] = useState(String(actuel));
  const formulaire = useRef<HTMLFormElement>(null);

  const appliquer = () => {
    const v = parseFloat(valeur);
    if (Number.isNaN(v) || v < 0) { window.alert('Saisissez un montant valide.'); return; }
    if (v >= actuel) { window.alert('Le nouveau montant doit etre INFERIEUR a la dette actuelle (' + actuel + ' MRU).'); return; }
    const m = window.prompt('Motif de la correction (tracee dans le journal) :', '');
    if (m === null) return;
    if (!window.confirm('Ramener la dette de cette famille de ' + actuel + ' a ' + v + ' MRU ?\n\n'
      + 'L\'ecart est enregistre comme remise. Les creances d\'origine sont conservees.')) return;
    // Son `envoyerDette` : le formulaire caché est rempli puis envoyé.
    const f = formulaire.current;
    if (!f) return;
    (f.elements.namedItem('montant') as HTMLInputElement).value = String(v);
    (f.elements.namedItem('motif') as HTMLInputElement).value = m;
    f.requestSubmit();
  };

  return (
    <>
      <label htmlFor={`${id}-dt`} style={{ fontSize: '.82rem', color: 'var(--text-light)', margin: 0 }}>Dette&nbsp;:</label>
      <input
        type="number"
        id={`${id}-dt`}
        value={valeur}
        onChange={(e) => setValeur(e.target.value)}
        min={0}
        step={1}
        inputMode="numeric"
        style={{ width: '7.5rem', textAlign: 'right', fontWeight: 700, color: '#8c491a', padding: '.25rem .5rem' }}
        title="Montant convenu avec la famille"
      />
      <span className="text-muted" style={{ fontSize: '.82rem' }}>MRU</span>
      <button type="button" className="btn btn-sm btn-secondary" onClick={appliquer}>Appliquer</button>
      <form action={action} ref={formulaire} hidden>
        <input type="hidden" name="parent_id" value={guardianId} />
        <input type="hidden" name="montant" defaultValue="" />
        <input type="hidden" name="motif" defaultValue="" />
      </form>
    </>
  );
}
