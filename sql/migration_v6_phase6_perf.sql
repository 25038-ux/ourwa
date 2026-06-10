-- =============================================================================
-- El OURWA — v6 PHASE 6 — Index performance pour les nouvelles tables
-- Idempotent / réimport sûr.
-- =============================================================================
SET NAMES utf8mb4;
SET collation_connection = 'utf8mb4_unicode_ci';
SET @db := DATABASE();

-- paiement_lignes : requêtes Revenue Live par jour/mois/moyen/sens
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='paiement_lignes' AND INDEX_NAME='idx_pl_date_sens');
SET @sql := IF(@x=0, "ALTER TABLE paiement_lignes ADD INDEX idx_pl_date_sens (date_creation, sens)", "SELECT 'idx_pl_date_sens ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- cs_paiements : agrégation par période
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='cs_paiements' AND INDEX_NAME='idx_csp_insc');
SET @sql := IF(@x=0, "ALTER TABLE cs_paiements ADD INDEX idx_csp_insc (inscription_id, annee, mois)", "SELECT 'idx_csp_insc ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- paiements_salaire : Revenue Live "payé aux profs/staff"
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='paiements_salaire' AND INDEX_NAME='idx_ps_type_periode');
SET @sql := IF(@x=0, "ALTER TABLE paiements_salaire ADD INDEX idx_ps_type_periode (beneficiaire_type, annee, mois)", "SELECT 'idx_ps_type_periode ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
