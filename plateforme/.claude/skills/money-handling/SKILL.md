---
name: money-handling
description: Handle monetary amounts correctly. Use whenever writing code that reads, stores, computes or displays money — fees, payments, invoices, debts, salaries, expenses — or when reviewing such code.
---

# Money

This is a financial system holding fee records, debts and payroll for thousands of
families. Correctness outranks convenience at every decision point.

## The rules

| Layer | Type |
|---|---|
| Postgres | `NUMERIC(14,2)` — never `float`, `real`, `double precision`, `money` |
| Driver | returned as a **string** (`types.setTypeParser` in `packages/db/src/client.ts`) |
| TypeScript | `decimal.js`, or an untouched string |
| Dart | `Decimal`, or an untouched string |
| Display | rounded **once**, at the very end |

**Never a JS `number`.** `0.1 + 0.2 !== 0.3`, and a monthly fee of 2000 MRU across
2,000 students compounds that error into something a parent will one day dispute.

## Append-only

Financial records are never `UPDATE`d. A correction is a **reversing entry** that
points at what it reverses:

```ts
// Wrong — the original amount is gone, and so is the reason it changed.
await tx.query('UPDATE payments SET amount = $1 WHERE id = $2', [corrected, id]);

// Right — both rows survive, and the ledger explains itself.
await tx.query(
  `INSERT INTO payments (school_id, student_id, academic_year_id, calendar_month,
                         calendar_year, amount, receipt_number, reverses_id)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
  [schoolId, studentId, yearId, month, year, negatedAmount, receipt, originalId],
);
```

## Round once, at display

```ts
// Wrong — rounding inside the loop drifts.
let total = new Decimal(0);
for (const line of lines) total = total.plus(line.amount.toDecimalPlaces(2));

// Right — full precision throughout, rounded only when shown.
const total = lines.reduce((sum, l) => sum.plus(l.amount), new Decimal(0));
return total.toDecimalPlaces(2).toString();
```

## Currency is per school

Read it from `schools.currency`. Never hardcode `MRU`, never assume two branches
share a currency, and never add amounts from different schools without converting.

## Receipt numbers

Take them from `receipt_sequences` with `SELECT … FOR UPDATE`, inside the same
transaction as the payment:

```sql
SELECT last_number FROM receipt_sequences
 WHERE school_id = $1 AND year = $2 FOR UPDATE;
UPDATE receipt_sequences SET last_number = last_number + 1
 WHERE school_id = $1 AND year = $2 RETURNING last_number;
```

`MAX(number) + 1` races: two concurrent collections read the same maximum and issue
the same receipt number to two different families.

## Test first

Anything touching money gets its test written **before** the implementation
(standing rule 13). And stop and ask before changing money handling at all
(standing rule 14).

## Checklist

- [ ] No `float`/`double`/JS `number` anywhere on the path
- [ ] Column is `NUMERIC(14,2)` — `packages/db/test/rls.test.ts` asserts this for every column named `*amount*`, `*fee*`, `*rate*`, `*salary*`
- [ ] No `UPDATE` on a financial record
- [ ] Rounded once, at display
- [ ] Currency read from the school
- [ ] Receipt numbers from the sequence, `FOR UPDATE`, same transaction
- [ ] Test written first
