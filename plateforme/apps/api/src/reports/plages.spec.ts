import { describe, expect, it } from 'vitest';
import { horsDesPlages, reunirPlages, type PlageJours } from './plages.js';

/**
 * Ces plages bornent ce que la synthèse de l'année LIT dans la caisse. Une
 * plage en double ferait compter une ligne deux fois, un jour oublié en
 * perdrait une : de l'argent dans les deux cas (règle 15).
 */

const A: PlageJours = ['2024-10-01', '2025-06-30'];
const B: PlageJours = ['2025-10-01', '2026-06-30'];
const C: PlageJours = ['2026-10-01', '2027-06-30'];

describe('reunirPlages', () => {
  it('trie, et laisse séparées des plages qui ne se touchent pas', () => {
    expect(reunirPlages([C, A, B])).toEqual([A, B, C]);
  });

  it('réunit deux plages qui se chevauchent ou se touchent au jour près', () => {
    expect(reunirPlages([['2026-07-01', '2026-09-30'], C])).toEqual([['2026-07-01', '2027-06-30']]);
    expect(reunirPlages([['2026-07-01', '2026-10-15'], C])).toEqual([['2026-07-01', '2027-06-30']]);
    // Un jour d'écart : elles restent deux.
    expect(reunirPlages([['2026-07-01', '2026-09-29'], C])).toEqual([['2026-07-01', '2026-09-29'], C]);
  });

  it('une plage contenue dans une autre disparaît ; une plage à l’envers est ignorée', () => {
    expect(reunirPlages([['2026-01-01', '2026-12-31'], ['2026-03-01', '2026-03-31'], ['2026-06-02', '2026-06-01']]))
      .toEqual([['2026-01-01', '2026-12-31']]);
  });

  it('une borne ouverte absorbe tout ce qui la suit', () => {
    expect(reunirPlages([['2026-07-01', 'infinity'], ['2028-07-01', 'infinity'], C])).toEqual([['2026-07-01', 'infinity']]);
    expect(reunirPlages([['-infinity', '2024-09-30'], A])).toEqual([['-infinity', '2025-06-30']]);
  });

  it('ne modifie pas les plages reçues', () => {
    const recu: PlageJours[] = [['2026-07-01', '2026-09-30'], ['2026-10-01', '2027-06-30']];
    reunirPlages(recu);
    expect(recu).toEqual([['2026-07-01', '2026-09-30'], ['2026-10-01', '2027-06-30']]);
  });
});

describe('horsDesPlages', () => {
  it('les étés entre les années, avant la première et après la dernière', () => {
    expect(horsDesPlages([A, B, C])).toEqual([
      ['-infinity', '2024-09-30'],
      ['2025-07-01', '2025-09-30'],
      ['2026-07-01', '2026-09-30'],
      ['2027-07-01', 'infinity'],
    ]);
  });

  it('sans aucune plage : tout', () => {
    expect(horsDesPlages([])).toEqual([['-infinity', 'infinity']]);
  });

  it('des plages ouvertes ne laissent rien de leur côté', () => {
    expect(horsDesPlages([['-infinity', '2025-06-30'], ['2025-10-01', 'infinity']])).toEqual([['2025-07-01', '2025-09-30']]);
    expect(horsDesPlages([['-infinity', 'infinity']])).toEqual([]);
  });

  it('⚠ chaque jour est soit dans une plage, soit dehors — jamais les deux, jamais aucun', () => {
    const plages: PlageJours[] = [A, B, C];
    const dehors = horsDesPlages(plages);
    const dans = (jour: string, liste: PlageJours[]) => liste.filter(([d, f]) => d <= jour && jour <= f).length;
    // Trois ans, jour par jour, autour des trois années.
    for (let t = Date.UTC(2024, 5, 1); t <= Date.UTC(2027, 11, 31); t += 86_400_000) {
      const jour = new Date(t).toISOString().slice(0, 10);
      expect(dans(jour, plages) + dans(jour, dehors), jour).toBe(1);
    }
    // Et réunir « dedans » et « dehors » redonne le calendrier entier.
    expect(reunirPlages([...plages, ...dehors])).toEqual([['-infinity', 'infinity']]);
  });
});
