-- ============================================================================
--  0008_timetable — the weekly grid, per-assignment hourly rates, and the
--                   expulsion register
-- ============================================================================

-- ── Per-assignment hourly rate ──────────────────────────────────────────────
--
-- El Ourwa's `enseignements.prix_par_heure` is per ASSIGNMENT, not per teacher:
-- its own comment says the rate depends on the level taught. It falls back to
-- the teacher's default rate when unset, so NULL here means "use the teacher's
-- rate" and is not the same as 0.
ALTER TABLE teachings ADD COLUMN hourly_rate numeric(14,2);
COMMENT ON COLUMN teachings.hourly_rate IS
  'Rate for THIS assignment. NULL falls back to teachers.hourly_rate — not 0.';

-- ── The weekly timetable ────────────────────────────────────────────────────
--
-- El Ourwa: a 6-day × 3-slot grid, one teaching assignment per cell, unique on
-- (group, day, slot). Ported as ordinals rather than as its French enums
-- ('Lundi', '8h-9h45'): the ordering a timetable needs falls out of the numbers,
-- and a school that adds a fourth period then needs a row, not a migration.
--
--   day_of_week  1 = Monday … 7 = Sunday   (ISO 8601)
--   slot         1 = 08:00–09:45, 2 = 10:00–11:45, 3 = 12:00–14:00
--
-- The times themselves are a display concern and live in the UI. If a school
-- ever needs its own, they become a `timetable_periods` table — the shape here
-- does not have to change for that.
CREATE TABLE timetable_slots (
  id          uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  group_id    uuid NOT NULL,
  teaching_id uuid NOT NULL,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  slot        smallint NOT NULL CHECK (slot BETWEEN 1 AND 6),
  created_at  timestamptz NOT NULL DEFAULT now(),
  origin      record_origin NOT NULL DEFAULT 'native',
  legacy_id   integer,
  PRIMARY KEY (id),
  -- One lesson per cell. A class cannot be in two places at once, and this is
  -- the constraint that says so rather than the code that builds the grid.
  UNIQUE (school_id, group_id, day_of_week, slot),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, group_id)    REFERENCES groups    (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, teaching_id) REFERENCES teachings (school_id, id) ON DELETE CASCADE
);
CREATE INDEX timetable_group_idx ON timetable_slots (school_id, group_id, day_of_week, slot);
CREATE INDEX timetable_teaching_idx ON timetable_slots (school_id, teaching_id);

-- ── The expulsion register ──────────────────────────────────────────────────
--
-- ⚠ Blocking is by IDENTITY (NNI + RIM), not by student id, and that is the
-- whole point: it has to outlive the deletion of the student record. A family
-- that deletes and re-creates a child must not slip past it.
--
-- ⚠ SCHOOL-SCOPED, unlike El Ourwa's, which is global because El Ourwa is one
-- school and cannot express the difference. Expelling a child from one branch
-- must not silently blacklist them across a platform that branch does not
-- control — that is a decision for whoever runs the platform, not a side effect
-- of a local disciplinary matter. See docs/DECISIONS.md ADR-0014.
CREATE TABLE expulsions (
  id            uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id     uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  national_id   text NOT NULL,
  rim           text NOT NULL,
  first_name    text NOT NULL,
  last_name     text NOT NULL,
  reason        text,
  expelled_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  expelled_at   timestamptz NOT NULL DEFAULT now(),
  -- Lifting a block is recorded, never deleted: "was this child ever expelled"
  -- is a question the school will be asked, and DELETE cannot answer it.
  lifted_at     timestamptz,
  lifted_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  lift_reason   text,
  origin        record_origin NOT NULL DEFAULT 'native',
  legacy_id     integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id)
);
-- At most one LIVE block per identity per school; lifted ones stay for history.
CREATE UNIQUE INDEX expulsions_live_idx
  ON expulsions (school_id, national_id, rim)
  WHERE lifted_at IS NULL;
CREATE INDEX expulsions_nni_idx ON expulsions (school_id, national_id);
CREATE INDEX expulsions_rim_idx ON expulsions (school_id, rim);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['timetable_slots', 'expulsions']
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
