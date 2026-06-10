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
