<?php
require_once __DIR__ . '/db.php';

if (session_status() === PHP_SESSION_NONE) {
    session_name('patrimo');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure'   => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    ]);
    session_start();
}

// Déconnexion automatique après 45 min sans activité
const DUREE_INACTIVITE = 2700;

function utilisateur(): ?array
{
    return $_SESSION['utilisateur'] ?? null;
}

function est_admin(): bool
{
    return (utilisateur()['role'] ?? '') === 'admin';
}

/** Direction dont l'utilisateur connecté est responsable (null pour l'admin). */
function ma_direction(): ?int
{
    $d = utilisateur()['direction_id'] ?? null;
    return $d ? (int) $d : null;
}

function connecter(string $identifiant, string $mdp): bool
{
    $u = ligne(
        'SELECT u.*, d.code AS direction_code, d.nom AS direction_nom
           FROM utilisateurs u
           LEFT JOIN directions d ON d.id = u.direction_id
          WHERE u.identifiant = ? AND u.actif = 1',
        [$identifiant]
    );

    if (!$u || !password_verify($mdp, $u['mot_de_passe'])) {
        return false;
    }

    session_regenerate_id(true);
    unset($u['mot_de_passe']);
    $_SESSION['utilisateur'] = $u;
    $_SESSION['vu_le'] = time();

    requete('UPDATE utilisateurs SET derniere_cnx = NOW() WHERE id = ?', [$u['id']]);
    return true;
}

function deconnecter(): void
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 3600, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
}

/** À appeler en haut de chaque page protégée. */
function exiger_connexion(): void
{
    if (!utilisateur()) {
        header('Location: connexion.php');
        exit;
    }
    if (time() - ($_SESSION['vu_le'] ?? 0) > DUREE_INACTIVITE) {
        deconnecter();
        header('Location: connexion.php?expire=1');
        exit;
    }
    $_SESSION['vu_le'] = time();
}

function exiger_admin(): void
{
    exiger_connexion();
    if (!est_admin()) {
        flash('Cette partie est réservée au responsable du patrimoine.', 'erreur');
        header('Location: index.php');
        exit;
    }
}
