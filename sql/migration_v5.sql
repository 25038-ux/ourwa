
CREATE TABLE IF NOT EXISTS expulsions (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  nni             VARCHAR(30) NOT NULL,
  rim             VARCHAR(30) NOT NULL,
  nom             VARCHAR(100) NOT NULL,
  prenom          VARCHAR(100) NOT NULL,
  motif           VARCHAR(255) NULL,
  expulse_par     INT NULL,
  date_expulsion  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_expulsion (nni, rim),
  KEY idx_expulsions_nni (nni),
  KEY idx_expulsions_rim (rim),
  FOREIGN KEY (expulse_par) REFERENCES utilisateurs(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) Étendre l'ENUM rôle
ALTER TABLE utilisateurs
  MODIFY COLUMN role ENUM('super_admin','admin','professeur','collecteur_absence') NOT NULL;

-- 3) Emploi du temps (3 créneaux × 6 jours)
CREATE TABLE IF NOT EXISTS emplois_du_temps (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  groupe_id       INT NOT NULL,
  jour            ENUM('Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi') NOT NULL,
  creneau         ENUM('8h-9h45','10h-11h45','12h-14h') NOT NULL,
  enseignement_id INT NOT NULL,
  date_creation   DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emploi_case (groupe_id, jour, creneau),
  KEY idx_emploi_groupe (groupe_id),
  KEY idx_emploi_enseignement (enseignement_id),
  FOREIGN KEY (groupe_id)       REFERENCES groupes(id)       ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (enseignement_id) REFERENCES enseignements(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;



