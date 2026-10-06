import { describe, expect, it } from 'vitest';
import { POURCENTAGES_PROPOSES, partPourcentage, resteApresPourcentage } from './pourcentages.js';

/**
 * LES POURCENTAGES PROPOSÉS DES FENÊTRES DE RÉDUCTION (06/10/2026, ADR-0082) :
 * « 5 % 10 % 15 % 20 % 25 % 30 % 35 % … jusqu'à 50 % », et le système
 * déduit tout seul. ⚠ De l'argent : en décimal, jamais en nombre JS ;
 * arrondi UNE fois, à l'ouguiya entier (au demi supérieur).
 */
describe('les pourcentages proposés', () => {
  it('de 5 % à 50 %, de cinq en cinq', () => {
    expect(POURCENTAGES_PROPOSES).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
  });

  it('la part retirée et ce qui reste', () => {
    expect(partPourcentage('3200', 20)).toBe('640');
    expect(resteApresPourcentage('3200', 20)).toBe('2560');
    expect(partPourcentage('3200.00', 50)).toBe('1600');
    expect(resteApresPourcentage('1500.00', 15)).toBe('1275');
  });

  it('arrondie une fois, à l’ouguiya entier, au demi supérieur ; le reste suit la part', () => {
    expect(partPourcentage('333', 5)).toBe('17'); // 16,65
    expect(resteApresPourcentage('333', 5)).toBe('316');
    expect(partPourcentage('210', 5)).toBe('11'); // 10,5
    // Jamais l'erreur des flottants : 0,1 + 0,2.
    expect(partPourcentage('0.3', 50)).toBe('0');
  });

  it('une base vide, nulle ou illisible ne propose rien', () => {
    for (const b of ['', '0', '0.00', 'abc', '-100', null, undefined]) {
      expect(partPourcentage(b, 20), String(b)).toBeNull();
      expect(resteApresPourcentage(b, 20), String(b)).toBeNull();
    }
  });
});
