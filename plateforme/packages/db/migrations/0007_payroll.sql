-- ============================================================================
--  0007_payroll — staff, salaries, loans, withdrawals, messaging, requests
--
--  The outflow side of the school's money, plus the two small workflows that
--  surround it.
-- ============================================================================

CREATE TYPE payee_kind AS ENUM ('staff', 'teacher');
CREATE TYPE loan_status AS ENUM ('outstanding', 'settled');
CREATE TYPE request_status AS ENUM ('pending', 'approved', 'refused');

CREATE TABLE staff (
  id          uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  first_name  text NOT NULL,
  last_name   text NOT NULL,
  sex         char(1) CHECK (sex IN ('M', 'F')),
  phone       text,
  role_title  text NOT NULL,
  salary      numeric(14,2) NOT NULL DEFAULT 0,
  hired_on    date,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  origin      record_origin NOT NULL DEFAULT 'native',
  legacy_id   integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id)
);
CREATE INDEX staff_school_active_idx ON staff (school_id, is_active, last_name);

-- One salary payment, for one person, for one month.
--
-- `payee_kind` is polymorphic because the school pays two populations from one
-- payroll: administrative staff and teachers. El Ourwa does the same.
CREATE TABLE salary_payments (
  id             uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  payee_kind     payee_kind NOT NULL,
  payee_id       uuid NOT NULL,
  -- Kept as text so a payslip still names its recipient after the record is gone.
  payee_name     text NOT NULL,
  calendar_month smallint NOT NULL CHECK (calendar_month BETWEEN 1 AND 12),
  calendar_year  smallint NOT NULL,
  gross          numeric(14,2) NOT NULL,
  -- What was withheld against an outstanding loan this month.
  loan_deduction numeric(14,2) NOT NULL DEFAULT 0,
  net            numeric(14,2) NOT NULL,
  note           text,
  paid_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  paid_at        timestamptz NOT NULL DEFAULT now(),
  -- Append-only, like every other financial record.
  reverses_id    uuid,
  -- Set when a reversal cancels this entry. The amounts are never touched; this
  -- only records that a later entry annulled this one, so the month can be paid
  -- again and the partial unique index below still holds.
  reversed       boolean NOT NULL DEFAULT false,
  origin         record_origin NOT NULL DEFAULT 'native',
  legacy_id      integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, reverses_id)
    REFERENCES salary_payments (school_id, id) ON DELETE RESTRICT
);
-- At most ONE live payment per person per month. Reversals are excluded (they
-- are the correction, not a second salary), and so is an entry that has been
-- reversed — otherwise a cancelled month could never be paid again.
--
-- This lives in the database, not in the service: two clerks pressing "pay" at
-- the same instant is exactly the case a service-level check cannot see.
CREATE UNIQUE INDEX salary_payments_once_idx
  ON salary_payments (school_id, payee_kind, payee_id, calendar_month, calendar_year)
  WHERE reverses_id IS NULL AND reversed = false;
CREATE INDEX salary_payments_period_idx
  ON salary_payments (school_id, calendar_year, calendar_month);

CREATE TABLE staff_loans (
  id           uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id    uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  payee_kind   payee_kind NOT NULL,
  payee_id     uuid NOT NULL,
  payee_name   text NOT NULL,
  principal    numeric(14,2) NOT NULL CHECK (principal > 0),
  repaid       numeric(14,2) NOT NULL DEFAULT 0,
  reason       text,
  status       loan_status NOT NULL DEFAULT 'outstanding',
  granted_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at   timestamptz NOT NULL DEFAULT now(),
  origin       record_origin NOT NULL DEFAULT 'native',
  legacy_id    integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id)
);
CREATE INDEX staff_loans_payee_idx ON staff_loans (school_id, payee_kind, payee_id, status);

-- The repayment schedule. A loan is recovered by deduction from salary, one
-- instalment per month, and `withheld` records that it actually was.
CREATE TABLE loan_instalments (
  id             uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  loan_id        uuid NOT NULL,
  calendar_month smallint NOT NULL CHECK (calendar_month BETWEEN 1 AND 12),
  calendar_year  smallint NOT NULL,
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
  repaid         numeric(14,2) NOT NULL DEFAULT 0,
  withheld       boolean NOT NULL DEFAULT false,
  origin         record_origin NOT NULL DEFAULT 'native',
  legacy_id      integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, loan_id, calendar_month, calendar_year),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, loan_id) REFERENCES staff_loans (school_id, id) ON DELETE CASCADE
);
CREATE INDEX loan_instalments_period_idx
  ON loan_instalments (school_id, calendar_year, calendar_month);

-- A repayment made outside payroll — cash handed back.
CREATE TABLE loan_repayments (
  id             uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  loan_id        uuid NOT NULL,
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
  receipt_number text,
  recorded_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  repaid_at      timestamptz NOT NULL DEFAULT now(),
  origin         record_origin NOT NULL DEFAULT 'native',
  legacy_id      integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, loan_id) REFERENCES staff_loans (school_id, id) ON DELETE CASCADE
);

-- ⚠ A FUND HOLDER IS NOT THE `admin` ROLE.
--
-- El Ourwa's `administrateurs` table holds people with a monthly withdrawal
-- limit — a FINANCIAL concept. `utilisateurs.role = 'admin'` is an ACCESS
-- concept. Same word, unrelated meanings; conflating them would grant
-- withdrawal rights to every administrator (GLOSSARY §4).
CREATE TABLE fund_holders (
  id            uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id     uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  full_name     text NOT NULL,
  phone         text,
  monthly_limit numeric(14,2) NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  origin        record_origin NOT NULL DEFAULT 'native',
  legacy_id     integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id)
);

CREATE TABLE withdrawals (
  id             uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  fund_holder_id uuid NOT NULL,
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
  calendar_month smallint NOT NULL CHECK (calendar_month BETWEEN 1 AND 12),
  calendar_year  smallint NOT NULL,
  reason         text,
  receipt_number text,
  recorded_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  withdrawn_at   timestamptz NOT NULL DEFAULT now(),
  origin         record_origin NOT NULL DEFAULT 'native',
  legacy_id      integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, fund_holder_id)
    REFERENCES fund_holders (school_id, id) ON DELETE CASCADE
);
CREATE INDEX withdrawals_holder_period_idx
  ON withdrawals (school_id, fund_holder_id, calendar_year, calendar_month);

-- Direction → parents.
CREATE TABLE messages (
  id          uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  guardian_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_name text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  read_at     timestamptz,
  sent_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  origin      record_origin NOT NULL DEFAULT 'native',
  legacy_id   integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id)
);
CREATE INDEX messages_guardian_idx ON messages (school_id, guardian_id, sent_at DESC);

-- The accountant raises, the direction decides. A small approval engine, not a
-- form: the decision, its author and its moment are all part of the record.
CREATE TABLE approval_requests (
  id           uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id    uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  raised_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  raiser_name  text NOT NULL,
  kind         text NOT NULL,
  description  text NOT NULL,
  amount       numeric(14,2),
  status       request_status NOT NULL DEFAULT 'pending',
  decided_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at   timestamptz,
  comment      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  origin       record_origin NOT NULL DEFAULT 'native',
  legacy_id    integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id)
);
CREATE INDEX approval_requests_status_idx
  ON approval_requests (school_id, status, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'staff', 'salary_payments', 'staff_loans', 'loan_instalments',
    'loan_repayments', 'fund_holders', 'withdrawals', 'messages',
    'approval_requests'
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
