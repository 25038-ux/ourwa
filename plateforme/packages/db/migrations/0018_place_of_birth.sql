-- ============================================================================
--  0018_place_of_birth — «Lieu de naissance», the field the enrolment form asks
--  for and we did not have.
--
--  ⚠ AND IT CORRECTS A GROUND-TRUTH ERROR IN OUR OWN NOTES.
--
--  `CLAUDE.md` states that Toujounine, Arafat and Ksar are moughataas "appearing
--  as student ADDRESS values". The first half is right — they are districts of
--  Nouakchott, never branches. The second half is not: `etudiants` in El Ourwa
--  has NO address column. Those names live in `lieu_naissance`.
--
--  Counted in the reference database:
--
--      nkt 112 · Arafat 73 · Ksar 48 · Toujounine 43 · Guerou 27
--      Dar Naim 21 · Riad 21 · dar-naim 21
--
--  Guerou is not in Nouakchott at all — it is in Assaba, three hundred
--  kilometres away — which is only sensible as a birthplace and makes no sense
--  as the address of a child attending school here. That is the tell.
--
--  Our `students.address`, labelled "Moughataa" on the enrolment form, was
--  therefore collecting the right values into the wrong field. The column is
--  KEPT rather than dropped: it holds data in the running system and the school
--  may want a real address later. The form now asks for place of birth, which
--  is what El Ourwa asks for.
-- ============================================================================

ALTER TABLE students
  ADD COLUMN place_of_birth text;

COMMENT ON COLUMN students.place_of_birth IS
  'El Ourwa''s `lieu_naissance`. Free text: "Arafat", "nkt", "Guerou". NOT a '
  'district code and NOT an address — a birthplace, which is often outside '
  'Nouakchott.';

COMMENT ON COLUMN students.address IS
  'A postal address. NOT the moughataa: those are birthplace values and live '
  'in place_of_birth (see migration 0018).';
