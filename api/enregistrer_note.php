<?php
/**
 * API — Enregistrer une note (AJAX)
 */
require_once __DIR__ . '/../includes/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');

demarrer_session();

if (!est_connecte() || $_SESSION['role'] !== 'professeur') {
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

$etudiant_id = nettoyer_entier($_POST['etudiant_id'] ?? 0);
$enseignement_id = nettoyer_entier($_POST['enseignement_id'] ?? 0);
$valeur = nettoyer_decimal($_POST['valeur'] ?? '');
$trimestre = nettoyer_entier($_POST['trimestre'] ?? 0);

if (!$etudiant_id || !$enseignement_id || $valeur === null || !$trimestre) {
    echo json_encode(['succes' => false, 'message' => 'Données manquantes.']);
    exit;
}

if ($valeur < 0 || $valeur > 20) {
    echo json_encode(['succes' => false, 'message' => 'La note doit être entre 0 et 20.']);
    exit;
}

if ($trimestre < 1 || $trimestre > 3) {
    echo json_encode(['succes' => false, 'message' => 'Trimestre invalide.']);
    exit;
}

// Vérification IDOR : le professeur possède-t-il cet enseignement ?
$stmt = $db->prepare('
    SELECT e.id FROM enseignements e
    JOIN professeurs p ON e.professeur_id = p.id
    WHERE e.id = :eid AND p.utilisateur_id = :uid
');
$stmt->execute([':eid' => $enseignement_id, ':uid' => $_SESSION['utilisateur_id']]);

if (!$stmt->fetch()) {
    http_response_code(403);
    echo json_encode(['succes' => false, 'message' => 'Vous n\'êtes pas autorisé.']);
    exit;
}

try {
    $stmt = $db->prepare('
        INSERT INTO notes (etudiant_id, enseignement_id, valeur, trimestre)
        VALUES (:eid, :ensid, :val, :tri)
        ON DUPLICATE KEY UPDATE valeur = :val2, date_saisie = NOW()
    ');
    $stmt->execute([
        ':eid' => $etudiant_id, ':ensid' => $enseignement_id,
        ':val' => $valeur, ':tri' => $trimestre, ':val2' => $valeur,
    ]);
    
    echo json_encode(['succes' => true, 'message' => 'Note enregistrée.']);
} catch (Exception $ex) {
    echo json_encode(['succes' => false, 'message' => 'Erreur : ' . $ex->getMessage()]);
}
