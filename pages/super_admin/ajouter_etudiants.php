<?php
/**
 * Cette page est désormais désactivée.
 * L'ajout d'étudiants doit passer par "Inscrire" (nouvel élève) ou
 * "Réinscrire" (étudiant existant), uniquement.
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_staff_admin();
// Redirection vers la page Inscrire
header('Location: inscrire_etudiant.php');
exit;
