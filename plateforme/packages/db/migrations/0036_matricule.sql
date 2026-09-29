-- ============================================================================
--  0036_matricule — le matricule interne de l'élève, `etudiants.identifiant`
--
--  Chaque page d'El Ourwa qui liste des élèves porte une colonne « Matricule »
--  (gestion_groupes, gerer_absence, saisir_notes, gestion_caisse…) : c'est
--  `etudiants.identifiant`, « ET » + année sur deux chiffres + cinq chiffres
--  tirés au sort à l'inscription (`inscrire_etudiant.php`), et la recherche
--  de la caisse l'accepte. La reprise l'avait laissé « sans destination » ;
--  il en a une désormais. Distinct du RIM et du NNI, qui ont leurs colonnes.
-- ============================================================================

ALTER TABLE students ADD COLUMN matricule text;
ALTER TABLE students
  ADD CONSTRAINT students_school_matricule_key UNIQUE (school_id, matricule);
