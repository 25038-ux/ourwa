-- ============================================================================
--  0020 — autoriser une réinscription malgré la dette, et corriger une créance
--
--  The last two actions of `reinscriptions.php` with nowhere to live:
--
--    autoriser                      -> reenrolment_authorisations
--    dette_modifier / dette_annuler -> misc_debts.corrected_*
-- ============================================================================

-- ── 1. « AUTORISÉE MALGRÉ DETTE » ───────────────────────────────────────────
--
-- ⚠ THIS WAS A FLAG ON A FUNCTION CALL, AND IT NEEDED TO BE A RECORD.
-- `enrol()` takes `bypassDebt`, checked against `scolarite.niveaux` — which is
-- right as far as it goes, and goes only as far as the one call. El Ourwa
-- stores the decision, and its own screen depends on that: the bulk
-- re-enrolment page prints "Autorisée malgré dette" as a STATE of the family,
-- sorts the blocked families to the top, and stops offering the decision once
-- it has been made.
--
-- ⚠ AND IT RECORDS THE AMOUNT AS IT STOOD AT THE MOMENT. `montant_du` is
-- captured when the authorisation is granted, not read back later, because the
-- question an auditor asks is "how much was owed when somebody waved this
-- through?" — and the debt moves afterwards, in both directions.
CREATE TABLE reenrolment_authorisations (
  id               uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id       uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  -- What the family owed at the moment of the decision. Frozen on purpose.
  amount_owed      numeric(14,2) NOT NULL DEFAULT 0,
  reason           text,
  authorised_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  authorised_at    timestamptz NOT NULL DEFAULT now(),
  -- A decision can be taken back before it is used; the row stays either way,
  -- because "who allowed this and then changed their mind" is also a fact.
  revoked_at       timestamptz,
  revoked_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  origin           record_origin NOT NULL DEFAULT 'native',
  legacy_id        integer,
  PRIMARY KEY (id),
  -- One live decision per child per year, as its `ON DUPLICATE KEY UPDATE`
  -- implies: authorising twice is the same authorisation, not two.
  UNIQUE (school_id, student_id, academic_year_id),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, student_id)
    REFERENCES students (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, academic_year_id)
    REFERENCES academic_years (school_id, id) ON DELETE CASCADE
);
CREATE INDEX reenrolment_authorisations_year_idx
  ON reenrolment_authorisations (school_id, academic_year_id)
  WHERE revoked_at IS NULL;

COMMENT ON COLUMN reenrolment_authorisations.amount_owed IS
  'What the family owed when the decision was taken. Frozen: the question later '
  'is how much was owed at the time, and the debt moves afterwards.';

-- ── 2. CORRIGER OU ANNULER UNE CRÉANCE ──────────────────────────────────────
--
-- `dette_modifier` and `dette_annuler`. El Ourwa's own comment on the second is
-- the specification for both:
--
--   "DELETE (non destructif) — la ligne est conservee, son solde tombe a 0 et
--    le motif est enregistre. Supprimer la ligne detruirait la trace comptable
--    de ce qui avait ete reclame a la famille."
--
-- ⚠ `total` IS WHAT WAS CLAIMED AND NEVER CHANGES. El Ourwa keeps it and edits
-- `solde`; we compute the remainder as `total - repaid`, so a correction needs
-- somewhere of its own to live. `corrected_balance` OVERRIDES that computation
-- when set — so the claim, the payments and the correction are three separate
-- facts, and none of them overwrites another.
--
-- Cancelling is `corrected_balance = 0`. It is the same operation with a
-- different number, which is why there is one column and not two.
ALTER TABLE misc_debts
  ADD COLUMN corrected_balance numeric(14,2) CHECK (corrected_balance >= 0),
  ADD COLUMN correction_reason text,
  ADD COLUMN corrected_at      timestamptz,
  ADD COLUMN corrected_by      uuid REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN misc_debts.corrected_balance IS
  'When set, THIS is what remains — not total - repaid. The claim and the '
  'payments stay untouched so the trail of what was asked for survives the '
  'correction. Zero means the claim was cancelled (dette_annuler).';

-- ── 3. RLS on the new table ────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reenrolment_authorisations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING      (school_id = current_school_id())
        WITH CHECK (school_id = current_school_id())
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
    EXECUTE format('GRANT SELECT ON %I TO app_reporter', t);
  END LOOP;
END $$;
