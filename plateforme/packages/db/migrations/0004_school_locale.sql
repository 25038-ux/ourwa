-- ============================================================================
--  0004_school_locale — the branch's default interface language
--
--  `users.locale` already carries each person's own preference, and that wins
--  once someone is signed in. But the login page has no user yet, and it still
--  has to pick a direction: Arabic is RTL and mirrors the entire layout.
--
--  So a school carries a DEFAULT, and El Ourwa's own resolution order is
--  preserved:  explicit choice -> session -> the person's profile -> this.
--
--  Additive and non-destructive: every existing row takes 'fr', which is what
--  they were already rendering.
-- ============================================================================

ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'fr'
  CONSTRAINT schools_locale_supported CHECK (locale IN ('fr', 'ar'));
