import { describe, expect, it } from 'vitest';
import { clesDivergentes, condense, empreinte, premierEcart, sou } from './commun.js';

/**
 * LES OUTILS QUI DÉCIDENT SI LA RÉCONCILIATION PEUT ÉCHOUER.
 *
 * ⚠ Une barrière qui ne sait pas échouer n'est pas une barrière. `empreinte()`
 * décide ce qu'on appelle « la même répartition », `sou()` comment deux montants
 * se comparent, `condense()` si une divergence se voit encore une fois les clés
 * masquées. Si l'un d'eux repliait deux valeurs différentes sur la même chaîne,
 * la réconciliation passerait au vert sur des données fausses — et c'est
 * exactement le genre de défaut que rien d'autre ne rattraperait.
 */

describe('empreinte', () => {
  it('trie, pour que l’ordre des lignes rendues ne compte pas', () => {
    const a = empreinte([
      { cle: 'b', n: 2 },
      { cle: 'a', n: 1 },
    ]);
    const b = empreinte([
      { cle: 'a', n: 1 },
      { cle: 'b', n: 2 },
    ]);
    expect(a).toBe(b);
    expect(a).toBe('a=1|b=2');
  });

  it('distingue un compte qui change', () => {
    expect(empreinte([{ cle: 'a', n: 1 }])).not.toBe(empreinte([{ cle: 'a', n: 2 }]));
  });

  it('distingue deux valeurs échangées entre deux clés', () => {
    // Le cas qui compte : les totaux restent identiques, la répartition non.
    const avant = empreinte([
      { cle: 'x', n: 3 },
      { cle: 'y', n: 5 },
    ]);
    const apres = empreinte([
      { cle: 'x', n: 5 },
      { cle: 'y', n: 3 },
    ]);
    expect(avant).not.toBe(apres);
  });

  it('rend une clé absente lisible plutôt que « undefined »', () => {
    expect(empreinte([{ cle: null, n: 7 }])).toBe('∅=7');
  });
});

describe('sou', () => {
  it('met les deux côtés à la même forme', () => {
    expect(sou('1234')).toBe('1234.00');
    expect(sou('1234.0')).toBe('1234.00');
    expect(sou(1234)).toBe('1234.00');
  });

  it('traite une somme vide comme zéro, des deux côtés', () => {
    expect(sou(null)).toBe('0.00');
    expect(sou(undefined)).toBe('0.00');
  });

  it('ne perd pas un centime sur un grand total', () => {
    // ⚠ En `number`, 8593000.1 + 0.2 ne rend pas 8593000.3 (règle 25).
    expect(sou('8593000.30')).toBe('8593000.30');
    expect(sou('8593000.30')).not.toBe(sou('8593000.31'));
  });
});

describe('condense', () => {
  it('rend le même condensé pour la même empreinte', () => {
    expect(condense('a=1|b=2')).toBe(condense('a=1|b=2'));
  });

  it('diverge sur une seule note déplacée', () => {
    // Le cas réel : 139 457 notes, une seule attribuée au mauvais élève.
    const bon = empreinte([
      { cle: '100:126:1', n: 2 },
      { cle: '101:126:1', n: 3 },
    ]);
    const faux = empreinte([
      { cle: '100:126:1', n: 3 },
      { cle: '101:126:1', n: 2 },
    ]);
    expect(condense(bon)).not.toBe(condense(faux));
  });

  it('ne laisse sortir aucune clé', () => {
    const avecIdentifiants = empreinte([{ cle: '100:126:1', n: 2 }]);
    expect(condense(avecIdentifiants)).not.toContain('100');
    expect(condense(avecIdentifiants)).not.toContain('126');
  });
});

describe('clesDivergentes', () => {
  it('nomme la clé fautive et les deux valeurs', () => {
    expect(clesDivergentes('a=1|b=2', 'a=1|b=3')).toEqual(['b : El Ourwa 2, nous 3']);
  });

  it('signale une clé que nous avons en trop', () => {
    expect(clesDivergentes('a=1', 'a=1|c=9')).toEqual(['c : absent chez lui, nous 9']);
  });

  it('signale une clé qui nous manque', () => {
    expect(clesDivergentes('a=1|z=4', 'a=1')).toEqual(['z : El Ourwa 4, nous —']);
  });

  it('découpe sur le DERNIER « = », parce qu’une clé peut en contenir un', () => {
    expect(clesDivergentes('a=b=1', 'a=b=2')).toEqual(['a=b : El Ourwa 1, nous 2']);
  });

  it('se borne, pour ne pas déverser des milliers de lignes', () => {
    const gauche = empreinte(Array.from({ length: 50 }, (_, i) => ({ cle: `k${i}`, n: 1 })));
    const droite = empreinte(Array.from({ length: 50 }, (_, i) => ({ cle: `k${i}`, n: 2 })));
    expect(clesDivergentes(gauche, droite)).toHaveLength(10);
  });

  it('ne trouve rien quand les deux côtés concordent', () => {
    expect(clesDivergentes('a=1|b=2', 'a=1|b=2')).toEqual([]);
  });
});

describe('premierEcart', () => {
  it('dit combien d’écarts il n’a pas montrés', () => {
    const gauche = empreinte(Array.from({ length: 8 }, (_, i) => ({ cle: `k${i}`, n: 1 })));
    const droite = empreinte(Array.from({ length: 8 }, (_, i) => ({ cle: `k${i}`, n: 2 })));
    expect(premierEcart(gauche, droite)).toContain('+3 autres');
  });

  it('rend une chaîne vide quand tout concorde', () => {
    expect(premierEcart('a=1', 'a=1')).toBe('');
  });
});
