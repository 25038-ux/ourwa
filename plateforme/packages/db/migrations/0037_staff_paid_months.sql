-- LES MOIS PAYÉS D'UN MEMBRE DU PERSONNEL — décision du propriétaire (2026-09-17).
--
-- Les professeurs ne sont payés que les mois actifs de l'année scolaire ; le
-- personnel peut l'être toute l'année — mais pas forcément chacun : un gardien
-- l'est douze mois, une cantinière neuf. Chaque membre porte donc SES mois
-- payés (1..12, mois civils). Vide ou NULL = tous les mois, ce qui est le
-- comportement d'avant pour tout le personnel existant (rien ne change pour
-- eux tant qu'on ne le décide pas).
ALTER TABLE staff ADD COLUMN paid_months smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,7,8,9,10,11,12}';
ALTER TABLE staff ADD CONSTRAINT staff_paid_months_range
  CHECK (paid_months <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]);
