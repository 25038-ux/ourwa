import { describe, expect, it } from 'vitest';
import { academicYearOfMonth, firstOwedMonthOrder, payableMonths } from '../src/academic-year.js';

const YEAR_2026 = { startYear: 2026, startMonth: 10, endMonth: 6 };

describe('payableMonths', () => {
  it('runs October to June — nine months', () => {
    const months = payableMonths(YEAR_2026);
    expect(months).toHaveLength(9);
    expect(months[0]).toMatchObject({ order: 1, month: 10, year: 2026 });
    expect(months[8]).toMatchObject({ order: 9, month: 6, year: 2027 });
  });

  it('places October-December in the opening year and January-June in the closing one', () => {
    const months = payableMonths(YEAR_2026);
    expect(months.filter((m) => m.year === 2026).map((m) => m.month)).toEqual([10, 11, 12]);
    expect(months.filter((m) => m.year === 2027).map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('academicYearOfMonth', () => {
  it('assigns a calendar year to the right academic year on both sides of the boundary', () => {
    expect(academicYearOfMonth(11, 2026)).toBe(2026);
    expect(academicYearOfMonth(3, 2027)).toBe(2026);
    expect(academicYearOfMonth(10, 2027)).toBe(2027);
  });
});

describe('the rule of the 25th', () => {
  it('bills the entry month when entry is on or before the 25th', () => {
    expect(firstOwedMonthOrder(YEAR_2026, '2026-11-25')).toBe(2); // November
  });

  it('bills the following month when entry is after the 25th', () => {
    expect(firstOwedMonthOrder(YEAR_2026, '2026-11-26')).toBe(3); // December
  });

  it('treats the 25th itself as inclusive — the boundary case that matters', () => {
    expect(firstOwedMonthOrder(YEAR_2026, '2026-10-25')).toBe(1);
    expect(firstOwedMonthOrder(YEAR_2026, '2026-10-26')).toBe(2);
  });

  it('crosses the calendar-year boundary correctly', () => {
    expect(firstOwedMonthOrder(YEAR_2026, '2026-12-26')).toBe(4); // January 2027
  });

  it('does not let an earlier year pull the first month backwards', () => {
    expect(firstOwedMonthOrder(YEAR_2026, '2024-03-02')).toBe(1);
  });

  it('owes every month when the entry date falls after the year has ended (his debut_effectif_annee: the date does not describe this year)', () => {
    expect(firstOwedMonthOrder(YEAR_2026, '2027-08-01')).toBe(1);
  });

  it('defaults to the first month when no entry date is recorded', () => {
    expect(firstOwedMonthOrder(YEAR_2026, null)).toBe(1);
    expect(firstOwedMonthOrder(YEAR_2026, 'not-a-date')).toBe(1);
  });
});
