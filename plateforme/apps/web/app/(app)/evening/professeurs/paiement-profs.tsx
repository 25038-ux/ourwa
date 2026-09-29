'use client';

import { useEffect, useState } from 'react';
import { payEveningTeacherAction, reverseEveningTeacherPaymentAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';
import { MoyensPaiement, type LigneMoyen, type Moyen, fr } from '@/components/moyens-paiement';
import { MOIS_NOMS } from '@/lib/mois';

export interface Row {
  eveningTeachingId: string;
  groupId: string;
  groupName: string;
  subject: string;
  teacherName: string;
  internal: boolean;
  payKind: 'fixed' | 'hourly';
  due: string;
  paid: string;
  remaining: string;
  payments: { id: string; amount: string; paidAt: string }[];
}

type Result = { ok?: string; error?: string } | null;
const mru = (v: string | number) => fr(Math.round(Number(v)));

/** La table « Professeurs & Rémunérations Cours du Soir » et sa modale « Payer un enseignant (Cours du soir) ». */
export function PaiementProfs({
  rows,
  mois,
  annee,
  moyens,
  mayPay,
  comptable,
}: {
  rows: Row[];
  mois: number;
  annee: number;
  moyens: Moyen[];
  mayPay: boolean;
  comptable: boolean;
}) {
  const [pay, payAction, payPending] = useActionMessage(payEveningTeacherAction);
  const [annul, annulAction] = useActionMessage(reverseEveningTeacherPaymentAction);


  const [modal, setModal] = useState<{ ens: string; nom: string; reste: number } | null>(null);
  const [lignes, setLignes] = useState<LigneMoyen[]>([]);
  useEffect(() => { if (pay) setModal(null); }, [pay]);

  const ouvrirPayProf = (ens: string, nom: string, reste: number) => {
    setLignes(moyens[0] ? [{ moyenId: moyens[0].id, montant: String(reste) }] : []);
    setModal({ ens, nom, reste });
  };

  return (
    <>
      <div className="table-container">
        <div className="table-header">
          <h3>Professeurs &amp; Rémunérations Cours du Soir — {MOIS_NOMS[mois]} {annee}</h3>
          <span className="badge badge-primary">{rows.length}</span>
        </div>
        <div className="overflow-x">
          <table>
            <thead>
              <tr>
                <th>Enseignant</th>
                <th>Groupe / Matière</th>
                <th>Type</th>
                <th>Rémunération Prévue</th>
                <th>Déjà Payé (Mois)</th>
                <th>Reste à Payer</th>
                <th className="no-print">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-muted" style={{ padding: '2rem' }}>Aucun professeur assigné à des cours du soir.</td></tr>
              ) : rows.map((item) => {
                const reste = Number(item.remaining);
                const deja = Number(item.paid);
                // Son `MIN(id)` : le premier paiement du mois porte le reçu.
                const payId = item.payments[0]?.id ?? null;
                return (
                  <tr key={item.eveningTeachingId}>
                    <td><strong>{item.teacherName}</strong> {item.internal ? <span className="badge badge-success">École</span> : <span className="badge badge-secondary">Externe</span>}</td>
                    <td>{item.groupName} — <em>{item.subject}</em></td>
                    <td><span className="badge badge-primary">{item.payKind === 'fixed' ? 'Mensuel stable' : 'Horaire'}</span></td>
                    <td>{mru(item.due)} MRU</td>
                    <td>{deja > 0 ? <span style={{ color: '#728157', fontWeight: 'bold' }}>{mru(deja)} MRU</span> : <span className="text-muted">—</span>}</td>
                    <td>{reste > 0 ? <strong style={{ color: 'var(--error)' }}>{mru(reste)} MRU</strong> : <span style={{ color: '#728157', fontWeight: 'bold' }}>✓ Réglé</span>}</td>
                    <td className="no-print">
                      {reste > 0 && mayPay && (
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => ouvrirPayProf(item.eveningTeachingId, item.teacherName, reste)}>
                          Rémunérer
                        </button>
                      )}
                      {payId && (
                        <>
                          <a href={`/evening/recu-prof/${payId}`} target="_blank" rel="noopener" className="btn btn-sm btn-secondary" style={{ marginLeft: '0.35rem' }} title="Imprimer le reçu de paiement">Reçu</a>
                          {!comptable && mayPay && (
                            <form action={annulAction} style={{ display: 'inline' }} onSubmit={(e) => { if (!confirm('Annuler le paiement de ce mois pour ce professeur ?')) e.preventDefault(); }}>
                              <input type="hidden" name="paymentId" value={payId} />
                              <button className="btn btn-sm btn-danger" style={{ marginLeft: '0.35rem' }}>✕ Annuler</button>
                            </form>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div id="modal_prof_pay" style={{ display: modal ? 'flex' : 'none', position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
        <div className="form-card" style={{ maxWidth: 480, width: '100%', background: '#fff' }}>
          <h3 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Payer un enseignant (Cours du soir)</h3>
          <p id="prof_pay_info" className="text-muted" style={{ marginBottom: '1rem' }}>
            {modal ? `${modal.nom} — Reste dû : ${modal.reste.toLocaleString('fr-FR')} MRU` : ''}
          </p>
          <form action={payAction}>
            <input type="hidden" name="eveningTeachingId" value={modal?.ens ?? ''} />
            <input type="hidden" name="calendarMonth" value={mois} />
            <input type="hidden" name="calendarYear" value={annee} />
            <input type="hidden" name="tender" value={JSON.stringify(lignes)} />
            <MoyensPaiement moyens={moyens} cible={String(modal?.reste ?? 0)} lignes={lignes} onChange={setLignes} currency="MRU" sens="sortant" />
            <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.5rem' }}>
              <button className="btn btn-primary" disabled={payPending}>✓ Confirmer le paiement</button>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Annuler</button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
