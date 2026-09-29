-- ============================================================================
--  0043 — LES ABSENCES DU PERSONNEL : professeurs et agents, d'après leur
--  emploi du temps.
--
--  ADR-0074. Demande du propriétaire (29/09/2026) : « add absence for staff
--  and professors based on their emplois du temps ». Sans équivalent dans
--  El Ourwa, qui ne suit que les absences des élèves.
--
--  Deux populations, deux emplois du temps :
--    - un PROFESSEUR a déjà le sien : les cases de `timetable_slots` dont
--      l'enseignement est le sien (0008). Une absence de professeur est une
--      SÉANCE manquée — un jour, un créneau, une classe, une matière.
--    - un AGENT (`staff` : surveillant, gardien, cuisinière, direction…) n'en
--      avait aucun. `staff_work_hours` le lui donne : ses périodes de travail,
--      jour par jour (lundi 07:30 – 14:30…). Une absence d'agent est une
--      période manquée, entière ou en partie (arrivé à 10:00 au lieu de 07:30).
--
--  ⚠ AUCUN ARGENT ICI. Une absence ne retient rien sur un salaire : la paie
--  (`salary_payments`, 0007) reste exactement ce qu'elle est, et la direction
--  décide de toute retenue. Les absences s'y lisent comme une information
--  (heures manquées, justifiées ou non), jamais comme un calcul.
--
--  ⚠ L'ABSENCE GARDE CE QUE L'EMPLOI DU TEMPS DISAIT CE JOUR-LÀ. Une grille se
--  refait en cours d'année ; l'absence du 12 octobre doit rester « 6ème A —
--  Mathématiques, 8h-9h45 » même si la case a changé depuis. D'où le libellé,
--  le créneau, les heures et la durée recopiés sur la ligne.
-- ============================================================================

-- ── 1. Les horaires de travail des agents ───────────────────────────────────
-- Une ligne par période : un agent peut travailler le matin et revenir le
-- soir. Jours ISO comme timetable_slots : 1 = lundi … 7 = dimanche.
CREATE TABLE staff_work_hours (
  id          uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_id    uuid NOT NULL,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  starts_at   time NOT NULL,
  ends_at     time NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  UNIQUE (school_id, staff_id, day_of_week, starts_at),
  CONSTRAINT staff_work_hours_ordre CHECK (ends_at > starts_at),
  -- Les horaires suivent l'agent : ils partent avec sa fiche.
  FOREIGN KEY (school_id, staff_id) REFERENCES staff (school_id, id) ON DELETE CASCADE
);
CREATE INDEX staff_work_hours_staff_idx ON staff_work_hours (school_id, staff_id, day_of_week, starts_at);

COMMENT ON TABLE staff_work_hours IS
  'L''emploi du temps d''un agent (staff) : ses périodes de travail, jour par jour. '
  'Les absences d''agent s''enregistrent contre elles (personnel_absences). ADR-0074.';

-- ── 2. Les absences ─────────────────────────────────────────────────────────
-- Une ligne par séance manquée (professeur) ou par période manquée (agent).
CREATE TABLE personnel_absences (
  id            uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id     uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  person_kind   payee_kind NOT NULL,
  teacher_id    uuid,
  staff_id      uuid,
  absence_date  date NOT NULL,
  -- Professeur : la séance, telle que l'emploi du temps la portait ce jour-là.
  slot          smallint CHECK (slot BETWEEN 1 AND 6),
  group_id      uuid,
  teaching_id   uuid,
  -- Agent : la période manquée (toute sa période de travail, ou une partie).
  -- Professeur : les heures du créneau quand elles sont connues.
  starts_at     time,
  ends_at       time,
  -- La durée manquée, en minutes. NULL : inconnue (un créneau sans horaire
  -- affiché) — comptée comme une séance, jamais comme zéro heure.
  minutes       integer CHECK (minutes >= 0),
  -- « 6ème A — Mathématiques » ; « Surveillante ». Recopié : il survit à la
  -- grille, à la classe, à l'enseignement.
  label         text NOT NULL,
  justified     boolean NOT NULL DEFAULT false,
  reason        text,
  justified_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  justified_at  timestamptz,
  recorded_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  origin        record_origin NOT NULL DEFAULT 'native',
  legacy_id     integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  -- Une absence désigne UNE personne, de la bonne population, avec ce que sa
  -- population exige : un créneau pour un professeur, des heures pour un agent.
  CONSTRAINT personnel_absences_personne CHECK (
    (person_kind = 'teacher' AND teacher_id IS NOT NULL AND staff_id IS NULL AND slot IS NOT NULL)
    OR
    (person_kind = 'staff' AND staff_id IS NOT NULL AND teacher_id IS NULL AND slot IS NULL
       AND starts_at IS NOT NULL AND ends_at IS NOT NULL)
  ),
  CONSTRAINT personnel_absences_heures CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  -- La personne partie, ses absences partent avec elle (comme ses horaires).
  FOREIGN KEY (school_id, teacher_id) REFERENCES teachers (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, staff_id)   REFERENCES staff    (school_id, id) ON DELETE CASCADE,
  -- La classe ou l'enseignement supprimés : l'absence reste, son libellé dit
  -- ce qu'ils étaient (0022 : on ne vide que la colonne, jamais school_id).
  FOREIGN KEY (school_id, group_id)    REFERENCES groups    (school_id, id) ON DELETE SET NULL (group_id),
  FOREIGN KEY (school_id, teaching_id) REFERENCES teachings (school_id, id) ON DELETE SET NULL (teaching_id)
);

-- Une séance ne se manque qu'une fois. (Un professeur que la grille met dans
-- deux classes au même créneau manque les deux : deux lignes, une par classe.)
CREATE UNIQUE INDEX personnel_absences_seance_uq
  ON personnel_absences (school_id, teacher_id, absence_date, slot, group_id)
  WHERE person_kind = 'teacher';
-- Une période d'agent ne commence qu'une fois par jour.
CREATE UNIQUE INDEX personnel_absences_periode_uq
  ON personnel_absences (school_id, staff_id, absence_date, starts_at)
  WHERE person_kind = 'staff';
CREATE INDEX personnel_absences_date_idx ON personnel_absences (school_id, absence_date);
CREATE INDEX personnel_absences_teacher_idx ON personnel_absences (school_id, teacher_id, absence_date);
CREATE INDEX personnel_absences_staff_idx ON personnel_absences (school_id, staff_id, absence_date);
CREATE UNIQUE INDEX personnel_absences_legacy_uq
  ON personnel_absences (school_id, legacy_id) WHERE legacy_id IS NOT NULL;

COMMENT ON TABLE personnel_absences IS
  'Absences des professeurs (une séance de l''emploi du temps) et des agents (une période '
  'de leurs horaires). Aucun effet sur la paie : information pour la direction. ADR-0074.';

-- ── 3. Isolation (règle 4) ──────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff_work_hours', 'personnel_absences']
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
