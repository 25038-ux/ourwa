-- ============================================================================
--  0009_partial_salaries — a salary may be paid in instalments
--
--  Answers the OPEN QUESTION recorded at the end of docs/DECISIONS.md, on the
--  owner's instruction. El Ourwa permits partial salary payments and we did not;
--  standing rule 26 says El Ourwa is right until proven otherwise, and nothing
--  proved otherwise. Half now and half at month end is an ordinary way for a
--  school with uneven cash flow to pay people, and forbidding it made us
--  stricter than the system we replace — a migration risk, not a safety feature.
-- ============================================================================

-- ⚠ THE ONE-PAYMENT-PER-MONTH INDEX GOES.
--
-- It was a deliberate guard against paying somebody twice by accident. What
-- replaces it is not "nothing": the rule is now "the month's payments may not
-- sum to more than the month's entitlement", which no unique index can express,
-- so it moves into PayrollService inside a transaction-scoped advisory lock.
--
-- The lock matters. Without it two clerks pressing "pay" at the same instant
-- both read the same remaining balance and both pay it, which is precisely the
-- double payment the index used to prevent.
DROP INDEX IF EXISTS salary_payments_once_idx;

-- The service reads a person's month on every payment to compute what is left.
-- The existing index leads with (school_id, calendar_year, calendar_month),
-- which does not serve that lookup.
CREATE INDEX salary_payments_payee_month_idx
  ON salary_payments (school_id, payee_kind, payee_id, calendar_year, calendar_month);

COMMENT ON COLUMN salary_payments.gross IS
  'The portion of the month''s gross THIS entry accounts for, not the month''s '
  'whole salary: amount paid + anything withheld on this entry. Summing a '
  'person''s month therefore reconstructs their reference pay exactly.';

COMMENT ON COLUMN salary_payments.loan_deduction IS
  'Withheld against a loan. Taken ONCE per month, on the first payment of that '
  'month — a deduction repeated on each instalment would repay the loan several '
  'times over from one month''s entitlement.';

COMMENT ON COLUMN salary_payments.net IS
  'What actually left the till for this entry. The financial report sums this.';
