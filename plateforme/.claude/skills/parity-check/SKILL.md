---
name: parity-check
description: Verify a ported feature against El Ourwa on the same data. Use when marking any docs/FEATURES.md row as parity verified, when a computed figure differs from the legacy system, or when deciding whether legacy behaviour is a bug or a requirement.
---

# Parity check

El Ourwa contains years of accumulated correctness — fee rules, debt
decomposition, bulletin formulas, edge cases nobody remembers deciding. A rewrite
that "looks right" will be wrong in ways nobody notices until a parent disputes a
balance.

**The only defensible standard: the new system produces identical numbers from
identical data.**

## Before you mark a row ☑

1. **Read the El Ourwa source first.** Not the schema, the PHP. Behaviour is the
   specification, including behaviour that looks odd.
2. **Run the same input through both systems.**
3. **Compare as strings or decimals, never as JS numbers.** `0.1 + 0.2` will make
   a matching pair look different.
4. **Check the edges, not just the happy path** — the empty case, the single-row
   case, the absent marker, the free student, the mid-year arrival.
5. Only then update `docs/FEATURES.md`.

## The check shape

```typescript
type CheckResult = {
  name: string;
  legacy: string;      // El Ourwa value, as a string — never a float
  current: string;     // new platform value
  match: boolean;
  delta?: string;
  sample?: unknown[];  // up to 10 offending rows when mismatched
};
```

Checks live in `tools/reconcile/checks/`, run with `pnpm reconcile`, and exit 1 on
any mismatch so CI can gate on them.

## When the numbers differ

**A mismatch is a blocking defect.** Not a rounding curiosity, not "close
enough." Investigate until you know the cause.

**El Ourwa is right until proven otherwise.** It has been reconciled against
reality for years; your new code has not. Start from the assumption that the new
code is wrong.

**Sometimes El Ourwa is genuinely wrong.** If you find a real legacy bug:

- record it in `docs/DECISIONS.md` with evidence — the query, the rows, the figure
- **ask before "fixing" it**

The school may have been working around it for years, and their expectations —
and possibly their paper records — are built on the current behaviour. Silently
correcting it changes numbers the school believes it already knows.

## Traps that produce quiet mismatches

| Symptom | Cause |
|---|---|
| Money off by pennies | `pg` type parser not configured; `NUMERIC` became a float |
| Averages slightly wrong | `note_absent = -1` counted as a grade instead of excluded |
| Debt too high | A month counted both directly and through its invoice |
| Debt too low | Auto-exemption applied across years instead of within one |
| Counts too high | Reading `students.group_id` (a cache) instead of the enrolment |
| Counts too low | Filtering on the administratively active year rather than the year with data |

## Definition of done for a ported feature

1. Works on seeded data
2. Has a test
3. Where it touches money or grades, reconciles against El Ourwa
4. `docs/FEATURES.md` updated
5. Committed with a message explaining *why*, not just *what*
