import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { money, sum, toDisplay, toStorage, equals } from '../src/money.js';
import { NOTE_ABSENT, isAbsent, countedScores } from '../src/grades.js';

describe('money', () => {
  it('refuses a JS number outright', () => {
    // The whole point: a number that reaches here has already lost precision
    // somewhere upstream, so failing loudly is better than accepting it.
    expect(() => money(1234.56 as never)).toThrow(/must be a string or Decimal/);
  });

  it('adds without floating-point drift', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. This is the canonical case.
    expect(sum(['0.10', '0.20']).toString()).toBe('0.3');
    expect(equals(sum(['0.10', '0.20']), '0.30')).toBe(true);
  });

  it('keeps precision across many fee lines', () => {
    const lines = Array.from({ length: 2000 }, () => '2000.33');
    expect(toStorage(sum(lines))).toBe('4000660.00');
  });

  it('rounds once, at display', () => {
    const total = sum(['0.005', '0.005', '0.005']);
    expect(total.toString()).toBe('0.015');
    expect(toDisplay(total, 'MRU')).toBe('0.02 MRU');
  });

  it('never uses exponent notation for realistic amounts', () => {
    expect(toStorage('12345678901.23')).toBe('12345678901.23');
  });

  it('rejects a non-finite amount', () => {
    expect(() => money('not-a-number')).toThrow();
  });

  it('accepts a Decimal unchanged', () => {
    expect(money(new Decimal('42.50')).toString()).toBe('42.5');
  });
});

describe('the absent marker', () => {
  it('recognises -1 as absent, in every representation', () => {
    expect(isAbsent(-1)).toBe(true);
    expect(isAbsent('-1')).toBe(true);
    expect(isAbsent('-1.00')).toBe(true);
    expect(NOTE_ABSENT).toBe(-1);
  });

  it('does not mistake a real low mark for absence', () => {
    expect(isAbsent('0')).toBe(false);
    expect(isAbsent('1')).toBe(false);
  });

  it('excludes absent markers before averaging', () => {
    // Averaging [-1, 10, 12] gives 7 — wrong, and wrong quietly.
    // Excluding first gives 11, which is the student's actual standing.
    const rows = [{ s: '-1' }, { s: '10' }, { s: '12' }];
    const counted = countedScores(rows, (r) => r.s);
    expect(counted).toHaveLength(2);

    const average = sum(counted.map((r) => r.s)).dividedBy(counted.length);
    expect(average.toString()).toBe('11');
  });

  it('returns nothing to average when every mark is absent', () => {
    const rows = [{ s: '-1' }, { s: '-1' }];
    expect(countedScores(rows, (r) => r.s)).toHaveLength(0);
  });
});
