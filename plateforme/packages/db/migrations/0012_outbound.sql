-- ============================================================================
--  0012_outbound — a durable queue for anything leaving the building
--
--  Two open issues turn out to be one. "Production has no mail path" and "bulk
--  messaging runs inline" are both "there is nowhere to hand work that must
--  leave the process and must not be lost".
--
--  ⚠ THIS IS NOT BULLMQ, and standing rule 18 names BullMQ.
--
--  BullMQ needs Redis, Redis needs Docker, and Docker is a ~2 GB download on a
--  metered connection in Nouakchott — deferred deliberately. A Postgres queue
--  needs nothing that is not already running, and `FOR UPDATE SKIP LOCKED` is a
--  correct work-claiming primitive, not a workaround. At one school's volume it
--  is comfortably enough.
--
--  It is also DURABLE in a way an unpersisted Redis is not: a crash mid-send
--  leaves the row exactly where it was, and the next worker picks it up. For a
--  password-reset email that matters.
--
--  See ADR-0017. If Redis ever arrives, the enqueue interface moves and the
--  callers do not.
-- ============================================================================

CREATE TYPE outbound_status AS ENUM ('pending', 'sent', 'failed', 'abandoned');

-- ⚠ A PLATFORM TABLE, like `login_attempts` and `refresh_tokens`.
--
-- No RLS. It carries `school_id` as DATA so a worker can pick up any school's
-- work, and the worker then does the tenant-scoped part inside `withTenant()`
-- for that school. Putting a policy here would mean the worker could not see the
-- queue at all without a tenant it does not yet know.
CREATE TABLE outbound_mail (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  school_id     uuid REFERENCES schools(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  recipient     text NOT NULL,
  subject       text NOT NULL,
  body          text NOT NULL,
  status        outbound_status NOT NULL DEFAULT 'pending',
  attempts      smallint NOT NULL DEFAULT 0,
  max_attempts  smallint NOT NULL DEFAULT 5,
  -- Exponential backoff lives here rather than in the worker, so a restart does
  -- not forget how long it was meant to wait.
  run_after     timestamptz NOT NULL DEFAULT now(),
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);

-- The claim query: pending, due, ordered oldest first. Partial, because sent
-- rows are the overwhelming majority after a week and none of them are due.
CREATE INDEX outbound_mail_due_idx
  ON outbound_mail (run_after, created_at)
  WHERE status = 'pending';

CREATE INDEX outbound_mail_school_idx ON outbound_mail (school_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON outbound_mail TO app_user;
GRANT SELECT ON outbound_mail TO app_reporter;

-- ⚠ THE RESET LINK MUST NEVER BE LOGGED AGAIN.
--
-- `password-reset.service.ts` printed the link to stdout whenever SMTP was
-- unreachable. In development that is convenient; in production it puts a live
-- credential into a log file that is routinely shipped to somewhere else and
-- read by people who should not be able to take over an account.
--
-- The row below is the replacement: the message waits here, visibly, and nothing
-- is written to a log.
COMMENT ON TABLE outbound_mail IS
  'Outbound messages awaiting delivery. Contains reset links: treat as secret, '
  'do not ship to log aggregation, and purge sent rows on a schedule.';
