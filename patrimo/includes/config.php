<?php
/*
 * Paramètres de l'application.
 *
 * Pour InfinityFree : remplacer les 4 valeurs DB_* par celles affichées dans
 * le panneau de contrôle (rubrique "MySQL Databases").
 * En local on peut créer un fichier config.local.php qui définit ses propres
 * constantes : il est chargé en priorité et n'est pas envoyé sur le serveur.
 */

if (is_file(__DIR__ . '/config.local.php')) {
    require __DIR__ . '/config.local.php';
}

defined('DB_HOST') || define('DB_HOST', 'sql000.infinityfree.com');
defined('DB_NAME') || define('DB_NAME', 'if0_00000000_patrimo');
defined('DB_USER') || define('DB_USER', 'if0_00000000');
defined('DB_PASS') || define('DB_PASS', 'mot_de_passe_mysql');
defined('DB_PORT') || define('DB_PORT', 3306);

define('APP_NOM', 'Patrimo');
define('APP_ORGANISME', 'Ministère — Direction du Patrimoine');
define('PAR_PAGE', 15);

// Mettre à true pendant le développement pour voir les erreurs PHP
defined('MODE_DEBUG') || define('MODE_DEBUG', false);

date_default_timezone_set('Africa/Nouakchott');
mb_internal_encoding('UTF-8');

if (MODE_DEBUG) {
    error_reporting(E_ALL);
    ini_set('display_errors', '1');
} else {
    error_reporting(0);
    ini_set('display_errors', '0');
}
