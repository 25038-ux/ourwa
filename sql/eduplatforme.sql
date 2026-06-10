-- =============================================================================
-- EduPlatforme — Schéma SQL complet (v4)
-- À importer UNE SEULE FOIS. Crée la base, toutes les tables, et le compte
-- super-admin par défaut. Aucune donnée de démonstration.
--
-- Compte par défaut :  identifiant = admin@supnum.mr   mot de passe = Admin2026!
-- (le hash Argon2id ci-dessous est réel et fonctionnel — aucun installateur requis)
-- =============================================================================

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;
SET collation_connection = 'utf8mb4_unicode_ci';





-- =============================================================================
--  Nettoyage (réimport propre)
-- =============================================================================
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS exercices;
DROP TABLE IF EXISTS absences;
DROP TABLE IF EXISTS remarques;
DROP TABLE IF EXISTS reinscriptions;
DROP TABLE IF EXISTS effectifs_annuels;
DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS enseignements;
DROP TABLE IF EXISTS paiements;
DROP TABLE IF EXISTS depenses;
DROP TABLE IF EXISTS etudiants;
DROP TABLE IF EXISTS parents;
DROP TABLE IF EXISTS matieres;
DROP TABLE IF EXISTS groupes;
DROP TABLE IF EXISTS niveaux;
DROP TABLE IF EXISTS professeurs;
DROP TABLE IF EXISTS personnel_admin;
DROP TABLE IF EXISTS staff;
DROP TABLE IF EXISTS journal_securite;
DROP TABLE IF EXISTS utilisateurs;
SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
--  TABLES — Comptes & sécurité
-- =============================================================================

CREATE TABLE utilisateurs (
  id                  INT PRIMARY KEY AUTO_INCREMENT,
  identifiant         VARCHAR(100) UNIQUE NOT NULL,
  mot_de_passe        VARCHAR(255) NOT NULL,                       -- hash Argon2id
  role                ENUM('super_admin','admin','professeur') NOT NULL,
  nom                 VARCHAR(100) NULL,
  prenom              VARCHAR(100) NULL,
  actif               BOOLEAN DEFAULT TRUE,
  derniere_connexion  DATETIME NULL,
  tentatives_echec    INT DEFAULT 0,
  bloque_jusqua       DATETIME NULL,
  date_creation       DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE journal_securite (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  utilisateur_id  INT NULL,
  action          VARCHAR(200),
  ip              VARCHAR(45),
  user_agent      TEXT,
  date            DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
--  TABLES — Structure pédagogique
-- =============================================================================

CREATE TABLE niveaux (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  nom           VARCHAR(20) UNIQUE NOT NULL,
  tarif_mensuel DECIMAL(10,2) NOT NULL DEFAULT 15000.00
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE groupes (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  nom           VARCHAR(50) NOT NULL,
  niveau_id     INT NULL,
  capacite      INT NOT NULL,
  date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (niveau_id) REFERENCES niveaux(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE matieres (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  nom         VARCHAR(100) NOT NULL,
  coefficient INT NOT NULL DEFAULT 1,
  niveau_id   INT NULL,
  UNIQUE KEY unique_matiere_niveau (nom, niveau_id),
  FOREIGN KEY (niveau_id) REFERENCES niveaux(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
--  TABLES — Parents & étudiants
-- =============================================================================

-- Compte parent : connexion par téléphone + mot de passe défini par l'admin.
CREATE TABLE parents (
  id                INT PRIMARY KEY AUTO_INCREMENT,
  telephone         VARCHAR(20)  UNIQUE NOT NULL,           -- identifiant de connexion
  mot_de_passe      VARCHAR(255) NOT NULL,                  -- hash Argon2id
  nom_complet       VARCHAR(150) NOT NULL,
  email             VARCHAR(150) NULL,
  actif             BOOLEAN DEFAULT TRUE,
  doit_changer_mdp  BOOLEAN DEFAULT TRUE,                   -- forcer le changement au 1er accès
  derniere_connexion DATETIME NULL,
  tentatives_echec  INT DEFAULT 0,
  bloque_jusqua     DATETIME NULL,
  date_creation     DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Étudiants : id technique (clé primaire pour les FK) + rim & nni uniques.
CREATE TABLE etudiants (
  id                INT PRIMARY KEY AUTO_INCREMENT,
  rim               VARCHAR(30)  NOT NULL,
  nni               VARCHAR(30)  NOT NULL,
  identifiant       VARCHAR(50)  NOT NULL,                  -- matricule affiché
  nom               VARCHAR(100) NOT NULL,
  prenom            VARCHAR(100) NOT NULL,
  date_naissance    DATE NULL,
  lieu_naissance    VARCHAR(120) NULL,
  parent_id         INT NULL,
  nom_parent        VARCHAR(150) NOT NULL,
  telephone_parent  VARCHAR(20)  NOT NULL,
  frais_mensuel     DECIMAL(10,2) NOT NULL DEFAULT 0,
  groupe_id         INT NOT NULL,
  date_inscription  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_etudiant_rim (rim),
  UNIQUE KEY uq_etudiant_nni (nni),
  FOREIGN KEY (groupe_id) REFERENCES groupes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Historique de réinscription (changement de niveau/groupe d'une année à l'autre)
CREATE TABLE reinscriptions (
  id                INT PRIMARY KEY AUTO_INCREMENT,
  etudiant_id       INT NOT NULL,
  ancien_groupe_id  INT NULL,
  nouveau_groupe_id INT NOT NULL,
  annee_scolaire    VARCHAR(9) NOT NULL,                    -- ex : 2025-2026
  date_reinscription DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (etudiant_id) REFERENCES etudiants(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Effectifs par groupe et par année (pour les statistiques de progression)
CREATE TABLE effectifs_annuels (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  groupe_id      INT NOT NULL,
  annee          SMALLINT NOT NULL,
  effectif       INT NOT NULL DEFAULT 0,
  date_snapshot  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_effectif (groupe_id, annee),
  FOREIGN KEY (groupe_id) REFERENCES groupes(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
--  TABLES — Personnel
-- =============================================================================

CREATE TABLE professeurs (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  utilisateur_id  INT NOT NULL UNIQUE,
  nom             VARCHAR(100) NOT NULL,
  prenom          VARCHAR(100) NOT NULL,
  telephone       VARCHAR(20),
  nb_classes      INT DEFAULT 0,
  heures_par_mois INT DEFAULT 0,
  prix_par_heure  DECIMAL(10,2) NOT NULL DEFAULT 0,
  salaire         DECIMAL(10,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE personnel_admin (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  utilisateur_id  INT NOT NULL UNIQUE,
  nom             VARCHAR(100) NOT NULL,
  prenom          VARCHAR(100) NOT NULL,
  telephone       VARCHAR(20),
  fonction        VARCHAR(100) NOT NULL,
  salaire         DECIMAL(10,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE staff (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  nom           VARCHAR(100) NOT NULL,
  prenom        VARCHAR(100) NOT NULL,
  telephone     VARCHAR(20),
  fonction      VARCHAR(100) NOT NULL,
  salaire       DECIMAL(10,2) NOT NULL DEFAULT 0,
  date_embauche DATE NOT NULL,
  actif         BOOLEAN DEFAULT TRUE,
  date_creation DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
--  TABLES — Pédagogie (enseignements, notes, exercices)
-- =============================================================================

CREATE TABLE enseignements (
  id                  INT PRIMARY KEY AUTO_INCREMENT,
  professeur_id       INT NOT NULL,
  groupe_id           INT NOT NULL,
  matiere_id          INT NOT NULL,
  heures_par_semaine  DECIMAL(4,1) NOT NULL DEFAULT 0,
  UNIQUE(professeur_id, groupe_id, matiere_id),
  FOREIGN KEY (professeur_id) REFERENCES professeurs(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (groupe_id)     REFERENCES groupes(id)      ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (matiere_id)    REFERENCES matieres(id)     ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notes (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  etudiant_id      INT NOT NULL,
  enseignement_id  INT NOT NULL,
  valeur           DECIMAL(4,2) NOT NULL,
  trimestre        TINYINT NOT NULL,
  type_note        ENUM('devoir','examen') NOT NULL DEFAULT 'devoir',
  numero_devoir    INT NOT NULL DEFAULT 1,
  date_saisie      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_note (etudiant_id, enseignement_id, trimestre, type_note, numero_devoir),
  FOREIGN KEY (etudiant_id)     REFERENCES etudiants(id)      ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (enseignement_id) REFERENCES enseignements(id)  ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE exercices (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  enseignement_id INT NOT NULL,
  titre           VARCHAR(150) NOT NULL,
  description     TEXT NOT NULL,
  pieces_jointes  JSON NULL,         -- tableau JSON : [{"nom":"...","chemin":"...","mime":"...","taille":1234}, ...]
  date_limite     DATE NULL,
  date_envoi      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (enseignement_id) REFERENCES enseignements(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
--  TABLES — Vie scolaire (absences, remarques)
-- =============================================================================

CREATE TABLE absences (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  etudiant_id     INT NOT NULL,
  enseignement_id INT NULL,
  date_absence    DATE NOT NULL,
  statut          ENUM('absent','present','retard') NOT NULL DEFAULT 'absent',
  justifiee       BOOLEAN DEFAULT FALSE,
  remarque        VARCHAR(255) NULL,
  saisi_par       INT NULL,
  date_saisie     DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_absence (etudiant_id, enseignement_id, date_absence),
  FOREIGN KEY (etudiant_id)     REFERENCES etudiants(id)     ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (enseignement_id) REFERENCES enseignements(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE remarques (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  etudiant_id   INT NOT NULL,
  auteur_type   ENUM('professeur','admin','super_admin') NOT NULL,
  auteur_id     INT NULL,
  auteur_nom    VARCHAR(150) NOT NULL,
  contenu       TEXT NOT NULL,
  gravite       ENUM('info','positif','avertissement','grave') NOT NULL DEFAULT 'info',
  date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (etudiant_id) REFERENCES etudiants(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
--  TABLES — Communication (messages admin→parent, notifications)
-- =============================================================================

CREATE TABLE messages (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  parent_id     INT NOT NULL,
  expediteur    VARCHAR(150) NOT NULL,
  sujet         VARCHAR(200) NOT NULL,
  contenu       TEXT NOT NULL,
  lu            BOOLEAN DEFAULT FALSE,
  date_envoi    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- File de notifications poussées vers le compte parent (feed temps réel + navigateur)
CREATE TABLE notifications (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  parent_id     INT NOT NULL,
  etudiant_id   INT NULL,
  type          ENUM('absence','note','remarque','exercice','message','info') NOT NULL,
  titre         VARCHAR(200) NOT NULL,
  contenu       TEXT NOT NULL,
  lu            BOOLEAN DEFAULT FALSE,
  notifie       BOOLEAN DEFAULT FALSE,                       -- déjà affiché dans le navigateur ?
  date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id)   REFERENCES parents(id)   ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (etudiant_id) REFERENCES etudiants(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE paiements (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  etudiant_id     INT NOT NULL,
  mois            TINYINT NOT NULL,
  annee           SMALLINT NOT NULL,
  montant         DECIMAL(10,2) NOT NULL,
  date_paiement   DATETIME DEFAULT CURRENT_TIMESTAMP,
  recu_numero     VARCHAR(50) UNIQUE NOT NULL,
  UNIQUE KEY unique_paiement (etudiant_id, mois, annee),
  FOREIGN KEY (etudiant_id) REFERENCES etudiants(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE depenses (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  montant         DECIMAL(10,2) NOT NULL,
  description     TEXT NOT NULL,
  date_depense    DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
--  INDEX
-- =============================================================================
CREATE INDEX idx_etudiants_groupe      ON etudiants(groupe_id);
CREATE INDEX idx_etudiants_parent      ON etudiants(parent_id);
CREATE INDEX idx_notes_etudiant        ON notes(etudiant_id);
CREATE INDEX idx_notes_trimestre       ON notes(trimestre);
CREATE INDEX idx_notes_enseignement    ON notes(enseignement_id);
CREATE INDEX idx_utilisateurs_role     ON utilisateurs(role);
CREATE INDEX idx_utilisateurs_actif    ON utilisateurs(actif);
CREATE INDEX idx_journal_date          ON journal_securite(date);
CREATE INDEX idx_journal_ip_date       ON journal_securite(ip, date);
CREATE INDEX idx_enseignements_prof    ON enseignements(professeur_id);
CREATE INDEX idx_enseignements_groupe  ON enseignements(groupe_id);
CREATE INDEX idx_paiements_etudiant    ON paiements(etudiant_id);
CREATE INDEX idx_paiements_mois        ON paiements(mois, annee);
CREATE INDEX idx_depenses_date         ON depenses(date_depense);
CREATE INDEX idx_matieres_niveau       ON matieres(niveau_id);
CREATE INDEX idx_absences_etudiant     ON absences(etudiant_id);
CREATE INDEX idx_absences_date         ON absences(date_absence);
CREATE INDEX idx_remarques_etudiant    ON remarques(etudiant_id);
CREATE INDEX idx_notif_parent          ON notifications(parent_id, lu);
CREATE INDEX idx_notif_notifie         ON notifications(parent_id, notifie);
CREATE INDEX idx_messages_parent       ON messages(parent_id, lu);

-- =============================================================================
--  DONNÉES DE BASE (structure uniquement — aucune donnée de démonstration)
-- =============================================================================

INSERT INTO niveaux (nom, tarif_mensuel) VALUES
  ('6ème', 15000.00), ('5ème', 18000.00), ('4ème', 20000.00), ('3ème', 22000.00);

INSERT INTO matieres (nom, coefficient, niveau_id)
SELECT m.nom, m.coef, n.id
FROM (
  SELECT 'Mathématiques' AS nom, 4 AS coef UNION ALL
  SELECT 'Français', 4 UNION ALL
  SELECT 'Physique-Chimie', 3 UNION ALL
  SELECT 'Sciences de la Vie et de la Terre', 2 UNION ALL
  SELECT 'Histoire-Géographie', 2 UNION ALL
  SELECT 'Anglais', 3 UNION ALL
  SELECT 'Arabe', 3 UNION ALL
  SELECT 'Éducation Islamique', 2 UNION ALL
  SELECT 'Informatique', 1 UNION ALL
  SELECT 'Éducation Physique', 1
) m
CROSS JOIN niveaux n;

-- Compte super-admin par défaut (hash Argon2id RÉEL — connexion immédiate).
--   Identifiant : admin@supnum.mr
--   Mot de passe : Admin2026!
INSERT INTO utilisateurs (identifiant, mot_de_passe, role, nom, prenom) VALUES
  ('admin@supnum.mr', '$argon2id$v=19$m=65536,t=4,p=1$UVpML3JqNXBsTkxHL21mSw$cy3C6nHIEvQOzEkmPIxsNV4jDo0gXzpVqtWgoJlr6Do', 'super_admin', 'Administrateur', 'Super');
