-- ============================================================================
--  0006_evening — cours du soir
--
--  ⚠ This is a SECOND BUSINESS sharing a login, not a feature of the first.
--
--  It has its own groups, its own monthly tariffs, its own teachers (including
--  people who teach nowhere else), its own payroll, and — the part that shapes
--  the schema — it enrols people who are NOT students of the school at all.
--  El Ourwa keeps eight `cs_*` tables for exactly this reason.
--
--  The temptation is to reuse `students` and `groups` with a flag. That breaks
--  the day a walk-in adult enrols: they have no RIM, no national id, no
--  guardian, no level, and they must never appear in a class roster, a report
--  card, or a headcount.
-- ============================================================================

CREATE TYPE evening_pay_kind AS ENUM ('hourly', 'fixed');

CREATE TABLE evening_groups (
  id            uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id     uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name          text NOT NULL,
  monthly_rate  numeric(14,2) NOT NULL DEFAULT 0,
  description   text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  origin        record_origin NOT NULL DEFAULT 'native',
  legacy_id     integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, name),
  UNIQUE (school_id, id)
);

-- Which months this group actually runs. An evening group is not bound to the
-- school year: it may run for three months and stop.
CREATE TABLE evening_group_months (
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  evening_group_id uuid NOT NULL,
  calendar_month   smallint NOT NULL CHECK (calendar_month BETWEEN 1 AND 12),
  calendar_year    smallint NOT NULL,
  PRIMARY KEY (school_id, evening_group_id, calendar_month, calendar_year),
  FOREIGN KEY (school_id, evening_group_id)
    REFERENCES evening_groups (school_id, id) ON DELETE CASCADE
);

-- Teachers who exist only for the evening school.
CREATE TABLE evening_teachers (
  id         uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name  text NOT NULL,
  phone      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  origin     record_origin NOT NULL DEFAULT 'native',
  legacy_id  integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id)
);

CREATE TABLE evening_teachings (
  id                 uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id          uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  evening_group_id   uuid NOT NULL,
  -- Exactly one of these: a day-school teacher, or an evening-only one.
  teacher_id         uuid,
  evening_teacher_id uuid,
  subject            text NOT NULL,
  pay_kind           evening_pay_kind NOT NULL DEFAULT 'hourly',
  hourly_rate        numeric(14,2) NOT NULL DEFAULT 0,
  hours_per_month    integer NOT NULL DEFAULT 0,
  fixed_salary       numeric(14,2) NOT NULL DEFAULT 0,
  origin             record_origin NOT NULL DEFAULT 'native',
  legacy_id          integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  CHECK ((teacher_id IS NULL) <> (evening_teacher_id IS NULL)),
  FOREIGN KEY (school_id, evening_group_id)
    REFERENCES evening_groups (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, teacher_id)
    REFERENCES teachers (school_id, id) ON DELETE SET NULL,
  FOREIGN KEY (school_id, evening_teacher_id)
    REFERENCES evening_teachers (school_id, id) ON DELETE CASCADE
);
CREATE INDEX evening_teachings_group_idx ON evening_teachings (school_id, evening_group_id);

-- ⚠ An enrolment is EITHER a school student OR an outside person.
--
-- The outside case is why this table exists at all: a walk-in has a name and a
-- phone number and nothing else, and must never surface in the day school.
CREATE TABLE evening_enrolments (
  id               uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  evening_group_id uuid NOT NULL,
  student_id       uuid,
  outsider_name    text,
  outsider_phone   text,
  outsider_sex     char(1) CHECK (outsider_sex IN ('M', 'F')),
  enrolled_at      timestamptz NOT NULL DEFAULT now(),
  origin           record_origin NOT NULL DEFAULT 'native',
  legacy_id        integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  -- One or the other, never both and never neither.
  CHECK ((student_id IS NULL) <> (outsider_name IS NULL)),
  FOREIGN KEY (school_id, evening_group_id)
    REFERENCES evening_groups (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, student_id)
    REFERENCES students (school_id, id) ON DELETE CASCADE
);
CREATE INDEX evening_enrolments_group_idx ON evening_enrolments (school_id, evening_group_id);

CREATE TABLE evening_payments (
  id             uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  enrolment_id   uuid NOT NULL,
  calendar_month smallint NOT NULL CHECK (calendar_month BETWEEN 1 AND 12),
  calendar_year  smallint NOT NULL,
  amount         numeric(14,2) NOT NULL,
  -- Drawn from the SAME per-branch sequence as day-school receipts: a family
  -- must never hold two receipts bearing the same number.
  receipt_number text NOT NULL,
  paper_reference text,
  recorded_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  paid_at        timestamptz NOT NULL DEFAULT now(),
  reverses_id    uuid,
  origin         record_origin NOT NULL DEFAULT 'native',
  legacy_id      integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, receipt_number),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, enrolment_id)
    REFERENCES evening_enrolments (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, reverses_id)
    REFERENCES evening_payments (school_id, id) ON DELETE RESTRICT
);
CREATE INDEX evening_payments_period_idx
  ON evening_payments (school_id, calendar_year, calendar_month);

CREATE TABLE evening_teacher_payments (
  id                  uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id           uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  evening_teaching_id uuid NOT NULL,
  calendar_month      smallint NOT NULL CHECK (calendar_month BETWEEN 1 AND 12),
  calendar_year       smallint NOT NULL,
  amount              numeric(14,2) NOT NULL,
  paid_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  paid_at             timestamptz NOT NULL DEFAULT now(),
  origin              record_origin NOT NULL DEFAULT 'native',
  legacy_id           integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, evening_teaching_id, calendar_month, calendar_year),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, evening_teaching_id)
    REFERENCES evening_teachings (school_id, id) ON DELETE CASCADE
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'evening_groups', 'evening_group_months', 'evening_teachers',
    'evening_teachings', 'evening_enrolments', 'evening_payments',
    'evening_teacher_payments'
  ]
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
