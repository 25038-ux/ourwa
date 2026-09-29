-- ============================================================================
--  0002_auth — refresh token families, rate limiting, password resets
--
--  Authority: ARCHITECTURE.md §5, PROJECT.md Phase 1.
--
--  These are PLATFORM tables, not tenant tables. A refresh token belongs to a
--  user, and `users` is global so one parent with children in two branches has
--  one account. Scoping tokens to a school would mean issuing two sessions to
--  one person.
-- ============================================================================

-- ── Refresh tokens ──────────────────────────────────────────────────────────
-- Opaque 256-bit random, HASHED AT REST, rotated on every use.
--
-- The `family_id` is what makes reuse detection possible. Every rotation issues
-- a new token in the SAME family. Presenting a token that has already been
-- rotated means it was stolen — the legitimate holder and the thief now both
-- have copies, and there is no way to tell which is which. So the whole family
-- is revoked and both are forced to re-authenticate. That is the difference
-- between a real implementation and a long-lived JWT with extra steps.
CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,
  -- SHA-256 of the presented token. The token itself is never stored: a database
  -- leak must not hand over live sessions.
  token_hash  text NOT NULL UNIQUE,
  -- Which school this session is scoped to. NULL for a platform admin session.
  school_id   uuid REFERENCES schools(id) ON DELETE CASCADE,
  -- Set when a platform admin enters a branch (ARCHITECTURE.md §5).
  impersonated boolean NOT NULL DEFAULT false,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  revoked_at  timestamptz,
  revoked_reason text,
  user_agent  text,
  ip          inet
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id, expires_at DESC);
-- Expired-token sweep runs on this.
CREATE INDEX refresh_tokens_expiry_idx ON refresh_tokens (expires_at)
  WHERE revoked_at IS NULL;

-- ── Rate limiting ───────────────────────────────────────────────────────────
-- 5 attempts / 15 min, keyed on BOTH account and IP (PROJECT.md 1.7).
--
-- Held in Postgres rather than Redis for now: the state is tiny, it must survive
-- a restart, and Redis is not yet running in this environment. The service that
-- reads it is written against an interface so it can move to Redis in Phase 4
-- when BullMQ brings Redis in anyway.
--
-- El Ourwa's IP lockout would have banned every user simultaneously behind a
-- proxy, because every request appears to come from Cloudflare. The real client
-- IP must be resolved and validated before it is written here.
CREATE TABLE login_attempts (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- 'account:<identifier>' or 'ip:<address>' — one table, two key spaces.
  bucket      text NOT NULL,
  succeeded   boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  ip          inet,
  user_agent  text
);
CREATE INDEX login_attempts_bucket_idx ON login_attempts (bucket, attempted_at DESC);

-- ── Password resets ─────────────────────────────────────────────────────────
CREATE TABLE password_resets (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Hashed, for the same reason refresh tokens are.
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip         inet
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON refresh_tokens, login_attempts, password_resets TO app_user;
GRANT SELECT ON refresh_tokens, login_attempts, password_resets TO app_reporter;
