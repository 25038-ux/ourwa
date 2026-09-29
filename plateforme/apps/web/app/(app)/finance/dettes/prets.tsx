'use client';

import { useActionState, useEffect, useState } from 'react';
import { grantLoanAction, repayLoanAction } from '@/app/actions';
import { MoyensPaiement, type LigneMoyen, type Moyen, fr } from '@/components/moyens-paiement';
import { MOIS_NOMS } from '@/lib/mois';

export interface Pret {
  id: string;
  payee_kind: 'staff' | 'teacher';
  benef_nom: string | null;
  principal: string;
  repaid: string;
  reste: string;
  status: string;
  reason: string | null;
  numero: string | null;
  echeances: { mois: number; annee: number; montant: string; rembourse: string }[];
}

type Result = { error?: string } | null;

/** Son `mb_substr($mois_noms[$m], 0, 4)`. */
const mois4 = (m: number) => Array.from(MOIS_NOMS[m] ?? '').slice(0, 4).join('');
const mru = (v: string | number) => fr(Number(v));

/**
 * LA SECTION « PRÊT AU PERSONNEL » DE `dette.php` : le formulaire `creer_pret`,
 * le tableau « Prêts en cours & soldés », la modale « Avance de remboursement »
 * et ses trois scripts — `majListePret()`, `majApercuPret()`, `ouvrirAvancePret()`.
 *
 * Un refus du serveur s'affiche comme chez lui : en alerte en haut, la modale
 * refermée.
 */
export function PretsPersonnel({
  staff,
  profs,
  moisMotif,
  annees,
  prets,
  moyens,
}: {
  staff: { id: string; nom_complet: string; fonction: string | null }[];
  profs: { id: string; nom_complet: string }[];
  moisMotif: number[];
  annees: number[];
  prets: Pret[];
  moyens: Moyen[];
}) {
  const [pretState, pretAction, pretPending] = useActionState(grantLoanAction, null as Result);
  const [avState, avAction, avPending] = useActionState(repayLoanAction, null as Result);

  const anneeCourante = new Date().getFullYear();
  const rangMin = anneeCourante * 12 + (new Date().getMonth() + 1);
  const [type, setType] = useState<'staff' | 'professeur'>('staff');
  const [montant, setMontant] = useState('');
  const [anneesOuvertes, setAnneesOuvertes] = useState<Set<number>>(new Set([anneeCourante]));
  const [coches, setCoches] = useState<Set<string>>(new Set());
  const [pretLignes, setPretLignes] = useState<LigneMoyen[]>([{ moyenId: '', montant: '' }]);

  const [avance, setAvance] = useState<{ id: string; nom: string; reste: string } | null>(null);
  const [avLignes, setAvLignes] = useState<LigneMoyen[]>([]);
  useEffect(() => {
    if (avState?.error) setAvance(null);
  }, [avState]);

  const message = pretState?.error ?? avState?.error ?? '';

  // `majApercuPret()`.
  const m = parseFloat(montant) || 0;
  const n = coches.size;
  const apercu =
    m > 0 && n > 0
      ? `→ Retenue mensuelle : ${(Math.round((m / n) * 100) / 100).toLocaleString('fr-FR')} MRU sur ${n} mois`
      : '';

  function basculerAnnee(an: number, ouverte: boolean) {
    const s = new Set(anneesOuvertes);
    if (ouverte) s.add(an);
    else {
      s.delete(an);
      // Une année repliée décoche ses mois.
      const c = new Set(coches);
      for (const v of c) if (v.endsWith(`-${an}`)) c.delete(v);
      setCoches(c);
    }
    setAnneesOuvertes(s);
  }

  function ouvrirAvancePret(id: string, nom: string, reste: string) {
    setAvance({ id, nom, reste });
    setAvLignes([{ moyenId: '', montant: String(Number(reste)) }]);
  }

  return (
    <>
      {message && <div className="alert alert-error">{message}</div>}

      {/* ═══════════════════ PRÊTS AU PERSONNEL (avances sur salaire) ═══════════════════ */}
      <div className="form-card" style={{ margin: '1.5rem 0' }}>
        <h3 style={{ marginTop: 0 }}>Prêt au personnel (avance sur salaire)</h3>
        <p className="text-muted" style={{ fontSize: '.85rem' }}>
          Prêtez une somme à un membre du staff ou à un professeur : le montant est{' '}
          <strong>retenu automatiquement sur son salaire</strong>, réparti à parts égales sur
          les mois de l&apos;année scolaire que vous cochez. Dans « Paiement du personnel »,
          c&apos;est le <strong>salaire net</strong> (après retenue) qui apparaît. Une avance de
          remboursement recalcule automatiquement les mensualités restantes.
        </p>
        <form action={pretAction} id="form_pret">
          <input type="hidden" name="tender" value={JSON.stringify(pretLignes)} />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))',
              gap: '1rem',
            }}
          >
            <div className="form-group">
              <label>Type de personnel *</label>
              <select
                name="pret_type"
                id="pret_type"
                required
                value={type}
                onChange={(e) => setType(e.currentTarget.value as 'staff' | 'professeur')}
              >
                <option value="staff">Staff</option>
                <option value="professeur">Professeur</option>
              </select>
            </div>
            <div className="form-group">
              <label>Bénéficiaire *</label>
              <select
                name="pret_beneficiaire_id"
                id="pret_benef_staff"
                required={type === 'staff'}
                disabled={type !== 'staff'}
                style={type === 'staff' ? undefined : { display: 'none' }}
                defaultValue=""
              >
                <option value="">— Choisir —</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nom_complet} — {s.fonction}
                  </option>
                ))}
              </select>
              <select
                name="pret_beneficiaire_id"
                id="pret_benef_prof"
                required={type !== 'staff'}
                disabled={type === 'staff'}
                style={type === 'staff' ? { display: 'none' } : undefined}
                defaultValue=""
              >
                <option value="">— Choisir —</option>
                {profs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nom_complet}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Montant du prêt (MRU) *</label>
              <input
                type="number"
                name="pret_montant"
                id="pret_montant"
                min="1"
                step="1"
                required
                value={montant}
                onChange={(e) => setMontant(e.currentTarget.value)}
              />
            </div>
            <div className="form-group">
              <label>Motif</label>
              <input
                type="text"
                name="pret_motif"
                maxLength={255}
                placeholder="Ex : avance, urgence familiale…"
              />
            </div>
          </div>

          <div className="form-group">
            <label>
              Mois de retenue * —{' '}
              <small className="text-muted">cochez les mois (répartition sur 1, 2, 3 ans ou plus)</small>
            </label>
            <div style={{ marginBottom: '.4rem' }}>
              <label style={{ fontSize: '.82rem', color: 'var(--text-light)' }}>Afficher les années :</label>
              {annees.map((ap) => (
                <label
                  key={ap}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '.3rem',
                    marginRight: '.7rem',
                    fontSize: '.85rem',
                  }}
                >
                  <input
                    type="checkbox"
                    className="pret-annee-toggle"
                    checked={anneesOuvertes.has(ap)}
                    onChange={(e) => basculerAnnee(ap, e.currentTarget.checked)}
                  />{' '}
                  {ap}
                </label>
              ))}
            </div>
            {annees.map((ap) => (
              <div
                key={ap}
                id={`pret_annee_${ap}`}
                style={{ display: anneesOuvertes.has(ap) ? undefined : 'none', marginBottom: '.45rem' }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    minWidth: 52,
                    fontWeight: 700,
                    color: 'var(--primary)',
                    fontSize: '.85rem',
                  }}
                >
                  {ap}
                </span>
                {moisMotif.map((mm) => {
                  const val = `${mm}-${ap}`;
                  // UN MOIS PASSÉ NE PEUT PORTER AUCUNE ÉCHÉANCE.
                  const passe = ap * 12 + mm < rangMin;
                  return (
                    <label
                      key={val}
                      title={
                        passe
                          ? "Mois déjà écoulé : le salaire correspondant est versé, une retenue ne peut plus s'y appliquer."
                          : ''
                      }
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '.35rem',
                        padding: '.3rem .6rem',
                        margin: '.12rem',
                        border: '1.5px solid var(--border)',
                        borderRadius: 8,
                        fontSize: '.83rem',
                        ...(passe
                          ? {
                              cursor: 'not-allowed',
                              opacity: 0.4,
                              background: 'var(--o-n-200,#eee7db)',
                              textDecoration: 'line-through',
                            }
                          : { cursor: 'pointer', background: '#fff' }),
                      }}
                    >
                      <input
                        type="checkbox"
                        name="pret_mois[]"
                        value={val}
                        disabled={passe}
                        checked={coches.has(val)}
                        onChange={(e) => {
                          const c = new Set(coches);
                          if (e.currentTarget.checked) c.add(val);
                          else c.delete(val);
                          setCoches(c);
                        }}
                      />
                      {MOIS_NOMS[mm]}
                    </label>
                  );
                })}
              </div>
            ))}
            <p
              id="pret_apercu"
              style={{ margin: '.5rem 0 0', fontWeight: 600, color: 'var(--primary)', fontSize: '.9rem' }}
            >
              {apercu}
            </p>
            <small className="text-muted">
              Les mois proposés suivent la configuration « Année scolaire » (ex. sans juillet-septembre).
            </small>
          </div>

          <div className="form-group">
            <label>Remise des fonds (moyens de paiement, sortie de caisse) *</label>
            <MoyensPaiement
              moyens={moyens}
              cible="0"
              lignes={pretLignes}
              onChange={setPretLignes}
              currency="MRU"
              sens="sortant"
            />
          </div>
          <button className="btn btn-primary" style={{ width: 'auto' }} disabled={pretPending}>
            Accorder le prêt
          </button>
        </form>
      </div>

      {prets.length > 0 && (
        <>
          <div className="table-container" style={{ marginBottom: '1.5rem' }}>
            <div className="table-header">
              <h3>Prêts en cours &amp; soldés</h3>
              <span className="badge badge-primary">{prets.length}</span>
            </div>
            <div className="overflow-x">
              <table>
                <thead>
                  <tr>
                    <th>Bénéficiaire</th>
                    <th>Type</th>
                    <th>Total</th>
                    <th>Remboursé</th>
                    <th>Reste</th>
                    <th>Échéancier (retenues)</th>
                    <th className="no-print">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {prets.map((pr) => {
                    const restePr = Math.max(0, Number(pr.reste));
                    const solde = pr.status === 'settled';
                    return (
                      <tr key={pr.id} style={solde ? { opacity: 0.6 } : undefined}>
                        <td>
                          <strong>{pr.benef_nom ?? '—'}</strong>
                          {pr.reason && (
                            <>
                              <br />
                              <small className="text-muted">{pr.reason}</small>
                            </>
                          )}
                        </td>
                        <td>{pr.payee_kind === 'staff' ? 'Staff' : 'Professeur'}</td>
                        <td>{mru(pr.principal)} MRU</td>
                        <td style={{ color: '#728157' }}>{mru(pr.repaid)} MRU</td>
                        <td>
                          <strong style={{ color: restePr > 0.01 ? '#a8341f' : '#728157' }}>
                            {mru(restePr)} MRU
                          </strong>
                          {solde && (
                            <>
                              <br />
                              <span className="badge" style={{ background: '#D1FAE5', color: '#065F46' }}>
                                Soldé
                              </span>
                            </>
                          )}
                        </td>
                        <td>
                          {pr.echeances.map((e, i) => {
                            const ok = Number(e.rembourse) >= Number(e.montant) - 0.01;
                            return (
                              <span
                                key={i}
                                title={ok ? 'Retenue effectuée' : 'Retenue à venir (déduite du salaire de ce mois)'}
                                style={{
                                  display: 'inline-block',
                                  margin: 1,
                                  padding: '.15rem .45rem',
                                  borderRadius: 6,
                                  fontSize: '.72rem',
                                  fontWeight: 600,
                                  background: ok ? '#D1FAE5' : '#FEF3C7',
                                  color: ok ? '#065F46' : '#92400E',
                                }}
                              >
                                {mois4(e.mois)} {e.annee} : {mru(e.montant)}
                                {ok ? ' ✓' : ''}
                              </span>
                            );
                          })}
                        </td>
                        <td className="no-print" style={{ whiteSpace: 'nowrap' }}>
                          {/* Son lien est un bouton sans texte. */}
                          <a
                            href={`/finance/dettes?print_recu_pret=${pr.id}`}
                            target="_blank"
                            rel="noopener"
                            className="btn btn-sm btn-secondary"
                            title="Imprimer le contrat de prêt"
                            aria-label="Imprimer le contrat de prêt"
                          ></a>{' '}
                          {pr.status === 'outstanding' && (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => ouvrirAvancePret(pr.id, pr.benef_nom ?? '', pr.reste)}
                            >
                              Avance
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Modale avance de remboursement */}
          <div
            id="modal_avance"
            style={{
              display: avance ? 'flex' : 'none',
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
              <h3 style={{ marginTop: 0 }}>Avance de remboursement</h3>
              <p id="avance_info" className="text-muted">
                {avance && `${avance.nom} — reste dû : ${Number(avance.reste).toLocaleString('fr-FR')} MRU`}
              </p>
              <form action={avAction}>
                <input type="hidden" name="pret_id" value={avance?.id ?? ''} />
                <input type="hidden" name="tender" value={JSON.stringify(avLignes)} />
                <MoyensPaiement
                  moyens={moyens}
                  cible={avance ? String(Number(avance.reste)) : '0'}
                  lignes={avLignes}
                  onChange={setAvLignes}
                  currency="MRU"
                  sens="entrant"
                />
                <p className="text-muted" style={{ fontSize: '.8rem' }}>
                  Après encaissement, les retenues mensuelles restantes sont{' '}
                  <strong>recalculées automatiquement</strong> (reste dû ÷ mois restants).
                </p>
                <div style={{ display: 'flex', gap: '.5rem', marginTop: '1rem' }}>
                  <button className="btn btn-primary" disabled={avPending}>
                    ✓ Encaisser l&apos;avance
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setAvance(null)}>
                    Annuler
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}
    </>
  );
}
