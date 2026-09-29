<?php
/**
 * EL OURWA CALCULE SES PROPRES DETTES, ET LES ÉCRIT EN JSON.
 *
 * ⚠ On appelle SON code — `obtenir_dette_parent_detaillee()` de
 * `includes/paiements.php` — sur SA base, pour chacun des 1 372 correspondants.
 * C'est LE chiffre que l'école réclame à une famille : la dette n'est stockée
 * nulle part, elle se déduit de l'échéancier, des encaissements, des exemptions
 * et des remises. Transcrire cette règle dans le vérificateur reviendrait à
 * tester ma transcription ; ici c'est bien lui qui la produit.
 *
 * ⚠ ELLE DÉPEND DU JOUR. « Un mois à venir n'est pas dû » — les deux côtés
 * doivent donc être calculés le même jour, ce que `pnpm reconcile` fait en
 * lançant les deux extractions à la suite.
 *
 * Sortie : une ligne JSON par correspondant, clé par TÉLÉPHONE — `users` n'a
 * pas de `legacy_id`, et le téléphone est l'identité d'un parent des deux côtés.
 * Tout en CHAÎNES, jamais en flottants (règle 25).
 *
 * Lecture seule de bout en bout (règle 22).
 */

if (session_status() === PHP_SESSION_NONE) {
    @session_start();
}
$_SESSION['utilisateur_id'] = 1;
$_SESSION['role'] = 'super_admin';
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
$_SERVER['HTTP_USER_AGENT'] = 'reconcile-cli';
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['SCRIPT_NAME'] = '/cli';

// Il vit ici, pas dans `reference/` : El Ourwa est en lecture seule pour
// toujours, et y déposer un script entamerait la règle.
$racine = __DIR__ . '/../../reference/v16/src';
require_once $racine . '/includes/bootstrap.php';
require_once $racine . '/includes/finance.php';
require_once $racine . '/includes/paiements.php';
require_once $racine . '/includes/annee_scolaire.php';

$db = getDB();

/** `number_format($x, 2, '.', '')` : deux décimales, point, jamais un float dans le JSON. */
function sou(float $v): string
{
    return number_format($v, 2, '.', '');
}

$parents = $db->query('SELECT id, telephone FROM parents ORDER BY id')->fetchAll();

foreach ($parents as $p) {
    $d = obtenir_dette_parent_detaillee($db, (int) $p['id']);

    $scolarite = 0.0;
    foreach ($d['dettes_scolarite'] as $l) {
        $scolarite += (float) $l['montant'];
    }
    $diverses = 0.0;
    foreach ($d['dettes_diverses'] as $l) {
        $diverses += (float) $l['montant'];
    }

    echo json_encode([
        'telephone'    => (string) $p['telephone'],
        'total'        => sou((float) $d['total_dette']),
        'avant_remise' => sou((float) $d['dette_avant_remise']),
        'remise'       => sou((float) $d['remise']),
        'scolarite'    => sou($scolarite),
        'diverses'     => sou($diverses),
        'mois'         => count($d['dettes_scolarite']),
    ], JSON_UNESCAPED_UNICODE), "\n";
}
