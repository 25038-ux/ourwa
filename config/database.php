<?php
/**
 * Configuration de la base de données
 * Connexion PDO sécurisée avec charset utf8mb4
 */

define('DB_HOST', 'sql201.infinityfree.com');
define('DB_NAME', 'if0_41928500_my_db');
define('DB_USER', 'if0_41928500');
define('DB_PASS', 'sidibrahim5med');
define('DB_CHARSET', 'utf8mb4');

/**
 * Obtenir une connexion PDO sécurisée
 * @return PDO Instance de connexion
 */
function getDB(): PDO {
    static $pdo = null;
    
    if ($pdo === null) {
        $dsn = sprintf(
            'mysql:host=%s;dbname=%s;charset=%s',
            DB_HOST, DB_NAME, DB_CHARSET
        );
        
        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // EMULATE_PREPARES = true : permet la réutilisation d'un même placeholder
            // nommé dans une requête (ex: WHERE a LIKE :q OR b LIKE :q).
            // L'échappement reste fait par PDO, donc la sécurité est identique.
            PDO::ATTR_EMULATE_PREPARES   => true,
            PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci",
            PDO::ATTR_PERSISTENT         => false, // pas de pooling sur mutualisé
        ];
        
        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
        } catch (PDOException $e) {
            if (defined('APP_DEBUG') && APP_DEBUG) {
                die('Erreur de connexion à la base de données : ' . $e->getMessage());
            } else {
                die('Erreur de connexion à la base de données. Veuillez contacter l\'administrateur.');
            }
        }
    }
    
    return $pdo;
}