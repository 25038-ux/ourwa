-- ============================================================================
--  0001_init — platform tables, tenant tables, RLS
--
--  Authority: ARCHITECTURE.md §3 (multi-tenancy), §6 (data model), §8 (money),
--  §9 (indexing).  PROJECT.md Part 4 standing rules 1-8.
--
--  EVERY tenant table follows the same four rules (standing rule 4):
--    1. `school_id` column, NOT NULL
--    2. ROW LEVEL SECURITY enabled AND FORCED
--    3. a policy with BOTH `USING` and `WITH CHECK`
--    4. a composite index leading with `school_id`; uniques scoped `(school_id, …)`
--
--  FORCE is not optional. Without it the table owner bypasses the policy, and in
--  development the owner is usually who you are connected as — so isolation
--  appears to work in testing and fails in production.
--
--  WITH CHECK is not optional either. Without it RLS blocks reads but still
--  permits WRITING a row into another school.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── UUIDv7 ──────────────────────────────────────────────────────────────────
-- ARCHITECTURE.md §6: time-ordered so index locality stays good, and
-- non-enumerable so one school cannot guess another's record ids.
-- Postgres 18 ships uuidv7() natively; on 16 we generate it ourselves.
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  unix_ms bigint := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  bytes   bytea  := gen_random_bytes(16);
BEGIN
  -- 48 bits of millisecond timestamp, then version 7 and the RFC variant bits.
  bytes := set_byte(bytes, 0, ((unix_ms >> 40) & 255)::int);
  bytes := set_byte(bytes, 1, ((unix_ms >> 32) & 255)::int);
  bytes := set_byte(bytes, 2, ((unix_ms >> 24) & 255)::int);
  bytes := set_byte(bytes, 3, ((unix_ms >> 16) & 255)::int);
  bytes := set_byte(bytes, 4, ((unix_ms >>  8) & 255)::int);
  bytes := set_byte(bytes, 5, ( unix_ms        & 255)::int);
  bytes := set_byte(bytes, 6, ((get_byte(bytes, 6) & 15)  | 112));  -- version 7
  bytes := set_byte(bytes, 8, ((get_byte(bytes, 8) & 63)  | 128));  -- variant
  RETURN encode(bytes, 'hex')::uuid;
END $$;

-- ── Database roles ──────────────────────────────────────────────────────────
-- app_user     : what the API connects as. NOT a superuser, NO BYPASSRLS.
-- app_reporter : the ONLY holder of BYPASSRLS, for cross-school rollup jobs.
--                Standing rule 3 — never bound to an HTTP request handler.
-- Les mots de passe : `app.role_password` posé par le migrateur (variables
-- APP_USER_PASSWORD / APP_REPORTER_PASSWORD), sinon « devpassword » — un
-- Postgres géré (Neon) refuse un mot de passe faible dès CREATE ROLE.
DO $$
DECLARE
  mdp_user text := COALESCE(NULLIF(current_setting('app.user_password', true), ''), 'devpassword');
  mdp_rep  text := COALESCE(NULLIF(current_setting('app.reporter_password', true), ''), 'devpassword');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE format('CREATE ROLE app_user LOGIN PASSWORD %L NOBYPASSRLS', mdp_user);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_reporter') THEN
    -- BYPASSRLS ne s'accorde que par un superutilisateur. Sur un Postgres géré
    -- (Neon, Supabase, Render…) le rôle qui migre n'en est pas un : le rôle est
    -- créé quand même — les GRANT des migrations suivantes le nomment — mais
    -- sans l'attribut, et les travaux de synthèse inter-écoles n'y tournent
    -- pas. Rien du chemin des requêtes n'en dépend (règle 3).
    IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
      EXECUTE format('CREATE ROLE app_reporter LOGIN PASSWORD %L BYPASSRLS', mdp_rep);
    ELSE
      EXECUTE format('CREATE ROLE app_reporter LOGIN PASSWORD %L NOBYPASSRLS', mdp_rep);
      RAISE NOTICE 'app_reporter créé SANS BYPASSRLS : ce serveur n''accorde pas l''attribut (pas de superutilisateur).';
    END IF;
  END IF;
END $$;

-- ── Tenant context ──────────────────────────────────────────────────────────
-- Reads the per-transaction tenant set by
-- set_config('app.current_school_id', ..., true).
-- Returns NULL when unset; every policy then matches nothing, so a missing
-- context fails CLOSED rather than open.
CREATE OR REPLACE FUNCTION current_school_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_school_id', true), '')::uuid
$$;

-- ── Shared enums ────────────────────────────────────────────────────────────
-- El Ourwa's origine ENUM('reprise','elourwa') + paiements' 'impute'.
-- ARCHITECTURE.md §6: 17,106 rows depend on it and financial reports key off
-- it. Carried forward, never dropped.
CREATE TYPE record_origin AS ENUM ('migrated', 'native', 'imputed');

CREATE TYPE year_status       AS ENUM ('future', 'active', 'closed');
CREATE TYPE enrollment_status AS ENUM ('enrolled', 'archived', 'debt_blocked', 'cancelled');
CREATE TYPE enrollment_outcome AS ENUM ('pending', 'passed', 'held_back', 'expelled');
CREATE TYPE school_cycle      AS ENUM ('fondamental', 'college', 'lycee', 'autre');
CREATE TYPE grade_kind        AS ENUM ('coursework', 'exam');
CREATE TYPE month_status      AS ENUM ('billable', 'invoiced', 'free');

-- ============================================================================
--  PLATFORM TABLES — no school_id, no RLS  (ARCHITECTURE.md §6)
-- ============================================================================

CREATE TABLE schools (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug           text NOT NULL UNIQUE,
  name           text NOT NULL,
  name_ar        text,
  logo_emoji     text NOT NULL DEFAULT '🎓',
  theme_color    text NOT NULL DEFAULT '#1d4ed8',
  timezone       text NOT NULL DEFAULT 'Africa/Nouakchott',
  -- Currency is per school, stored explicitly, never assumed (standing rule 8).
  currency       char(3) NOT NULL DEFAULT 'MRU',
  address        text,
  receipt_prefix text NOT NULL,
  receipt_footer text,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE school_domains (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  hostname    text NOT NULL UNIQUE,
  is_primary  boolean NOT NULL DEFAULT false,
  verified_at timestamptz
);
CREATE INDEX school_domains_school_idx ON school_domains (school_id);

-- GLOBAL on purpose (ARCHITECTURE.md §6): one parent with children in two
-- branches has ONE account and two user_school_roles rows. Making this
-- tenant-scoped would force them to hold two logins.
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  email             text UNIQUE,
  phone             text UNIQUE,
  -- Mixed hashes are expected: El Ourwa holds both $argon2id$ and $2y$ bcrypt.
  -- Verification accepts both and transparently re-hashes to Argon2id on a
  -- successful login (PROJECT.md §2.8). Forcing a reset would lock out 1,372
  -- parents at once.
  password_hash     text NOT NULL,
  full_name         text NOT NULL,
  is_platform_admin boolean NOT NULL DEFAULT false,
  locale            text NOT NULL DEFAULT 'fr',
  active            boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  failed_logins     integer NOT NULL DEFAULT 0,
  locked_until      timestamptz,
  last_login_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE roles (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  code       text NOT NULL UNIQUE,
  label      text NOT NULL,
  is_system  boolean NOT NULL DEFAULT false,
  sort_order smallint NOT NULL DEFAULT 100
);

-- Permissions are DATA, never hardcoded (PROJECT.md §2.2), so a school can
-- define custom roles later without a code change.
CREATE TABLE role_permissions (
  role_id    uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission text NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE user_school_roles (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  role_id    uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, school_id, role_id)
);
CREATE INDEX user_school_roles_school_idx ON user_school_roles (school_id, user_id);

CREATE TABLE audit_log (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  school_id    uuid REFERENCES schools(id) ON DELETE SET NULL,
  action       text NOT NULL,
  entity       text,
  entity_id    uuid,
  before       jsonb,
  after        jsonb,
  ip           inet,
  -- Impersonation is the feature most likely to be abused or disputed; the log
  -- is what protects everyone (ARCHITECTURE.md §5).
  impersonated boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_school_date_idx ON audit_log (school_id, created_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, created_at DESC);

CREATE TABLE configuration (
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  key       text NOT NULL,
  value     text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, key)
);

-- ============================================================================
--  TENANT TABLES
--
--  Each carries: school_id, origin, legacy_id.
--  `legacy_id` stays permanently — it makes reconciliation possible and lets
--  imports re-run idempotently. Four bytes that save the project
--  (PHASES.md session 2.2).
--
--  Each also carries UNIQUE (school_id, id) so that composite foreign keys can
--  reference it, making a cross-tenant reference structurally impossible rather
--  than merely unlikely (ARCHITECTURE.md §6).
-- ============================================================================

CREATE TABLE academic_years (
  id          uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  label       text NOT NULL,                       -- '2026-2027'
  start_year  smallint NOT NULL,
  start_month smallint NOT NULL DEFAULT 10 CHECK (start_month BETWEEN 1 AND 12),
  end_month   smallint NOT NULL DEFAULT 6  CHECK (end_month BETWEEN 1 AND 12),
  status      year_status NOT NULL DEFAULT 'future',
  closed_at   timestamptz,
  origin      record_origin NOT NULL DEFAULT 'native',
  legacy_id   integer,
  PRIMARY KEY (id),
  -- El Ourwa had UNIQUE(libelle) globally; under multi-tenancy that would stop a
  -- second school from ever having a 2026-2027 year (PHASES.md session 2.1).
  UNIQUE (school_id, label),
  UNIQUE (school_id, start_year),
  UNIQUE (school_id, id)
);
CREATE INDEX academic_years_school_status_idx ON academic_years (school_id, status);

CREATE TABLE levels (
  id             uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name           text NOT NULL,
  monthly_rate   numeric(14,2) NOT NULL DEFAULT 0,
  cycle          school_cycle NOT NULL DEFAULT 'autre',
  is_fondamental boolean NOT NULL DEFAULT false,
  pass_mark      numeric(5,2) NOT NULL DEFAULT 10.00,
  sort_order     smallint NOT NULL DEFAULT 0,
  origin         record_origin NOT NULL DEFAULT 'native',
  legacy_id      integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, name),
  UNIQUE (school_id, id)
);
CREATE INDEX levels_school_order_idx ON levels (school_id, cycle, sort_order);

CREATE TABLE groups (
  id        uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  level_id  uuid,
  name      text NOT NULL,
  capacity  integer NOT NULL DEFAULT 40,
  origin    record_origin NOT NULL DEFAULT 'native',
  legacy_id integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, name),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, level_id) REFERENCES levels (school_id, id) ON DELETE SET NULL
);
CREATE INDEX groups_school_level_idx ON groups (school_id, level_id);

CREATE TABLE subjects (
  id          uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  level_id    uuid,
  name        text NOT NULL,
  name_ar     text,
  coefficient smallint NOT NULL DEFAULT 1,
  max_score   numeric(6,2) NOT NULL DEFAULT 20.00,
  origin      record_origin NOT NULL DEFAULT 'native',
  legacy_id   integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, level_id, name),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, level_id) REFERENCES levels (school_id, id) ON DELETE CASCADE
);
CREATE INDEX subjects_school_level_idx ON subjects (school_id, level_id);

CREATE TABLE teachers (
  id          uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  first_name  text NOT NULL,
  last_name   text NOT NULL,
  sex         char(1) CHECK (sex IN ('M', 'F')),
  phone       text,
  employment  text CHECK (employment IN ('permanent', 'interim')),
  hourly_rate numeric(14,2) NOT NULL DEFAULT 0,
  salary      numeric(14,2) NOT NULL DEFAULT 0,
  origin      record_origin NOT NULL DEFAULT 'native',
  legacy_id   integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id)
);
CREATE INDEX teachers_school_name_idx ON teachers (school_id, last_name, first_name);

-- El Ourwa's `enseignements`: teacher × group × subject × year.
CREATE TABLE teachings (
  id               uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL,
  teacher_id       uuid NOT NULL,
  group_id         uuid NOT NULL,
  subject_id       uuid NOT NULL,
  hours_per_week   numeric(4,1) NOT NULL DEFAULT 0,
  origin           record_origin NOT NULL DEFAULT 'native',
  legacy_id        integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, academic_year_id, teacher_id, group_id, subject_id),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, teacher_id)       REFERENCES teachers       (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, group_id)         REFERENCES groups         (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, subject_id)       REFERENCES subjects       (school_id, id) ON DELETE CASCADE
);
CREATE INDEX teachings_school_group_idx ON teachings (school_id, academic_year_id, group_id);
CREATE INDEX teachings_school_teacher_idx ON teachings (school_id, teacher_id);

CREATE TABLE students (
  id             uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  -- The fee-paying adult, as a GLOBAL user account.
  guardian_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  rim            text NOT NULL,
  national_id    text NOT NULL,
  first_name     text NOT NULL,
  last_name      text NOT NULL,
  sex            char(1) CHECK (sex IN ('M', 'F')),
  date_of_birth  date,
  -- Moughataa (district) of Nouakchott. This is an ADDRESS field, not a branch.
  address        text,
  has_left       boolean NOT NULL DEFAULT false,
  origin         record_origin NOT NULL DEFAULT 'native',
  legacy_id      integer,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  -- Scoped per school, NOT globally: a family moving between branches would
  -- otherwise be rejected by a global unique.
  UNIQUE (school_id, rim),
  UNIQUE (school_id, national_id),
  UNIQUE (school_id, id)
);
CREATE INDEX students_school_name_idx ON students (school_id, last_name, first_name);
CREATE INDEX students_school_guardian_idx ON students (school_id, guardian_id);
CREATE INDEX students_school_legacy_idx ON students (school_id, legacy_id);

CREATE TABLE enrollments (
  id               uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id       uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  group_id         uuid,
  level_id         uuid,
  -- `debt_blocked` is a real business rule with financial consequences.
  -- Ported exactly, not simplified away (PROJECT.md §2.7).
  status           enrollment_status NOT NULL DEFAULT 'archived',
  -- THE amount owed. The gap to the level's full rate is never claimed.
  monthly_fee      numeric(14,2) NOT NULL DEFAULT 0,
  full_rate        numeric(14,2) NOT NULL DEFAULT 0,
  enrolment_fee    numeric(14,2) NOT NULL DEFAULT 0,
  document_fee     numeric(14,2) NOT NULL DEFAULT 0,
  supplies_fee     numeric(14,2) NOT NULL DEFAULT 0,
  is_free          boolean NOT NULL DEFAULT false,
  outcome          enrollment_outcome NOT NULL DEFAULT 'pending',
  entry_date       date,
  origin           record_origin NOT NULL DEFAULT 'native',
  legacy_id        integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (school_id, student_id, academic_year_id),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, student_id)       REFERENCES students       (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, group_id)         REFERENCES groups         (school_id, id) ON DELETE SET NULL,
  FOREIGN KEY (school_id, level_id)         REFERENCES levels         (school_id, id) ON DELETE SET NULL
);
CREATE INDEX enrollments_school_year_idx ON enrollments (school_id, academic_year_id, status);
CREATE INDEX enrollments_school_group_idx ON enrollments (school_id, group_id);

CREATE TABLE enrollment_months (
  id             uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  enrollment_id  uuid NOT NULL,
  month_order    smallint NOT NULL,
  month_label    text,
  calendar_month smallint NOT NULL CHECK (calendar_month BETWEEN 1 AND 12),
  calendar_year  smallint NOT NULL,
  status         month_status NOT NULL DEFAULT 'billable',
  amount_due     numeric(14,2) NOT NULL DEFAULT 0,
  origin         record_origin NOT NULL DEFAULT 'native',
  legacy_id      integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, enrollment_id, month_order),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, enrollment_id) REFERENCES enrollments (school_id, id) ON DELETE CASCADE
);
CREATE INDEX enrollment_months_school_status_idx ON enrollment_months (school_id, status);

CREATE TABLE grades (
  id               uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id       uuid NOT NULL,
  teaching_id      uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  term             smallint NOT NULL CHECK (term BETWEEN 1 AND 3),
  kind             grade_kind NOT NULL,
  sequence_no      smallint NOT NULL DEFAULT 1,
  -- -1 is the ABSENT MARKER, not a grade (PROJECT.md §2.4). Any average that
  -- includes it as a number is wrong, and wrong quietly. The check permits it;
  -- the computation must exclude it.
  score            numeric(6,2) NOT NULL,
  origin           record_origin NOT NULL DEFAULT 'native',
  legacy_id        integer,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (school_id, student_id, teaching_id, term, kind, sequence_no),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, student_id)       REFERENCES students       (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, teaching_id)      REFERENCES teachings      (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years (school_id, id) ON DELETE CASCADE
);
CREATE INDEX grades_school_student_year_idx ON grades (school_id, student_id, academic_year_id, term);
CREATE INDEX grades_school_teaching_idx ON grades (school_id, teaching_id, term);

CREATE TABLE payment_methods (
  id        uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name      text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id),
  UNIQUE (school_id, name),
  UNIQUE (school_id, id)
);

-- Per-school receipt sequence. Taken atomically, never MAX()+1 (PROJECT.md §2.6).
CREATE TABLE receipt_sequences (
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  year        smallint NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (school_id, year)
);

CREATE TABLE payments (
  id               uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id       uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  calendar_month   smallint NOT NULL CHECK (calendar_month BETWEEN 1 AND 12),
  calendar_year    smallint NOT NULL,
  amount           numeric(14,2) NOT NULL,
  -- Generated: NOUR-2026-00001.
  receipt_number   text NOT NULL,
  -- Free-text reference for the number in the school's paper receipt book.
  -- El Ourwa's recu_numero was only ever this (PROJECT.md §2.6).
  paper_reference  text,
  recorded_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  paid_at          timestamptz NOT NULL DEFAULT now(),
  -- Financial records are append-only (standing rule 6). A correction is a
  -- reversing entry pointing at what it reverses.
  reverses_id      uuid,
  origin           record_origin NOT NULL DEFAULT 'native',
  legacy_id        integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, receipt_number),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, student_id)       REFERENCES students       (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, reverses_id)      REFERENCES payments       (school_id, id) ON DELETE RESTRICT
);
CREATE INDEX payments_school_student_period_idx
  ON payments (school_id, student_id, calendar_year, calendar_month);
CREATE INDEX payments_school_paid_at_idx ON payments (school_id, paid_at DESC);

-- El Ourwa's paiement_lignes: how one payment was split across tender types.
CREATE TABLE payment_lines (
  id                uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id         uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  payment_id        uuid NOT NULL,
  payment_method_id uuid NOT NULL,
  amount            numeric(14,2) NOT NULL,
  direction         text NOT NULL DEFAULT 'in' CHECK (direction IN ('in', 'out')),
  origin            record_origin NOT NULL DEFAULT 'native',
  legacy_id         integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, payment_id)        REFERENCES payments        (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, payment_method_id) REFERENCES payment_methods (school_id, id) ON DELETE RESTRICT
);
CREATE INDEX payment_lines_school_payment_idx ON payment_lines (school_id, payment_id);

CREATE TABLE expenses (
  id          uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  amount      numeric(14,2) NOT NULL,
  description text NOT NULL,
  spent_at    timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  origin      record_origin NOT NULL DEFAULT 'native',
  legacy_id   integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id)
);
CREATE INDEX expenses_school_date_idx ON expenses (school_id, spent_at DESC);

-- ============================================================================
--  Row Level Security — enabled AND forced on every tenant table
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'configuration', 'academic_years', 'levels', 'groups', 'subjects',
    'teachers', 'teachings', 'students', 'enrollments', 'enrollment_months',
    'grades', 'payment_methods', 'receipt_sequences', 'payments',
    'payment_lines', 'expenses'
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

-- ── Grants ──────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO app_user, app_reporter;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_reporter;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user, app_reporter;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_reporter;
