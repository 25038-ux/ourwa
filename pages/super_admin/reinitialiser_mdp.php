<?php
/**
 * Page redirigée — la réinitialisation de mot de passe est désormais intégrée
 * à la page « Mon profil ». Conservée pour rétro-compatibilité des liens.
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_staff_admin();

header('Location: modifier_profil.php');
exit;
