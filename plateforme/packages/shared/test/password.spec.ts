import { describe, expect, it } from 'vitest';
import { validatePassword, passwordIsValid, PASSWORD_MIN_LENGTH } from '../src/password.js';

/**
 * ⚠ OURS CHECKED LENGTH AND NOTHING ELSE. "aaaaaaaa" passed — and this is a
 * school that hands passwords to 1 372 families, some of whom keep whatever
 * they are given.
 */
describe('its password policy', () => {
  it('requires eight characters, as PASSWORD_MIN_LENGTH says', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(validatePassword('Ab3d')).toContain('au moins 8 caractères');
    expect(validatePassword('Ab3defg')).toContain('au moins 8 caractères');
  });

  it('⚠ refuses eight characters of one kind — the case ours let through', () => {
    expect(passwordIsValid('aaaaaaaa')).toBe(false);
    expect(passwordIsValid('12345678')).toBe(false);
    expect(passwordIsValid('AZERTYUI')).toBe(false);
    expect(validatePassword('aaaaaaaa')).toContain('3 types de caractères');
  });

  it('refuses two classes, accepts three', () => {
    // lower + digit only
    expect(passwordIsValid('motdepasse1')).toBe(false);
    // lower + upper + digit
    expect(passwordIsValid('Motdepasse1')).toBe(true);
    // lower + upper + symbol
    expect(passwordIsValid('Motdepasse!')).toBe(true);
    // lower + digit + symbol
    expect(passwordIsValid('motdepasse1!')).toBe(true);
  });

  it('⚠ three of four, not four — a symbol is not compulsory', () => {
    // Requiring a symbol from every parent on a phone keyboard is how you get
    // it written on the back of the enrolment form.
    expect(passwordIsValid('Rentree2026')).toBe(true);
    expect(validatePassword('Rentree2026')).toBe('');
  });

  it('says what would satisfy it, never just "invalid"', () => {
    for (const bad of ['court', 'aaaaaaaa']) {
      const message = validatePassword(bad);
      expect(message).not.toBe('');
      // Every rejection names either the length or the classes.
      expect(message).toMatch(/caractères/);
    }
  });

  it('accepts a long passphrase with a digit', () => {
    expect(passwordIsValid('Les enfants rentrent en octobre 2026')).toBe(true);
  });
});
