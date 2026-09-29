-- ============================================================================
--  0015 — «✓ Réglé par facture»
--
--  ⚠ AN IMPORT ARTEFACT THAT WOULD READ AS ARREARS ACROSS THE WHOLE SCHOOL.
--
--  El Ourwa's predecessor issued ONE invoice covering several things at once —
--  its own example is "Insc + Photocopieuse + Oct + Nov + Juin". El Ourwa's
--  migration v14 spread that receipt month by month, which means each of those
--  months received LESS than its own tariff.
--
--  Rendered naively, every one of them shows "Partiel" — a family who paid in
--  full, in one payment, displayed as owing money on five separate months. Its
--  own comment: "chaque mois recoit moins que le tarif et s'affichait
--  « Partiel » alors que la facture est integralement reglee."
--
--  We have not run the import yet, so no row is in this state today. That is
--  precisely why the column goes in now: the importer needs somewhere to record
--  it, and standing rule 23 forbids cutting over with a financial discrepancy.
--  Discovering this on cutover day, with 1 372 families showing false arrears,
--  is the scenario the rule exists to prevent.
--
--  Not a payment, not a discount, and deliberately neither: nothing about what
--  is OWED changes. The month is settled and this says how, so the screen can
--  stop calling it partial.
-- ============================================================================

ALTER TABLE enrollment_months
  ADD COLUMN covered_by_invoice boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN enrollment_months.covered_by_invoice IS
  'Imported: this month was settled inside a single multi-month invoice from '
  'the pre-El Ourwa software. The apportioned amount is less than the tariff, '
  'so the month must render "Réglé par facture" rather than "Partiel". '
  'Never set by the application — only by the importer.';

-- The caisse reads this per child, alongside the months themselves.
CREATE INDEX enrollment_months_covered_idx
  ON enrollment_months (school_id, enrollment_id)
  WHERE covered_by_invoice;
