-- ============================================================================
--  0014_tender_lines — one ledger for HOW money moved, in both directions
--
--  Closes open issue 1. El Ourwa posts every movement into `paiement_lignes`
--  with a `sens` of entrant or sortant, and eleven source types use it:
--
--      paiement · frais_annuel · cours_soir · cours_soir_prof · depense
--      salaire · pret_personnel · pret_remb · dette · dette_creation
--      admin_retrait
--
--  Here only tuition did. So nothing recorded how a salary, an expense or a
--  withdrawal actually left the till, and the "Synthèse par moyen de paiement"
--  on Rapport Financier could fill its Entrées column and not its Sorties.
--
--  ⚠ THIS REPLACES `payment_lines`, IT DOES NOT SIT BESIDE IT.
--
--  Two ledgers for the same fact would drift, and the one nobody updated would
--  be the one somebody reported from. Existing rows are copied across as
--  `paiement`, then the old table goes.
-- ============================================================================

CREATE TYPE tender_direction AS ENUM ('in', 'out');

CREATE TABLE tender_lines (
  id                uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id         uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  -- Polymorphic, exactly as El Ourwa's is. A foreign key per source would mean
  -- eleven nullable columns and a check constraint nobody maintains.
  source_type       text NOT NULL,
  source_id         uuid NOT NULL,
  payment_method_id uuid NOT NULL,
  amount            numeric(14,2) NOT NULL,
  direction         tender_direction NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  origin            record_origin NOT NULL DEFAULT 'native',
  legacy_id         integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, payment_method_id)
    REFERENCES payment_methods (school_id, id) ON DELETE RESTRICT
);

-- Its four indexes, for the four questions actually asked: what made up this
-- receipt, what moved through this method, what moved in this direction, and
-- what moved on this day.
CREATE INDEX tender_lines_source_idx ON tender_lines (school_id, source_type, source_id);
CREATE INDEX tender_lines_method_idx ON tender_lines (school_id, payment_method_id);
CREATE INDEX tender_lines_direction_idx ON tender_lines (school_id, direction, created_at);
CREATE INDEX tender_lines_date_idx ON tender_lines (school_id, created_at);

-- ── Carry the existing lines over ───────────────────────────────────────────
--
-- `created_at` is taken from the PAYMENT, not from now(): these lines are as old
-- as the receipt they belong to, and stamping them today would move a year of
-- collections into this afternoon on every report keyed by date.
INSERT INTO tender_lines
  (school_id, source_type, source_id, payment_method_id, amount, direction, created_at, origin)
SELECT l.school_id, 'paiement', l.payment_id, l.payment_method_id, l.amount,
       CASE WHEN l.direction = 'out' THEN 'out'::tender_direction
            ELSE 'in'::tender_direction END,
       p.paid_at, l.origin
  FROM payment_lines l
  JOIN payments p ON p.id = l.payment_id;

DROP TABLE payment_lines;

ALTER TABLE tender_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_lines FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tender_lines
  USING      (school_id = current_school_id())
  WITH CHECK (school_id = current_school_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tender_lines TO app_user;
GRANT SELECT ON tender_lines TO app_reporter;

COMMENT ON TABLE tender_lines IS
  'How money moved, both directions. One row per means of payment per movement. '
  'source_type is one of El Ourwa''s: paiement, frais_annuel, cours_soir, '
  'depense, salaire, pret_personnel, pret_remb, dette, admin_retrait.';
