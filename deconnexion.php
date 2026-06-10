<?php
/**
 * Déconnexion sécurisée.
 */
require_once __DIR__ . '/includes/bootstrap.php';

deconnecter();

header('Location: ' . get_base_url() . '/index.php?deconnexion=1');
exit;
