<?php
require_once __DIR__ . '/includes/bootstrap.php';
require_once __DIR__ . '/includes/parent_auth.php';
parent_deconnecter();
header('Location: ' . get_base_url() . '/parent_connexion.php?deconnexion=1');
exit;
