<?php
/**
 * El OURWA — Bootstrap centralisé
 * Point d'entrée unique pour toutes les pages : charge la config, la DB, les headers
 * de sécurité, l'authentification, le CSRF et les fonctions de nettoyage.
 *
 * Usage en haut de toute page :
 *   require_once __DIR__ . '/../../includes/bootstrap.php';
 *   require_role('super_admin');
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/cache.php';
require_once __DIR__ . '/security_headers.php';
require_once __DIR__ . '/sanitize.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/csrf.php';
require_once __DIR__ . '/pagination.php';
require_once __DIR__ . '/paiements.php';
