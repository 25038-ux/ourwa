-- ---------------------------------------------------------------
--  Patrimo — suivi du patrimoine matériel
--  Structure de la base (MySQL 5.7+ / MariaDB 10.3+)
--
--  Sur InfinityFree la base est créée depuis le panneau de contrôle :
--  on ne fait donc PAS de CREATE DATABASE ici. Sélectionner la base
--  dans phpMyAdmin puis importer ce fichier (ou patrimo.sql qui
--  contient aussi les données de démonstration).
-- ---------------------------------------------------------------

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS transferts;
DROP TABLE IF EXISTS mouvements;
DROP TABLE IF EXISTS materiels;
DROP TABLE IF EXISTS utilisateurs;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS directions;

SET FOREIGN_KEY_CHECKS = 1;

-- Les directions / services de l'administration
CREATE TABLE directions (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code         VARCHAR(12)  NOT NULL,
  nom          VARCHAR(120) NOT NULL,
  localisation VARCHAR(120) DEFAULT NULL,  -- bâtiment, étage...
  telephone    VARCHAR(30)  DEFAULT NULL,
  cree_le      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_direction_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Catégories de matériel. Le préfixe sert à construire le n° d'inventaire (INF-2024-0007)
CREATE TABLE categories (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nom         VARCHAR(80)  NOT NULL,
  prefixe     VARCHAR(5)   NOT NULL,
  description VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_categorie_nom (nom),
  UNIQUE KEY uk_categorie_prefixe (prefixe)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- admin = responsable du patrimoine (voit tout)
-- responsable = responsable d'inventaire d'UNE direction
CREATE TABLE utilisateurs (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nom_complet     VARCHAR(100) NOT NULL,
  identifiant     VARCHAR(50)  NOT NULL,
  mot_de_passe    VARCHAR(255) NOT NULL,
  role            ENUM('admin','responsable') NOT NULL DEFAULT 'responsable',
  direction_id    INT UNSIGNED DEFAULT NULL,
  actif           TINYINT(1)   NOT NULL DEFAULT 1,
  derniere_cnx    DATETIME     DEFAULT NULL,
  cree_le         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_identifiant (identifiant),
  KEY idx_user_direction (direction_id),
  CONSTRAINT fk_user_direction FOREIGN KEY (direction_id)
    REFERENCES directions (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE materiels (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  numero_inventaire VARCHAR(30)  NOT NULL,
  designation       VARCHAR(150) NOT NULL,
  categorie_id      INT UNSIGNED NOT NULL,
  marque            VARCHAR(60)  DEFAULT NULL,
  modele            VARCHAR(80)  DEFAULT NULL,
  numero_serie      VARCHAR(80)  DEFAULT NULL,
  date_acquisition  DATE         DEFAULT NULL,
  etat              ENUM('en_service','en_panne','en_reparation','reforme') NOT NULL DEFAULT 'en_service',
  direction_id      INT UNSIGNED DEFAULT NULL,  -- NULL = en magasin, pas encore affecté
  observation       TEXT         DEFAULT NULL,
  cree_le           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modifie_le        DATETIME     DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_numero_inventaire (numero_inventaire),
  KEY idx_mat_categorie (categorie_id),
  KEY idx_mat_direction (direction_id),
  KEY idx_mat_etat (etat),
  CONSTRAINT fk_mat_categorie FOREIGN KEY (categorie_id)
    REFERENCES categories (id) ON DELETE RESTRICT,
  CONSTRAINT fk_mat_direction FOREIGN KEY (direction_id)
    REFERENCES directions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Journal : une ligne par événement dans la vie d'un matériel.
-- type = entree (enregistrement), affectation, transfert, etat (changement d'état)
CREATE TABLE mouvements (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  materiel_id          INT UNSIGNED NOT NULL,
  type                 ENUM('entree','affectation','transfert','etat') NOT NULL,
  direction_depart_id  INT UNSIGNED DEFAULT NULL,
  direction_arrivee_id INT UNSIGNED DEFAULT NULL,
  etat_avant           VARCHAR(20)  DEFAULT NULL,
  etat_apres           VARCHAR(20)  DEFAULT NULL,
  observation          VARCHAR(255) DEFAULT NULL,
  utilisateur_id       INT UNSIGNED DEFAULT NULL,
  date_mouvement       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mvt_materiel (materiel_id, date_mouvement),
  KEY idx_mvt_date (date_mouvement),
  CONSTRAINT fk_mvt_materiel FOREIGN KEY (materiel_id)
    REFERENCES materiels (id) ON DELETE CASCADE,
  CONSTRAINT fk_mvt_depart FOREIGN KEY (direction_depart_id)
    REFERENCES directions (id) ON DELETE SET NULL,
  CONSTRAINT fk_mvt_arrivee FOREIGN KEY (direction_arrivee_id)
    REFERENCES directions (id) ON DELETE SET NULL,
  CONSTRAINT fk_mvt_user FOREIGN KEY (utilisateur_id)
    REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Demandes de transfert : le matériel ne change de direction qu'une fois
-- validé par le responsable de la direction de départ ET celui d'arrivée.
CREATE TABLE transferts (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  materiel_id          INT UNSIGNED NOT NULL,
  direction_depart_id  INT UNSIGNED NOT NULL,
  direction_arrivee_id INT UNSIGNED NOT NULL,
  motif                VARCHAR(255) DEFAULT NULL,
  statut               ENUM('en_attente','valide','refuse','annule') NOT NULL DEFAULT 'en_attente',
  demande_par          INT UNSIGNED DEFAULT NULL,
  demande_le           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valide_depart_par    INT UNSIGNED DEFAULT NULL,
  valide_depart_le     DATETIME     DEFAULT NULL,
  valide_arrivee_par   INT UNSIGNED DEFAULT NULL,
  valide_arrivee_le    DATETIME     DEFAULT NULL,
  refuse_par           INT UNSIGNED DEFAULT NULL,
  motif_refus          VARCHAR(255) DEFAULT NULL,
  cloture_le           DATETIME     DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_tr_statut (statut),
  KEY idx_tr_materiel (materiel_id),
  CONSTRAINT fk_tr_materiel FOREIGN KEY (materiel_id)
    REFERENCES materiels (id) ON DELETE CASCADE,
  CONSTRAINT fk_tr_depart FOREIGN KEY (direction_depart_id)
    REFERENCES directions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tr_arrivee FOREIGN KEY (direction_arrivee_id)
    REFERENCES directions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tr_demandeur FOREIGN KEY (demande_par)
    REFERENCES utilisateurs (id) ON DELETE SET NULL,
  CONSTRAINT fk_tr_val_dep FOREIGN KEY (valide_depart_par)
    REFERENCES utilisateurs (id) ON DELETE SET NULL,
  CONSTRAINT fk_tr_val_arr FOREIGN KEY (valide_arrivee_par)
    REFERENCES utilisateurs (id) ON DELETE SET NULL,
  CONSTRAINT fk_tr_refus FOREIGN KEY (refuse_par)
    REFERENCES utilisateurs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
