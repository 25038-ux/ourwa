-- ============================================================================
--  0016_bulletin_formulas — the report-card formula, per level and per term
--
--  `notes_etudiants.php`, action `config_formule`, table `bulletin_formules`.
--
--  ⚠ THE SCHOOL DECIDES HOW A SUBJECT MARK IS COMPUTED, AND WE HAD HARD-CODED IT.
--
--      moyenne = (moyenne des devoirs × A + examen × B) / C
--
--  El Ourwa's defaults are A=2, B=3, C=5 -- which is the 0.4/0.6 split its
--  `saisir_notes.php` shows live. But they are DEFAULTS, and the direction can
--  change them per level and per term from that screen. A primary level may
--  weight continuous assessment more heavily than a leaving year does.
--
--  Computing every bulletin with 2/3/5 regardless is not a missing feature, it
--  is a WRONG NUMBER on a document a family keeps: a level configured 3/2/5
--  would have every mark quietly mis-weighted, and nothing on the page would say
--  so. Standing rule 11's neighbour -- a grade error is silent.
--
--  Not tenant-shared: the formula belongs to a level, and a level belongs to a
--  school, so this table carries `school_id` and its own policy like every other.
-- ============================================================================

CREATE TABLE bulletin_formulas (
  id                uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id         uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  level_id          uuid NOT NULL,
  term              smallint NOT NULL CHECK (term BETWEEN 1 AND 3),

  -- A -- weight on the MEAN of the coursework marks, not on their sum.
  coursework_weight numeric(6,2) NOT NULL DEFAULT 2 CHECK (coursework_weight >= 0),
  -- B -- weight on the exam.
  exam_weight       numeric(6,2) NOT NULL DEFAULT 3 CHECK (exam_weight >= 0),
  -- C -- the divisor. Its own validation refuses zero, and so does this: a
  -- divisor of zero is a division by zero on every bulletin of that level.
  divisor           numeric(6,2) NOT NULL DEFAULT 5 CHECK (divisor > 0),

  updated_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  origin            record_origin NOT NULL DEFAULT 'native',
  legacy_id         integer,

  PRIMARY KEY (id),
  -- One formula per level per term. Setting it again UPDATES: this is a
  -- configuration, not a financial record, and its history lives in the audit
  -- log rather than in a pile of superseded rows.
  UNIQUE (school_id, level_id, term),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, level_id) REFERENCES levels (school_id, id) ON DELETE CASCADE
);

CREATE INDEX bulletin_formulas_level_idx
  ON bulletin_formulas (school_id, level_id, term);

ALTER TABLE bulletin_formulas ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulletin_formulas FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bulletin_formulas
  USING      (school_id = current_school_id())
  WITH CHECK (school_id = current_school_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON bulletin_formulas TO app_user;
GRANT SELECT ON bulletin_formulas TO app_reporter;

COMMENT ON TABLE bulletin_formulas IS
  'moyenne = (moyenne des devoirs * coursework_weight + examen * exam_weight) '
  '/ divisor. El Ourwa''s bulletin_formules. Absent when the level uses the '
  'default 2/3/5.';
