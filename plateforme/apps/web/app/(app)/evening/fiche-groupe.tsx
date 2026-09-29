'use client';

import { useEffect, useState } from 'react';
import {
  applyEveningDiscountAction,
  assignEveningTeacherAction,
  clearEveningSlotAction,
  deleteEveningGroupAction,
  eveningCollectAction,
  eveningEnrolAction,
  placeEveningSlotAction,
  removeEveningTeachingAction,
  setEveningMonthsAction,
  updateEveningGroupAction,
} from '@/app/actions';
import { useActionMessage } from '@/components/message-page';
import { MoyensPaiement, type LigneMoyen, type Moyen, fr } from '@/components/moyens-paiement';
import { MOIS_NOMS } from '@/lib/mois';

export interface Detail {
  groupe: { id: string; name: string; monthly_rate: string; description: string | null };
  moisDus: number[];
  inscrits: {
    id: string;
    student_id: string | null;
    etu_nom: string | null;
    matricule: string | null;
    externe_nom: string | null;
    mois_payes: Record<number, { id: string; montant: string }>;
    reductions: Record<number, { id: string; montant: string; motif: string | null }>;
  }[];
}

export interface EveningTeaching {
  id: string;
  teacherName: string | null;
  internal: boolean;
  subject: string;
  payKind: 'fixed' | 'hourly';
  hourlyRate: string;
  hoursPerMonth: number;
  fixedSalary: string;
}

export interface EveningSlot {
  id: string;
  dayOfWeek: number;
  slot: number;
  subject: string;
  eveningTeachingId: string | null;
  teacherName: string | null;
}

type Result = { ok?: string; error?: string } | null;

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const CRENEAUX = ['8h-10h', '10h-12h', '12h-14h', '14h-16h', '16h-18h', '18h-20h', '20h-22h'];
const mru = (v: string | number) => fr(Math.round(Number(v)));
const loc = (v: number) => v.toLocaleString('fr-FR');

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, alignItems: 'center', justifyContent: 'center', padding: '1rem',
};

/** LA FICHE D'UN GROUPE — `cours_du_soir.php?groupe_id=…`, section par section. */
export function FicheGroupe({
  detail,
  anneeCourante,
  anneeDefaut,
  teachings,
  creneaux,
  profsEcole,
  profsExternes,
  moyens,
  etudiants,
  droits,
}: {
  detail: Detail;
  anneeCourante: number;
  anneeDefaut: number;
  teachings: EveningTeaching[];
  creneaux: EveningSlot[];
  profsEcole: { id: string; nom: string }[];
  profsExternes: { id: string; nom: string }[];
  moyens: Moyen[];
  etudiants: { id: string; label: string }[];
  droits: { mayCollect: boolean; mayManage: boolean; mayAdminister: boolean; comptable: boolean };
}) {
  const g = detail.groupe;
  const tarif = Number(g.monthly_rate);
  const moisActuel = new Date().getMonth() + 1;

  // Les actions et leurs messages, en haut de page.
  const [modif, modifAction] = useActionMessage(updateEveningGroupAction);
  const [suppr, supprAction] = useActionMessage(deleteEveningGroupAction);
  const [moisSt, moisAction] = useActionMessage(setEveningMonthsAction);
  const [pay, payAction, payPending] = useActionMessage(eveningCollectAction);
  const [red, redAction] = useActionMessage(applyEveningDiscountAction);
  const [insc, inscAction] = useActionMessage(eveningEnrolAction);
  const [inscExt, inscExtAction] = useActionMessage(eveningEnrolAction);
  const [assign, assignAction] = useActionMessage(assignEveningTeacherAction);
  const [retirer, retirerAction] = useActionMessage(removeEveningTeachingAction);
  const [placer, placerAction] = useActionMessage(placeEveningSlotAction);
  const [effacer, effacerAction] = useActionMessage(clearEveningSlotAction);












  const [editOpen, setEditOpen] = useState(false);
  const [modalMois, setModalMois] = useState(false);
  const [modalPay, setModalPay] = useState<{ insc: string; nom: string; reductions: Record<number, number>; payes: Record<number, number> } | null>(null);
  const [payMois, setPayMois] = useState(detail.moisDus.includes(moisActuel) ? moisActuel : detail.moisDus[0] ?? 1);
  const [lignesPay, setLignesPay] = useState<LigneMoyen[]>([]);
  const [modalRed, setModalRed] = useState<{ insc: string; nom: string } | null>(null);
  const [modalPl, setModalPl] = useState<{ jour: string; creneau: string } | null>(null);
  const [plMatiere, setPlMatiere] = useState('');
  const [plEns, setPlEns] = useState('');
  const [profSource, setProfSource] = useState<'interne' | 'externe'>('interne');
  const [extChoice, setExtChoice] = useState('');
  const [typeSal, setTypeSal] = useState<'horaire' | 'fixe'>('horaire');
  const [rechercheEtu, setRechercheEtu] = useState('');

  // Sa page se rend à nouveau après un POST : les modales sont refermées.
  useEffect(() => { if (moisSt) setModalMois(false); }, [moisSt]);
  useEffect(() => { if (red) setModalRed(null); }, [red]);
  useEffect(() => { if (placer) setModalPl(null); }, [placer]);
  useEffect(() => { if (modif) setEditOpen(false); }, [modif]);

  // Son `ouvrirCSPay` : reste dû du mois choisi, cible du widget.
  const resteDu = () => {
    if (!modalPay) return 0;
    const du = Math.max(0, tarif - (modalPay.reductions[payMois] || 0));
    return Math.max(0, du - (modalPay.payes[payMois] || 0));
  };
  const infoPay = () => {
    if (!modalPay) return '';
    const redM = modalPay.reductions[payMois] || 0;
    const payeM = modalPay.payes[payMois] || 0;
    let txt = `${modalPay.nom} — tarif : ${loc(tarif)} MRU/mois`;
    if (redM > 0) txt += ` · réduction : -${loc(redM)}`;
    if (payeM > 0) txt += ` · déjà payé : ${loc(payeM)}`;
    txt += ` · reste dû : ${loc(resteDu())} MRU`;
    return txt;
  };
  const ouvrirCSPay = (i: Detail['inscrits'][number], nom: string) => {
    const reductions: Record<number, number> = {};
    const payes: Record<number, number> = {};
    for (const [m, r] of Object.entries(i.reductions)) reductions[Number(m)] = Number(r.montant);
    for (const [m, p] of Object.entries(i.mois_payes)) payes[Number(m)] = Number(p.montant);
    const mois = detail.moisDus.includes(moisActuel) ? moisActuel : detail.moisDus[0] ?? 1;
    setPayMois(mois);
    const du = Math.max(0, tarif - (reductions[mois] || 0));
    const reste = Math.max(0, du - (payes[mois] || 0));
    setLignesPay(reste > 0 && moyens[0] ? [{ moyenId: moyens[0].id, montant: String(reste) }] : []);
    setModalPay({ insc: i.id, nom, reductions, payes });
  };
  useEffect(() => {
    if (!modalPay) return;
    const reste = resteDu();
    setLignesPay(reste > 0 && moyens[0] ? [{ moyenId: moyens[0].id, montant: String(reste) }] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payMois]);

  // Matières proposables : celles créées pour CE groupe par ses assignations, tri naturel.
  const matieresDispo = [...new Set(teachings.map((t) => t.subject).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' }));
  const grille = new Map(creneaux.map((c) => [`${c.dayOfWeek}:${c.slot}`, c]));
  const etudiantsFiltres = etudiants.filter((e) => e.label.toLowerCase().includes(rechercheEtu.toLowerCase())).slice(0, 50);

  return (
    <>
      <a href="/evening" className="btn btn-secondary no-print" style={{ marginBottom: '1rem' }}>← Tous les groupes</a>
      <form method="GET" className="no-print" style={{ display: 'inline-flex', gap: '.4rem', alignItems: 'center', margin: '0 0 1rem .6rem' }}>
        <input type="hidden" name="groupe_id" value={g.id} />
        <label style={{ fontSize: '.8rem', color: 'var(--text-light)' }}>Année :</label>
        <select name="cs_annee" defaultValue={String(anneeCourante)} onChange={(e) => e.currentTarget.form?.requestSubmit()} style={{ padding: '.3rem .5rem' }}>
          {Array.from({ length: 8 }, (_, i) => anneeDefaut + 1 - i).map((ya) => (
            <option key={ya} value={ya}>{ya}</option>
          ))}
        </select>
      </form>

      <div className="form-card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h3 style={{ marginTop: 0, marginBottom: '0.5rem' }}>{g.name}</h3>
            <p className="text-muted" style={{ margin: 0 }}>{mru(tarif)} MRU/mois {g.description ? `· ${g.description}` : ''}</p>
          </div>
          {droits.mayManage && (
            <div style={{ display: 'flex', gap: '0.5rem' }} className="no-print">
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setModalMois(true)}>Mois de paiement</button>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setEditOpen((v) => !v)}>Modifier</button>
              <form
                action={supprAction}
                onSubmit={(e) => {
                  if (!confirm('Confirmer la suppression complète de ce groupe ? Tous les inscrits, cours et paiements associés seront supprimés !')) e.preventDefault();
                }}
                style={{ display: 'inline' }}
              >
                <input type="hidden" name="groupId" value={g.id} />
                <button className="btn btn-sm btn-danger">Supprimer</button>
              </form>
            </div>
          )}
        </div>

        {editOpen && (
          <div id="edit_group_box" style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }} className="no-print">
            <form action={modifAction}>
              <input type="hidden" name="groupId" value={g.id} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Nom du groupe *</label>
                  <input type="text" name="name" defaultValue={g.name} required />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Tarif mensuel (MRU) *</label>
                  <input type="number" name="monthlyRate" min={0} step={0.01} defaultValue={g.monthly_rate} required />
                </div>
              </div>
              <div className="form-group">
                <label>Description</label>
                <input type="text" name="description" defaultValue={g.description ?? ''} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-primary">Enregistrer</button>
                <button type="button" className="btn btn-secondary" onClick={() => setEditOpen(false)}>Annuler</button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Modal configurer mois dus */}
      <div id="modal_mois_dus" style={{ ...overlay, display: modalMois ? 'flex' : 'none' }}>
        <div className="form-card" style={{ maxWidth: 400, width: '100%', background: '#fff', padding: '1.5rem' }}>
          <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>Configuration des mois dus</h3>
          <form action={moisAction}>
            <input type="hidden" name="groupId" value={g.id} />
            <input type="hidden" name="calendarYear" value={anneeCourante} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem', marginBottom: '1.5rem' }}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <label key={m} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', fontWeight: 500 }}>
                  <input type="checkbox" name="months" value={m} defaultChecked={detail.moisDus.includes(m)} />
                  {MOIS_NOMS[m]}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
              <button type="submit" className="btn btn-primary">Enregistrer</button>
              <button type="button" className="btn btn-secondary" onClick={() => setModalMois(false)}>Annuler</button>
            </div>
          </form>
        </div>
      </div>

      {/* INSCRITS + FINANCE */}
      <div className="table-container" style={{ marginBottom: '1.5rem' }}>
        <div className="table-header"><h3>Inscrits &amp; paiements — {anneeCourante}</h3><span className="badge badge-primary">{detail.inscrits.length}</span></div>
        <div className="overflow-x">
          <table>
            <thead><tr><th>Inscrit</th><th>Type</th><th>Mois payés</th><th className="no-print">Payer</th></tr></thead>
            <tbody>
              {detail.inscrits.length === 0 ? (
                <tr><td colSpan={4} className="text-center text-muted" style={{ padding: '1.5rem' }}>Aucun inscrit.</td></tr>
              ) : detail.inscrits.map((ins) => {
                const nom = ins.student_id ? `${ins.etu_nom} (${ins.matricule ?? ''})` : (ins.externe_nom ?? '');
                const estEcole = Boolean(ins.student_id);
                return (
                  <tr key={ins.id}>
                    <td><strong>{nom}</strong></td>
                    <td>{estEcole ? <span className="badge badge-success">École</span> : <span className="badge badge-primary">Externe</span>}</td>
                    <td>
                      {detail.moisDus.map((mn) => {
                        const pinfo = ins.mois_payes[mn];
                        const redCs = Number(ins.reductions[mn]?.montant ?? 0);
                        const duM = Math.max(0, tarif - redCs);
                        const payeM = pinfo ? Number(pinfo.montant) : 0;
                        const titre = `${MOIS_NOMS[mn]}${redCs > 0 ? ` · Réduction : -${mru(redCs)} MRU` : ''} · Payé : ${mru(payeM)} / ${mru(duM)} MRU`;
                        let bg = '#dcd3c4', fg = '#666';
                        if (pinfo && payeM >= duM - 0.01) { bg = '#728157'; fg = '#fff'; }
                        else if (pinfo && payeM > 0) { bg = '#c98a12'; fg = '#fff'; }
                        else if (redCs > 0) { bg = '#FEF3C7'; fg = '#92400E'; }
                        const style: React.CSSProperties = { display: 'inline-block', width: 20, height: 20, lineHeight: '20px', textAlign: 'center', borderRadius: 4, fontSize: '.65rem', margin: 1, background: bg, color: fg };
                        return pinfo ? (
                          <a key={mn} href={`/evening/recu/${pinfo.id}`} target="_blank" title={`${titre} (Cliquer pour imprimer le reçu)`} style={{ ...style, textDecoration: 'none', fontWeight: 'bold' }}>{mn}</a>
                        ) : (
                          <span key={mn} title={titre} style={style}>{mn}</span>
                        );
                      })}
                    </td>
                    <td className="no-print" style={{ whiteSpace: 'nowrap' }}>
                      {droits.mayCollect && <button type="button" className="btn btn-sm btn-primary" onClick={() => ouvrirCSPay(ins, nom)}>Payer</button>}
                      {!droits.comptable && droits.mayAdminister && (
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => setModalRed({ insc: ins.id, nom })}>Réduction</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="form-card">
          <h4 style={{ marginTop: 0 }}>Inscrire un étudiant de l&apos;école</h4>
          <form action={inscAction}>
            <input type="hidden" name="eveningGroupId" value={g.id} />
            <input type="hidden" name="kind" value="student" />
            <div className="form-group">
              <label>Rechercher l&apos;étudiant</label>
              <input type="text" id="cs_etu_search" placeholder="Tapez un nom…" value={rechercheEtu} onChange={(e) => setRechercheEtu(e.target.value)} />
              <select name="studentId" id="cs_etu_select" required size={5} style={{ marginTop: '.4rem' }}>
                {etudiantsFiltres.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
              </select>
            </div>
            <button className="btn btn-primary">Inscrire</button>
          </form>
        </div>
        <div className="form-card">
          <h4 style={{ marginTop: 0 }}>Inscrire un élève externe</h4>
          <form action={inscExtAction}>
            <input type="hidden" name="eveningGroupId" value={g.id} />
            <input type="hidden" name="kind" value="outsider" />
            <div className="form-group"><label>Nom complet *</label><input type="text" name="outsiderName" required /></div>
            <div className="form-group"><label>Téléphone</label><input type="text" name="outsiderPhone" /></div>
            <div className="form-group"><label>Sexe</label>
              <select name="outsiderSex" defaultValue=""><option value="">—</option><option value="M">Masculin</option><option value="F">Féminin</option></select>
            </div>
            <button className="btn btn-primary">Inscrire</button>
          </form>
        </div>
      </div>

      {/* PROFS ASSIGNÉS */}
      <div className="table-container" style={{ marginBottom: '1.5rem' }}>
        <div className="table-header"><h3>Professeurs assignés</h3><span className="badge badge-primary">{teachings.length}</span></div>
        <div className="overflow-x">
          <table>
            <thead><tr><th>Professeur</th><th>Matière</th><th>Mode de paiement</th><th>Détails</th><th>Gain mensuel</th><th>Actions</th></tr></thead>
            <tbody>
              {teachings.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-muted" style={{ padding: '1.5rem' }}>Aucun professeur assigné.</td></tr>
              ) : teachings.map((cp) => {
                const fixe = cp.payKind === 'fixed';
                const gain = fixe ? Number(cp.fixedSalary) : Number(cp.hourlyRate) * cp.hoursPerMonth;
                return (
                  <tr key={cp.id}>
                    <td><strong>{cp.teacherName}</strong> {cp.internal ? <span className="badge badge-success">École</span> : <span className="badge badge-secondary">Externe</span>}</td>
                    <td>{cp.subject || '—'}</td>
                    <td><span className="badge badge-primary">{fixe ? 'Salaire stable' : 'Tarif horaire'}</span></td>
                    <td>{fixe ? 'Mensuel fixe' : `${mru(cp.hourlyRate)} MRU/h × ${cp.hoursPerMonth}h/mois`}</td>
                    <td><strong>{mru(gain)} MRU</strong></td>
                    <td>
                      {droits.mayManage && (
                        <form action={retirerAction} style={{ display: 'inline' }} onSubmit={(e) => { if (!confirm('Retirer ce professeur du groupe ?')) e.preventDefault(); }}>
                          <input type="hidden" name="teachingId" value={cp.id} />
                          <button className="btn btn-sm btn-danger">Retirer</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {droits.mayManage && (
          <div style={{ padding: '1.5rem', borderTop: '1px solid var(--border)' }}>
            <h4 id="assigner-prof" style={{ marginTop: 0, marginBottom: '1rem', scrollMarginTop: '1rem' }}>Assigner un nouveau professeur</h4>
            <form action={assignAction}>
              <input type="hidden" name="eveningGroupId" value={g.id} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div className="form-group">
                  <label>Source du professeur *</label>
                  <select name="source" id="prof_source_select" required value={profSource} onChange={(e) => setProfSource(e.target.value as 'interne' | 'externe')}>
                    <option value="interne">Professeur de l&apos;école (enregistré)</option>
                    <option value="externe">Professeur externe (hors école)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Matière *</label>
                  <input type="text" name="subject" placeholder="Ex: Mathématiques" required />
                </div>
              </div>

              {profSource === 'interne' && (
                <div className="form-group" id="prof_source_interne_box">
                  <label>Sélectionner le professeur *</label>
                  <select name="teacherId" id="prof_interne_id" required defaultValue="">
                    <option value="">— Sélectionner —</option>
                    {profsEcole.map((tp) => <option key={tp.id} value={tp.id}>{tp.nom}</option>)}
                  </select>
                </div>
              )}

              {profSource === 'externe' && (
                <div id="prof_source_externe_box" style={{ marginBottom: '1rem' }}>
                  <div className="form-group">
                    <label>Choisir ou créer un professeur externe *</label>
                    <select name="eveningTeacherId" id="prof_externe_id" required value={extChoice} onChange={(e) => setExtChoice(e.target.value)}>
                      <option value="">— Sélectionner un prof externe existant —</option>
                      <option value="nouveau">[ + Créer un nouveau professeur externe ]</option>
                      {profsExternes.map((tpe) => <option key={tpe.id} value={tpe.id}>{tpe.nom}</option>)}
                    </select>
                  </div>
                  {extChoice === 'nouveau' && (
                    <div id="nouveau_prof_externe_fields" style={{ display: 'grid', border: '1px dashed var(--primary)', padding: '1rem', borderRadius: 8, background: 'rgba(198,113,57,.02)', marginTop: '0.5rem', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div className="form-group" style={{ marginBottom: 0 }}><label>Prénom *</label><input type="text" name="ext_prenom" required /></div>
                      <div className="form-group" style={{ marginBottom: 0 }}><label>Nom *</label><input type="text" name="ext_nom" required /></div>
                      <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 2' }}><label>Téléphone</label><input type="text" name="ext_tel" /></div>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div className="form-group">
                  <label>Type de rémunération *</label>
                  <select name="payKind" id="type_salaire_select" required value={typeSal} onChange={(e) => setTypeSal(e.target.value as 'horaire' | 'fixe')}>
                    <option value="horaire">Rémunération horaire (Taux × Heures)</option>
                    <option value="fixe">Rémunération stable (Salaire mensuel fixe)</option>
                  </select>
                </div>
                {typeSal === 'fixe' && (
                  <div className="form-group" id="sal_fixe_box">
                    <label>Salaire stable (MRU) *</label>
                    <input type="number" name="fixedSalary" min={0} step={0.01} defaultValue={0} required />
                  </div>
                )}
              </div>

              {typeSal === 'horaire' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }} id="sal_horaire_box">
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>Taux horaire (MRU/h) *</label>
                    <input type="number" name="hourlyRate" min={0} step={0.01} defaultValue={0} required />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>Heures par mois prévues *</label>
                    <input type="number" name="hoursPerMonth" min={0} defaultValue={0} required />
                  </div>
                </div>
              )}

              <button className="btn btn-primary" style={{ width: 'auto' }}>✓ Enregistrer l&apos;assignation</button>
            </form>
          </div>
        )}
      </div>

      {/* EMPLOI DU TEMPS */}
      <div className="table-container">
        <div className="table-header"><h3>Emploi du temps (Grille des créneaux)</h3></div>
        <div className="overflow-x">
          <table style={{ minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={{ background: 'var(--bg)', fontWeight: 700, width: 120, textAlign: 'center' }}>Heures</th>
                {JOURS.map((j) => <th key={j} style={{ background: 'var(--primary)', color: '#fff', textAlign: 'center', fontWeight: 700 }}>{j}</th>)}
              </tr>
            </thead>
            <tbody>
              {CRENEAUX.map((cr, ci) => (
                <tr key={cr}>
                  <td style={{ background: 'var(--bg)', fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap' }}>{cr}</td>
                  {JOURS.map((j, ji) => {
                    const c = grille.get(`${ji + 1}:${ci + 1}`);
                    return (
                      <td key={j} style={{ verticalAlign: 'top', padding: '0.4rem', minWidth: 150 }}>
                        {c ? (
                          <div style={{ background: 'linear-gradient(135deg,#fff2eb,#ffe1d0)', padding: '.6rem', borderRadius: 8, borderLeft: '4px solid var(--primary)', position: 'relative' }}>
                            <strong style={{ display: 'block', color: 'var(--primary)', fontSize: '.85rem', marginBottom: '.2rem' }}>{c.subject}</strong>
                            <small style={{ color: 'var(--text-light)', display: 'block', fontSize: '.75rem' }}>{c.teacherName || '—'}</small>
                            {droits.mayManage && (
                              <form action={effacerAction} style={{ marginTop: '.4rem', textAlign: 'right' }} onSubmit={(e) => { if (!confirm('Effacer ce créneau ?')) e.preventDefault(); }}>
                                <input type="hidden" name="groupId" value={g.id} />
                                <input type="hidden" name="dayOfWeek" value={ji + 1} />
                                <input type="hidden" name="slot" value={ci + 1} />
                                <button className="btn btn-sm btn-danger" style={{ fontSize: '.65rem', padding: '.15rem .35rem', borderRadius: 4 }}>✕ Supprimer</button>
                              </form>
                            )}
                          </div>
                        ) : droits.mayManage ? (
                          <button
                            type="button"
                            className="no-print"
                            onClick={() => { setPlMatiere(''); setPlEns(''); setModalPl({ jour: j, creneau: cr }); }}
                            style={{ width: '100%', height: 55, background: '#fafafa', border: '2px dashed var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-muted)', fontSize: '.75rem', transition: '.2s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            onMouseOver={(e) => { e.currentTarget.style.background = '#fff2eb'; e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
                            onMouseOut={(e) => { e.currentTarget.style.background = '#fafafa'; e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                          >
                            + Ajouter
                          </button>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modale Placement Emploi du Temps */}
      <div className="modal-overlay" id="modale-placement" style={{ ...overlay, display: modalPl ? 'flex' : 'none', opacity: 1, visibility: 'visible' }}>
        <div className="form-card" style={{ maxWidth: 480, width: '100%', background: '#fff', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>Assigner un cours</h3>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setModalPl(null)} style={{ padding: '.2rem .4rem' }}>✕</button>
          </div>
          <form action={placerAction}>
            <input type="hidden" name="groupId" value={g.id} />
            <input type="hidden" name="dayOfWeek" value={modalPl ? JOURS.indexOf(modalPl.jour) + 1 : ''} />
            <input type="hidden" name="slot" value={modalPl ? CRENEAUX.indexOf(modalPl.creneau) + 1 : ''} />
            <input type="hidden" name="jourLabel" value={modalPl?.jour ?? ''} />
            <input type="hidden" name="creneauLabel" value={modalPl?.creneau ?? ''} />
            <p className="text-muted" style={{ fontSize: '.85rem', marginBottom: '1.2rem' }}>
              Créneau : <strong id="pl_label">{modalPl ? `${modalPl.jour} @ ${modalPl.creneau}` : ''}</strong>
            </p>
            {teachings.length === 0 ? (
              <div className="alert alert-warning" style={{ fontSize: '.85rem' }}>
                Aucune matière n&apos;a encore été créée pour ce groupe : un créneau
                se pose sur une matière, et une matière naît de l&apos;assignation
                d&apos;un professeur.
                <div style={{ marginTop: '.7rem' }}>
                  <a href="#assigner-prof" className="btn btn-sm btn-primary" onClick={() => setModalPl(null)}>
                    Assigner un professeur &amp; créer la matière →
                  </a>
                </div>
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label>Matière * <small className="text-muted">(matières créées pour ce groupe)</small></label>
                  <select
                    name="subject"
                    id="pl_matiere"
                    required
                    value={plMatiere}
                    onChange={(e) => {
                      const mat = e.target.value;
                      setPlMatiere(mat);
                      // Son `majEnseignantsPlacement` : un seul professeur pour cette matière → choisi d'office.
                      const candidats = teachings.filter((t) => t.subject === mat);
                      const courant = teachings.find((t) => t.id === plEns);
                      if (courant && mat && courant.subject !== '' && courant.subject !== mat) setPlEns('');
                      if (mat && candidats.length === 1 && !plEns) setPlEns(candidats[0]!.id);
                    }}
                  >
                    <option value="">— Choisir la matière —</option>
                    {matieresDispo.map((mn) => <option key={mn} value={mn}>{mn}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Enseignant <small className="text-muted">(professeurs enregistrés dans ce groupe)</small></label>
                  <select name="eveningTeachingId" id="pl_enseignant" value={plEns} onChange={(e) => setPlEns(e.target.value)}>
                    <option value="">— Aucun / à définir plus tard —</option>
                    {teachings.map((cp) => (
                      <option key={cp.id} value={cp.id} hidden={Boolean(plMatiere) && cp.subject !== '' && cp.subject !== plMatiere}>
                        {cp.teacherName}{cp.subject ? ` — ${cp.subject}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
              {teachings.length > 0 && <button type="submit" className="btn btn-primary">Valider</button>}
              <button type="button" className="btn btn-secondary" onClick={() => setModalPl(null)}>Annuler</button>
            </div>
          </form>
        </div>
      </div>

      {/* Modale réduction CS (admin) */}
      {!droits.comptable && droits.mayAdminister && (
        <div id="modal_csred" style={{ ...overlay, display: modalRed ? 'flex' : 'none' }}>
          <div className="form-card" style={{ maxWidth: 440, width: '100%', background: '#fff' }}>
            <h3 style={{ marginTop: 0 }}>Réduction — Cours du soir</h3>
            <p id="csred_info" className="text-muted">{modalRed ? `${modalRed.nom} — tarif mensuel : ${loc(tarif)} MRU` : ''}</p>
            <form action={redAction}>
              <input type="hidden" name="enrolmentId" value={modalRed?.insc ?? ''} />
              <input type="hidden" name="year" value={anneeCourante} />
              <div style={{ marginBottom: '.5rem' }}><label>Mois</label>
                <select name="month" required defaultValue={String(detail.moisDus.includes(moisActuel) ? moisActuel : detail.moisDus[0] ?? 1)}>
                  {detail.moisDus.map((m) => <option key={m} value={m}>{MOIS_NOMS[m]}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Montant de la réduction (MRU) *</label>
                <input type="number" name="amount" id="csred_montant" min={1} step={1} max={tarif} required placeholder="Ex : 1000" />
                <small className="text-muted">L&apos;inscrit ne paiera que : tarif mensuel − réduction.</small>
              </div>
              <div className="form-group">
                <label>Motif</label>
                <input type="text" name="reason" maxLength={255} placeholder="Ex : fratrie, situation sociale…" />
              </div>
              <div style={{ display: 'flex', gap: '.5rem', marginTop: '1rem' }}>
                <button className="btn btn-primary">✓ Appliquer</button>
                <button type="button" className="btn btn-secondary" onClick={() => setModalRed(null)}>Annuler</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modale paiement CS */}
      <div id="modal_cspay" style={{ ...overlay, display: modalPay ? 'flex' : 'none' }}>
        <div className="form-card" style={{ maxWidth: 460, width: '100%', background: '#fff' }}>
          <h3 style={{ marginTop: 0 }}>Paiement cours du soir</h3>
          <p id="cspay_info" className="text-muted">{infoPay()}</p>
          <form action={payAction}>
            <input type="hidden" name="enrolmentId" value={modalPay?.insc ?? ''} />
            <input type="hidden" name="calendarYear" value={anneeCourante} />
            <input type="hidden" name="tender" value={JSON.stringify(lignesPay)} />
            <div style={{ marginBottom: '.5rem' }}><label>Mois</label>
              <select name="calendarMonth" required value={payMois} onChange={(e) => setPayMois(Number(e.target.value))}>
                {detail.moisDus.map((m) => <option key={m} value={m}>{MOIS_NOMS[m]}</option>)}
              </select>
            </div>
            <MoyensPaiement moyens={moyens} cible={String(resteDu())} lignes={lignesPay} onChange={setLignesPay} currency="MRU" sens="entrant" />
            <div style={{ display: 'flex', gap: '.5rem', marginTop: '1rem' }}>
              <button className="btn btn-primary" disabled={payPending}>✓ Valider</button>
              <button type="button" className="btn btn-secondary" onClick={() => setModalPay(null)}>Annuler</button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
