<?php
/**
 * API — Connexion (endpoint AJAX)
 */
require_once __DIR__ . '/../includes/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['succes' => false, 'message' => 'Méthode non autorisée.']);
    exit;
}

exiger_csrf();

$identifiant = nettoyer($_POST['identifiant'] ?? '');
$mot_de_passe = $_POST['mot_de_passe'] ?? '';

if (empty($identifiant) || empty($mot_de_passe)) {
    echo json_encode(['succes' => false, 'message' => 'Veuillez remplir tous les champs.']);
    exit;
}

$resultat = tenter_connexion($identifiant, $mot_de_passe);

if ($resultat['succes']) {
    echo json_encode([
        'succes'   => true,
        'message'  => 'Connexion réussie.',
        'redirect' => url_tableau_bord($resultat['role']),
    ]);
} else {
    echo json_encode([
        'succes'  => false,
        'message' => $resultat['message'],
    ]);
}
