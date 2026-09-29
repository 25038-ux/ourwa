-- ============================================================================
--  0022 — ON DELETE SET NULL sur une clé composite : ne vider QUE la colonne
--         référencée
-- ============================================================================
--
-- ⚠ HUIT CONTRAINTES ÉTAIENT INAPPLICABLES, ET AUCUNE NE S'EN PLAIGNAIT AVANT
-- LE JOUR DE LA SUPPRESSION.
--
-- Nos clés étrangères sont composites — `(school_id, level_id)` plutôt que
-- `(level_id)` — pour qu'une référence d'un tenant vers un autre soit
-- structurellement impossible (règle 5). Mais `ON DELETE SET NULL` sur une clé
-- composite vide TOUTES ses colonnes, `school_id` compris. Or `school_id` est
-- `NOT NULL` partout, par construction. Le résultat :
--
--     DELETE FROM levels WHERE id = …
--     ERROR:  null value in column "school_id" of relation "groups"
--             violates not-null constraint
--
-- Autrement dit « Supprimer le niveau » ne détachait pas les classes : il
-- échouait, avec une erreur de base de données brute, précisément dans le cas
-- où l'on veut supprimer un niveau — celui où il porte encore des classes.
-- Vérifié sur la base de développement avant d'écrire ceci.
--
-- Postgres 15 a introduit la forme qui manquait : `ON DELETE SET NULL (col)`,
-- qui ne vide que la colonne nommée et laisse `school_id` en place. La clé
-- reste composite ; la garantie d'isolation ne change pas d'un iota. Seule
-- l'action de suppression devient exécutable.
--
-- Les huit, telles que le catalogue les donne. Elles sont réécrites une par une
-- plutôt que par une boucle : une clé étrangère se relit.

-- attendance → teachings : une séance dont l'assignation disparaît garde son
-- appel, sans le cours. L'absence d'un élève est un fait, pas un détail du
-- planning.
ALTER TABLE attendance
  DROP CONSTRAINT attendance_school_id_teaching_id_fkey,
  ADD  CONSTRAINT attendance_school_id_teaching_id_fkey
       FOREIGN KEY (school_id, teaching_id) REFERENCES teachings (school_id, id)
       ON DELETE SET NULL (teaching_id);

-- debt_write_offs → academic_years : une remise accordée survit à l'année sur
-- laquelle elle portait. Effacer la remise avec l'année effacerait la décision.
ALTER TABLE debt_write_offs
  DROP CONSTRAINT debt_write_offs_school_id_academic_year_id_fkey,
  ADD  CONSTRAINT debt_write_offs_school_id_academic_year_id_fkey
       FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years (school_id, id)
       ON DELETE SET NULL (academic_year_id);

-- enrollments → groups / levels : supprimer une classe ne supprime pas les
-- inscriptions qu'elle portait ; elle les laisse sans classe, à réaffecter.
ALTER TABLE enrollments
  DROP CONSTRAINT enrollments_school_id_group_id_fkey,
  ADD  CONSTRAINT enrollments_school_id_group_id_fkey
       FOREIGN KEY (school_id, group_id) REFERENCES groups (school_id, id)
       ON DELETE SET NULL (group_id);

ALTER TABLE enrollments
  DROP CONSTRAINT enrollments_school_id_level_id_fkey,
  ADD  CONSTRAINT enrollments_school_id_level_id_fkey
       FOREIGN KEY (school_id, level_id) REFERENCES levels (school_id, id)
       ON DELETE SET NULL (level_id);

-- evening_teachings → teachers : un professeur de l'école qui s'en va laisse
-- son assignation du soir, qui bascule alors sur l'autre branche du CHECK.
ALTER TABLE evening_teachings
  DROP CONSTRAINT evening_teachings_school_id_teacher_id_fkey,
  ADD  CONSTRAINT evening_teachings_school_id_teacher_id_fkey
       FOREIGN KEY (school_id, teacher_id) REFERENCES teachers (school_id, id)
       ON DELETE SET NULL (teacher_id);

-- evening_timetable_slots → evening_teachings : retirer un professeur d'un
-- groupe ne vide pas la case de la grille ; elle passe à « à définir plus
-- tard », ce que sa propre grille affiche par un tiret.
ALTER TABLE evening_timetable_slots
  DROP CONSTRAINT evening_timetable_slots_school_id_evening_teaching_id_fkey,
  ADD  CONSTRAINT evening_timetable_slots_school_id_evening_teaching_id_fkey
       FOREIGN KEY (school_id, evening_teaching_id) REFERENCES evening_teachings (school_id, id)
       ON DELETE SET NULL (evening_teaching_id);

-- groups → levels : le cas prouvé ci-dessus.
ALTER TABLE groups
  DROP CONSTRAINT groups_school_id_level_id_fkey,
  ADD  CONSTRAINT groups_school_id_level_id_fkey
       FOREIGN KEY (school_id, level_id) REFERENCES levels (school_id, id)
       ON DELETE SET NULL (level_id);

-- misc_debts → students : ⚠ CELLE-CI EST FINANCIÈRE. Supprimer un élève ne doit
-- pas emporter la créance de sa famille : la dette appartient au correspondant,
-- et le lien vers l'enfant n'est qu'une indication de son origine.
ALTER TABLE misc_debts
  DROP CONSTRAINT misc_debts_school_id_student_id_fkey,
  ADD  CONSTRAINT misc_debts_school_id_student_id_fkey
       FOREIGN KEY (school_id, student_id) REFERENCES students (school_id, id)
       ON DELETE SET NULL (student_id);
