'use client';

import { useState } from 'react';
import { MODES_ETUDE, libelleMode, type ModeEtude } from '@elourwa/shared/facturation';
import { useActionMessage } from '@/components/message-page';
import { fr } from '@/components/moyens-paiement';
import type { CatalogueFacturation } from '@/components/choix-facturation';
import { MOIS_NOMS } from '@/lib/mois';
import { money, toStorage } from '@elourwa/shared/money';
import {
  annulerPaiementServiceAction,
  arreterServiceAction,
  changerModeAction,
  exempterServiceAction,
  remiseServiceAction,
  souscrireServiceAction,
} from './services-actions';

/**
 * LES SERVICES D'UN ENFANT SUR LA FICHE DU CORRESPONDANT — facturation
 * « services » (Jinan), spécification §7. Rien de ce fichier ne se rend pour
 * une école « famille » : le relevé n'y porte ni mode, ni abonnement, ni
 * échéance de service.
 */

/** La remise par mois, pour savoir s'il y en a une et pré-remplir le champ ; le dû se calcule en décimal (règle 6). */
const remiseDe = (a: { remise?: string }) => Number(a.remise ?? '0');

/** Un abonnement (`familyLedger` → `children[].services`). */
export interface AbonnementFiche {
  id: string;
  service: string;
  label: string;
  periodicite: 'mensuel' | 'annuel';
  famille: string;
  amount: string;
  /** La remise par mois (ADR-0079) ; '0.00' sans remise. Absente d'une API plus ancienne. */
  remise?: string;
  /** Faux pour les services d'office (inscription, photocopie) : ils s'exemptent, ne s'arrêtent pas. */
  arretable?: boolean;
  exempt: boolean;
  startMonth: number;
  startYear: number;
  endedAt: string | null;
}

/** Une échéance de service dans une carte de mois (`months[].services`). */
export interface LigneServiceMois {
  studentServiceId: string;
  service: string;
  label: string;
  due: string;
  paid: string;
  outstanding: string;
  state: 'paid' | 'partial' | 'due' | 'exempt';
  paymentId: string | null;
  receiptId: string | null;
  receiptNumber: string | null;
}

/** Une échéance portée par l'enfant : un service annuel, ou un mois hors grille. */
export interface LigneServiceEnfant extends LigneServiceMois {
  periodicite: 'mensuel' | 'annuel';
  month: number | null;
  year: number | null;
}

/** La clé d'une échéance — la même que celle de la fenêtre d'encaissement. */
export function cleEcheance(studentServiceId: string, mois: number | null, annee: number | null): string {
  return `${studentServiceId}:${mois ?? 'an'}:${annee ?? ''}`;
}

const mru = (v: string | number) => fr(Number(v));

const ETATS: Record<LigneServiceMois['state'], { texte: string; couleur: string; fond: string }> = {
  paid: { texte: '✓ Réglé', couleur: '#3d472b', fond: '#ECFDF5' },
  partial: { texte: 'Partiel', couleur: '#D97706', fond: '#FEF3C7' },
  due: { texte: 'Dû', couleur: '#a8341f', fond: '#FEF2F2' },
  exempt: { texte: 'Exempté', couleur: '#92400e', fond: '#fef3c7' },
};

/** Le ✕ d'un paiement de service — la direction ; le motif est obligatoire (API). */
function AnnulerPaiement({ paymentId, libelle }: { paymentId: string; libelle: string }) {
  const [, action, pending] = useActionMessage(annulerPaiementServiceAction);
  return (
    <form
      action={action}
      style={{ display: 'inline' }}
      onSubmit={(e) => {
        if (!confirm(`Annuler ce paiement (${libelle}) ?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="paymentId" value={paymentId} />
      <input type="hidden" name="reason" value={`Annulation — ${libelle}`} />
      <button
        className="btn btn-sm btn-danger mois-btn"
        disabled={pending}
        title="Annuler ce paiement"
        aria-label={`Annuler le paiement : ${libelle}`}
        style={{ padding: '.05rem .35rem', fontSize: '.68rem' }}
      >
        ✕
      </button>
    </form>
  );
}

/**
 * UNE ÉCHÉANCE DE SERVICE, EN UNE LIGNE — sous la scolarité dans une carte de
 * mois, ou dans les lignes annuelles de l'enfant : libellé, montant, état,
 * case « Cocher pour l'encaisser », « Reçu », ✕ (direction).
 */
export function LigneEcheance({
  ligne,
  libelleMois,
  cle,
  cochee,
  onCocher,
  peutAdministrer,
  peutEncaisser,
  compacte = false,
}: {
  ligne: LigneServiceMois;
  libelleMois: string | null;
  cle: string;
  cochee: boolean;
  onCocher: (cle: string) => void;
  peutAdministrer: boolean;
  peutEncaisser: boolean;
  compacte?: boolean;
}) {
  const e = ETATS[ligne.state];
  const encaissable = (ligne.state === 'due' || ligne.state === 'partial') && Number(ligne.outstanding) > 0.005;
  const libelle = `${ligne.label}${libelleMois ? ` — ${libelleMois}` : ''}`;
  return (
    <div
      className="service-ligne"
      data-testid={`service-${cle}`}
      style={{
        display: 'flex', alignItems: 'center', gap: '.3rem', flexWrap: 'wrap',
        fontSize: compacte ? '.7rem' : '.85rem', borderTop: compacte ? '1px dashed var(--border)' : undefined,
        paddingTop: compacte ? '.2rem' : undefined, marginTop: compacte ? '.2rem' : undefined,
      }}
    >
      {encaissable && peutEncaisser && (
        <input
          type="checkbox"
          title="Cocher pour l'encaisser avec le reste — un seul reçu"
          aria-label={`Cocher pour l'encaisser : ${libelle}`}
          checked={cochee}
          onChange={() => onCocher(cle)}
        />
      )}
      <span style={{ flex: 1, minWidth: compacte ? 0 : 160 }}>
        {ligne.label} <strong>{mru(ligne.due)}</strong>
      </span>
      <span className="badge" style={{ background: e.fond, color: e.couleur, fontSize: compacte ? '.62rem' : undefined }}>
        {ligne.state === 'partial' ? `${e.texte} ${mru(ligne.paid)}/${mru(ligne.due)}` : e.texte}
      </span>
      {ligne.receiptId && (
        <a
          href={`/finance/recu/groupe/${ligne.receiptId}`}
          target="_blank"
          rel="noopener"
          className="btn btn-sm btn-secondary mois-btn"
          title={ligne.receiptNumber ? `Reçu ${ligne.receiptNumber}` : 'Reçu'}
          style={{ padding: '.05rem .35rem', fontSize: '.68rem' }}
        >
          Reçu
        </a>
      )}
      {peutAdministrer && ligne.paymentId && <AnnulerPaiement paymentId={ligne.paymentId} libelle={libelle} />}
    </div>
  );
}

/** Les mois de l'année affichée, pour les sélecteurs « à partir de ». */
export type MoisPeriode = { mois: number; annee: number }[];

/**
 * LE BLOC « SERVICES » D'UN ENFANT — son mode d'étude (et le changer :
 * direction), ses abonnements de l'année (exempter / lever, arrêter :
 * direction), « Ajouter un service » (la caisse), et ses échéances annuelles
 * (inscription, photocopie) à cocher comme les mois.
 */
export function BlocServices({
  studentId,
  studyMode,
  abonnements,
  annuelles,
  catalogue,
  academicYearId,
  moisPeriode,
  peutAdministrer,
  peutEncaisser,
  selection,
  onCocher,
}: {
  studentId: string;
  studyMode: string | null;
  abonnements: AbonnementFiche[];
  annuelles: LigneServiceEnfant[];
  catalogue: CatalogueFacturation | null;
  academicYearId: string;
  moisPeriode: MoisPeriode;
  peutAdministrer: boolean;
  peutEncaisser: boolean;
  selection: Set<string>;
  onCocher: (cle: string) => void;
}) {
  const [, souscrire, pSous] = useActionMessage(souscrireServiceAction);
  const [, arreter, pArr] = useActionMessage(arreterServiceAction);
  const [, exempter, pExe] = useActionMessage(exempterServiceAction);
  const [, remiser, pRem] = useActionMessage(remiseServiceAction);
  const [, changerMode, pMode] = useActionMessage(changerModeAction);
  const [ouvert, setOuvert] = useState(false);
  const [modeOuvert, setModeOuvert] = useState(false);

  const actifs = abonnements.filter((a) => a.endedAt === null);
  const famillesActives = new Set(actifs.map((a) => a.famille));
  const proposables = (catalogue?.services ?? []).filter(
    (s) => s.prix !== null && !famillesActives.has(s.code.startsWith('cantine_') ? 'cantine' : s.code),
  );
  // Le mois suivant par défaut, parmi ceux de l'année.
  const maintenant = new Date();
  // Une année déjà finie n'a pas de « mois suivant » : son dernier mois.
  const suivant =
    moisPeriode.find((m) => m.annee * 12 + m.mois > maintenant.getFullYear() * 12 + maintenant.getMonth() + 1) ??
    moisPeriode.at(-1);

  return (
    <div className="services-enfant" style={{ margin: '.5rem 0 .75rem', padding: '.6rem .75rem', border: '1px solid var(--border)', borderRadius: 8, background: '#fcfbf8' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.4rem' }}>
        <strong>Services</strong>
        <span className="badge badge-primary" title="Mode d'étude de l'année">
          {studyMode ? libelleMode(studyMode as ModeEtude) : 'mode non renseigné'}
        </span>
        {peutAdministrer && (
          <button type="button" className="btn btn-sm btn-secondary" style={{ padding: '.1rem .45rem', fontSize: '.72rem' }} onClick={() => setModeOuvert((v) => !v)}>
            Changer de mode
          </button>
        )}
        {peutEncaisser && proposables.length > 0 && (
          <button type="button" className="btn btn-sm btn-secondary" style={{ padding: '.1rem .45rem', fontSize: '.72rem' }} onClick={() => setOuvert((v) => !v)}>
            + Ajouter un service
          </button>
        )}
      </div>

      {modeOuvert && peutAdministrer && (
        <form
          action={changerMode}
          style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap', margin: '.25rem 0 .5rem' }}
          onSubmit={(e) => {
            if (!confirm("Changer le mode d'étude ? Les mois non réglés suivront le tarif du nouveau mode ; les mois payés gardent leur prix.")) e.preventDefault();
          }}
        >
          <input type="hidden" name="studentId" value={studentId} />
          <input type="hidden" name="academicYearId" value={academicYearId} />
          <select name="studyMode" required defaultValue="" aria-label="Nouveau mode d'étude">
            <option value="">— Nouveau mode —</option>
            {MODES_ETUDE.filter((m) => m !== studyMode).map((m) => (
              <option key={m} value={m}>{libelleMode(m)}</option>
            ))}
          </select>
          <input type="text" name="reason" placeholder="Motif (facultatif)" style={{ width: 150 }} />
          <button className="btn btn-sm btn-primary" disabled={pMode}>Changer</button>
        </form>
      )}

      {ouvert && peutEncaisser && (
        <form action={souscrire} style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap', margin: '.25rem 0 .5rem' }}>
          <input type="hidden" name="studentId" value={studentId} />
          <input type="hidden" name="academicYearId" value={academicYearId} />
          <select name="service" required defaultValue="" aria-label="Service à ajouter">
            <option value="">— Service —</option>
            {proposables.map((s) => (
              <option key={s.code} value={s.code}>
                {s.libelle} — {mru(s.prix!)} MRU{s.periodicite === 'mensuel' ? ' / mois' : ''}
              </option>
            ))}
          </select>
          <select name="debut" defaultValue="" aria-label="À partir de">
            <option value="">À partir de : règle du 25</option>
            {moisPeriode.map((m) => (
              <option key={`${m.annee}-${m.mois}`} value={`${m.annee}-${m.mois}`}>{MOIS_NOMS[m.mois]} {m.annee}</option>
            ))}
          </select>
          <button className="btn btn-sm btn-primary" disabled={pSous}>Ajouter</button>
        </form>
      )}

      {abonnements.length === 0 ? (
        <p className="text-muted" style={{ margin: 0, fontSize: '.82rem' }}>Aucun service pour cette année.</p>
      ) : (
        <div style={{ display: 'grid', gap: '.3rem' }}>
          {abonnements.map((a) => {
            const arrete = a.endedAt !== null;
            return (
              <div key={a.id} data-testid={`abonnement-${a.service}`} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap', fontSize: '.85rem', opacity: arrete ? 0.6 : 1 }}>
                <span style={{ minWidth: 200 }}>
                  <strong>{a.label}</strong> —{' '}
                  {remiseDe(a) > 0 ? (
                    // La remise (ADR-0079) : le prix, la remise, ce qui est dû par mois.
                    <span data-testid={`remise-${a.service}`}>
                      <s className="text-muted">{mru(a.amount)}</s> − {mru(a.remise!)} ={' '}
                      <strong>{mru(toStorage(money(a.amount).minus(money(a.remise!))))}</strong> MRU / mois
                    </span>
                  ) : (
                    <>{mru(a.amount)} MRU{a.periodicite === 'mensuel' ? ' / mois' : ''}</>
                  )}
                  {a.arretable === false && <span className="text-muted"> · obligatoire</span>}
                  <span className="text-muted"> · depuis {MOIS_NOMS[a.startMonth]} {a.startYear}</span>
                </span>
                {arrete ? (
                  <span className="badge" style={{ background: '#dcd3c4', color: '#374151' }}>Arrêté</span>
                ) : a.exempt ? (
                  <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>Exempté</span>
                ) : (
                  <span className="badge badge-success">Actif</span>
                )}
                {peutAdministrer && !arrete && (
                  <form action={exempter} style={{ display: 'inline' }}>
                    <input type="hidden" name="studentServiceId" value={a.id} />
                    <input type="hidden" name="service" value={a.service} />
                    <input type="hidden" name="exempt" value={a.exempt ? '0' : '1'} />
                    <button className="btn btn-sm btn-secondary" disabled={pExe} style={{ padding: '.1rem .45rem', fontSize: '.72rem' }}>
                      {a.exempt ? "Lever l'exemption" : 'Exempter'}
                    </button>
                  </form>
                )}
                {peutAdministrer && !arrete && a.periodicite === 'mensuel' && (
                  // Une remise par mois (direction) : les mois non réglés suivent.
                  <form action={remiser} style={{ display: 'inline-flex', gap: '.25rem', alignItems: 'center' }}>
                    <input type="hidden" name="studentServiceId" value={a.id} />
                    <input type="hidden" name="service" value={a.service} />
                    <input
                      type="number"
                      name="remise"
                      min={0}
                      max={Number(a.amount)}
                      step="any"
                      defaultValue={remiseDe(a) > 0 ? String(remiseDe(a)) : ''}
                      placeholder="0"
                      aria-label={`Remise par mois sur ${a.label}`}
                      style={{ width: 80, padding: '.1rem .3rem', fontSize: '.72rem' }}
                    />
                    <button className="btn btn-sm btn-secondary" disabled={pRem} style={{ padding: '.1rem .45rem', fontSize: '.72rem' }}>
                      Remise / mois
                    </button>
                  </form>
                )}
                {peutAdministrer && !arrete && (a.arretable ?? (a.service !== 'inscription' && a.service !== 'photocopie')) && (
                  <form
                    action={arreter}
                    style={{ display: 'inline-flex', gap: '.25rem', alignItems: 'center' }}
                    onSubmit={(e) => {
                      if (!confirm(`Arrêter « ${a.label} » ? Les mois suivants non payés sont retirés.`)) e.preventDefault();
                    }}
                  >
                    <input type="hidden" name="studentServiceId" value={a.id} />
                    <input type="hidden" name="service" value={a.service} />
                    {/* Un service annuel n'a qu'une échéance, à son mois : l'arrêter,
                        c'est la retirer (si elle n'est pas payée). */}
                    {a.periodicite === 'annuel' && <input type="hidden" name="depuis" value={`${a.startYear}-${a.startMonth}`} />}
                    {a.periodicite === 'mensuel' && (
                      <select name="depuis" defaultValue={suivant ? `${suivant.annee}-${suivant.mois}` : ''} aria-label={`Arrêter ${a.label} à partir de`} style={{ padding: '.1rem .3rem', fontSize: '.72rem' }}>
                        {moisPeriode.map((m) => (
                          <option key={`${m.annee}-${m.mois}`} value={`${m.annee}-${m.mois}`}>à partir de {MOIS_NOMS[m.mois]} {m.annee}</option>
                        ))}
                      </select>
                    )}
                    <button className="btn btn-sm btn-danger" disabled={pArr} style={{ padding: '.1rem .45rem', fontSize: '.72rem' }}>Arrêter</button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}

      {annuelles.length > 0 && (
        <div style={{ marginTop: '.5rem', paddingTop: '.4rem', borderTop: '1px solid var(--border)' }}>
          {annuelles.map((l) => {
            const libelleMois = l.month !== null && l.year !== null ? `${MOIS_NOMS[l.month]} ${l.year}` : null;
            const cle = cleEcheance(l.studentServiceId, l.periodicite === 'annuel' ? null : l.month, l.periodicite === 'annuel' ? null : l.year);
            return (
              <LigneEcheance
                key={cle}
                ligne={l}
                libelleMois={libelleMois ?? 'pour l’année'}
                cle={cle}
                cochee={selection.has(cle)}
                onCocher={onCocher}
                peutAdministrer={peutAdministrer}
                peutEncaisser={peutEncaisser}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
