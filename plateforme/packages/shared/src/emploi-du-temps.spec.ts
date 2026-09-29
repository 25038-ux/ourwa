import { describe, expect, it } from 'vitest';
import {
  CRENEAUX,
  creneau,
  dureeLisible,
  heureCourte,
  jourIso,
  libelleJour,
  minutesDuJour,
  minutesEntre,
} from './emploi-du-temps.js';

/**
 * LES JOURS ET LES CRÉNEAUX — ADR-0074. Les libellés sont ceux qu'El Ourwa
 * affiche (et que trois écrans recopiaient) ; les durées sont ce que les
 * absences du personnel additionnent.
 */
describe('les créneaux', () => {
  it('sont ceux d’El Ourwa, avec leur durée', () => {
    expect(CRENEAUX.map((c) => [c.libelle, c.minutes])).toEqual([
      ['8h-9h45', 105],
      ['10h-11h45', 105],
      ['12h-14h', 120],
    ]);
    for (const c of CRENEAUX) expect(minutesEntre(c.debut!, c.fin!)).toBe(c.minutes);
  });

  it('au-delà du troisième : un nom, ni heure ni durée (jamais zéro)', () => {
    expect(creneau(4)).toEqual({ slot: 4, libelle: 'Créneau 4', debut: null, fin: null, minutes: null });
  });
});

describe('les jours', () => {
  it('ISO 8601 : lundi = 1, dimanche = 7, sans dépendre du fuseau', () => {
    expect(jourIso('2026-09-28')).toBe(1); // un lundi
    expect(jourIso('2026-10-03')).toBe(6); // un samedi
    expect(jourIso('2026-10-04')).toBe(7); // un dimanche
    expect(libelleJour(jourIso('2026-09-29'))).toBe('Mardi');
  });

  it('refusent une date qui n’existe pas', () => {
    expect(() => jourIso('2026-02-30')).toThrow(RangeError);
    expect(() => jourIso('29/09/2026')).toThrow(RangeError);
  });
});

describe('les heures', () => {
  it('se lisent HH:MM ou HH:MM:SS (la forme de Postgres)', () => {
    expect(minutesDuJour('07:30')).toBe(450);
    expect(minutesDuJour('14:30:00')).toBe(870);
    expect(heureCourte('14:30:00')).toBe('14:30');
    expect(() => minutesDuJour('24:00')).toThrow(RangeError);
    expect(() => minutesDuJour('7h30')).toThrow(RangeError);
  });

  it('une durée se lit en heures et minutes', () => {
    expect(dureeLisible(105)).toBe('1 h 45');
    expect(dureeLisible(120)).toBe('2 h');
    expect(dureeLisible(45)).toBe('45 min');
    expect(dureeLisible(0)).toBe('0 min');
  });
});
