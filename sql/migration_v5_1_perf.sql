-- =============================================================================
-- El OURWA — v5.1 — Index ciblés performance — RÉIMPORT SÛR (idempotent)
-- Chaque index n'est ajouté que s'il n'existe pas déjà (information_schema).
-- Aucune erreur "Duplicate key name" : l'import ne s'interrompt jamais.
-- =============================================================================
SET NAMES utf8mb4;
SET collation_connection = 'utf8mb4_unicode_ci';
SET @db := DATABASE();

-- notifications.idx_notif_parent_lu
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='notifications' AND INDEX_NAME='idx_notif_parent_lu');
SET @sql := IF(@x=0, "ALTER TABLE notifications ADD INDEX idx_notif_parent_lu (parent_id, lu, id)", "SELECT 'idx_notif_parent_lu ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- notifications.idx_notif_parent_date
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='notifications' AND INDEX_NAME='idx_notif_parent_date');
SET @sql := IF(@x=0, "ALTER TABLE notifications ADD INDEX idx_notif_parent_date (parent_id, date_creation)", "SELECT 'idx_notif_parent_date ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- etudiants.idx_etu_parent
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='etudiants' AND INDEX_NAME='idx_etu_parent');
SET @sql := IF(@x=0, "ALTER TABLE etudiants ADD INDEX idx_etu_parent (parent_id)", "SELECT 'idx_etu_parent ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- etudiants.idx_etu_groupe
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='etudiants' AND INDEX_NAME='idx_etu_groupe');
SET @sql := IF(@x=0, "ALTER TABLE etudiants ADD INDEX idx_etu_groupe (groupe_id)", "SELECT 'idx_etu_groupe ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- etudiants.idx_etu_nom_prenom
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='etudiants' AND INDEX_NAME='idx_etu_nom_prenom');
SET @sql := IF(@x=0, "ALTER TABLE etudiants ADD INDEX idx_etu_nom_prenom (nom, prenom)", "SELECT 'idx_etu_nom_prenom ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- paiements.idx_paie_etu_mois
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='paiements' AND INDEX_NAME='idx_paie_etu_mois');
SET @sql := IF(@x=0, "ALTER TABLE paiements ADD INDEX idx_paie_etu_mois (etudiant_id, mois, annee)", "SELECT 'idx_paie_etu_mois ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- paiements.idx_paie_annee_mois
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='paiements' AND INDEX_NAME='idx_paie_annee_mois');
SET @sql := IF(@x=0, "ALTER TABLE paiements ADD INDEX idx_paie_annee_mois (annee, mois)", "SELECT 'idx_paie_annee_mois ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- absences.idx_abs_etudiant
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='absences' AND INDEX_NAME='idx_abs_etudiant');
SET @sql := IF(@x=0, "ALTER TABLE absences ADD INDEX idx_abs_etudiant (etudiant_id, date_absence)", "SELECT 'idx_abs_etudiant ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- absences.idx_abs_date
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='absences' AND INDEX_NAME='idx_abs_date');
SET @sql := IF(@x=0, "ALTER TABLE absences ADD INDEX idx_abs_date (date_absence)", "SELECT 'idx_abs_date ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- notes.idx_notes_etudiant
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='notes' AND INDEX_NAME='idx_notes_etudiant');
SET @sql := IF(@x=0, "ALTER TABLE notes ADD INDEX idx_notes_etudiant (etudiant_id, trimestre)", "SELECT 'idx_notes_etudiant ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- notes.idx_notes_ens
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='notes' AND INDEX_NAME='idx_notes_ens');
SET @sql := IF(@x=0, "ALTER TABLE notes ADD INDEX idx_notes_ens (enseignement_id)", "SELECT 'idx_notes_ens ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- remarques.idx_rem_etudiant
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='remarques' AND INDEX_NAME='idx_rem_etudiant');
SET @sql := IF(@x=0, "ALTER TABLE remarques ADD INDEX idx_rem_etudiant (etudiant_id, date_creation)", "SELECT 'idx_rem_etudiant ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- messages.idx_msg_parent
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='messages' AND INDEX_NAME='idx_msg_parent');
SET @sql := IF(@x=0, "ALTER TABLE messages ADD INDEX idx_msg_parent (parent_id, date_envoi)", "SELECT 'idx_msg_parent ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- enseignements.idx_ens_groupe
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='enseignements' AND INDEX_NAME='idx_ens_groupe');
SET @sql := IF(@x=0, "ALTER TABLE enseignements ADD INDEX idx_ens_groupe (groupe_id)", "SELECT 'idx_ens_groupe ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- enseignements.idx_ens_prof
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='enseignements' AND INDEX_NAME='idx_ens_prof');
SET @sql := IF(@x=0, "ALTER TABLE enseignements ADD INDEX idx_ens_prof (professeur_id)", "SELECT 'idx_ens_prof ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- parents.idx_parents_actif
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='parents' AND INDEX_NAME='idx_parents_actif');
SET @sql := IF(@x=0, "ALTER TABLE parents ADD INDEX idx_parents_actif (actif)", "SELECT 'idx_parents_actif ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- parents.idx_parents_nom
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='parents' AND INDEX_NAME='idx_parents_nom');
SET @sql := IF(@x=0, "ALTER TABLE parents ADD INDEX idx_parents_nom (nom_complet)", "SELECT 'idx_parents_nom ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- utilisateurs.idx_users_role
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='utilisateurs' AND INDEX_NAME='idx_users_role');
SET @sql := IF(@x=0, "ALTER TABLE utilisateurs ADD INDEX idx_users_role (role)", "SELECT 'idx_users_role ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- utilisateurs.idx_users_actif
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='utilisateurs' AND INDEX_NAME='idx_users_actif');
SET @sql := IF(@x=0, "ALTER TABLE utilisateurs ADD INDEX idx_users_actif (actif)", "SELECT 'idx_users_actif ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- MAJ des stats de l'optimiseur
ANALYZE TABLE notifications, etudiants, paiements, absences, notes, remarques, messages, enseignements, parents, utilisateurs;
