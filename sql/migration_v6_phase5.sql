-- =============================================================================
-- El OURWA — Migration v6 (PHASE 5) — RÉIMPORT SÛR (idempotent)
-- Dettes + Cours du soir (groupes hors niveaux, tarifs, emploi, profs, paiements)
-- À importer après les phases 1 et 3. Réimport sans danger.
-- =============================================================================
SET NAMES utf8mb4;
SET collation_connection = 'utf8mb4_unicode_ci';
SET @db := DATABASE();

-- ---------------------------------------------------------------------------
-- DETTES : on prête X mois de service à une personne ; suivi des remboursements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dettes (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  etudiant_id   INT NULL,                      -- si rattachée à un étudiant existant
  debiteur_nom  VARCHAR(150) NOT NULL,         -- nom libre (étudiant ou tiers)
  telephone     VARCHAR(20) NULL,
  nb_mois       INT NOT NULL DEFAULT 1,        -- nombre de mois de service prêtés
  montant_total DECIMAL(10,2) NOT NULL,        -- dette totale
  montant_rembourse DECIMAL(10,2) NOT NULL DEFAULT 0,
  motif         VARCHAR(255) NULL,
  cree_par      INT NULL,
  date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_dette_etudiant (etudiant_id),
  KEY idx_dette_solde (montant_total, montant_rembourse)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dette_remboursements (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  dette_id      INT NOT NULL,
  montant       DECIMAL(10,2) NOT NULL,
  date_remb     DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_dr_dette (dette_id),
  FOREIGN KEY (dette_id) REFERENCES dettes(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- COURS DU SOIR : groupes indépendants des niveaux
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cs_groupes (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  nom           VARCHAR(80) NOT NULL,
  tarif_mensuel DECIMAL(10,2) NOT NULL DEFAULT 0,
  description   VARCHAR(255) NULL,
  actif         BOOLEAN NOT NULL DEFAULT TRUE,
  date_creation DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Inscrits : soit un étudiant de l'école (etudiant_id), soit un externe (nom libre)
CREATE TABLE IF NOT EXISTS cs_inscriptions (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  cs_groupe_id  INT NOT NULL,
  etudiant_id   INT NULL,                      -- élève déjà dans l'école
  externe_nom   VARCHAR(150) NULL,             -- élève externe
  externe_tel   VARCHAR(20) NULL,
  externe_sexe  ENUM('M','F') NULL,
  date_inscription DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_csi_groupe (cs_groupe_id),
  KEY idx_csi_etudiant (etudiant_id),
  FOREIGN KEY (cs_groupe_id) REFERENCES cs_groupes(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (etudiant_id) REFERENCES etudiants(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Paiements cours du soir (ventilation par moyen dans paiement_lignes,
-- source_type='cours_soir', sens='entrant')
CREATE TABLE IF NOT EXISTS cs_paiements (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  inscription_id INT NOT NULL,
  mois          TINYINT NOT NULL,
  annee         SMALLINT NOT NULL,
  montant       DECIMAL(10,2) NOT NULL,
  recu_numero   VARCHAR(50) NOT NULL,
  date_paiement DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cs_paie (inscription_id, mois, annee),
  KEY idx_csp_periode (annee, mois),
  FOREIGN KEY (inscription_id) REFERENCES cs_inscriptions(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Profs assignés à un groupe cours du soir + taux horaire pour ce cours
CREATE TABLE IF NOT EXISTS cs_enseignements (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  cs_groupe_id  INT NOT NULL,
  professeur_id INT NOT NULL,
  matiere       VARCHAR(100) NULL,
  prix_par_heure DECIMAL(10,2) NOT NULL DEFAULT 0,
  heures_par_mois INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_cs_ens (cs_groupe_id, professeur_id),
  KEY idx_cse_prof (professeur_id),
  FOREIGN KEY (cs_groupe_id) REFERENCES cs_groupes(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (professeur_id) REFERENCES professeurs(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Emploi du temps cours du soir (libre : jour + créneau texte)
CREATE TABLE IF NOT EXISTS cs_emploi (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  cs_groupe_id  INT NOT NULL,
  jour          ENUM('Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche') NOT NULL,
  creneau       VARCHAR(40) NOT NULL,
  matiere       VARCHAR(100) NULL,
  professeur_id INT NULL,
  KEY idx_cse_groupe (cs_groupe_id),
  FOREIGN KEY (cs_groupe_id) REFERENCES cs_groupes(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (professeur_id) REFERENCES professeurs(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- FIN PHASE 5
-- =============================================================================
