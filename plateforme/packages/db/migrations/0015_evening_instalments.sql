-- ============================================================================
--  0015_evening_instalments — an evening teacher may be paid in instalments
--
--  Same reasoning as 0009 did for the day-school payroll, applied to the other
--  place the school pays people. El Ourwa permits a partial payment here too —
--  `cours_du_soir.php` writes `ON DUPLICATE KEY UPDATE montant = montant + …`,
--  so a second payment lands on the first row and the two become one number.
--
--  ⚠ WE KEEP THE PARTIAL PAYMENT AND REFUSE THE ACCUMULATION.
--
--  Accumulating is an UPDATE to a financial record (standing rule 7). It loses
--  who paid which half and when, which is the whole content of an audit trail
--  for a cash payment handed over in an office. Two instalments become two rows.
-- ============================================================================

-- The unique key was what forced the accumulation. What replaces it is not
-- "nothing": the rule is now "a month's payments may not sum to more than the
-- month's entitlement", which no unique index can express, so it moves into
-- EveningService inside a transaction-scoped advisory lock — exactly as
-- PayrollService does since 0009.
--
-- The lock is the point. Without it two clerks pressing "payer" at the same
-- instant both read the same remaining balance and both pay it in full.
-- Dropped BY LOOKUP, not by name. Postgres truncates a generated constraint
-- name to 63 bytes, and this one is longer than that -- writing out the name I
-- expected silently dropped nothing and the migration "succeeded".
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
    FROM pg_constraint
   WHERE conrelid = 'evening_teacher_payments'::regclass
     AND contype = 'u'
     AND (SELECT array_agg(attname::text ORDER BY attname::text)
            FROM unnest(conkey) k
            JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = k)
         = ARRAY['calendar_month', 'calendar_year', 'evening_teaching_id', 'school_id'];
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE evening_teacher_payments DROP CONSTRAINT %I', c);
  END IF;
END $$;

-- The service reads a teaching's month on every payment to compute what is
-- left, so that lookup gets an index of its own.
CREATE INDEX IF NOT EXISTS evening_teacher_payments_month_idx
  ON evening_teacher_payments (school_id, evening_teaching_id, calendar_year, calendar_month);

COMMENT ON TABLE evening_teacher_payments IS
  'One row per payment, not per month. A month may be settled in several '
  'instalments; summing them gives what the teacher has received. Never '
  'updated — a correction is a further row.';
