<?php
/**
 * Redirect — Créer groupe is now inside Gérer Niveaux
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
header('Location: ' . get_base_url() . '/pages/super_admin/gerer_niveaux.php');
exit;
