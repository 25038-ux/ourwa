import { Decimal } from 'decimal.js';

/**
 * Money helpers. Standing rule 5: never `float`, `double` or a JS `number`.
 *
 * Amounts cross the wire as STRINGS and are parsed here. `toDisplay` is the only
 * place rounding happens — rounding mid-calculation drifts, and over thousands
 * of fee lines that becomes a balance you cannot explain to a parent.
 */

// Enough headroom for NUMERIC(14,2) without ever reaching for exponent notation.
Decimal.set({ precision: 28, toExpNeg: -9e15, toExpPos: 9e15 });

export type MoneyInput = string | Decimal;

export function money(value: MoneyInput): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value !== 'string') {
    throw new TypeError(
      `Money must be a string or Decimal, received ${typeof value}. ` +
        'A JS number here silently loses precision.',
    );
  }
  const parsed = new Decimal(value);
  if (!parsed.isFinite()) throw new RangeError(`Not a finite amount: ${value}`);
  return parsed;
}

export function sum(values: readonly MoneyInput[]): Decimal {
  return values.reduce<Decimal>((total, v) => total.plus(money(v)), new Decimal(0));
}

/** Round ONCE, here, at the point of display. */
export function toDisplay(value: MoneyInput, currency = 'MRU'): string {
  return `${money(value).toDecimalPlaces(2).toFixed(2)} ${currency}`;
}

/** The storage form: a plain string Postgres accepts for NUMERIC(14,2). */
export function toStorage(value: MoneyInput): string {
  return money(value).toDecimalPlaces(2).toFixed(2);
}

export function equals(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).equals(money(b));
}
