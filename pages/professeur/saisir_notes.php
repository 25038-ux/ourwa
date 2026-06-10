<?php
/**
 * La saisie des notes a été déplacée vers l'espace administration.
 * Cette page n'est plus accessible aux professeurs.
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_role('professeur');
header('Location: ' . get_base_url() . '/pages/professeur/tableau_bord.php?info=notes_deplacees');
exit;
