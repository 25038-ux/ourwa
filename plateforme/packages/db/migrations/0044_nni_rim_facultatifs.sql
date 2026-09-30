-- ============================================================================
--  0044 — LE NNI ET LE RIM FACULTATIFS.
--
--  Décision du propriétaire (30/09/2026) : « make the nni and rim optional ».
--  El Ourwa les exigeait à l'inscription (« Le RIM est obligatoire. Le NNI est
--  obligatoire. ») ; un enfant sans papiers s'inscrit désormais sans eux.
--  Pour toutes les écoles : les donner reste possible, et ils restent UNIQUES
--  dans l'école quand on les donne.
--
--  ⚠ ABSENT = NULL, JAMAIS ''. Deux raisons :
--    - l'unique (school_id, rim) laisse passer autant de NULL qu'on veut, mais
--      pas deux '' : le deuxième enfant sans RIM serait « déjà inscrit » ;
--    - le registre des exclus bloque par « NNI OU RIM » : un exclu rangé avec
--      un NNI '' aurait bloqué tous les enfants sans NNI de l'école.
--  D'où les CHECK ci-dessous, et les '' existants (s'il y en a) passés à NULL
--  AVANT eux — même sens (« pas de numéro »), aucune donnée d'argent touchée.
--
--  Le registre des exclus suit : un blocage peut ne porter que le NNI ou que
--  le RIM (jamais aucun des deux : l'API le refuse, un tel blocage ne
--  bloquerait rien).
-- ============================================================================

UPDATE students SET rim = NULL WHERE btrim(rim) = '';
UPDATE students SET national_id = NULL WHERE btrim(national_id) = '';

ALTER TABLE students
  ALTER COLUMN rim DROP NOT NULL,
  ALTER COLUMN national_id DROP NOT NULL,
  ADD CONSTRAINT students_rim_non_vide CHECK (rim IS NULL OR btrim(rim) <> ''),
  ADD CONSTRAINT students_nni_non_vide CHECK (national_id IS NULL OR btrim(national_id) <> '');

UPDATE expulsions SET rim = NULL WHERE btrim(rim) = '';
UPDATE expulsions SET national_id = NULL WHERE btrim(national_id) = '';

ALTER TABLE expulsions
  ALTER COLUMN rim DROP NOT NULL,
  ALTER COLUMN national_id DROP NOT NULL,
  ADD CONSTRAINT expulsions_rim_non_vide CHECK (rim IS NULL OR btrim(rim) <> ''),
  ADD CONSTRAINT expulsions_nni_non_vide CHECK (national_id IS NULL OR btrim(national_id) <> '');
