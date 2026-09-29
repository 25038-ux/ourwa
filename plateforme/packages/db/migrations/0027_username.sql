-- ============================================================================
--  0027_username — staff sign in with a username, not an email address
--
--  ⚠ WE HAD NOWHERE TO PUT THE THING PEOPLE ACTUALLY TYPE.
--
--  `users` offered `email` and `phone`, and login matched
--  `lower(email) = lower($1) OR phone = $1`. That covers guardians, who sign in
--  with a phone number. It does not cover the staff: of El Ourwa's four
--  accounts, three sign in as `e.historique`, `s.employ339`, `parite_lab` — and
--  one as `admin@supnum.mr`, which happens to look like an address.
--
--  The import put those usernames in `email` so nobody would lose their login.
--  It worked, and it was wrong: a profile screen would show `e.historique`
--  labelled "email address", and any code that ever mails that column would be
--  addressing a mailbox that does not exist.
--
--  A username is its own thing. It gets its own column.
--
--  ⚠ UNIQUE ON `lower(username)`, NOT ON `username`. Login already compares
--  case-insensitively; a plain unique would let `Admin` and `admin` both exist
--  and then let either one match the same typed name — with two different
--  password hashes behind them. Which account you land in would depend on row
--  order.
--
--  ⚠ AND IT IS GLOBAL, like `email` and `phone`, because `users` is global
--  (0001). One person, one account, however many branches they work in.
-- ============================================================================

ALTER TABLE users ADD COLUMN username text;

CREATE UNIQUE INDEX users_username_uq
  ON users (lower(username)) WHERE username IS NOT NULL;

-- The row must still be reachable by SOMETHING. Without widening this, a staff
-- account holding only a username would be rejected outright.
--
-- The old constraint was written unnamed in 0001, so Postgres chose its name.
-- Looking it up beats hard-coding a name the server picked: if a future dump and
-- restore ever names it differently, this still finds it instead of failing the
-- migration halfway through.
DO $$
DECLARE nom text;
BEGIN
  SELECT conname INTO nom
    FROM pg_constraint
   WHERE conrelid = 'users'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%email%phone%';
  IF nom IS NOT NULL THEN
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', nom);
  END IF;
END $$;

ALTER TABLE users ADD CONSTRAINT users_identifiable
  CHECK (email IS NOT NULL OR phone IS NOT NULL OR username IS NOT NULL);

COMMENT ON COLUMN users.username IS
  'What staff type to sign in. Matched case-insensitively, like email. NOT an '
  'address: never mail it, never display it as one.';
