'use client';

import { useEffect, useState } from 'react';
import {
  applyDiscountAction,
  caissePaiementAction,
  changeMonthlyFeeAction,
  exemptAnnualFeeAction,
  exemptStudentAction,
  liftAutoExemptionAction,
  liftExemptionAction,
  payGlobalAction,
  payerFraisAnnuelAction,
  reExemptMonthAction,
  removeAnnualFeeExemptionAction,
  removeDiscountAction,
  reversePaymentAction,
  revokeWriteOffAction,
  setAnnualFeeScaleAction,
  writeOffAction,
} from '@/app/actions';
import { MessagePage, useActionMessage } from '@/components/message-page';
import { MoyensPaiement, type LigneMoyen, type Moyen, fr } from '@/components/moyens-paiement';
import { MOIS_NOMS } from '@/lib/mois';
import { money, sum, toStorage } from '@elourwa/shared/money';
import { FenetreEncaissement, type FenetreData } from '@/components/fenetre-encaissement';
import type { CatalogueFacturation } from '@/components/choix-facturation';
import {
  BlocServices,
  LigneEcheance,
  cleEcheance,
  type AbonnementFiche,
  type LigneServiceEnfant,
  type LigneServiceMois,
} from './services-enfant';

const mru = (v: string | number) => fr(Number(v));
const loc = (v: string | number) => Number(v).toLocaleString('fr-FR');
const dmy = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const dmyhm = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dmy(iso)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export interface Mois {
  month: number;
  year: number;
  label: string;
  state: 'paid' | 'partial' | 'exempt' | 'due' | 'invoice';
  due: string;
  paid: string;
  fullRate: string;
  discount: string | null;
  paymentId: string | null;
  receiptNumber: string | null;
  autoExempt: boolean;
  autoLifted?: boolean;
  /** École « services » (§7) : les échéances de service de ce mois ; absent ou [] sinon. */
  services?: LigneServiceMois[];
}

export interface Enfant {
  studentId: string;
  name: string;
  matricule: string | null;
  levelName: string | null;
  groupName: string | null;
  monthlyFee: string;
  fullRate: string;
  isFree: boolean;
  exemptFull: boolean;
  entryDate: string | null;
  firstBillable: string | null;
  months: Mois[];
  /** École « services » (§7) : le mode d'étude, les abonnements, les échéances annuelles. */
  studyMode?: string | null;
  services?: AbonnementFiche[];
  annualServices?: LigneServiceEnfant[];
  /** Les identifiants des exemptions, pour « Retirer ». */
  exemptFullId: string | null;
  exemptMonthIds: Record<string, string>;
  discountReasons: Record<string, string | null>;
}

export interface Remise {
  id: string;
  amount: string;
  clears_all: boolean;
  reason: string | null;
  created_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  granted_by_name: string | null;
  year_label: string | null;
  revoked_by_name: string | null;
}

export interface Frais {
  kind: 'enrolment' | 'photocopy';
  label: string;
  scale: string;
  paid: string;
  remaining: string;
  exempt: boolean;
}

export interface PaiementAnnuel {
  id: string;
  kind: string;
  label: string;
  amount: string;
  receipt_number: string | null;
  paid_at: string;
}

type Result = { ok?: string; error?: string } | null;

/** Un formulaire POST à confirmation, comme ses `onsubmit="return confirm(…)"`. */
function FormConfirm({
  action,
  confirmation,
  children,
  style,
}: {
  action: (formData: FormData) => void;
  confirmation?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <form
      action={action}
      style={style ?? { display: 'inline' }}
      onSubmit={(e) => {
        if (confirmation && !confirm(confirmation)) e.preventDefault();
      }}
    >
      {children}
    </form>
  );
}

/** Rattache l'état d'une action au `$message` de la page. */
function useAction(fn: (prev: unknown, form: FormData) => Promise<Result>) {
  const [state, action, pending] = useActionMessage(fn);

  return { state, action, pending };
}

/**
 * LE PROFIL DE PAIEMENT D'UN CORRESPONDANT — `gestion_caisse.php?parent_id=…`,
 * de « ← Tous les correspondants » à la dernière modale.
 */
export function CaisseProfil(props: {
  guardianId: string;
  peutAdministrer: boolean;
  comptable: boolean;
  parent: { full_name: string; phone: string | null };
  anneeCourante: number;
  academicYearId: string;
  yearLabel: string;
  anneesPar: { annee: number; tag: string }[];
  enfAn: { id: string; nom: string; frais: string; gratuit: boolean; classe: string | null }[];
  mensAn: string;
  nbGratuits: number;
  dette: { total: string; scolarite: string; divers: string; services?: string };
  remises: Remise[];
  frais: Frais[];
  paiementsAnnuels: PaiementAnnuel[];
  enfants: Enfant[];
  moisPeriode: { mois: number; annee: number }[];
  moyens: Moyen[];
  /** La fenêtre d'encaissement de chaque enfant (mois de l'année, frais) — 0040. */
  fenetres: Record<string, FenetreData>;
  /** Les boutons « Modifier le correspondant / Fiche de … » du dossier de la famille. */
  dossier?: React.ReactNode;
  /** Le message porté depuis « Réinscriptions » (son `$_SESSION['flash_reinscription']`). */
  flash?: string | null;
  /** Le nom du frais « photocopie » de l'école (El Mourad : « Frais Graytna ») — lu côté serveur. */
  libellePhotocopie?: string;
  /**
   * École « services » (Jinan, spécification §7) : pas de frais annuels par
   * famille ; par enfant, le mode, le bloc « Services », les échéances de
   * service dans les cartes de mois. Faux : la fiche d'El Ourwa, inchangée.
   */
  facturationServices?: boolean;
  /** Les prix de l'année, pour « Ajouter un service ». */
  catalogue?: CatalogueFacturation | null;
  /** Qui tient la caisse (`finance.encaisser`) : cocher, encaisser, ajouter un service. */
  peutEncaisser?: boolean;
}) {
  const {
    guardianId, peutAdministrer, comptable, parent, anneeCourante, academicYearId, anneesPar,
    enfAn, mensAn, nbGratuits, dette, remises, frais, paiementsAnnuels, enfants, moisPeriode, moyens,
  } = props;
  const totalDette = Number(dette.total);

  return (
    <MessagePage initial={props.flash ? { type: 'success', texte: props.flash } : null}>
      <Profil {...props} totalDette={totalDette} />
    </MessagePage>
  );
}

function Profil(props: Parameters<typeof CaisseProfil>[0] & { totalDette: number }) {
  const {
    guardianId, peutAdministrer, comptable, parent, anneeCourante, academicYearId, anneesPar,
    enfAn, mensAn, nbGratuits, dette, remises, frais, paiementsAnnuels, enfants, moisPeriode, moyens,
    fenetres, dossier, totalDette,
  } = props;
  const libellePhotocopie = props.libellePhotocopie ?? 'Frais de photocopie';

  // LA SÉLECTION DE MOIS (0040) : une case sur chaque mois dû, par enfant, et
  // « Encaisser la sélection » qui ouvre la fenêtre avec ces mois cochés — un
  // seul reçu pour le tout, frais annuels compris si on les coche là.
  const [selection, setSelection] = useState<Record<string, Set<string>>>({});
  const [fenetreOuverte, setFenetreOuverte] = useState<{ studentId: string; mois: { mois: number; annee: number }[]; services?: string[] } | null>(null);
  // École « services » : les échéances de service cochées, par enfant.
  const [selectionServices, setSelectionServices] = useState<Record<string, Set<string>>>({});
  const basculerService = (studentId: string, cle: string) =>
    setSelectionServices((s) => {
      const n = new Set(s[studentId] ?? []);
      if (n.has(cle)) n.delete(cle); else n.add(cle);
      return { ...s, [studentId]: n };
    });
  const facturationServices = props.facturationServices === true;
  const peutEncaisser = props.peutEncaisser ?? true;
  const basculer = (studentId: string, cle: string) =>
    setSelection((s) => {
      const n = new Set(s[studentId] ?? []);
      if (n.has(cle)) n.delete(cle); else n.add(cle);
      return { ...s, [studentId]: n };
    });

  const fenetre = fenetreOuverte ? fenetres[fenetreOuverte.studentId] : null;
  const remiseAct = useAction(writeOffAction);
  const annulerRemiseAct = useAction(revokeWriteOffAction);
  const fraisScaleAct = useAction(setAnnualFeeScaleAction);
  const exemptFraisAct = useAction(exemptAnnualFeeAction);
  const retirerExemptFraisAct = useAction(removeAnnualFeeExemptionAction);
  const payerFraisAct = useAction(payerFraisAnnuelAction);
  const globalAct = useAction(payGlobalAction);
  const paiementAct = useAction(caissePaiementAction);
  const modifFraisAct = useAction(changeMonthlyFeeAction);
  const reductionAct = useAction(applyDiscountAction);
  const retirerReductionAct = useAction(removeDiscountAction);
  const exemptAct = useAction(exemptStudentAction);
  const retirerExemptAct = useAction(liftExemptionAction);
  const annulerPaiementAct = useAction(reversePaymentAction);
  const annulerAutoAct = useAction(liftAutoExemptionAction);
  const retablirAutoAct = useAction(reExemptMonthAction);

  const [blocRemise, setBlocRemise] = useState(false);
  const [exemptOuvert, setExemptOuvert] = useState<Record<string, boolean>>({});
  const [detailsFrais, setDetailsFrais] = useState(false);

  // Les modales et leurs `ouvrir…()`.
  const [modalPaiement, setModalPaiement] = useState<{
    eid: string; mois: number; moisNom: string; frais: string; nom: string; anMois: number;
  } | null>(null);
  const [lignesPaiement, setLignesPaiement] = useState<LigneMoyen[]>([]);
  const [modalGlobal, setModalGlobal] = useState<{ dette: string } | null>(null);
  const [lignesGlobal, setLignesGlobal] = useState<LigneMoyen[]>([]);
  const [modalFraisAnnuel, setModalFraisAnnuel] = useState<{
    type: 'enrolment' | 'photocopy'; label: string; reste: string;
  } | null>(null);
  const [lignesFraisAnnuel, setLignesFraisAnnuel] = useState<LigneMoyen[]>([]);
  const [modalFrais, setModalFrais] = useState<{ eid: string; nom: string; frais: string } | null>(null);
  const [modalReduction, setModalReduction] = useState<{
    eid: string; mois: number; moisNom: string; frais: string; nom: string; anMois: number;
  } | null>(null);

  // Sa page se rend à nouveau après un POST : les modales sont refermées.
  useEffect(() => { if (paiementAct.state) setModalPaiement(null); }, [paiementAct.state]);
  useEffect(() => { if (globalAct.state) setModalGlobal(null); }, [globalAct.state]);
  useEffect(() => { if (payerFraisAct.state) setModalFraisAnnuel(null); }, [payerFraisAct.state]);
  useEffect(() => { if (modifFraisAct.state) setModalFrais(null); }, [modifFraisAct.state]);
  useEffect(() => { if (reductionAct.state) setModalReduction(null); }, [reductionAct.state]);

  function ouvrirPaiement(eid: string, mois: number, moisNom: string, frais: string, nom: string, anMois: number) {
    setModalPaiement({ eid, mois, moisNom, frais, nom, anMois });
    setLignesPaiement([{ moyenId: '', montant: String(Number(frais)) }]);
  }
  function ouvrirPaiementGlobal(detteMontant: string) {
    setModalGlobal({ dette: detteMontant });
    const d = Number(detteMontant);
    setLignesGlobal([{ moyenId: '', montant: d > 0 ? String(d) : '' }]);
  }
  function ouvrirFraisAnnuel(type: 'enrolment' | 'photocopy', label: string, reste: string) {
    setModalFraisAnnuel({ type, label, reste });
    setLignesFraisAnnuel([{ moyenId: '', montant: String(Number(reste)) }]);
  }

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', alignItems: 'center',
    justifyContent: 'center', padding: '1rem',
  };
  const petitChamp: React.CSSProperties = { width: 160 };

  return (
    <>
      {fenetre && fenetreOuverte && (
        <FenetreEncaissement
          key={`${fenetreOuverte.studentId}-${fenetreOuverte.mois.map((m) => `${m.annee}-${m.mois}`).join(',')}-${(fenetreOuverte.services ?? []).join(',')}`}
          data={fenetre}
          moyens={moyens}
          titre="Encaisser — un seul reçu"
          sousTitre={`${fenetre.eleve.niveau_nom ?? '—'} / ${fenetre.eleve.groupe_nom ?? ''} · ${fenetre.annee.label}`}
          lienTerminer={`/finance/${guardianId}`}
          libelleTerminer="Annuler"
          preselection={fenetreOuverte.mois}
          {...(fenetreOuverte.services ? { preselectionServices: fenetreOuverte.services } : {})}
          onFermer={() => setFenetreOuverte(null)}
        />
      )}
      <a href="/finance" className="btn btn-secondary" style={{ marginBottom: '1rem' }}>
        ← Tous les correspondants
      </a>
      <div className="form-card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginTop: 0 }}>{parent.full_name}</h3>
        <form method="GET" className="no-print" style={{ display: 'inline-flex', gap: '.4rem', alignItems: 'center' }}>
          <label style={{ fontSize: '.8rem', color: 'var(--text-light)' }}>Année :</label>
          <select
            name="annee"
            defaultValue={String(anneeCourante)}
            style={{ padding: '.3rem .5rem' }}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
          >
            {anneesPar.map((ya) => (
              <option key={ya.annee} value={ya.annee}>
                {ya.annee}–{ya.annee + 1}{ya.tag}
              </option>
            ))}
          </select>
        </form>
        <h3 style={{ display: 'none' }}></h3>
        {dossier}
        <p className="text-muted" style={{ margin: '.25rem 0' }}>
          {parent.phone}
          &nbsp;·&nbsp; {enfAn.length} enfant(s) inscrit(s) en {anneeCourante}–{anneeCourante + 1} · Total
          mensuel : <strong>{mru(mensAn)} MRU</strong>{' '}
          {nbGratuits > 0 && (
            <span style={{ color: '#059669' }}>
              (dont {nbGratuits} exempté{nbGratuits > 1 ? 's' : ''} de scolarité)
            </span>
          )}
        </p>
        {enfAn.length > 0 && (
          <table style={{ width: '100%', fontSize: '.85rem', borderCollapse: 'collapse', marginTop: '.5rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-light)' }}>
                <th style={{ padding: '.25rem .5rem' }}>Élève</th>
                <th style={{ padding: '.25rem .5rem' }}>Mensualité</th>
                <th style={{ padding: '.25rem .5rem' }}>Situation</th>
              </tr>
            </thead>
            <tbody>
              {enfAn.map((x) => (
                <tr key={x.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '.25rem .5rem' }}>
                    {x.nom}
                    {x.classe && (
                      <span className="badge badge-secondary" style={{ marginLeft: '.35rem' }}>{x.classe}</span>
                    )}
                  </td>
                  <td style={{ padding: '.25rem .5rem' }}>{mru(x.frais)} MRU</td>
                  <td style={{ padding: '.25rem .5rem' }}>
                    {x.gratuit ? (
                      <span style={{ color: '#059669', fontWeight: 600 }}>Exempté — scolarité gratuite</span>
                    ) : (
                      <span style={{ color: 'var(--text-light)' }}>Tarif {mru(x.frais)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div
        className="form-card"
        style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}
      >
        <div>
          <h4 style={{ margin: 0, color: 'var(--text-light)' }}>Situation financière</h4>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: '.25rem', color: totalDette > 0.01 ? '#a8341f' : '#728157' }}>
            {totalDette > 0.01 ? `Dette : ${mru(totalDette)} MRU` : '✓ En règle (0 MRU)'}
          </div>
          {totalDette > 0.01 && (
            <small className="text-muted" style={{ display: 'block', marginTop: '.25rem' }}>
              Scolarité : {mru(dette.scolarite)} MRU · Divers : {mru(dette.divers)} MRU
              {facturationServices && dette.services !== undefined && <> · Services : {mru(dette.services)} MRU</>}
            </small>
          )}
        </div>
        <div>
          {/* Le règlement global ne répartit que sur les mois de scolarité : dans
              une école « services », il se pré-remplit de la seule scolarité due
              — les services s'encaissent en les cochant. */}
          <button type="button" className="btn btn-primary" onClick={() => ouvrirPaiementGlobal(facturationServices ? dette.scolarite : dette.total)}>
            {facturationServices ? 'Encaisser un règlement / avance (scolarité)' : 'Encaisser un règlement / avance'}
          </button>
          {Number(mensAn) > 0.005 && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginLeft: '.4rem', background: '#059669' }}
              onClick={() => ouvrirPaiementGlobal(mensAn)}
            >
              Payer la mensualité ({mru(mensAn)} MRU)
            </button>
          )}
          {totalDette > 0.01 && peutAdministrer && (
            <button type="button" className="btn btn-secondary" style={{ marginLeft: '.5rem' }} onClick={() => setBlocRemise((v) => !v)}>
              ⚖ Accorder une remise
            </button>
          )}
        </div>
      </div>

      {totalDette > 0.01 && peutAdministrer && (
        <div id="bloc-remise" className="form-card" style={{ display: blocRemise ? 'block' : 'none', marginBottom: '1.5rem', borderLeft: '3px solid #B45309' }}>
          <h4 style={{ marginTop: 0 }}>Abaisser ou annuler la dette</h4>
          <p className="text-muted" style={{ fontSize: '.85rem' }}>
            Pour les cas humains : difficulté familiale, accord d&apos;échelonnement, erreur historique. La remise{' '}
            <strong>réduit réellement la dette</strong> — elle se répercute sur les impayés et débloque la
            réinscription. Auteur, montant et motif sont enregistrés.
          </p>
          <form action={remiseAct.action} style={{ display: 'flex', gap: '.8rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <input type="hidden" name="guardianId" value={guardianId} />
            <div>
              <label htmlFor="rd-mode">Décision</label>
              <select id="rd-mode" name="mode" defaultValue="partiel">
                <option value="partiel">Retirer un montant</option>
                <option value="total">Annuler toute la dette ({mru(totalDette)} MRU)</option>
              </select>
            </div>
            <div>
              <label htmlFor="rd-montant">Montant (MRU)</label>
              <input type="number" id="rd-montant" name="amount" min="0" step="100" max={Math.trunc(totalDette)} placeholder="ex. 5000" />
            </div>
            <div style={{ flex: 1, minWidth: '12rem' }}>
              <label htmlFor="rd-motif">Motif</label>
              <input type="text" id="rd-motif" name="reason" maxLength={200} placeholder="Situation familiale, accord…" />
            </div>
            <button type="submit" className="btn btn-primary" disabled={remiseAct.pending}>Enregistrer la remise</button>
          </form>
        </div>
      )}

      {remises.length > 0 && (
        <div className="form-card" style={{ marginBottom: '1.5rem' }}>
          <h4 style={{ marginTop: 0 }}>Historique des remises</h4>
          <div className="overflow-x">
            <table style={{ width: '100%', fontSize: '.85rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-light)' }}>
                  <th style={{ padding: '.3rem .5rem' }}>Date</th>
                  <th style={{ padding: '.3rem .5rem' }}>Montant</th>
                  <th style={{ padding: '.3rem .5rem' }}>Année</th>
                  <th style={{ padding: '.3rem .5rem' }}>Motif</th>
                  <th style={{ padding: '.3rem .5rem' }}>Accordée par</th>
                  <th style={{ padding: '.3rem .5rem' }}>État</th>
                </tr>
              </thead>
              <tbody>
                {remises.map((h) => {
                  const revoquee = h.revoked_at !== null;
                  return (
                    <tr key={h.id} style={{ borderTop: '1px solid var(--border)', ...(revoquee ? { opacity: 0.6 } : {}) }}>
                      <td style={{ padding: '.3rem .5rem' }}>{dmy(h.created_at)}</td>
                      <td style={{ padding: '.3rem .5rem', ...(revoquee ? { textDecoration: 'line-through' } : {}) }}>
                        {h.clears_all ? 'Dette annulée' : `${mru(h.amount)} MRU`}
                      </td>
                      <td style={{ padding: '.3rem .5rem' }}>{h.year_label || 'toutes'}</td>
                      <td style={{ padding: '.3rem .5rem' }}>{h.reason || '—'}</td>
                      <td style={{ padding: '.3rem .5rem' }}>{h.granted_by_name || '—'}</td>
                      <td style={{ padding: '.3rem .5rem' }}>
                        {revoquee ? (
                          <>
                            <span className="badge" style={{ background: '#dcd3c4', color: '#374151' }}>Annulée</span>{' '}
                            <small className="text-muted">
                              le {dmy(h.revoked_at!)} par {h.revoked_by_name || '—'}
                              {h.revoked_reason ? ` · ${h.revoked_reason}` : ''}
                            </small>
                          </>
                        ) : peutAdministrer ? (
                          <FormConfirm action={annulerRemiseAct.action} confirmation="Annuler cette remise ? La dette sera rétablie.">
                            <input type="hidden" name="guardianId" value={guardianId} />
                            <input type="hidden" name="writeOffId" value={h.id} />
                            <input type="text" name="reason" placeholder="Motif" maxLength={200} style={{ width: '9rem', padding: '.15rem .3rem', fontSize: '.78rem' }} />{' '}
                            <button type="submit" className="btn btn-secondary" style={{ padding: '.12rem .45rem', fontSize: '.75rem' }}>Annuler</button>
                          </FormConfirm>
                        ) : (
                          <span className="badge badge-success">Active</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== FRAIS ANNUELS ===== — une école « services » n'en a pas par
          famille : ses frais d'inscription (par élève) et sa photocopie sont
          des services de chaque enfant, plus bas. */}
      {!facturationServices && (
      <div className="form-card" style={{ marginBottom: '1.5rem' }}>
        <h4 style={{ marginTop: 0 }}>Frais annuels</h4>
        {peutAdministrer && (
          <details style={{ marginBottom: '1rem' }} open={detailsFrais} onToggle={(e) => setDetailsFrais(e.currentTarget.open)}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--primary)' }}>Configurer les montants (admin)</summary>
            <form action={fraisScaleAct.action} style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '.75rem' }}>
              <input type="hidden" name="academicYearId" value={academicYearId} />
              <input type="hidden" name="anneeLabel" value={`${anneeCourante}-${anneeCourante + 1}`} />
              <div>
                <label>Frais d&apos;inscription (MRU)</label>
                <input type="number" name="enrolment" defaultValue={String(Math.round(Number(frais.find((f) => f.kind === 'enrolment')?.scale ?? 0)))} min="0" step="1" style={{ width: 140 }} />
              </div>
              <div>
                <label>{libellePhotocopie} (MRU)</label>
                <input type="number" name="photocopy" defaultValue={String(Math.round(Number(frais.find((f) => f.kind === 'photocopy')?.scale ?? 0)))} min="0" step="1" style={{ width: 140 }} />
              </div>
              <button className="btn btn-sm btn-primary" disabled={fraisScaleAct.pending}>Enregistrer</button>
            </form>
          </details>
        )}

        {(['enrolment', 'photocopy'] as const).map((fkey) => {
          const f = frais.find((x) => x.kind === fkey);
          const flabel = fkey === 'enrolment' ? "Frais d'inscription" : libellePhotocopie;
          const fmontant = Number(f?.scale ?? 0);
          const paye = Number(f?.paid ?? 0);
          const reste = Math.max(0, fmontant - paye);
          const isExempt = Boolean(f?.exempt);
          return (
            <div key={fkey} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem', padding: '.75rem', border: '1px solid #dcd3c4', borderRadius: 8, marginBottom: '.75rem', background: '#FAFAFA' }}>
              <div>
                <strong>{flabel}</strong>
                <span style={{ marginLeft: '.5rem', fontSize: '.9rem' }}>
                  Montant : <strong>{mru(fmontant)} MRU</strong>
                </span>
                {isExempt ? (
                  <span className="badge" style={{ background: '#fef3c7', color: '#92400e', marginLeft: '.5rem' }}>Exempté</span>
                ) : fmontant > 0 && paye >= fmontant - 0.01 ? (
                  <span className="badge" style={{ background: '#ECFDF5', color: '#728157', marginLeft: '.5rem' }}>✓ Payé ({mru(paye)} MRU)</span>
                ) : fmontant > 0 && paye > 0 ? (
                  <span className="badge" style={{ background: '#FEF3C7', color: '#D97706', marginLeft: '.5rem' }}>Partiel: {mru(paye)} / {mru(fmontant)} MRU</span>
                ) : fmontant > 0 ? (
                  <span className="badge" style={{ background: '#FEF2F2', color: '#a8341f', marginLeft: '.5rem' }}>Non payé</span>
                ) : (
                  <span className="text-muted" style={{ marginLeft: '.5rem', fontSize: '.85rem' }}>Non défini</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                {!isExempt && fmontant > 0 && reste > 0.01 && (
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => ouvrirFraisAnnuel(fkey, flabel, reste.toFixed(2))}>
                    Encaisser
                  </button>
                )}
                {peutAdministrer &&
                  (isExempt ? (
                    <FormConfirm action={retirerExemptFraisAct.action} confirmation="Retirer l'exemption ?">
                      <input type="hidden" name="guardianId" value={guardianId} />
                      <input type="hidden" name="kind" value={fkey} />
                      <input type="hidden" name="academicYearId" value={academicYearId} />
                      <input type="hidden" name="anneeLabel" value={`${anneeCourante}-${anneeCourante + 1}`} />
                      <button className="btn btn-sm btn-danger">Retirer exemption</button>
                    </FormConfirm>
                  ) : (
                    <FormConfirm action={exemptFraisAct.action} confirmation={`Exempter ce correspondant de « ${flabel} » ?`}>
                      <input type="hidden" name="guardianId" value={guardianId} />
                      <input type="hidden" name="kind" value={fkey} />
                      <input type="hidden" name="academicYearId" value={academicYearId} />
                      <input type="hidden" name="anneeLabel" value={`${anneeCourante}-${anneeCourante + 1}`} />
                      <button className="btn btn-sm btn-secondary">Exempter</button>
                    </FormConfirm>
                  ))}
              </div>
            </div>
          );
        })}

        {paiementsAnnuels.length > 0 && (
          <details style={{ marginTop: '.5rem' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '.9rem' }}>
              Historique des paiements annuels ({paiementsAnnuels.length})
            </summary>
            <div className="overflow-x" style={{ marginTop: '.5rem' }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Montant</th>
                    <th>Reçu</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {paiementsAnnuels.map((ap) => (
                    <tr key={ap.id}>
                      <td>{dmyhm(ap.paid_at)}</td>
                      <td>{ap.kind === 'enrolment' ? "Frais d'inscription" : libellePhotocopie}</td>
                      <td>
                        <strong style={{ color: '#728157' }}>{mru(ap.amount)} MRU</strong>
                      </td>
                      <td>{ap.receipt_number}</td>
                      <td>
                        {/* Son lien est un bouton sans texte. */}
                        <a href={`/finance/recu/annuel/${ap.id}`} target="_blank" rel="noopener" className="btn btn-sm btn-secondary" data-print aria-label="Imprimer le reçu"></a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
      )}

      {enfants.length === 0 ? (
        <div className="alert alert-info">Ce correspondant n&apos;a aucun enfant inscrit.</div>
      ) : (
        <>
          {enfants.map((enf) => {
            const exemptTotale = enf.exemptFull || enf.isFree;
            return (
              <div key={enf.studentId} className="form-card" style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                  {enf.name}
                  <span className="text-muted" style={{ fontWeight: 400, fontSize: '.9rem' }}>
                    — {enf.levelName ?? '—'} / {enf.groupName ?? ''}
                    {' · '}{enf.matricule ?? ''}
                    {' · '}{mru(enf.monthlyFee)} MRU/mois
                  </span>
                  {peutAdministrer && (
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      style={{ padding: '.15rem .5rem', fontSize: '.75rem' }}
                      title="Modifier le frais mensuel de cet étudiant"
                      onClick={() => setModalFrais({ eid: enf.studentId, nom: enf.name, frais: enf.monthlyFee })}
                    >
                      Frais
                    </button>
                  )}
                  {exemptTotale && (
                    <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>Exempté (total)</span>
                  )}
                </h4>
                {facturationServices && (
                  <BlocServices
                    studentId={enf.studentId}
                    studyMode={enf.studyMode ?? null}
                    abonnements={enf.services ?? []}
                    annuelles={enf.annualServices ?? []}
                    catalogue={props.catalogue ?? null}
                    academicYearId={academicYearId}
                    moisPeriode={moisPeriode}
                    peutAdministrer={peutAdministrer}
                    peutEncaisser={peutEncaisser && Boolean(fenetres[enf.studentId])}
                    selection={selectionServices[enf.studentId] ?? new Set()}
                    onCocher={(cle) => basculerService(enf.studentId, cle)}
                  />
                )}
                <p className="text-muted" style={{ margin: '.15rem 0 .6rem', fontSize: '.82rem' }}>
                  Inscrit le <strong>{enf.entryDate ?? '—'}</strong>
                  {enf.firstBillable && (
                    <>
                      {' · '}
                      <span title="Règle : une inscription après le 25 exempte aussi le mois en cours.">
                        1er mois dû : <strong>{enf.firstBillable}</strong>
                      </span>
                    </>
                  )}
                </p>

                {peutAdministrer && (
                  <div style={{ margin: '.5rem 0' }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => setExemptOuvert((s) => ({ ...s, [enf.studentId]: !s[enf.studentId] }))}
                    >
                      Exemption du frais
                    </button>
                    <div
                      style={{
                        display: exemptOuvert[enf.studentId] ? 'block' : 'none',
                        marginTop: '.6rem', padding: '.75rem', border: '1px dashed #d1d5db', borderRadius: 8, background: '#fafafa',
                      }}
                    >
                      {exemptTotale ? (
                        <>
                          <p style={{ margin: '.25rem 0' }}>
                            Cet étudiant bénéficie d&apos;une <strong>exemption totale</strong>.
                          </p>
                          {enf.exemptFullId && (
                            <FormConfirm action={retirerExemptAct.action} confirmation="Retirer l'exemption totale ?">
                              <input type="hidden" name="exemptionId" value={enf.exemptFullId} />
                              <button className="btn btn-sm btn-danger">Retirer l&apos;exemption totale</button>
                            </FormConfirm>
                          )}
                        </>
                      ) : (
                        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                          <FormConfirm
                            action={exemptAct.action}
                            confirmation="Appliquer une exemption TOTALE ? L'étudiant n'aura plus à payer."
                            style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}
                          >
                            <input type="hidden" name="kind" value="full" />
                            <input type="hidden" name="studentId" value={enf.studentId} />
                            <input type="text" name="reason" placeholder="Motif (optionnel)" style={petitChamp} />
                            <button className="btn btn-sm btn-primary">Exemption totale</button>
                          </FormConfirm>
                          <form action={exemptAct.action} style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <input type="hidden" name="kind" value="monthly" />
                            <input type="hidden" name="studentId" value={enf.studentId} />
                            <select name="periode" required defaultValue="">
                              <option value="">— Mois —</option>
                              {moisPeriode.map((x) => (
                                <option key={`${x.annee}-${x.mois}`} value={`${x.annee}-${x.mois}`}>
                                  {MOIS_NOMS[x.mois]} {x.annee}
                                </option>
                              ))}
                            </select>
                            <input type="text" name="reason" placeholder="Motif (optionnel)" style={{ width: 140 }} />
                            <button className="btn btn-sm btn-primary">Exemption d&apos;un mois</button>
                          </form>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {exemptTotale && !(facturationServices && (enf.services ?? []).length > 0) ? (
                  <div className="alert alert-info" style={{ margin: '.5rem 0' }}>
                    Profil exempté — aucun paiement mensuel requis.
                  </div>
                ) : (
                  <>
                  {exemptTotale && (
                    <div className="alert alert-info" style={{ margin: '.5rem 0' }}>
                      Scolarité exemptée — les services restent dus.
                    </div>
                  )}
                  {fenetres[enf.studentId] && (() => {
                    const coches = [...(selection[enf.studentId] ?? [])];
                    const encaissables = enf.months.filter((m) => m.state === 'due' || m.state === 'partial');
                    // En décimal (règle 6), arrondi une fois, à l'affichage.
                    const restesMois = enf.months
                      .filter((m) => coches.includes(`${m.year}-${m.month}`))
                      .map((m) => {
                        const r = money(m.due).minus(money(m.paid));
                        return r.isNegative() ? '0' : r;
                      });
                    // École « services » : les échéances cochées (cartes de mois et lignes annuelles).
                    const echeances = [
                      ...enf.months.flatMap((m) => (m.services ?? []).map((l) => ({ cle: cleEcheance(l.studentServiceId, m.month, m.year), l }))),
                      ...(enf.annualServices ?? []).map((l) => ({
                        cle: cleEcheance(l.studentServiceId, l.periodicite === 'annuel' ? null : l.month, l.periodicite === 'annuel' ? null : l.year),
                        l,
                      })),
                    ];
                    const servicesCoches = echeances.filter((e) => selectionServices[enf.studentId]?.has(e.cle));
                    const totalSelection = toStorage(sum([...restesMois, ...servicesCoches.map((e) => e.l.outstanding)]));
                    const servicesEncaissables = echeances.some((e) => e.l.state === 'due' || e.l.state === 'partial');
                    const nbLignes = coches.length + servicesCoches.length;
                    return (
                      <div className="no-print" style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', margin: '.5rem 0 .6rem' }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          disabled={encaissables.length === 0 && !servicesEncaissables}
                          onClick={() =>
                            setFenetreOuverte({
                              studentId: enf.studentId,
                              mois: enf.months.filter((m) => coches.includes(`${m.year}-${m.month}`)).map((m) => ({ mois: m.month, annee: m.year })),
                              ...(facturationServices && servicesCoches.length > 0 ? { services: servicesCoches.map((e) => e.cle) } : {}),
                            })
                          }
                        >
                          Encaisser la sélection
                          {nbLignes > 0
                            ? ` — ${coches.length > 0 ? `${coches.length} mois` : ''}${coches.length > 0 && servicesCoches.length > 0 ? ' + ' : ''}${servicesCoches.length > 0 ? `${servicesCoches.length} service${servicesCoches.length > 1 ? 's' : ''}` : ''}, ${mru(totalSelection)} MRU`
                            : ''}
                        </button>
                        {encaissables.length > 1 && (
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={() => setSelection((s) => ({ ...s, [enf.studentId]: coches.length < encaissables.length ? new Set(encaissables.map((m) => `${m.year}-${m.month}`)) : new Set() }))}
                          >
                            {coches.length < encaissables.length ? 'Tout cocher' : 'Tout décocher'}
                          </button>
                        )}
                        <span className="text-muted" style={{ fontSize: '.8rem' }}>
                          {facturationServices
                            ? 'Cochez les mois et les services à régler : un seul reçu.'
                            : 'Cochez les mois à régler : un seul reçu, frais annuels compris si vous les cochez dans la fenêtre.'}
                        </span>
                      </div>
                    );
                  })()}
                  <div className="mois-grid">
                    {enf.months.map((m) => {
                      const cle = `${m.year}-${m.month}`;
                      const paye = Number(m.paid);
                      const du = Number(m.due);
                      const reduction = Number(m.discount ?? 0);
                      const exempteMois = m.state === 'exempt' && !m.autoExempt;
                      const etat =
                        m.state === 'exempt' ? 'is-exempt'
                        : m.state === 'paid' || m.state === 'invoice' ? 'is-paye'
                        : m.state === 'partial' ? 'is-partial' : 'is-due';
                      const rh = Number(enf.fullRate) - Number(enf.monthlyFee);
                      const tp = Number(enf.fullRate);
                      return (
                        <div key={cle} className={`mois-card ${etat}`}>
                          <div className="mois-nom" style={{ display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                            {(m.state === 'due' || m.state === 'partial') && fenetres[enf.studentId] && (
                              <input
                                type="checkbox"
                                title="Cocher pour l'encaisser avec d'autres mois — un seul reçu"
                                checked={selection[enf.studentId]?.has(cle) ?? false}
                                onChange={() => basculer(enf.studentId, cle)}
                              />
                            )}
                            <span>
                              {MOIS_NOMS[m.month]}{' '}
                              <span style={{ fontWeight: 400, opacity: 0.65, fontSize: '.8em' }}>{m.year}</span>
                            </span>
                          </div>
                          {reduction > 0.009 && (
                            <div style={{ fontSize: '.7rem', color: '#B45309', fontWeight: 700 }} title={enf.discountReasons[cle] ?? ''}>
                              Réduit : −{mru(reduction)}{' '}
                              {peutAdministrer && (
                                <FormConfirm action={retirerReductionAct.action} confirmation="Retirer la réduction de ce mois ?">
                                  <input type="hidden" name="studentId" value={enf.studentId} />
                                  <input type="hidden" name="calendarMonth" value={m.month} />
                                  <input type="hidden" name="calendarYear" value={m.year} />
                                  <button style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#B45309', padding: 0, fontSize: '.7rem' }} title="Retirer la réduction">✕</button>
                                </FormConfirm>
                              )}
                            </div>
                          )}
                          {m.state === 'exempt' && m.autoExempt ? (
                            <>
                              <div className="mois-etat" title="Mois antérieur à l'inscription/réinscription (règle du 25)">Exempté (avant inscription)</div>
                              {peutAdministrer && (
                                <FormConfirm
                                  action={annulerAutoAct.action}
                                  confirmation="Annuler l'exemption automatique ? Ce mois deviendra dû et comptera dans la dette."
                                  style={{ marginTop: '.25rem' }}
                                >
                                  <input type="hidden" name="studentId" value={enf.studentId} />
                                  <input type="hidden" name="academicYearId" value={academicYearId} />
                                  <input type="hidden" name="calendarMonth" value={m.month} />
                                  <input type="hidden" name="calendarYear" value={m.year} />
                                  <button className="btn btn-sm btn-secondary mois-btn" style={{ fontSize: '.68rem' }}>✕ Annuler l&apos;exemption</button>
                                </FormConfirm>
                              )}
                            </>
                          ) : exempteMois ? (
                            <>
                              <div className="mois-etat">Exempté</div>
                              {peutAdministrer && enf.exemptMonthIds[cle] && (
                                <FormConfirm action={retirerExemptAct.action} confirmation="Retirer l'exemption de ce mois ?">
                                  <input type="hidden" name="exemptionId" value={enf.exemptMonthIds[cle]} />
                                  <button className="btn btn-sm btn-secondary mois-btn">Annuler exempt.</button>
                                </FormConfirm>
                              )}
                            </>
                          ) : m.state === 'invoice' ? (
                            <>
                              <div className="mois-etat">✓ Réglé par facture</div>
                              <div style={{ fontSize: '.68rem', color: 'var(--text-muted)' }} title="Une facture globale de l'ancien logiciel couvrait plusieurs mois ; elle est soldée.">
                                versé sur ce mois : {mru(paye)}
                              </div>
                            </>
                          ) : m.state === 'paid' ? (
                            <>
                              <div className="mois-etat">✓ Payé ({mru(paye)})</div>
                              {rh > 0.009 && tp > 0.009 && (
                                <div style={{ fontSize: '.68rem', color: '#B45309', fontWeight: 600 }} title="Tarif convenu avec la famille, repris de l'ancien logiciel">
                                  Tarif réduit — plein : {mru(tp)} (−{mru(rh)})
                                </div>
                              )}
                              <div className="mois-actions">
                                {m.paymentId && (
                                  <a href={`/finance/recu/${m.paymentId}`} target="_blank" rel="noopener" className="btn btn-sm btn-secondary mois-btn" title="Imprimer le reçu">Reçu</a>
                                )}
                                {peutAdministrer && m.paymentId && (
                                  <FormConfirm action={annulerPaiementAct.action} confirmation="Annuler ce paiement ?">
                                    <input type="hidden" name="paymentId" value={m.paymentId} />
                                    <input type="hidden" name="reason" value={`Annulation — ${MOIS_NOMS[m.month]} ${m.year}`} />
                                    <button className="btn btn-sm btn-danger mois-btn" title="Annuler ce paiement">✕</button>
                                  </FormConfirm>
                                )}
                              </div>
                            </>
                          ) : m.state === 'partial' ? (
                            <>
                              <div className="mois-etat">Partiel ({mru(paye)} / {mru(du)})</div>
                              <div className="mois-actions" style={{ marginTop: 'auto', display: 'flex', gap: '.25rem', flexWrap: 'wrap' }}>
                                {m.paymentId && (
                                  <a href={`/finance/recu/${m.paymentId}`} target="_blank" rel="noopener" className="btn btn-sm btn-secondary mois-btn" title="Imprimer le reçu" style={{ flex: 1 }}>Reçu</a>
                                )}
                                {peutAdministrer && m.paymentId && (
                                  <FormConfirm action={annulerPaiementAct.action} confirmation="Annuler ce paiement ?" style={{ display: 'inline', flex: 1 }}>
                                    <input type="hidden" name="paymentId" value={m.paymentId} />
                                    <input type="hidden" name="reason" value={`Annulation — ${MOIS_NOMS[m.month]} ${m.year}`} />
                                    <button className="btn btn-sm btn-danger mois-btn" title="Annuler ce paiement" style={{ width: '100%' }}>✕</button>
                                  </FormConfirm>
                                )}
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary mois-btn-pay"
                                  style={{ padding: '.28rem .55rem', marginTop: '.25rem' }}
                                  onClick={() => ouvrirPaiement(enf.studentId, m.month, MOIS_NOMS[m.month]!, Math.max(0, du - paye).toFixed(2), enf.name, m.year)}
                                >
                                  Reste
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="mois-etat">En attente</div>
                              <button
                                type="button"
                                className="btn btn-sm btn-primary mois-btn-pay"
                                onClick={() => ouvrirPaiement(enf.studentId, m.month, MOIS_NOMS[m.month]!, du.toFixed(2), enf.name, m.year)}
                              >
                                Encaisser
                              </button>
                              {!comptable && reduction < 0.01 && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-secondary mois-btn"
                                  style={{ marginTop: '.25rem' }}
                                  onClick={() => setModalReduction({ eid: enf.studentId, mois: m.month, moisNom: MOIS_NOMS[m.month]!, frais: enf.monthlyFee, nom: enf.name, anMois: m.year })}
                                >
                                  Réduction
                                </button>
                              )}
                              {!comptable && m.autoLifted && (
                                <form action={retablirAutoAct.action} style={{ marginTop: '.25rem' }}>
                                  <input type="hidden" name="studentId" value={enf.studentId} />
                                  <input type="hidden" name="academicYearId" value={academicYearId} />
                                  <input type="hidden" name="calendarMonth" value={m.month} />
                                  <input type="hidden" name="calendarYear" value={m.year} />
                                  <button className="btn btn-sm btn-secondary mois-btn" style={{ fontSize: '.68rem' }} title="Ce mois était exempté automatiquement (avant inscription) ; l'exemption avait été annulée.">Rétablir l&apos;exemption</button>
                                </form>
                              )}
                            </>
                          )}
                          {facturationServices && (m.services ?? []).length > 0 && (
                            <div className="mois-services" style={{ marginTop: '.3rem' }}>
                              {(m.services ?? []).map((l) => {
                                const k = cleEcheance(l.studentServiceId, m.month, m.year);
                                return (
                                  <LigneEcheance
                                    key={k}
                                    ligne={l}
                                    libelleMois={`${MOIS_NOMS[m.month]} ${m.year}`}
                                    cle={k}
                                    cochee={selectionServices[enf.studentId]?.has(k) ?? false}
                                    onCocher={(c) => basculerService(enf.studentId, c)}
                                    peutAdministrer={peutAdministrer}
                                    peutEncaisser={peutEncaisser && Boolean(fenetres[enf.studentId])}
                                    compacte
                                  />
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  </>
                )}
              </div>
            );
          })}

          {/* Modale de modification du frais mensuel (admin) */}
          {peutAdministrer && (
            <div id="modal_frais" style={{ ...overlay, display: modalFrais ? 'flex' : 'none', zIndex: 1050 }}>
              <div className="form-card" style={{ maxWidth: 420, width: '100%', background: '#fff' }}>
                <h3 style={{ marginTop: 0 }}>Modifier le frais mensuel</h3>
                <p id="frais_info" className="text-muted">
                  {modalFrais && `${modalFrais.nom} — frais actuel : ${loc(modalFrais.frais)} MRU/mois`}
                </p>
                <form action={modifFraisAct.action} key={modalFrais?.eid ?? 'x'}>
                  <input type="hidden" name="studentId" value={modalFrais?.eid ?? ''} />
                  <input type="hidden" name="studentName" value={modalFrais?.nom ?? ''} />
                  <input type="hidden" name="academicYearId" value={academicYearId} />
                  <div className="form-group">
                    <label>Nouveau frais mensuel (MRU) *</label>
                    <input type="number" name="amount" min="0" step="1" required defaultValue={modalFrais ? String(Number(modalFrais.frais)) : ''} />
                    <small className="text-muted">
                      S&apos;applique à tous les mois : les mois déjà réglés à hauteur du nouveau montant apparaîtront « payés », les autres seront recalculés dans la dette.
                    </small>
                  </div>
                  <div style={{ display: 'flex', gap: '.5rem', marginTop: '1rem' }}>
                    <button className="btn btn-primary" disabled={modifFraisAct.pending}>✓ Enregistrer</button>
                    <button type="button" className="btn btn-secondary" onClick={() => setModalFrais(null)}>Annuler</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Modale de réduction (admin) */}
          {peutAdministrer && (
            <div id="modal_reduction" style={{ ...overlay, display: modalReduction ? 'flex' : 'none', zIndex: 1050 }}>
              <div className="form-card" style={{ maxWidth: 440, width: '100%', background: '#fff' }}>
                <h3 style={{ marginTop: 0 }}>Appliquer une réduction</h3>
                <p id="red_info" className="text-muted">
                  {modalReduction && `${modalReduction.nom} — ${modalReduction.moisNom} · frais mensuel : ${loc(modalReduction.frais)} MRU`}
                </p>
                <form action={reductionAct.action} key={modalReduction ? `${modalReduction.eid}-${modalReduction.anMois}-${modalReduction.mois}` : 'x'}>
                  <input type="hidden" name="studentId" value={modalReduction?.eid ?? ''} />
                  <input type="hidden" name="studentName" value={modalReduction?.nom ?? ''} />
                  <input type="hidden" name="periode" value={modalReduction ? `${modalReduction.anMois}-${modalReduction.mois}` : ''} />
                  <div className="form-group">
                    <label>Montant de la réduction (MRU) *</label>
                    <input type="number" name="amount" min="1" step="1" required placeholder="Ex : 2000" max={modalReduction ? Number(modalReduction.frais) : undefined} />
                    <small className="text-muted">Le parent ne paiera que : frais mensuel − réduction. Aucune dette ne sera enregistrée sur la partie réduite.</small>
                  </div>
                  <div className="form-group">
                    <label>Motif</label>
                    <input type="text" name="reason" placeholder="Ex : situation sociale, fratrie…" maxLength={255} />
                  </div>
                  <div style={{ display: 'flex', gap: '.5rem', marginTop: '1rem' }}>
                    <button className="btn btn-primary" disabled={reductionAct.pending}>✓ Appliquer la réduction</button>
                    <button type="button" className="btn btn-secondary" onClick={() => setModalReduction(null)}>Annuler</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Modale de paiement multi-moyens */}
          <div id="modal_paiement" style={{ ...overlay, display: modalPaiement ? 'flex' : 'none', zIndex: 1000 }}>
            <div className="form-card" style={{ maxWidth: 480, width: '100%', background: '#fff' }}>
              <h3 style={{ marginTop: 0 }}>Confirmer le paiement</h3>
              <p id="modal_info" className="text-muted">
                {modalPaiement && `${modalPaiement.nom} — ${modalPaiement.moisNom} · ${loc(modalPaiement.frais)} MRU`}
              </p>
              <form action={paiementAct.action} id="form_paiement">
                <input type="hidden" name="studentId" value={modalPaiement?.eid ?? ''} />
                <input type="hidden" name="mois" value={modalPaiement?.mois ?? ''} />
                <input type="hidden" name="annee" value={modalPaiement?.anMois ?? anneeCourante} />
                <input type="hidden" name="tender" value={JSON.stringify(lignesPaiement)} />
                <MoyensPaiement moyens={moyens} cible={modalPaiement ? String(Number(modalPaiement.frais)) : '0'} lignes={lignesPaiement} onChange={setLignesPaiement} currency="MRU" sens="entrant" />
                <div style={{ display: 'flex', gap: '.5rem', marginTop: '1rem' }}>
                  <button className="btn btn-primary" disabled={paiementAct.pending}>✓ Valider le paiement</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setModalPaiement(null)}>Annuler</button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}

      {/* Modale paiement global */}
      <div id="modal_paiement_global" style={{ ...overlay, display: modalGlobal ? 'flex' : 'none', zIndex: 1100 }}>
        <div className="form-card" style={{ maxWidth: 480, width: '100%', background: '#fff' }}>
          <h3 style={{ marginTop: 0 }}>Règlement global / Avance</h3>
          <p id="global_pay_info" className="text-muted">
            {modalGlobal &&
              `Correspondant #${guardianId.slice(0, 8)} · Dette actuelle : ${loc(modalGlobal.dette)} MRU. Saisissez le montant à encaisser (les avances éventuelles seront créditées sur les mois futurs).`}
          </p>
          <form action={globalAct.action} id="form_global_pay">
            <input type="hidden" name="guardianId" value={guardianId} />
            <input type="hidden" name="academicYearId" value={academicYearId} />
            <input type="hidden" name="tender" value={JSON.stringify(lignesGlobal)} />
            <MoyensPaiement moyens={moyens} cible={modalGlobal && Number(modalGlobal.dette) > 0 ? String(Number(modalGlobal.dette)) : '0'} lignes={lignesGlobal} onChange={setLignesGlobal} currency="MRU" sens="entrant" />
            <div style={{ display: 'flex', gap: '.5rem', marginTop: '1rem' }}>
              <button className="btn btn-primary" disabled={globalAct.pending}>✓ Confirmer le paiement</button>
              <button type="button" className="btn btn-secondary" onClick={() => setModalGlobal(null)}>Annuler</button>
            </div>
          </form>
        </div>
      </div>

      {/* Modale frais annuel */}
      <div id="modal_frais_annuel" style={{ ...overlay, display: modalFraisAnnuel ? 'flex' : 'none', zIndex: 1100 }}>
        <div className="form-card" style={{ maxWidth: 480, width: '100%', background: '#fff' }}>
          <h3 style={{ marginTop: 0 }} id="fa_titre">{modalFraisAnnuel ? modalFraisAnnuel.label : 'Paiement frais annuels'}</h3>
          <p id="fa_info" className="text-muted">
            {modalFraisAnnuel && `Reste à payer : ${loc(modalFraisAnnuel.reste)} MRU`}
          </p>
          <form action={payerFraisAct.action} id="form_frais_annuel">
            <input type="hidden" name="guardianId" value={guardianId} />
            <input type="hidden" name="academicYearId" value={academicYearId} />
            <input type="hidden" name="kind" value={modalFraisAnnuel?.type ?? ''} />
            <input type="hidden" name="montant" value={modalFraisAnnuel?.reste ?? ''} />
            <input type="hidden" name="tender" value={JSON.stringify(lignesFraisAnnuel)} />
            <MoyensPaiement moyens={moyens} cible={modalFraisAnnuel ? String(Number(modalFraisAnnuel.reste)) : '0'} lignes={lignesFraisAnnuel} onChange={setLignesFraisAnnuel} currency="MRU" sens="entrant" />
            <div style={{ display: 'flex', gap: '.5rem', marginTop: '1rem' }}>
              <button className="btn btn-primary" disabled={payerFraisAct.pending}>✓ Confirmer le paiement</button>
              <button type="button" className="btn btn-secondary" onClick={() => setModalFraisAnnuel(null)}>Annuler</button>
            </div>
          </form>
        </div>
      </div>

      <style>{`@media print { .no-print, .sidebar, .topbar, .page-header { display:none !important; } #recu { border:none !important; } }`}</style>
    </>
  );
}
