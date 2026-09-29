-- ============================================================================
--  0016 — LES MOIS PAYABLES D'UNE ANNÉE SCOLAIRE, choisis un par un
--
--  ⚠ WE MODELLED A RANGE; EL OURWA MODELS A SET, AND THE DIFFERENCE IS REAL.
--
--  `academic_years.start_month` / `end_month` can only say "October through
--  June". Its `annee_scolaire_mois` is a row per month with a checkbox, and its
--  own page exists to tick them: "Sélectionnez les mois de l'année scolaire
--  durant lesquels les parents doivent payer les frais de scolarité".
--
--  A range cannot express a year that skips a month. A school that does not
--  bill for the month of Ramadan, or opens late after building works, has no
--  way to say so — and every enrolment's schedule is generated from this, so the
--  gap becomes a month of fees invented for every family at once.
--
--  It also matters for the import: if the real `annee_scolaire_mois` has a hole
--  in it, a range silently fills it in.
--
--  ⚠ EMPTY MEANS THE RANGE, NOT "NO MONTHS". A year nobody has configured must
--  keep behaving exactly as it does today — the set is an override, and the
--  absence of one is not a school that bills nothing. The same shape as its own
--  `empty($mois_grp) ? true` for evening groups.
-- ============================================================================

CREATE TABLE academic_year_months (
  id               uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL,
  -- The civil month. Its own table stores the month alone and derives the year
  -- from the school year's span, which is the same thing said differently.
  calendar_month   smallint NOT NULL CHECK (calendar_month BETWEEN 1 AND 12),
  created_at       timestamptz NOT NULL DEFAULT now(),
  origin           record_origin NOT NULL DEFAULT 'native',
  PRIMARY KEY (id),
  UNIQUE (school_id, academic_year_id, calendar_month),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, academic_year_id)
    REFERENCES academic_years (school_id, id) ON DELETE CASCADE
);

CREATE INDEX academic_year_months_year_idx
  ON academic_year_months (school_id, academic_year_id, calendar_month);

ALTER TABLE academic_year_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_year_months FORCE ROW LEVEL SECURITY;

-- The same predicate every other tenant table uses. `current_school_id()`
-- handles an unset context; comparing `current_setting(...)::uuid` directly
-- raises on the empty string instead of returning no rows.
CREATE POLICY tenant_isolation ON academic_year_months
  USING      (school_id = current_school_id())
  WITH CHECK (school_id = current_school_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON academic_year_months TO app_user;
GRANT SELECT ON academic_year_months TO app_reporter;

COMMENT ON TABLE academic_year_months IS
  'The months of a school year that families are billed for, chosen one by one. '
  'EMPTY MEANS the year''s start_month..end_month range, not "no months": the '
  'set is an override and its absence is not a school that bills nothing.';
