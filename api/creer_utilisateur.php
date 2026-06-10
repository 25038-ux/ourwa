<?php
/**
 * API — Créer un utilisateur (AJAX)
 * Rôles : professeur, admin (sans salaire).
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
$identifiant = nettoyer($_POST['identifiant'] ?? '');
$mot_de_passe = $_POST['mot_de_passe'] ?? '';
$role = $_POST['role'] ?? '';
$nom = nettoyer($_POST['nom'] ?? '');
$prenom = nettoyer($_POST['prenom'] ?? '');

if (!valider_identifiant($identifiant) || strlen($mot_de_passe) < 6 || !in_array($role, ['admin','professeur'], true) || empty($nom) || empty($prenom)) {
    echo json_encode(['succes' => false, 'message' => 'Données invalides.']);
    exit;
}

try {
    $hash = password_hash($mot_de_passe, PASSWORD_ARGON2ID);
    $stmt = $db->prepare('INSERT INTO utilisateurs (identifiant, mot_de_passe, role) VALUES (:id, :mdp, :role)');
    $stmt->execute([':id' => $identifiant, ':mdp' => $hash, ':role' => $role]);
    $user_id = $db->lastInsertId();

    if ($role === 'professeur') {
        $db->prepare('INSERT INTO professeurs (utilisateur_id, nom, prenom, telephone, salaire) VALUES (?, ?, ?, ?, 0)')
           ->execute([$user_id, $nom, $prenom, nettoyer_telephone($_POST['telephone'] ?? '')]);
    } else {
        $fonction = nettoyer($_POST['fonction'] ?? 'Administrateur');
        $db->prepare('INSERT INTO personnel_admin (utilisateur_id, nom, prenom, telephone, fonction, salaire) VALUES (?, ?, ?, ?, ?, 0)')
           ->execute([$user_id, $nom, $prenom, nettoyer_telephone($_POST['telephone'] ?? ''), $fonction]);
    }

    journaliser($_SESSION['utilisateur_id'], "API: Création utilisateur {$identifiant}");
    echo json_encode(['succes' => true, 'message' => 'Utilisateur créé.', 'id' => $user_id]);
} catch (PDOException $ex) {
    $msg = $ex->getCode() == 23000 ? 'Cet identifiant existe déjà.' : 'Erreur serveur.';
    echo json_encode(['succes' => false, 'message' => $msg]);
}
