-- ============================================================================
--  0021 — la grille des créneaux des cours du soir  (`cs_emploi`)
--
--  `cours_du_soir.php`, actions `placer_creneau` and `effacer_creneau`, and the
--  "Emploi du temps (Grille des créneaux)" table they fill.
-- ============================================================================

-- ⚠ UN CRÉNEAU SE POSE SUR UNE MATIÈRE, PAS SUR UN PROFESSEUR, and the modal
-- says so in as many words: "un créneau se pose sur une matière, et une matière
-- naît de l'assignation d'un professeur". The teacher is optional — its select
-- offers « Aucun / à définir plus tard » — so `subject` is NOT NULL and the
-- assignment is nullable, never the other way round.
--
-- ⚠ ET LA MATIÈRE DOIT EXISTER DANS CE GROUPE. `placer_creneau` refuses a
-- subject that is not among the group's own assignments: "Cette matière
-- n'existe pas dans ce groupe : créez-la d'abord en assignant un professeur."
-- A constraint cannot express that (the set of a group's subjects is a query),
-- so the service enforces it and a test holds it.
--
-- Days and slots are ordinals, as `timetable_slots` already does for the day
-- school. Its own lists are French strings —
--   ['Lundi'…'Dimanche'] and ['8h-10h','10h-12h','12h-14h','14h-16h',
--    '16h-18h','18h-20h','20h-22h']
-- — and the ordering a timetable needs falls out of numbers, not of strings.
-- The labels are a display concern and live in the UI, in both apps.
CREATE TABLE evening_timetable_slots (
  id                  uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id           uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  evening_group_id    uuid NOT NULL,
  -- 1 = lundi … 7 = dimanche (ISO 8601), comme la grille du jour.
  day_of_week         smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  -- 1 = 8h-10h … 7 = 20h-22h.
  slot                smallint NOT NULL CHECK (slot BETWEEN 1 AND 7),
  subject             text NOT NULL CHECK (btrim(subject) <> ''),
  -- « Aucun / à définir plus tard ». Effacer l'assignation d'un professeur vide
  -- la case de son nom sans effacer le cours : c'est exactement l'état que sa
  -- grille affiche avec un tiret.
  evening_teaching_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  origin              record_origin NOT NULL DEFAULT 'native',
  legacy_id           integer,
  PRIMARY KEY (id),
  -- Un cours par case. Son `placer_creneau` fait DELETE puis INSERT sur ce même
  -- triplet ; ici la contrainte le dit, et le service écrit un UPSERT.
  UNIQUE (school_id, evening_group_id, day_of_week, slot),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, evening_group_id)
    REFERENCES evening_groups (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, evening_teaching_id)
    REFERENCES evening_teachings (school_id, id) ON DELETE SET NULL
);
CREATE INDEX evening_timetable_group_idx
  ON evening_timetable_slots (school_id, evening_group_id, day_of_week, slot);
CREATE INDEX evening_timetable_teaching_idx
  ON evening_timetable_slots (school_id, evening_teaching_id);

COMMENT ON COLUMN evening_timetable_slots.subject IS
  'La matière du créneau. Obligatoire : un créneau se pose sur une matière, et '
  'elle doit être l''une de celles créées pour ce groupe par ses assignations.';
COMMENT ON COLUMN evening_timetable_slots.evening_teaching_id IS
  'L''assignation qui tient ce créneau, ou NULL pour « à définir plus tard ».';

-- ── RLS ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['evening_timetable_slots']
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
