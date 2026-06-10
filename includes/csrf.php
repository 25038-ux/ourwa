<?php
/**
 * Tokens CSRF — protection contre les Cross-Site Request Forgery.
 */

function generer_csrf(): string {
    demarrer_session();
    if (!isset($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function champ_csrf(): string {
    $t = generer_csrf();
    return '<input type="hidden" name="csrf_token" value="' . htmlspecialchars($t, ENT_QUOTES | ENT_HTML5, 'UTF-8') . '">';
}

function verifier_csrf(?string $token = null): bool {
    demarrer_session();
    if ($token === null) {
        $token = $_POST['csrf_token'] ?? $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    }
    if (empty($token) || !isset($_SESSION['csrf_token'])) {
        return false;
    }
    return hash_equals($_SESSION['csrf_token'], $token);
}

function exiger_csrf(): void {
    if (!verifier_csrf()) {
        http_response_code(403);
        $ajax = ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') === 'XMLHttpRequest';
        if ($ajax) {
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['succes' => false, 'message' => 'Token de sécurité invalide. Veuillez rafraîchir la page.']);
        } else {
            echo 'Token de sécurité invalide. Veuillez rafraîchir la page et réessayer.';
        }
        exit;
    }
}

function regenerer_csrf(): string {
    demarrer_session();
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    return $_SESSION['csrf_token'];
}

/**
 * Alias de champ_csrf() — compatibilité avec les pages v4.
 */
if (!function_exists('csrf_field')) {
    function csrf_field(): string {
        return champ_csrf();
    }
}
