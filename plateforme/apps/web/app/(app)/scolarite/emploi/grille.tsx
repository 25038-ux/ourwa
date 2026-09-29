'use client';

import { useEffect, useState } from 'react';
import { assignSlotAction, clearSlotAction, publishTimetableAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';
import { Modale, PiedModale } from '@/components/modale';
import { nomProfesseurAffichable } from '@/lib/professeur';

export interface Case {
  id: string;
  day_of_week: number;
  slot: number;
  teaching_id: string;
  subject_id: string | null;
  subject: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface Enseignement {
  id: string;
  subject_id: string;
  subject_name: string;
  coefficient: number;
  hours_per_week: string;
  first_name: string | null;
  last_name: string | null;
}

type Result = { ok?: string; error?: string } | null;

/** Ses `$JOURS` et `$CRENEAUX` ; `day_of_week` 1 = Lundi, `slot` 1 = 8h-9h45. */
const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const CRENEAUX = ['8h-9h45', '10h-11h45', '12h-14h'];

/**
 * L'ÉTAPE 3 D'`emploi_du_temps.php` : le récapitulatif « Matières du groupe et
 * quotas hebdomadaires », la grille `edt-grille` (case remplie : dégradé, ✕
 * avec `confirm('Effacer cette case ?')` ; case vide : « + Ajouter » qui ouvre
 * la modale), « ✓ Valider et publier l'emploi du temps », et la modale
 * « Choisir une matière » — un bouton radio par enseignement, grisé quand le
 * quota est atteint. Les messages remontent en haut de page.
 */
export function GrilleEmploi({
  groupeId,
  academicYearId,
  cases,
  enseignements,
  editable,
}: {
  groupeId: string;
  academicYearId: string;
  cases: Case[];
  enseignements: Enseignement[];
  editable: boolean;
}) {
  const [placer, placerAction, placerPending] = useActionMessage(assignSlotAction);
  const [effacer, effacerAction] = useActionMessage(clearSlotAction);
  const [valider, validerAction, validerPending] = useActionMessage(publishTimetableAction);




  const [modale, setModale] = useState<{ jour: number; creneau: number } | null>(null);
  // Sa page se rend à nouveau après un POST : la modale est refermée.
  useEffect(() => {
    if (placer) setModale(null);
  }, [placer]);

  // Ses `$comptes_matieres` : places posées / ⌊heures ÷ 2⌋, au moins 1.
  const comptes = enseignements.map((e) => {
    const max = Math.max(1, Math.floor(Number(e.hours_per_week) / 2));
    const places = cases.filter((c) => c.subject_id === e.subject_id && enseignements.some((x) => x.id === c.teaching_id)).length;
    return { ...e, places, max, plein: places >= max };
  });

  const at = (jour: number, creneau: number) => cases.find((c) => c.day_of_week === jour && c.slot === creneau) ?? null;

  return (
    <>
      <div className="form-card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Matières du groupe et quotas hebdomadaires</h3>
        <p className="text-muted" style={{ fontSize: '.88rem', marginBottom: '.75rem' }}>
          Quota = nb max d&apos;apparitions dans la grille = ⌊heures par semaine ÷ 2⌋.
        </p>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          {comptes.map((info) => {
            const col = info.plein ? 'var(--error)' : 'var(--primary)';
            return (
              <div key={info.subject_id} style={{ border: `2px solid ${col}`, padding: '.5rem .75rem', borderRadius: 8, fontSize: '.85rem' }}>
                <strong>{info.subject_name}</strong>{' '}
                <span style={{ color: col, fontWeight: 700 }}>{info.places}/{info.max}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="table-container" style={{ marginBottom: '1.5rem' }}>
        <div className="overflow-x">
          <table className="edt-grille" style={{ minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={{ background: 'var(--bg)', fontWeight: 700 }}></th>
                {JOURS.map((j) => (
                  <th key={j} style={{ background: 'var(--primary)', color: '#fff', textAlign: 'center', fontWeight: 700 }}>{j}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CRENEAUX.map((cr, ci) => (
                <tr key={cr}>
                  <th style={{ background: 'var(--bg)', fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap' }}>{cr}</th>
                  {JOURS.map((j, ji) => {
                    const jour = ji + 1;
                    const creneau = ci + 1;
                    const c = at(jour, creneau);
                    const prof = c ? nomProfesseurAffichable(c.first_name, c.last_name) : '';
                    return (
                      <td key={j} style={{ verticalAlign: 'top', padding: 0, minWidth: 140 }}>
                        {c ? (
                          <div style={{ background: 'linear-gradient(135deg,#fff2eb,#ffe1d0)', padding: '.6rem', borderRadius: 8, margin: '.25rem', borderLeft: '4px solid var(--primary)' }}>
                            <strong style={{ display: 'block', color: 'var(--primary)', fontSize: '.88rem' }}>{c.subject}</strong>
                            {prof !== '' && <small style={{ color: 'var(--text-light)' }}>{prof}</small>}
                            {editable && (
                              <form
                                action={effacerAction}
                                style={{ marginTop: '.4rem', display: 'inline' }}
                                onSubmit={(e) => {
                                  if (!confirm('Effacer cette case ?')) e.preventDefault();
                                }}
                              >
                                <input type="hidden" name="groupId" value={groupeId} />
                                <input type="hidden" name="day" value={jour} />
                                <input type="hidden" name="slot" value={creneau} />
                                <button className="btn btn-sm btn-danger" style={{ fontSize: '.7rem', padding: '.2rem .5rem' }}>✕</button>
                              </form>
                            )}
                          </div>
                        ) : editable ? (
                          <button
                            type="button"
                            onClick={() => setModale({ jour, creneau })}
                            style={{ width: '100%', height: 80, background: '#fafafa', border: '2px dashed var(--border)', borderRadius: 8, margin: '.25rem', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '.78rem', transition: '.2s' }}
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

      {editable && (
        <form action={validerAction} style={{ textAlign: 'center' }}>
          <input type="hidden" name="groupId" value={groupeId} />
          <input type="hidden" name="academicYearId" value={academicYearId} />
          <button className="btn btn-success" style={{ fontSize: '1.1rem', padding: '.9rem 2rem', width: 'auto' }} disabled={validerPending}>
            ✓ Valider et publier l&apos;emploi du temps
          </button>
          <p className="text-muted" style={{ marginTop: '.5rem', fontSize: '.85rem' }}>
            Tous les parents et professeurs concernés seront notifiés.
          </p>
        </form>
      )}

      <Modale titre="Choisir une matière" largeur={540} ouverte={modale !== null} onFermer={() => setModale(null)}>
        <form action={placerAction} id="form-placer">
          <input type="hidden" name="groupId" value={groupeId} />
          <input type="hidden" name="dayOfWeek" value={modale?.jour ?? ''} />
          <input type="hidden" name="slot" value={modale?.creneau ?? ''} />

          <p className="text-muted" style={{ fontSize: '.85rem', marginBottom: '1rem' }}>
            Créneau : <strong id="m-libelle">{modale ? `${JOURS[modale.jour - 1]} — ${CRENEAUX[modale.creneau - 1]}` : ''}</strong>
          </p>

          <div style={{ display: 'grid', gap: '.5rem', maxHeight: 360, overflowY: 'auto' }}>
            {comptes.map((ens) => {
              const prof = nomProfesseurAffichable(ens.first_name, ens.last_name);
              const radioId = `ens_radio_${ens.id}`;
              return (
                <label
                  key={ens.id}
                  htmlFor={radioId}
                  style={{
                    display: 'flex', gap: '.6rem', alignItems: 'center', padding: '.6rem .75rem',
                    border: `2px solid ${ens.plein ? 'var(--border)' : 'var(--primary)'}`, borderRadius: 10,
                    cursor: ens.plein ? 'not-allowed' : 'pointer', opacity: ens.plein ? 0.45 : 1, background: ens.plein ? '#fafafa' : '#fff',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input type="radio" id={radioId} name="teachingId" value={ens.id} disabled={ens.plein} required />
                  <div style={{ flex: 1 }}>
                    <strong>{ens.subject_name}</strong> (coef {ens.coefficient})
                    <br />
                    <small className="text-muted">{prof !== '' ? `Prof : ${prof} · ` : ''}{ens.hours_per_week}h/sem</small>
                  </div>
                  <span style={{ fontSize: '.8rem', fontWeight: 700, color: ens.plein ? 'var(--error)' : 'var(--primary)' }}>
                    {ens.places}/{ens.max}
                  </span>
                </label>
              );
            })}
          </div>

          <PiedModale onAnnuler={() => setModale(null)}>
            <button type="submit" className="btn btn-primary" disabled={placerPending}>Placer</button>
          </PiedModale>
        </form>
      </Modale>
    </>
  );
}
