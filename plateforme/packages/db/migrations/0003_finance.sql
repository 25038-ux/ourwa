-- ============================================================================
--  0003_finance — exemptions, discounts, write-offs, annual family fees
--
--  Authority: ARCHITECTURE.md §8, PROJECT.md §2.3 and Phase 4.
--
--  NOTE ON INVOICES. El Ourwa's `factures` are almost entirely artefacts of its
--  own import from the software that preceded it; natively it bills month by
--  month through `inscription_mois`. With no migration in scope (ADR-0010) there
--  are no legacy invoices to carry, so billing here is month-based and the debt
--  rule reduces to its first term. The invoice-remainder term is reinstated the
--  day an import is scheduled — the debt service is written so that is an
--  addition, not a rewrite.
-- ============================================================================

-- A month, or a whole student, excused from paying.
CREATE TABLE exemptions (
  id             uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id     uuid NOT NULL,
  -- 'full'    : the student pays nothing, ever
  -- 'monthly' : one named month is excused
  kind           text NOT NULL CHECK (kind IN ('full', 'monthly')),
  calendar_month smallint CHECK (calendar_month BETWEEN 1 AND 12),
  calendar_year  smallint,
  reason         text,
  granted_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  origin         record_origin NOT NULL DEFAULT 'native',
  legacy_id      integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  -- A monthly exemption names a month; a full one must not.
  CHECK ((kind = 'monthly') = (calendar_month IS NOT NULL AND calendar_year IS NOT NULL)),
  FOREIGN KEY (school_id, student_id) REFERENCES students (school_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX exemptions_monthly_uq
  ON exemptions (school_id, student_id, calendar_month, calendar_year)
  WHERE kind = 'monthly';
CREATE UNIQUE INDEX exemptions_full_uq
  ON exemptions (school_id, student_id) WHERE kind = 'full';
CREATE INDEX exemptions_school_student_idx ON exemptions (school_id, student_id);

-- A reduction in what one month costs. Distinct from a write-off: a discount
-- lowers the price BEFORE it is owed; a write-off forgives debt already owed.
CREATE TABLE discounts (
  id             uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id     uuid NOT NULL,
  calendar_month smallint NOT NULL CHECK (calendar_month BETWEEN 1 AND 12),
  calendar_year  smallint NOT NULL,
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
  reason         text,
  granted_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  origin         record_origin NOT NULL DEFAULT 'native',
  legacy_id      integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, student_id, calendar_month, calendar_year),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, student_id) REFERENCES students (school_id, id) ON DELETE CASCADE
);

-- Forgiveness of debt already owed. A direction decision, revocable, and kept
-- when revoked so the trail survives.
CREATE TABLE debt_write_offs (
  id               uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  guardian_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  academic_year_id uuid,
  amount           numeric(14,2) NOT NULL DEFAULT 0,
  -- 1 = the family's debt is brought to zero outright.
  clears_all       boolean NOT NULL DEFAULT false,
  reason           text,
  granted_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Revoked, not deleted.
  revoked_at       timestamptz,
  revoked_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_reason   text,
  origin           record_origin NOT NULL DEFAULT 'native',
  legacy_id        integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, academic_year_id)
    REFERENCES academic_years (school_id, id) ON DELETE SET NULL
);
CREATE INDEX debt_write_offs_guardian_idx
  ON debt_write_offs (school_id, guardian_id) WHERE revoked_at IS NULL;

-- Inscription and photocopy fees: due ONCE PER FAMILY PER YEAR, not per child.
-- If an elder sibling has already paid, the remainder is zero and the UI says
-- so rather than charging twice.
CREATE TABLE family_fee_payments (
  id               uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  guardian_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('enrolment', 'photocopy')),
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  receipt_number   text NOT NULL,
  paper_reference  text,
  recorded_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  paid_at          timestamptz NOT NULL DEFAULT now(),
  origin           record_origin NOT NULL DEFAULT 'native',
  legacy_id        integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, receipt_number),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, academic_year_id)
    REFERENCES academic_years (school_id, id) ON DELETE CASCADE
);
CREATE INDEX family_fee_payments_guardian_idx
  ON family_fee_payments (school_id, guardian_id, academic_year_id, kind);

-- A family excused an annual fee entirely.
CREATE TABLE family_fee_exemptions (
  id               uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  guardian_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('enrolment', 'photocopy')),
  -- NULL = every year.
  academic_year_id uuid,
  granted_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (school_id, guardian_id, kind, academic_year_id),
  UNIQUE (school_id, id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'exemptions', 'discounts', 'debt_write_offs',
    'family_fee_payments', 'family_fee_exemptions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING      (school_id = current_school_id())
        WITH CHECK (school_id = current_school_id())
    $f$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  exemptions, discounts, debt_write_offs, family_fee_payments, family_fee_exemptions
  TO app_user;
GRANT SELECT ON
  exemptions, discounts, debt_write_offs, family_fee_payments, family_fee_exemptions
  TO app_reporter;
