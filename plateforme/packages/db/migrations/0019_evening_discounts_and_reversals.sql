-- ============================================================================
--  0019 — a reduction on an evening enrolment, and a cancelled teacher payment
--
--  Two actions of `cours_du_soir.php` that had no home in the schema:
--
--    appliquer_reduction_cs / retirer_reduction_cs   -> evening_discounts
--    annuler_paiement_prof_cs                        -> a reversing entry
-- ============================================================================

-- ── 1. LA RÉDUCTION SUR UNE INSCRIPTION AU COURS DU SOIR ────────────────────
--
-- ⚠ WHY NOT `discounts`. That table is keyed on `student_id NOT NULL` with a
-- composite foreign key into `students`, and an evening enrolee may be an
-- OUTSIDER — a walk-in with a name and a phone number and no student row at
-- all. Widening it would mean making `student_id` nullable, which drops the
-- guarantee that every school discount points at a real child of the same
-- school, and adding a discriminator that every existing query would then have
-- to remember to filter on.
--
-- El Ourwa took that road: one `reductions` table with a `contexte` column and
-- two nullable foreign keys. It works, and it means the day-school debt query
-- is one forgotten `WHERE contexte = 'scolarite'` away from subtracting an
-- evening reduction from a family's tuition.
--
-- A separate table makes that mistake unavailable. The day-school queries
-- cannot see these rows because they are not in the table they read.
CREATE TABLE evening_discounts (
  id                  uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id           uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  evening_enrolment_id uuid NOT NULL,
  calendar_month      smallint NOT NULL CHECK (calendar_month BETWEEN 1 AND 12),
  calendar_year       smallint NOT NULL,
  -- Strictly positive: a "reduction" of zero is not a decision, and a negative
  -- one is a surcharge nobody agreed to.
  amount              numeric(14,2) NOT NULL CHECK (amount > 0),
  reason              text,
  granted_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  origin              record_origin NOT NULL DEFAULT 'native',
  legacy_id           integer,
  PRIMARY KEY (id),
  -- One reduction per enrolment per month, as its `ON DUPLICATE KEY UPDATE`
  -- implies. A second one for the same month replaces the first rather than
  -- stacking, because two reductions on one month is not a thing the school
  -- decides — it is a mistake being made twice.
  UNIQUE (school_id, evening_enrolment_id, calendar_month, calendar_year),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, evening_enrolment_id)
    REFERENCES evening_enrolments (school_id, id) ON DELETE CASCADE
);
CREATE INDEX evening_discounts_month_idx
  ON evening_discounts (school_id, evening_enrolment_id, calendar_year, calendar_month);

COMMENT ON TABLE evening_discounts IS
  'Reduction on one month of one evening enrolment — cours_du_soir.php, '
  'appliquer_reduction_cs. Deliberately NOT `discounts`: an evening enrolee may '
  'be an outsider with no student row, and keeping the two apart stops a '
  'day-school debt query from ever subtracting an evening reduction.';

-- ── 2. ANNULER UN PAIEMENT DE PROFESSEUR DU SOIR ────────────────────────────
--
-- ⚠ EL OURWA DELETES THE ROW, AND ITS TENDER LINES WITH IT. `DELETE FROM
-- cs_paiements_profs` then `DELETE FROM paiement_lignes` — so a salary that was
-- handed over in cash, and then cancelled, leaves the ledger with no trace that
-- either thing happened. The money left the drawer and the books say it never
-- did.
--
-- Standing rule 7: financial records are append-only, and a correction is a
-- reversing entry. This is the same shape `salary_payments` has carried since
-- 0009 — a negative row pointing at the original, the original flagged, and
-- BOTH halves excluded from every total.
ALTER TABLE evening_teacher_payments
  ADD COLUMN reverses_id uuid REFERENCES evening_teacher_payments(id) ON DELETE SET NULL,
  ADD COLUMN reversed    boolean NOT NULL DEFAULT false,
  ADD COLUMN note        text;

-- ⚠ The amount CHECK, if there were one, would have to allow negatives now.
-- There is none on this column, so nothing to relax — recorded here because the
-- next person will look for it.

CREATE INDEX evening_teacher_payments_live_idx
  ON evening_teacher_payments (school_id, evening_teaching_id, calendar_year, calendar_month)
  WHERE reversed = false AND reverses_id IS NULL;

COMMENT ON COLUMN evening_teacher_payments.reverses_id IS
  'The payment this entry cancels. Both halves are excluded from what a month '
  'counts as paid — the cancelled entry and the cancellation.';

-- ── 3. RLS, on the new table, like every other tenant table ─────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['evening_discounts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING      (school_id = current_school_id())
        WITH CHECK (school_id = current_school_id())
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
    -- Reporting reads it: an evening reduction is revenue the school chose not
    -- to take, and a revenue report that cannot see it overstates the month.
    EXECUTE format('GRANT SELECT ON %I TO app_reporter', t);
  END LOOP;
END $$;
