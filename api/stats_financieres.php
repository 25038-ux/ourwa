<?php
/**
 * API — Statistiques financières (JSON pour Chart.js)
 * Admin salary excluded, depenses included
 */
require_once __DIR__ . '/../includes/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');

demarrer_session();

if (!est_connecte() || $_SESSION['role'] !== 'super_admin') {
    http_response_code(403);
    echo json_encode(['succes' => false, 'message' => 'Accès refusé.']);
    exit;
}

$db = getDB();

// Revenu par niveau
$revenus_niveaux = $db->query('
    SELECT n.nom AS label, COALESCE(SUM(e.frais_mensuel), 0) AS valeur
    FROM niveaux n
    LEFT JOIN groupes g ON g.niveau_id = n.id
    LEFT JOIN etudiants e ON e.groupe_id = g.id
    GROUP BY n.id, n.nom ORDER BY n.id
')->fetchAll();

// Revenu par groupe
$revenus_groupes = $db->query('
    SELECT CONCAT(IFNULL(n.nom, "Sans niveau"), " — ", g.nom) AS label, COALESCE(SUM(e.frais_mensuel), 0) AS valeur
    FROM groupes g LEFT JOIN niveaux n ON g.niveau_id = n.id LEFT JOIN etudiants e ON e.groupe_id = g.id
    GROUP BY g.id, g.nom, n.nom ORDER BY n.nom, g.nom
')->fetchAll();

// Totaux financiers — admin salary excluded
$revenu_brut = $db->query('SELECT COALESCE(SUM(frais_mensuel), 0) FROM etudiants')->fetchColumn();
$charges_profs = $db->query('SELECT COALESCE(SUM(salaire), 0) FROM professeurs')->fetchColumn();
$charges_staff = $db->query('SELECT COALESCE(SUM(salaire), 0) FROM staff WHERE actif = TRUE')->fetchColumn();
$depenses_sup = $db->query('SELECT COALESCE(SUM(montant), 0) FROM depenses')->fetchColumn();
$charges_totales = $charges_profs + $charges_staff + $depenses_sup;
$gain_net = $revenu_brut - $charges_totales;

echo json_encode([
    'succes' => true,
    'donnees' => [
        'revenus_niveaux' => $revenus_niveaux,
        'revenus_groupes' => $revenus_groupes,
        'financier' => [
            'revenu_brut'       => floatval($revenu_brut),
            'charges_profs'     => floatval($charges_profs),
            'charges_staff'     => floatval($charges_staff),
            'depenses_sup'      => floatval($depenses_sup),
            'charges_totales'   => floatval($charges_totales),
            'gain_net'          => floatval($gain_net),
        ],
        'kpi' => [
            'total_etudiants'   => intval($db->query('SELECT COUNT(*) FROM etudiants')->fetchColumn()),
            'total_professeurs' => intval($db->query('SELECT COUNT(*) FROM professeurs')->fetchColumn()),
            'total_groupes'     => intval($db->query('SELECT COUNT(*) FROM groupes')->fetchColumn()),
        ],
    ],
]);
