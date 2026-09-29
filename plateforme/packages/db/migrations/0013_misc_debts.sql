-- ============================================================================
--  0013_misc_debts — "dettes diverses", the debt that is not tuition
--
--  Found while replicating El Ourwa's Impayés screen, which has a column for it
--  that we could not fill. `dettes` there is a debt owed to the school that has
--  nothing to do with a monthly fee: a book not returned, a supply advanced, an
--  agreed catch-up. It has its own repayments, each with a receipt number.
--
--  ⚠ THE DEBTOR IS NAMED, not merely linked.
--
--  `debiteur_nom` is a column in El Ourwa and not a join, and that is not
--  sloppiness: a debt can be owed by somebody who is not a parent of a current
--  pupil — a former family, a supplier, a member of staff — and it must survive
--  the deletion of whatever record they once had. The student link is optional
--  for the same reason.
-- ============================================================================

CREATE TABLE misc_debts (
  id            uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id     uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  -- Optional: a debt may attach to a pupil, or stand on its own.
  student_id    uuid,
  -- Optional: the family, when there is one. Impayés groups by this.
  guardian_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  -- ALWAYS present. See above — this is what the receipt says.
  debtor_name   text NOT NULL,
  phone         text,
  -- El Ourwa's `nb_mois`: what the debt represents, informationally.
  months        smallint NOT NULL DEFAULT 1,
  total         numeric(14,2) NOT NULL CHECK (total > 0),
  repaid        numeric(14,2) NOT NULL DEFAULT 0,
  reason        text,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  origin        record_origin NOT NULL DEFAULT 'native',
  legacy_id     integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, student_id) REFERENCES students (school_id, id) ON DELETE SET NULL
);
CREATE INDEX misc_debts_guardian_idx ON misc_debts (school_id, guardian_id);
-- El Ourwa's `idx_dette_solde`: the Impayés list asks for debts not yet settled.
CREATE INDEX misc_debts_balance_idx ON misc_debts (school_id, total, repaid);

CREATE TABLE misc_debt_repayments (
  id             uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  debt_id        uuid NOT NULL,
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
  receipt_number text,
  recorded_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  repaid_at      timestamptz NOT NULL DEFAULT now(),
  origin         record_origin NOT NULL DEFAULT 'native',
  legacy_id      integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, debt_id) REFERENCES misc_debts (school_id, id) ON DELETE CASCADE
);
CREATE INDEX misc_debt_repayments_debt_idx ON misc_debt_repayments (school_id, debt_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['misc_debts', 'misc_debt_repayments']
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
