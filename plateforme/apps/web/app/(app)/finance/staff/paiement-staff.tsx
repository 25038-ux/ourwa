'use client';

import { useActionState, useEffect, useState } from 'react';
import { paySalaryAction, withdrawAction } from '@/app/actions';
import { MoyensPaiement, type LigneMoyen, type Moyen, fr } from '@/components/moyens-paiement';
import { MOIS_NOMS } from '@/lib/mois';

/** Une ligne telle que `/payroll/staff-pay` la rend — le `$p` de sa boucle. */
export interface LignePersonnel {
  id: string;
  nom_complet: string;
  fonction: string | null;
  telephone: string | null;
  situation: string | null;
  heures_mois_calc: string | null;
  /** Absent (null) pour le comptable sur les administrateurs. */
  gain: string | null;
  retenue: string;
  net: string | null;
  paye: string;
  reste: string;
  gain_nul: boolean;
  net_nul: boolean;
  reste_nul: boolean;
  /** Personnel : ce mois fait-il partie de ses mois payés (fiche) ? Absent pour les professeurs. */
  mois_paye?: boolean;
}


/** Son `number_format($x, 0, ',', ' ')`. */
const mru = (v: string | number) => fr(Number(v));
/** Son `x.toLocaleString('fr-FR')` — même rendu, espace fine incluse. */
const loc = (v: string | number) => Number(v).toLocaleString('fr-FR');

type Result = { error?: string } | null;

/**
 * PAIEMENT DU PERSONNEL — le corps de `paiement_staff.php`, sous le reçu.
 *
 * Le filtre GET à trois listes qui se soumettent au changement (pas de
 * bouton) ; le tableau dont les colonnes dépendent du type et du rôle ; ses
 * deux modales, `#modal_retrait` et `#modal_pay`, avec leur texte, et le
 * script qui les ouvre : `ouvrirPay()`, `ouvrirRetrait()`, `majDrapeauRetrait()`.
 *
 * Un refus du serveur s'affiche comme chez lui : en alerte en haut de la page,
 * la modale refermée — sa page se rend à nouveau sans modale ouverte.
 */
export function PaiementStaff({
  type,
  mois,
  annee,
  moisDisponibles,
  annees,
  lignes,
  comptable,
  moyens,
}: {
  type: 'staff' | 'profs' | 'admins';
  mois: number;
  annee: number;
  moisDisponibles: number[];
  annees: number[];
  lignes: LignePersonnel[];
  comptable: boolean;
  moyens: Moyen[];
}) {
  const [payState, payAction, payPending] = useActionState(paySalaryAction, null as Result);
  const [retState, retAction, retPending] = useActionState(withdrawAction, null as Result);

  // `ouvrirPay(btype, bid, nom, gain)` / `ouvrirRetrait(aid, nom, reste, limite, pris)`.
  const [pay, setPay] = useState<{ id: string; nom: string; reste: string } | null>(null);
  const [retrait, setRetrait] = useState<{
    id: string;
    nom: string;
    reste: string;
    limite: string;
    pris: string;
  } | null>(null);
  const [payLignes, setPayLignes] = useState<LigneMoyen[]>([]);
  const [retLignes, setRetLignes] = useState<LigneMoyen[]>([]);

  // Sa page se rend à nouveau après un refus : modale fermée, message en haut.
  useEffect(() => {
    if (payState?.error) setPay(null);
  }, [payState]);
  useEffect(() => {
    if (retState?.error) setRetrait(null);
  }, [retState]);

  const message = payState?.error ?? retState?.error ?? '';
  const benefType = type === 'profs' ? 'professeur' : 'staff';
  const titre =
    type === 'staff' ? 'Staff' : type === 'admins' ? 'Administrateurs (retraits)' : 'Professeurs';
  const adminsComptable = type === 'admins' && comptable;

  function ouvrirPay(id: string, nom: string, reste: string) {
    setPay({ id, nom, reste });
    // `l.innerHTML = ''; mpAjouter('paystaff', undefined, gain)` — une ligne,
    // pré-remplie du reste dû.
    setPayLignes([{ moyenId: '', montant: String(Number(reste)) }]);
  }
  function ouvrirRetrait(id: string, nom: string, reste: string, limite: string, pris: string) {
    setRetrait({ id, nom, reste, limite, pris });
    // `mpAjouter('admpay')` — une ligne vide.
    setRetLignes([{ moyenId: '', montant: '' }]);
  }

  // `majDrapeauRetrait()` : total > RETRAIT_RESTE + 0.009.
  const retraitTotal = retLignes.reduce((a, l) => a + (parseFloat(l.montant) || 0), 0);
  const retraitReste = retrait ? Math.max(0, Number(retrait.reste)) : 0;
  const drapeau = retrait !== null && retraitTotal > retraitReste + 0.009;

  const soumettre = (e: React.ChangeEvent<HTMLSelectElement>) =>
    e.currentTarget.form?.requestSubmit();

  return (
    <>
      {message && <div className="alert alert-error">{message}</div>}

      <form method="GET" className="form-card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 160 }}>
            <label>Catégorie</label>
            <select name="type" defaultValue={type} onChange={soumettre}>
              <option value="staff">Staff</option>
              <option value="profs">Professeurs</option>
              <option value="admins">Administrateurs</option>
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label>
              Mois {type === 'profs' ? <small className="text-muted">(année scolaire)</small> : ''}
            </label>
            <select name="mois" defaultValue={String(mois)} onChange={soumettre}>
              {moisDisponibles.map((mn) => (
                <option key={mn} value={mn}>
                  {MOIS_NOMS[mn]}
                </option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 110 }}>
            <label>Année</label>
            <select name="annee" defaultValue={String(annee)} onChange={soumettre}>
              {annees.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>
      </form>

      <div className="table-container">
        <div className="table-header">
          <h3>
            {titre} — {MOIS_NOMS[mois]} {annee}
          </h3>
          <span className="badge badge-primary">{lignes.length}</span>
        </div>
        <div className="overflow-x">
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>{type === 'admins' ? 'Téléphone' : 'Fonction'}</th>
                {type === 'profs' && (
                  <>
                    <th>Situation</th>
                    <th>Heures/mois</th>
                  </>
                )}
                {adminsComptable ? (
                  <>
                    <th>Retiré ce mois</th>
                    <th>Action</th>
                  </>
                ) : (
                  <>
                    <th>{type === 'admins' ? 'Limite mensuelle' : 'Salaire mensuel'}</th>
                    <th>{type === 'admins' ? 'Retiré ce mois' : 'Déjà payé (mois)'}</th>
                    <th>Action</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {lignes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-muted" style={{ padding: '2rem' }}>
                    Aucune personne dans cette catégorie.
                  </td>
                </tr>
              ) : (
                lignes.map((p) => {
                  const paye = Number(p.paye);
                  const retenue = Number(p.retenue);
                  const reste = Number(p.reste);
                  return (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.nom_complet}</strong>
                      </td>
                      <td>{type === 'admins' ? p.telephone || '—' : p.fonction}</td>
                      {type === 'profs' && (
                        <>
                          <td>
                            {(p.situation ?? 'permanent') === 'interim' ? (
                              <>
                                <span className="badge" style={{ background: '#FEF3C7', color: '#92400E' }}>
                                  Intérim
                                </span>
                                <small className="text-muted" style={{ display: 'block' }}>
                                  taux par assignation
                                </small>
                              </>
                            ) : (
                              <span className="badge badge-primary">Permanent</span>
                            )}
                          </td>
                          <td>{mru(p.heures_mois_calc ?? 0)} h</td>
                        </>
                      )}
                      {!adminsComptable && (
                        <td>
                          {mru(p.gain ?? 0)} MRU
                          {retenue > 0.009 && (
                            <>
                              <small
                                style={{ display: 'block', color: '#B45309', fontWeight: 600 }}
                                title="Retenue de prêt du mois (voir Dettes → Prêts au personnel)"
                              >
                                − {mru(retenue)} prêt
                              </small>
                              <small
                                style={{ display: 'block', color: 'var(--primary)', fontWeight: 700 }}
                              >
                                Net : {mru(p.net ?? 0)} MRU
                              </small>
                            </>
                          )}
                        </td>
                      )}
                      <td>
                        {paye > 0 ? (
                          <span style={{ color: '#728157' }}>{mru(paye)} MRU</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                        {paye > 0 && reste > 0.009 && (
                          <small style={{ display: 'block', color: 'var(--danger)' }}>
                            reste {mru(reste)}
                          </small>
                        )}
                      </td>
                      <td>
                        {type === 'admins' ? (
                          p.gain_nul ? (
                            <span
                              className="text-muted"
                              title="La limite mensuelle doit d'abord être définie par l'administration"
                            >
                              — retrait indisponible —
                            </span>
                          ) : p.reste_nul ? (
                            <span style={{ color: '#a8341f', fontWeight: 'bold' }}>
                              ⚠ Limite mensuelle atteinte
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() =>
                                ouvrirRetrait(
                                  p.id,
                                  p.nom_complet,
                                  p.reste,
                                  comptable ? '0' : (p.gain ?? '0'),
                                  comptable ? '0' : p.paye,
                                )
                              }
                            >
                              Retirer
                            </button>
                          )
                        ) : p.mois_paye === false ? (
                          <span className="text-muted" title="Les mois payés se définissent sur la fiche du personnel">
                            — non payé ce mois —
                          </span>
                        ) : p.gain_nul ? (
                          <span className="text-muted" title="Définissez d'abord un salaire de référence">
                            — salaire non défini —
                          </span>
                        ) : p.net_nul ? (
                          <span
                            style={{ color: '#B45309', fontWeight: 'bold' }}
                            title="La retenue de prêt couvre tout le salaire de ce mois"
                          >
                            Retenu (prêt)
                          </span>
                        ) : p.reste_nul ? (
                          <span style={{ color: '#728157', fontWeight: 'bold' }}>✓ Payé</span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => ouvrirPay(p.id, p.nom_complet, p.reste)}
                          >
                            {paye > 0 ? 'Payer le reste' : 'Payer'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modale RETRAIT ADMINISTRATEUR */}
      <div
        id="modal_retrait"
        style={{
          display: retrait ? 'flex' : 'none',
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,.5)',
          zIndex: 1000,
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
        }}
      >
        <div className="form-card" style={{ maxWidth: 500, width: '100%', background: '#fff' }}>
          <h3 style={{ marginTop: 0 }}>Retrait administrateur</h3>
          <p id="retrait_info" className="text-muted">
            {retrait &&
              (!comptable
                ? `${retrait.nom} — limite : ${loc(retrait.limite)} MRU/mois · déjà retiré : ${loc(retrait.pris)} MRU · reste disponible : ${loc(retraitReste)} MRU`
                : `${retrait.nom} — la limite mensuelle est contrôlée automatiquement par le système.`)}
          </p>
          <div
            id="retrait_flag"
            style={{
              display: drapeau ? '' : 'none',
              background: '#FEE2E2',
              border: '2px solid #a8341f',
              color: '#991B1B',
              fontWeight: 700,
              padding: '.7rem .9rem',
              borderRadius: 10,
              marginBottom: '.7rem',
            }}
          >
            VOUS AVEZ DÉPASSÉ LA LIMITE MENSUELLE de cet administrateur !{' '}
            {!comptable ? (
              <>
                Reste disponible : <span id="retrait_reste_txt">{loc(retraitReste)} MRU</span>.{' '}
              </>
            ) : (
              <span id="retrait_reste_txt" style={{ display: 'none' }} />
            )}
            Le retrait sera refusé.
          </div>
          <form action={retAction}>
            <input type="hidden" name="fundHolderId" value={retrait?.id ?? ''} />
            <input type="hidden" name="mois" value={mois} />
            <input type="hidden" name="annee" value={annee} />
            <input type="hidden" name="tender" value={JSON.stringify(retLignes)} />
            <div style={{ marginBottom: '.5rem' }}>
              <label>Motif</label>
              <input
                type="text"
                name="motif"
                placeholder="Ex : retrait personnel, frais de représentation…"
                maxLength={255}
              />
            </div>
            <MoyensPaiement
              moyens={moyens}
              cible="0"
              lignes={retLignes}
              onChange={setRetLignes}
              currency="MRU"
              sens="sortant"
            />
            <div style={{ display: 'flex', gap: '.5rem', marginTop: '1rem' }}>
              <button className="btn btn-primary" disabled={retPending}>
                ✓ Confirmer le retrait
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setRetrait(null)}>
                Annuler
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Modale PAYER UN SALAIRE */}
      <div
        id="modal_pay"
        style={{
          display: pay ? 'flex' : 'none',
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,.5)',
          zIndex: 1000,
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
        }}
      >
        <div className="form-card" style={{ maxWidth: 480, width: '100%', background: '#fff' }}>
          <h3 style={{ marginTop: 0 }}>Payer un salaire</h3>
          <p id="pay_info" className="text-muted">
            {pay && `${pay.nom} — reste dû pour ce mois : ${loc(pay.reste)} MRU`}
          </p>
          <form action={payAction}>
            <input type="hidden" name="beneficiaire_type" value={benefType} />
            <input type="hidden" name="beneficiaire_id" value={pay?.id ?? ''} />
            <input type="hidden" name="mois" value={mois} />
            <input type="hidden" name="annee" value={annee} />
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="tender" value={JSON.stringify(payLignes)} />
            <div style={{ marginBottom: '.5rem' }}>
              <label>Motif</label>
              <input
                type="text"
                name="motif"
                defaultValue="Salaire"
                placeholder="Salaire, prime, cours du soir…"
              />
            </div>
            <MoyensPaiement
              moyens={moyens}
              cible={pay ? String(Number(pay.reste)) : '0'}
              lignes={payLignes}
              onChange={setPayLignes}
              currency="MRU"
              sens="sortant"
            />
            <div style={{ display: 'flex', gap: '.5rem', marginTop: '1rem' }}>
              <button className="btn btn-primary" disabled={payPending}>
                ✓ Confirmer le paiement
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setPay(null)}>
                Annuler
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
