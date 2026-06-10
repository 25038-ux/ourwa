<?php
/**
 * API — Ajouter un étudiant (AJAX)
 * Display ID (identifiant) can repeat across groups — internal DB PK is unique
 */
require_once __DIR__ . '/../includes/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');
demarrer_session();

if (!est_connecte() || !in_array($_SESSION['role'], ['super_admin', 'admin'])) {
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
$nom = nettoyer($_POST['nom'] ?? '');
$prenom = nettoyer($_POST['prenom'] ?? '');
$parent = nettoyer($_POST['nom_parent'] ?? '');
$tel = nettoyer_telephone($_POST['telephone_parent'] ?? '');
$groupe_id = nettoyer_entier($_POST['groupe_id'] ?? 0);

if (empty($nom) || empty($prenom) || empty($parent) || !$groupe_id) {
    echo json_encode(['succes' => false, 'message' => 'Champs obligatoires manquants.']);
    exit;
}

// Auto-generate unique identifiant if empty
if (empty($identifiant)) {
    $identifiant = 'ETU-' . $groupe_id . '-' . time() . '-' . rand(100,999);
}

// Get tarif from niveau
$stmt = $db->prepare('SELECT n.tarif_mensuel FROM groupes g JOIN niveaux n ON g.niveau_id = n.id WHERE g.id = :gid');
$stmt->execute([':gid' => $groupe_id]);
$tarif = $stmt->fetchColumn() ?: 0;

$frais = nettoyer_decimal($_POST['frais_mensuel'] ?? 0);
if ($frais === null || $frais == 0) $frais = $tarif;

try {
    $stmt = $db->prepare('INSERT INTO etudiants (identifiant, nom, prenom, nom_parent, telephone_parent, frais_mensuel, groupe_id) VALUES (:id, :nom, :pre, :par, :tel, :frais, :gid)');
    $stmt->execute([':id' => $identifiant, ':nom' => $nom, ':pre' => $prenom, ':par' => $parent, ':tel' => $tel, ':frais' => $frais, ':gid' => $groupe_id]);

    journaliser($_SESSION['utilisateur_id'], "API: Ajout étudiant {$identifiant}");
    echo json_encode(['succes' => true, 'message' => 'Étudiant ajouté.', 'id' => $db->lastInsertId()]);
} catch (PDOException $ex) {
    $msg = 'Erreur serveur : ' . $ex->getMessage();
    echo json_encode(['succes' => false, 'message' => $msg]);
}
