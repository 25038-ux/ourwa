<?php
/**
 * API — Créer un groupe (AJAX)
 */
require_once __DIR__ . '/../includes/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');
demarrer_session();

if (!est_connecte() || $_SESSION['role'] !== 'super_admin') {
    http_response_code(403);
    echo json_encode(['succes' => false, 'message' => 'Accès refusé.']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['succes' => false, 'message' => 'Méthode non autorisée.']);
    exit;
}

exiger_csrf();

$db = getDB();
$nom = nettoyer($_POST['nom'] ?? '');
$niveau_id = nettoyer_entier($_POST['niveau_id'] ?? 0);
$capacite = nettoyer_entier($_POST['capacite'] ?? 0);

if (empty($nom) || !$niveau_id || !$capacite || $capacite < 1) {
    echo json_encode(['succes' => false, 'message' => 'Données invalides.']);
    exit;
}

try {
    $stmt = $db->prepare('INSERT INTO groupes (nom, niveau_id, capacite) VALUES (:nom, :nid, :cap)');
    $stmt->execute([':nom' => $nom, ':nid' => $niveau_id, ':cap' => $capacite]);
    $id = $db->lastInsertId();

    journaliser($_SESSION['utilisateur_id'], "API: Création groupe {$nom}");
    echo json_encode(['succes' => true, 'message' => 'Groupe créé.', 'id' => $id]);
} catch (Exception $ex) {
    echo json_encode(['succes' => false, 'message' => 'Erreur serveur.']);
}
