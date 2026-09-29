import { describe, expect, it } from 'vitest';
import { genererMotDePasse, validatePassword } from './password.js';

describe('le mot de passe généré (comptes parents)', () => {
  const lot = Array.from({ length: 2000 }, () => genererMotDePasse());

  it('respecte toujours la politique (8 caractères, 3 types)', () => {
    for (const m of lot) expect(validatePassword(m), m).toBe('');
  });

  it('fait 10 caractères', () => {
    for (const m of lot) expect(m).toHaveLength(10);
  });

  it('ne contient aucun caractère qui se confond à la lecture (O/0, l/1, I)', () => {
    for (const m of lot) expect(m, m).not.toMatch(/[O0l1I]/);
  });

  it('ne se répète pas', () => {
    expect(new Set(lot).size).toBe(lot.length);
  });
});
