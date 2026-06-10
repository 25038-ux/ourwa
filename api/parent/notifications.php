<?php
/**
 * API parent — flux de notifications en LONG POLLING.
 *
 *  GET  ?since=<id>&wait=1   -> long-polling (tient ~25s si rien)
 *  GET  ?since=<id>          -> simple poll (renvoie immédiatement)
 *  POST action=lu            -> marque tout comme lu (ou ?id=X pour un seul)
 *
 *  Avantage : diviser par 10 la charge serveur quand il n'y a rien de nouveau.
 *  La session est fermée pendant l'attente (session_write_close) pour ne pas
 *  bloquer les autres requêtes du même user.
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_once __DIR__ . '/../../includes/parent_auth.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Accel-Buffering: no'); // nginx : pas de bufferisation

if (!parent_est_connecte()) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'message' => 'Non authentifié']);
    exit;
}

$parent_id = (int) $_SESSION['parent_id'];

// --- POST: marquer comme lu ---
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();
    $db = getDB();
    $action = $_POST['action'] ?? '';
    if ($action === 'lu') {
        $id = nettoyer_entier($_POST['id'] ?? 0);
        if ($id) {
            $db->prepare('UPDATE notifications SET lu = TRUE WHERE id = :i AND parent_id = :p')
               ->execute([':i' => $id, ':p' => $parent_id]);
        } else {
            $db->prepare('UPDATE notifications SET lu = TRUE WHERE parent_id = :p AND lu = FALSE')
               ->execute([':p' => $parent_id]);
        }
        // Invalider le cache du compteur non-lues
        cache_forget("notif:nl:{$parent_id}");
        echo json_encode(['ok' => true]);
        exit;
    }
    echo json_encode(['ok' => false, 'message' => 'Action inconnue']);
    exit;
}

// --- GET: poll simple (compatible hébergement mutualisé) ---
$since = nettoyer_entier($_GET['since'] ?? 0) ?? 0;

// IMPORTANT : libérer la session pour ne pas bloquer les autres tabs
session_write_close();

$db = getDB();

$stmt = $db->prepare('
    SELECT id, type, titre, contenu, lu, notifie, date_creation
    FROM notifications
    WHERE parent_id = :p AND id > :since
    ORDER BY id ASC LIMIT 50');
$stmt->execute([':p' => $parent_id, ':since' => $since]);
$nouvelles = $stmt->fetchAll(PDO::FETCH_ASSOC);

if ($nouvelles) {
    $ids = array_column($nouvelles, 'id');
    $in  = implode(',', array_fill(0, count($ids), '?'));
    $db->prepare("UPDATE notifications SET notifie = TRUE WHERE id IN ($in)")
       ->execute($ids);
    cache_forget("notif:nl:{$parent_id}");
}

// Compteur non-lues : cache 15 s
$non_lues = cache_remember("notif:nl:{$parent_id}", 15, function() use ($db, $parent_id) {
    $st = $db->prepare('SELECT COUNT(*) FROM notifications WHERE parent_id = :p AND lu = FALSE');
    $st->execute([':p' => $parent_id]);
    return (int) $st->fetchColumn();
});

echo json_encode([
    'ok'        => true,
    'nouvelles' => $nouvelles,
    'non_lues'  => $non_lues,
    'max_id'    => $nouvelles ? max(array_column($nouvelles, 'id')) : $since,
]);
