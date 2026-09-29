-- ============================================================================
--  0025 — la base refuse elle-même d'effacer des notes et des salaires
-- ============================================================================
--
-- ADR-0042 a bouché deux trous dans le SERVICE : `removeTeaching()` effaçait en
-- silence les notes de l'assignation, et son jumeau du soir effaçait les
-- salaires déjà versés au professeur. Les deux refusent maintenant, en disant
-- combien de lignes sont en jeu.
--
-- ⚠ MAIS UN GARDE APPLICATIF NE PROTÈGE QUE LES CHEMINS QU'ON CONNAÎT. Le
-- prochain écran, le prochain import, la prochaine tâche de nettoyage passera à
-- côté ; et un `DELETE` lancé à la main dans psql un soir de reprise n'en saura
-- rien du tout. La contrainte, elle, ne s'oublie pas.
--
-- ⚠ `NO ACTION` ET NON `RESTRICT`, ET LA DIFFÉRENCE EST TOUT LE SUJET.
--
-- Les deux refusent de laisser une ligne orpheline. Mais `RESTRICT` est vérifié
-- IMMÉDIATEMENT, tandis que `NO ACTION` l'est à la FIN de l'instruction. Or
-- `grades` et `evening_teacher_payments` portent aussi une clé directe vers
-- `schools` en CASCADE : supprimer une école efface d'un même geste les
-- enseignements ET les notes. Avec `RESTRICT`, ce geste échouerait — la
-- contrainte se déclencherait avant que la cascade voisine n'ait retiré les
-- lignes qui la gênent. Avec `NO ACTION`, la vérification a lieu quand tout est
-- retiré, et la suppression d'un tenant reste possible.
--
-- Autrement dit : on veut refuser « supprime cette assignation et perds ses
-- notes », pas « supprime cette école ». Un test tient les deux.
--
-- Rien n'est réécrit dans les données : ces clés n'ont jamais eu de ligne
-- orpheline, puisqu'elles cascadaient.

-- Les notes d'une assignation. Une secrétaire qui retire une assignation saisie
-- par erreur en octobre emportait tout un trimestre de notes, pour toute la
-- classe.
ALTER TABLE grades
  DROP CONSTRAINT grades_school_id_teaching_id_fkey,
  ADD  CONSTRAINT grades_school_id_teaching_id_fkey
       FOREIGN KEY (school_id, teaching_id) REFERENCES teachings (school_id, id)
       ON DELETE NO ACTION;

-- Les salaires versés à un professeur du soir. De l'argent sorti de la caisse :
-- les écritures financières sont append-only (règle 7).
ALTER TABLE evening_teacher_payments
  DROP CONSTRAINT evening_teacher_payments_school_id_evening_teaching_id_fkey,
  ADD  CONSTRAINT evening_teacher_payments_school_id_evening_teaching_id_fkey
       FOREIGN KEY (school_id, evening_teaching_id)
       REFERENCES evening_teachings (school_id, id)
       ON DELETE NO ACTION;

COMMENT ON CONSTRAINT grades_school_id_teaching_id_fkey ON grades IS
  'NO ACTION, jamais CASCADE : supprimer une assignation ne doit pas effacer '
  'ses notes. NO ACTION plutôt que RESTRICT pour que la suppression d''une '
  'école, qui efface les deux tables à la fois, reste possible.';

COMMENT ON CONSTRAINT
  evening_teacher_payments_school_id_evening_teaching_id_fkey
  ON evening_teacher_payments IS
  'NO ACTION, jamais CASCADE : un salaire versé ne s''efface pas avec '
  'l''assignation qui l''a justifié.';
