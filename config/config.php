<?php
/**
 * Configuration générale de l'application El OURWA
 * Paramètres globaux et constantes
 */

// ============================================================================
//  MODE DEBUG (DOIT être FALSE en production)
// ============================================================================
define('APP_DEBUG', false);



// ============================================================================
//  IDENTITÉ DE L'APPLICATION
// ============================================================================
define('APP_NAME',     'El OURWA');
define('APP_SUBTITLE', 'Plateforme de gestion scolaire');
define('APP_URL',      'http://localhost/project');

// ============================================================================
//  SESSIONS & SÉCURITÉ
// ============================================================================
define('SESSION_TIMEOUT',      1800);   // 30 minutes d'inactivité
define('SESSION_REGEN_PERIOD',  600);   // Régénérer l'ID toutes les 10 min

// Anti brute-force (par compte)
define('MAX_LOGIN_ATTEMPTS', 5);
define('LOCKOUT_DURATION',  900);       // 15 minutes

// Anti brute-force (par IP) — protection complémentaire
define('IP_MAX_ATTEMPTS', 15);
define('IP_LOCKOUT',      900);

// Politique de mot de passe
define('PASSWORD_MIN_LENGTH', 8);

// ============================================================================
//  LOCALISATION
// ============================================================================
date_default_timezone_set('Africa/Nouakchott');
mb_internal_encoding('UTF-8');

// ============================================================================
//  GESTION DES ERREURS
// ============================================================================
if (APP_DEBUG) {
    error_reporting(E_ALL);
    ini_set('display_errors', '1');
} else {
    error_reporting(E_ALL & ~E_DEPRECATED & ~E_STRICT);
    ini_set('display_errors', '0');
    ini_set('log_errors', '1');

    $log_dir = __DIR__ . '/../logs';
    if (!is_dir($log_dir)) {
        @mkdir($log_dir, 0750, true);
    }
    ini_set('error_log', $log_dir . '/error.log');
}