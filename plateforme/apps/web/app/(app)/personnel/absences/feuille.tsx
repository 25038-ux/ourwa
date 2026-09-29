'use client';

import { useState } from 'react';
import { JOURS_SEMAINE, dureeLisible } from '@elourwa/shared/emploi-du-temps';
import { useActionMessage } from '@/components/message-page';
import {
  declarerAgentAction,
  declarerProfesseurAction,
  definirHorairesAction,
  justifierAbsenceAction,
  retirerAbsenceAction,
} from './actions';

/** Ce que `GET /personnel/absences/journee` rend (ADR-0074). */
export interface AbsenceLue {
  id: string;
  justified: boolean;
  reason: string | null;
  minutes: number | null;
  debut: string | null;
  fin: string | null;
  recordedBy: string | null;
}

export interface SeanceDuJour {
  slot: number;
  creneau: string;
  minutes: number | null;
  groupId: string | null;
  groupe: string;
  matiere: string;
  horsGrille: boolean;
  absence: AbsenceLue | null;
}

export interface ProfesseurDuJour {
  teacherId: string;
  nom: string;
  seances: SeanceDuJour[];
}

export interface PeriodeDuJour {
  workHoursId: string | null;
  debut: string;
  fin: string;
  minutes: number;
  absences: AbsenceLue[];
}

export interface AgentDuJour {
  staffId: string;
  nom: string;
  fonction: string;
  periodes: PeriodeDuJour[];
}

function duree(minutes: number | null): string {
  return minutes === null ? '' : dureeLisible(minutes);
}

/** Le badge d'une absence : « Absent » (rouge) ou « Justifiée » (orange), avec son motif. */
function Etat({ absence }: { absence: AbsenceLue }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
      <span className={`badge ${absence.justified ? 'badge-warning' : 'badge-danger'}`}>
        {absence.justified ? 'Absence justifiée' : 'Absent'}
      </span>
      {absence.reason && <small className="text-muted">{absence.reason}</small>}
      {absence.recordedBy && <small className="text-muted">saisie : {absence.recordedBy}</small>}
    </span>
  );
}

/**
 * JUSTIFIER, RETIRER — sur une absence déjà déclarée. Justifier est la
 * direction ; retirer est l'erreur de saisie (une absence justifiée : la
 * direction seule — l'API le refuse aux autres).
 */
export function GestesAbsence({ absence, direction }: { absence: AbsenceLue; direction: boolean }) {
  const [, justifier, j] = useActionMessage(justifierAbsenceAction);
  const [, retirer, r] = useActionMessage(retirerAbsenceAction);
  const [motif, setMotif] = useState(absence.reason ?? '');
  return (
    <span style={{ display: 'inline-flex', gap: '.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
      {direction && (
        <form action={justifier} style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center' }}>
          <input type="hidden" name="id" value={absence.id} />
          <input type="hidden" name="justified" value={absence.justified ? '0' : '1'} />
          {!absence.justified && (
            <input
              type="text"
              name="motif"
              placeholder="Motif (certificat…)"
              aria-label="Motif de la justification"
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              style={{ width: 150, padding: '.25rem .4rem' }}
            />
          )}
          <button className="btn btn-sm btn-secondary" disabled={j}>
            {absence.justified ? 'Retirer la justification' : 'Justifier'}
          </button>
        </form>
      )}
      {(direction || !absence.justified) && (
        <form
          action={retirer}
          onSubmit={(e) => {
            if (!confirm('Retirer cette absence ?')) e.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={absence.id} />
          <button className="btn btn-sm btn-danger" disabled={r} aria-label="Retirer l'absence">
            ✕
          </button>
        </form>
      )}
    </span>
  );
}

/**
 * UN PROFESSEUR, SES SÉANCES DU JOUR — telles que l'emploi du temps les donne.
 * On coche les séances manquées (ou « Toute la journée ») ; une séance déjà
 * déclarée montre son état et ses gestes.
 */
export function FeuilleProfesseur({
  date,
  prof,
  peutSaisir,
  direction,
}: {
  date: string;
  prof: ProfesseurDuJour;
  peutSaisir: boolean;
  direction: boolean;
}) {
  const [, action, pending] = useActionMessage(declarerProfesseurAction);
  const libres = prof.seances.filter((s) => !s.absence && !s.horsGrille && s.groupId);
  const [coches, setCoches] = useState<Set<string>>(new Set());
  const cle = (s: SeanceDuJour) => `${s.slot}:${s.groupId}`;
  const absentes = prof.seances.filter((s) => s.absence).length;

  return (
    <div className="table-container" style={{ marginBottom: '1rem' }} data-testid={`prof-${prof.teacherId}`}>
      <div className="table-header">
        <h3 style={{ margin: 0 }}>{prof.nom}</h3>
        <span className={`badge ${absentes > 0 ? 'badge-danger' : 'badge-success'}`}>
          {absentes > 0 ? `${absentes} séance${absentes > 1 ? 's' : ''} manquée${absentes > 1 ? 's' : ''}` : 'Présent'}
        </span>
      </div>
      {/* ⚠ Le formulaire de déclaration n'entoure PAS le tableau : chaque absence
          déjà déclarée y porte ses propres formulaires (Justifier, ✕), et un
          formulaire dans un formulaire n'existe pas en HTML — le navigateur
          ignorait l'intérieur, et ✕ soumettait la déclaration. Les cases sont
          un état React ; seul le pied de carte est un formulaire. */}
      <div className="overflow-x">
        <table>
          <thead>
            <tr>
              {peutSaisir && <th style={{ width: 40 }} aria-label="Cocher" />}
              <th>Créneau</th>
              <th>Classe</th>
              <th>Matière</th>
              <th>État</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {prof.seances.map((s) => (
              <tr key={`${s.slot}-${s.groupId ?? s.groupe}`}>
                {peutSaisir && (
                  <td>
                    {!s.absence && s.groupId && !s.horsGrille && (
                      <input
                        type="checkbox"
                        aria-label={`Absent : ${s.creneau} ${s.groupe}`}
                        checked={coches.has(cle(s))}
                        onChange={(e) =>
                          setCoches((c) => {
                            const n = new Set(c);
                            if (e.target.checked) n.add(cle(s));
                            else n.delete(cle(s));
                            return n;
                          })
                        }
                      />
                    )}
                  </td>
                )}
                <td>
                  <strong>{s.creneau}</strong>
                  {s.minutes !== null && <><br /><small className="text-muted">{duree(s.minutes)}</small></>}
                </td>
                <td>{s.groupe}</td>
                <td>
                  {s.matiere}
                  {s.horsGrille && <><br /><small className="text-muted">n&apos;est plus dans la grille</small></>}
                </td>
                <td>{s.absence ? <Etat absence={s.absence} /> : <span className="badge badge-success">Présent</span>}</td>
                <td>{s.absence && peutSaisir && <GestesAbsence absence={s.absence} direction={direction} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {peutSaisir && libres.length > 0 && (
        <form action={action} style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', padding: '.75rem 1rem' }}>
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="teacherId" value={prof.teacherId} />
          <input
            type="hidden"
            name="seances"
            value={JSON.stringify(libres.filter((s) => coches.has(cle(s))).map((s) => ({ slot: s.slot, groupId: s.groupId })))}
          />
          <input
            type="text"
            name="motif"
            placeholder="Motif (facultatif)"
            aria-label={`Motif de l'absence de ${prof.nom}`}
            style={{ flex: '1 1 180px', maxWidth: 320 }}
          />
          <button className="btn btn-sm btn-danger" disabled={pending || coches.size === 0}>
            Déclarer absent ({coches.size})
          </button>
          {/* Le bouton qui soumet est dans le formulaire envoyé : son nom dit « toute la journée ». */}
          <button className="btn btn-sm btn-secondary" name="toute_la_journee" value="1" disabled={pending}>
            Absent toute la journée
          </button>
        </form>
      )}
    </div>
  );
}

/** UNE PÉRIODE D'UN AGENT : absent toute la période, ou de telle heure à telle heure. */
function PeriodeAgent({
  date,
  staffId,
  periode,
  peutSaisir,
  direction,
}: {
  date: string;
  staffId: string;
  periode: PeriodeDuJour;
  peutSaisir: boolean;
  direction: boolean;
}) {
  const [, action, pending] = useActionMessage(declarerAgentAction);
  const [partiel, setPartiel] = useState(false);
  const manquees = periode.absences.reduce((a, x) => a + (x.minutes ?? 0), 0);
  const complete = manquees >= periode.minutes;
  return (
    <tr>
      <td>
        <strong>
          {periode.debut} – {periode.fin}
        </strong>
        <br />
        <small className="text-muted">
          {duree(periode.minutes)}
          {periode.workHoursId === null && ' · plus dans ses horaires'}
        </small>
      </td>
      <td>
        {periode.absences.length === 0 ? (
          <span className="badge badge-success">Présent</span>
        ) : (
          <div style={{ display: 'grid', gap: '.4rem' }}>
            {periode.absences.map((a) => (
              <div key={a.id} style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span>
                  {a.debut} – {a.fin} <small className="text-muted">({duree(a.minutes)})</small>
                </span>
                <Etat absence={a} />
                {peutSaisir && <GestesAbsence absence={a} direction={direction} />}
              </div>
            ))}
          </div>
        )}
      </td>
      <td>
        {peutSaisir && periode.workHoursId && !complete && (
          <form action={action} style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="hidden" name="date" value={date} />
            <input type="hidden" name="staffId" value={staffId} />
            <input type="hidden" name="workHoursId" value={periode.workHoursId} />
            {partiel && (
              <>
                <input type="time" name="debut" defaultValue={periode.debut} min={periode.debut} max={periode.fin} aria-label="Absent de" required />
                <input type="time" name="fin" defaultValue={periode.fin} min={periode.debut} max={periode.fin} aria-label="Absent jusqu'à" required />
              </>
            )}
            <input type="text" name="motif" placeholder="Motif (facultatif)" aria-label="Motif" style={{ width: 140 }} />
            <button className="btn btn-sm btn-danger" disabled={pending}>
              {partiel ? 'Déclarer' : periode.absences.length > 0 ? 'Absent le reste' : 'Absent'}
            </button>
            {!partiel && periode.absences.length === 0 && (
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setPartiel(true)}>
                En partie…
              </button>
            )}
          </form>
        )}
      </td>
    </tr>
  );
}

export function FeuilleAgent({
  date,
  agent,
  peutSaisir,
  direction,
}: {
  date: string;
  agent: AgentDuJour;
  peutSaisir: boolean;
  direction: boolean;
}) {
  const [, action, pending] = useActionMessage(declarerAgentAction);
  const absentes = agent.periodes.reduce((a, p) => a + p.absences.length, 0);
  const libres = agent.periodes.some((p) => p.workHoursId && p.absences.length === 0);
  return (
    <div className="table-container" style={{ marginBottom: '1rem' }} data-testid={`agent-${agent.staffId}`}>
      <div className="table-header">
        <h3 style={{ margin: 0 }}>
          {agent.nom} <small className="text-muted" style={{ fontWeight: 400 }}>· {agent.fonction}</small>
        </h3>
        <span className={`badge ${absentes > 0 ? 'badge-danger' : 'badge-success'}`}>{absentes > 0 ? 'Absent' : 'Présent'}</span>
        {peutSaisir && libres && agent.periodes.length > 1 && (
          <form action={action} style={{ marginLeft: 'auto' }}>
            <input type="hidden" name="date" value={date} />
            <input type="hidden" name="staffId" value={agent.staffId} />
            <input type="hidden" name="toute_la_journee" value="1" />
            <button className="btn btn-sm btn-secondary" disabled={pending}>Absent toute la journée</button>
          </form>
        )}
      </div>
      <div className="overflow-x">
        <table>
          <thead>
            <tr>
              <th style={{ width: 160 }}>Période</th>
              <th>État</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {agent.periodes.map((p) => (
              <PeriodeAgent
                key={`${p.workHoursId ?? 'x'}-${p.debut}`}
                date={date}
                staffId={agent.staffId}
                periode={p}
                peutSaisir={peutSaisir}
                direction={direction}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * LES HORAIRES D'UN AGENT — sa semaine : des lignes jour / début / fin, qu'on
 * ajoute et retire, enregistrées d'un bloc. L'API refuse un chevauchement ou
 * une fin avant le début, en le nommant.
 */
export function HorairesAgent({
  agent,
  modifiable,
}: {
  agent: { staffId: string; nom: string; fonction: string; actif: boolean; periodes: { jour: number; debut: string; fin: string }[] };
  modifiable: boolean;
}) {
  const [, action, pending] = useActionMessage(definirHorairesAction);
  const [lignes, setLignes] = useState(agent.periodes);
  const maj = (i: number, champ: 'jour' | 'debut' | 'fin', v: string) =>
    setLignes((l) => l.map((x, k) => (k === i ? { ...x, [champ]: champ === 'jour' ? Number(v) : v } : x)));
  const ajouter = () => {
    const dernier = lignes.at(-1);
    setLignes((l) => [...l, { jour: dernier ? Math.min(7, dernier.jour + 1) : 1, debut: dernier?.debut ?? '08:00', fin: dernier?.fin ?? '14:00' }]);
  };
  const semaine = () => setLignes([1, 2, 3, 4, 5].map((jour) => ({ jour, debut: '08:00', fin: '14:00' })));

  return (
    <div className="table-container" style={{ marginBottom: '1rem', opacity: agent.actif ? 1 : 0.6 }} data-testid={`horaires-${agent.staffId}`}>
      <div className="table-header">
        <h3 style={{ margin: 0 }}>
          {agent.nom} <small className="text-muted" style={{ fontWeight: 400 }}>· {agent.fonction}</small>
        </h3>
        {!agent.actif && <span className="badge badge-danger">Inactif</span>}
        <span className="badge badge-primary">
          {lignes.length === 0 ? 'aucun horaire' : `${lignes.length} période${lignes.length > 1 ? 's' : ''}`}
        </span>
      </div>
      <form action={action} style={{ padding: '.75rem 1rem' }}>
        <input type="hidden" name="staffId" value={agent.staffId} />
        <input type="hidden" name="periodes" value={JSON.stringify(lignes)} />
        {lignes.length === 0 && <p className="text-muted" style={{ margin: '0 0 .5rem' }}>Aucun horaire : on ne peut déclarer aucune absence pour cet agent.</p>}
        <div style={{ display: 'grid', gap: '.4rem', marginBottom: '.6rem' }}>
          {lignes.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={l.jour} disabled={!modifiable} aria-label="Jour" onChange={(e) => maj(i, 'jour', e.target.value)}>
                {JOURS_SEMAINE.map((j, k) => (
                  <option key={j} value={k + 1}>{j}</option>
                ))}
              </select>
              <input type="time" value={l.debut} disabled={!modifiable} aria-label="Début" onChange={(e) => maj(i, 'debut', e.target.value)} />
              <span>–</span>
              <input type="time" value={l.fin} disabled={!modifiable} aria-label="Fin" onChange={(e) => maj(i, 'fin', e.target.value)} />
              {modifiable && (
                <button type="button" className="btn btn-sm btn-secondary" aria-label="Retirer cette période" onClick={() => setLignes((x) => x.filter((_, k) => k !== i))}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        {modifiable && (
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm btn-secondary" onClick={ajouter}>+ Période</button>
            {lignes.length === 0 && (
              <button type="button" className="btn btn-sm btn-secondary" onClick={semaine}>Lundi – vendredi, 8h – 14h</button>
            )}
            <button className="btn btn-sm btn-primary" disabled={pending}>Enregistrer les horaires</button>
          </div>
        )}
      </form>
    </div>
  );
}
