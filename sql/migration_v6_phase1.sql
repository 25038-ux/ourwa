-- =============================================================================
-- El OURWA — Migration v6 (PHASE 1) — RÉIMPORT SÛR (idempotent)
-- Fondations : moyens de paiement multi-lignes, exemptions, sexe, nouveaux rôles
--
-- À importer dans phpMyAdmin (InfinityFree), APRÈS le schéma de base + v5 / v5.1.
-- Vous pouvez le réimporter sans risque : chaque ajout de colonne/index est
-- protégé par un test sur information_schema (pas de procédure stockée).
-- =============================================================================

SET NAMES utf8mb4;
SET collation_connection = 'utf8mb4_unicode_ci';

-- -----------------------------------------------------------------------------
-- 1) Étendre l'ENUM rôle : + secretaire, + comptable  (MODIFY est idempotent)
-- -----------------------------------------------------------------------------
ALTER TABLE utilisateurs
  MODIFY COLUMN role
  ENUM('super_admin','admin','professeur','collecteur_absence','secretaire','comptable')
  NOT NULL;

-- -----------------------------------------------------------------------------
-- 2) Colonne sexe — ajout conditionnel (ne casse pas si déjà présente)
--    Motif technique : ADD COLUMN IF NOT EXISTS n'est pas dispo sur l'hôte.
--    On construit dynamiquement l'ALTER seulement si la colonne manque.
-- -----------------------------------------------------------------------------
SET @db := DATABASE();

-- etudiants.sexe
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA=@db AND TABLE_NAME='etudiants' AND COLUMN_NAME='sexe');
SET @sql := IF(@x=0, "ALTER TABLE etudiants ADD COLUMN sexe ENUM('M','F') NULL AFTER prenom", "SELECT 'etudiants.sexe ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- professeurs.sexe
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA=@db AND TABLE_NAME='professeurs' AND COLUMN_NAME='sexe');
SET @sql := IF(@x=0, "ALTER TABLE professeurs ADD COLUMN sexe ENUM('M','F') NULL AFTER prenom", "SELECT 'professeurs.sexe ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- staff.sexe
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA=@db AND TABLE_NAME='staff' AND COLUMN_NAME='sexe');
SET @sql := IF(@x=0, "ALTER TABLE staff ADD COLUMN sexe ENUM('M','F') NULL AFTER prenom", "SELECT 'staff.sexe ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- personnel_admin.sexe
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA=@db AND TABLE_NAME='personnel_admin' AND COLUMN_NAME='sexe');
SET @sql := IF(@x=0, "ALTER TABLE personnel_admin ADD COLUMN sexe ENUM('M','F') NULL AFTER prenom", "SELECT 'personnel_admin.sexe ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- -----------------------------------------------------------------------------
-- 3) Moyens de paiement
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS moyens_paiement (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  nom           VARCHAR(60) NOT NULL,
  actif         BOOLEAN NOT NULL DEFAULT TRUE,
  date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_moyen_nom (nom)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO moyens_paiement (nom) VALUES
  ('Espèces'), ('Bankily'), ('Masrvi'), ('Sedad'), ('Virement bancaire');

-- -----------------------------------------------------------------------------
-- 4) Lignes de paiement (ventilation polymorphe)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paiement_lignes (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  source_type   VARCHAR(32) NOT NULL,
  source_id     INT NOT NULL,
  moyen_id      INT NOT NULL,
  montant       DECIMAL(10,2) NOT NULL,
  sens          ENUM('entrant','sortant') NOT NULL DEFAULT 'entrant',
  date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pl_source (source_type, source_id),
  KEY idx_pl_moyen  (moyen_id),
  KEY idx_pl_sens   (sens, date_creation),
  FOREIGN KEY (moyen_id) REFERENCES moyens_paiement(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 5) Exemptions de frais
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exemptions (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  etudiant_id   INT NOT NULL,
  type          ENUM('totale','mensuelle') NOT NULL,
  mois          TINYINT NULL,
  annee         SMALLINT NULL,
  motif         VARCHAR(255) NULL,
  cree_par      INT NULL,
  date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_exempt_etudiant (etudiant_id),
  KEY idx_exempt_periode  (etudiant_id, annee, mois),
  FOREIGN KEY (etudiant_id) REFERENCES etudiants(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Index unique conditionnel sur (etudiant_id, mois, annee)
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA=@db AND TABLE_NAME='exemptions' AND INDEX_NAME='uq_exempt_mensuelle');
SET @sql := IF(@x=0, "ALTER TABLE exemptions ADD UNIQUE KEY uq_exempt_mensuelle (etudiant_id, mois, annee)", "SELECT 'uq_exempt_mensuelle ok'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- =============================================================================
-- FIN PHASE 1
-- =============================================================================
