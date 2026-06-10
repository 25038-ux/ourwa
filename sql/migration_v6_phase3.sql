-- =============================================================================
-- El OURWA — Migration v6 (PHASE 3) — RÉIMPORT SÛR (idempotent)
-- Finance : paiements de salaires (staff/profs), méthode sur les dépenses.
-- À importer après la phase 1. Réimport sans danger.
-- =============================================================================
SET NAMES utf8mb4;
SET collation_connection = 'utf8mb4_unicode_ci';
SET @db := DATABASE();

-- 1) Paiements de salaire (profs + staff) — la ventilation par moyen vit dans
--    paiement_lignes (source_type='salaire_staff' | 'salaire_prof', sens='sortant').
CREATE TABLE IF NOT EXISTS paiements_salaire (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  beneficiaire_type ENUM('staff','professeur') NOT NULL,
  beneficiaire_id   INT NOT NULL,              -- staff.id ou professeurs.id
  montant       DECIMAL(10,2) NOT NULL,
  mois          TINYINT NOT NULL,
  annee         SMALLINT NOT NULL,
  motif         VARCHAR(255) NULL,             -- ex: "Salaire", "Cours du soir"
  paye_par      INT NULL,
  date_paiement DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ps_benef (beneficiaire_type, beneficiaire_id),
  KEY idx_ps_periode (annee, mois)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) Colonne "date_depense" existe déjà ; on ajoute rien à depenses
--    (la méthode de paiement d'une dépense est stockée dans paiement_lignes,
--     source_type='depense', sens='sortant').

-- =============================================================================
-- FIN PHASE 3
-- =============================================================================
