import { describe, expect, it } from 'vitest';
import { telephoneMauritanien } from './telephone.js';

describe('telephoneMauritanien', () => {
  it('accepte les huit chiffres, avec ou sans indicatif, espaces, tirets, parenthèses', () => {
    for (const s of ['22123456', '22 12 34 56', '+222 22-12-34-56', '0022222123456', '(22) 12 34 56', '+22222123456']) {
      expect(telephoneMauritanien(s), s).toBe('22123456');
    }
    expect(telephoneMauritanien('36000000')).toBe('36000000');
    expect(telephoneMauritanien('45123456')).toBe('45123456');
  });

  it('refuse ce qui n’est pas un numéro mauritanien', () => {
    for (const s of ['12345678', '2212345', '221234567', 'SANSTEL-0042', 'admin@nour.test', '', '+33612345678', '+2224000000']) {
      expect(telephoneMauritanien(s), s).toBeNull();
    }
    expect(telephoneMauritanien(null)).toBeNull();
    expect(telephoneMauritanien(undefined)).toBeNull();
  });
});
