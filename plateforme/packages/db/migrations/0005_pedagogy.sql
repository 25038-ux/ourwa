-- ============================================================================
--  0005_pedagogy — attendance, remarks, homework
--
--  The three things a teacher produces about a child that a parent then reads.
--  All tenant-scoped, all following the tenant-table convention.
-- ============================================================================

CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late');
CREATE TYPE remark_severity AS ENUM ('info', 'positive', 'warning', 'serious');

-- One row per student per teaching per day.
--
-- Deliberately keyed on the TEACHING, not the group: a child can be present in
-- the morning and absent in the afternoon, and El Ourwa records absence against
-- the lesson. Keying on the group alone would collapse a day into one verdict.
CREATE TABLE attendance (
  id           uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id    uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id   uuid NOT NULL,
  teaching_id  uuid,
  on_date      date NOT NULL,
  status       attendance_status NOT NULL DEFAULT 'absent',
  -- An absence is excused or it is not; the school decides, not the system.
  is_excused   boolean NOT NULL DEFAULT false,
  note         text,
  recorded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  origin       record_origin NOT NULL DEFAULT 'native',
  legacy_id    integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, student_id, teaching_id, on_date),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, student_id)  REFERENCES students  (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, teaching_id) REFERENCES teachings (school_id, id) ON DELETE SET NULL
);
CREATE INDEX attendance_school_student_idx ON attendance (school_id, student_id, on_date DESC);
CREATE INDEX attendance_school_date_idx ON attendance (school_id, on_date DESC);

CREATE TABLE remarks (
  id          uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL,
  author_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Kept as text so the remark still names its author after the account is gone.
  author_name text NOT NULL,
  body        text NOT NULL,
  severity    remark_severity NOT NULL DEFAULT 'info',
  created_at  timestamptz NOT NULL DEFAULT now(),
  origin      record_origin NOT NULL DEFAULT 'native',
  legacy_id   integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, student_id) REFERENCES students (school_id, id) ON DELETE CASCADE
);
CREATE INDEX remarks_school_student_idx ON remarks (school_id, student_id, created_at DESC);

CREATE TABLE homework (
  id          uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teaching_id uuid NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  -- Attachment metadata only; the files themselves live outside the database.
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  due_on      date,
  sent_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  origin      record_origin NOT NULL DEFAULT 'native',
  legacy_id   integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, teaching_id) REFERENCES teachings (school_id, id) ON DELETE CASCADE
);
CREATE INDEX homework_school_teaching_idx ON homework (school_id, teaching_id, sent_at DESC);

-- Notifications to a guardian.
--
-- Stored as a translation KEY plus parameters, never as a rendered sentence: a
-- parent who switches language would otherwise keep seeing the old one. This is
-- El Ourwa's `cle_i18n` / `params_i18n` design, carried over unchanged.
CREATE TABLE notifications (
  id          uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  guardian_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id  uuid,
  kind        text NOT NULL,
  i18n_key    text NOT NULL,
  i18n_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, student_id) REFERENCES students (school_id, id) ON DELETE CASCADE
);
CREATE INDEX notifications_school_guardian_idx
  ON notifications (school_id, guardian_id, created_at DESC);
CREATE INDEX notifications_unread_idx
  ON notifications (school_id, guardian_id) WHERE read_at IS NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance', 'remarks', 'homework', 'notifications']
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

GRANT SELECT, INSERT, UPDATE, DELETE
  ON attendance, remarks, homework, notifications TO app_user;
GRANT SELECT ON attendance, remarks, homework, notifications TO app_reporter;
