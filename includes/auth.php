<?php
/**
 * Authentification & sessions sécurisées.
 *
 * Comprend :
 *  - Démarrage de session durci (HttpOnly, SameSite, Secure auto-HTTPS)
 *  - Empreinte de session (IP + User-Agent) — protection contre le vol de cookie
 *  - Régénération périodique de l'ID de session
 *  - Anti brute-force par compte ET par IP
 *  - Protection contre la fuite : déconnexion silencieuse sur empreinte invalide
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/security_headers.php';

// ============================================================================
//  SESSION
// ============================================================================

function demarrer_session(): void {
    if (session_status() !== PHP_SESSION_NONE) return;

    ini_set('session.cookie_httponly', '1');
    ini_set('session.cookie_samesite', 'Strict');
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime', (string) SESSION_TIMEOUT);

    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
        ini_set('session.cookie_secure', '1');
    }

    $session_dir = __DIR__ . '/../sessions';
    if (!is_dir($session_dir)) {
        @mkdir($session_dir, 0770, true);
    }
    if (is_writable($session_dir)) {
        session_save_path($session_dir);
    }

    session_name('EDUPLATFORME_SID');
    session_start();
}

/**
 * Calcule une empreinte stable de la session (User-Agent + 3 premiers octets IP).
 * On tronque l'IP pour ne pas casser la session lors d'un changement mineur
 * (proxy, NAT) tout en bloquant un vol de cookie depuis un autre réseau.
 */
function empreinte_session(): string {
    $ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $ip_parts = explode('.', $ip);
    $ip_prefix = count($ip_parts) === 4
        ? "{$ip_parts[0]}.{$ip_parts[1]}.{$ip_parts[2]}"
        : substr($ip, 0, 8);
    return hash('sha256', $ua . '|' . $ip_prefix);
}

/**
 * L'utilisateur est-il connecté ? Vérifie aussi l'empreinte et le timeout.
 */
function est_connecte(): bool {
    demarrer_session();

    if (!isset($_SESSION['utilisateur_id'])) {
        return false;
    }

    // Empreinte de session
    if (!isset($_SESSION['empreinte']) || !hash_equals($_SESSION['empreinte'], empreinte_session())) {
        journaliser($_SESSION['utilisateur_id'] ?? null, 'Empreinte de session invalide (vol potentiel)');
        deconnecter();
        return false;
    }

    // Timeout
    if (isset($_SESSION['derniere_activite']) && (time() - $_SESSION['derniere_activite']) > SESSION_TIMEOUT) {
        deconnecter();
        return false;
    }

    // Régénération périodique de l'ID
    if (!isset($_SESSION['regen_at']) || (time() - $_SESSION['regen_at']) > SESSION_REGEN_PERIOD) {
        session_regenerate_id(true);
        $_SESSION['regen_at'] = time();
    }

    $_SESSION['derniere_activite'] = time();
    return true;
}

/**
 * Exige un rôle (ou une liste de rôles). Redirige vers la connexion sinon.
 */
function require_role($roles): void {
    if (!est_connecte()) {
        header('Location: ' . get_base_url() . '/index.php?erreur=session_expiree');
        exit;
    }

    $roles = is_string($roles) ? [$roles] : $roles;

    if (!in_array($_SESSION['role'], $roles, true)) {
        http_response_code(403);
        $back = e(get_base_url() . '/index.php');
        echo <<<HTML
<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Accès refusé</title>
<style>body{display:flex;justify-content:center;align-items:center;height:100vh;font-family:Inter,sans-serif;background:#FAF8F5;margin:0}
.box{text-align:center}h1{color:#EF4444;font-size:4rem;margin:0}a{color:#6366F1;text-decoration:none}</style></head>
<body><div class="box"><h1>403</h1><p>Accès refusé. Vous n'avez pas les permissions nécessaires.</p>
<a href="{$back}">← Retour à la connexion</a></div></body></html>
HTML;
        exit;
    }
}

/**
 * Exiger un rôle d'administration (super_admin OU admin).
 * Les deux partagent les mêmes pages ; le filtrage fin de la finance
 * se fait via require_finance() sur les pages concernées.
 */
function require_staff_admin(): void {
    require_role(['super_admin', 'admin']);
}

/**
 * Pour les pages accessibles aux 'collecteur_absence' (= gerer_absence)
 * en plus des admins/super_admins.
 */
function require_admin_ou_collecteur(): void {
    require_role(['super_admin', 'admin', 'collecteur_absence']);
}

// ============================================================================
//  ANTI BRUTE-FORCE PAR IP
// ============================================================================

function ip_est_bloquee(string $ip): bool {
    try {
        $db = getDB();
        $stmt = $db->prepare(
            'SELECT COUNT(*) FROM journal_securite
             WHERE ip = :ip AND action LIKE "Tentative de connexion%"
             AND date > DATE_SUB(NOW(), INTERVAL :sec SECOND)'
        );
        $stmt->execute([':ip' => $ip, ':sec' => IP_LOCKOUT]);
        return ((int) $stmt->fetchColumn()) >= IP_MAX_ATTEMPTS;
    } catch (Throwable $e) {
        return false;
    }
}

// ============================================================================
//  CONNEXION
// ============================================================================

function tenter_connexion(string $identifiant, string $mot_de_passe): array {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';

    if (ip_est_bloquee($ip)) {
        journaliser(null, 'Tentative de connexion refusée — IP bloquée', $ip);
        return ['succes' => false, 'message' => 'Trop de tentatives depuis votre réseau. Réessayez plus tard.', 'role' => null];
    }

    $db = getDB();
    $stmt = $db->prepare('SELECT * FROM utilisateurs WHERE identifiant = :id AND actif = TRUE');
    $stmt->execute([':id' => $identifiant]);
    $u = $stmt->fetch();

    // Message générique pour ne pas révéler l'existence du compte (mais on simule
    // une vérification de hash pour empêcher l'énumération par timing).
    if (!$u) {
        password_verify($mot_de_passe, '$argon2id$v=19$m=65536,t=4,p=1$YWFhYWFhYWFhYWFhYWFhYQ$0000000000000000000000000000000000000000000');
        journaliser(null, 'Tentative de connexion échouée (compte inconnu)', $identifiant);
        return ['succes' => false, 'message' => 'Identifiant ou mot de passe incorrect.', 'role' => null];
    }

    // Blocage anti brute-force (par compte)
    if ($u['bloque_jusqua'] !== null && strtotime($u['bloque_jusqua']) > time()) {
        $minutes = max(1, (int) ceil((strtotime($u['bloque_jusqua']) - time()) / 60));
        journaliser($u['id'], 'Tentative de connexion bloquée (compte verrouillé)');
        return ['succes' => false, 'message' => "Compte verrouillé. Réessayez dans {$minutes} minute(s).", 'role' => null];
    }

    if (!password_verify($mot_de_passe, $u['mot_de_passe'])) {
        $tentatives = (int) $u['tentatives_echec'] + 1;
        $bloque_jusqua = null;
        if ($tentatives >= MAX_LOGIN_ATTEMPTS) {
            $bloque_jusqua = date('Y-m-d H:i:s', time() + LOCKOUT_DURATION);
            $tentatives = 0;
        }
        $db->prepare('UPDATE utilisateurs SET tentatives_echec = :t, bloque_jusqua = :b WHERE id = :id')
           ->execute([':t' => $tentatives, ':b' => $bloque_jusqua, ':id' => $u['id']]);

        journaliser($u['id'], 'Tentative de connexion échouée (mot de passe)');

        if ($bloque_jusqua) {
            return ['succes' => false, 'message' => 'Trop de tentatives échouées. Compte verrouillé pendant 15 minutes.', 'role' => null];
        }
        return ['succes' => false, 'message' => 'Identifiant ou mot de passe incorrect.', 'role' => null];
    }

    // Si le hash doit être recalculé (algorithme amélioré), on le met à jour.
    if (password_needs_rehash($u['mot_de_passe'], PASSWORD_ARGON2ID)) {
        $nouveau_hash = password_hash($mot_de_passe, PASSWORD_ARGON2ID);
        $db->prepare('UPDATE utilisateurs SET mot_de_passe = :h WHERE id = :id')
           ->execute([':h' => $nouveau_hash, ':id' => $u['id']]);
    }

    // Succès
    $db->prepare('UPDATE utilisateurs SET tentatives_echec = 0, bloque_jusqua = NULL, derniere_connexion = NOW() WHERE id = :id')
       ->execute([':id' => $u['id']]);

    demarrer_session();
    session_regenerate_id(true);

    $_SESSION['utilisateur_id']    = (int) $u['id'];
    $_SESSION['identifiant']       = $u['identifiant'];
    $_SESSION['role']              = $u['role'];
    $_SESSION['empreinte']         = empreinte_session();
    $_SESSION['derniere_activite'] = time();
    $_SESSION['regen_at']          = time();
    $_SESSION['nom_complet']       = charger_nom_complet((int) $u['id'], $u['role']);

    // Déterminer le palier d'administrateur (accès finance ou non).
    $_SESSION['admin_tier'] = 'restreint';
    if ($u['role'] === 'super_admin') {
        $_SESSION['admin_tier'] = 'complet';
    } elseif ($u['role'] === 'admin') {
        $stmt = $db->prepare('SELECT fonction FROM personnel_admin WHERE utilisateur_id = :u');
        $stmt->execute([':u' => (int) $u['id']]);
        $fonction = (string) $stmt->fetchColumn();
        if (mb_strtolower(trim($fonction)) === 'super administrateur') {
            $_SESSION['admin_tier'] = 'complet';
        }
    }

    journaliser((int) $u['id'], 'Connexion réussie');

    return ['succes' => true, 'message' => 'Connexion réussie.', 'role' => $u['role']];
}

function charger_nom_complet(int $userId, string $role): string {
    $db = getDB();

    if ($role === 'professeur') {
        $stmt = $db->prepare('SELECT CONCAT(prenom, " ", nom) AS n FROM professeurs WHERE utilisateur_id = :u');
        $stmt->execute([':u' => $userId]);
        return $stmt->fetchColumn() ?: 'Professeur';
    }
    if ($role === 'admin' || $role === 'collecteur_absence' || $role === 'secretaire' || $role === 'comptable') {
        $stmt = $db->prepare('SELECT CONCAT(prenom, " ", nom) AS n FROM personnel_admin WHERE utilisateur_id = :u');
        $stmt->execute([':u' => $userId]);
        $defauts = [
            'collecteur_absence' => 'Collecteur d\'absence',
            'secretaire'         => 'Secrétaire',
            'comptable'          => 'Comptable',
            'admin'              => 'Administrateur',
        ];
        $defaut = $defauts[$role] ?? 'Administrateur';
        return $stmt->fetchColumn() ?: $defaut;
    }
    if ($role === 'super_admin') {
        $stmt = $db->prepare('SELECT nom, prenom FROM utilisateurs WHERE id = :u');
        $stmt->execute([':u' => $userId]);
        $r = $stmt->fetch();
        if ($r && !empty($r['prenom']) && !empty($r['nom'])) {
            return $r['prenom'] . ' ' . $r['nom'];
        }
    }
    return 'Super Administrateur';
}

function date_fr(): string {
    $jours = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
    $mois  = ['','Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    return $jours[(int) date('w')] . ' ' . date('d') . ' ' . $mois[(int) date('n')] . ' ' . date('Y');
}

function deconnecter(): void {
    demarrer_session();

    if (isset($_SESSION['utilisateur_id'])) {
        journaliser($_SESSION['utilisateur_id'], 'Déconnexion');
    }

    $_SESSION = [];

    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $params['path'], $params['domain'],
            $params['secure'], $params['httponly']);
    }

    session_destroy();
}

function url_tableau_bord(string $role): string {
    $base = get_base_url();
    return match ($role) {
        'super_admin', 'admin' => $base . '/pages/super_admin/tableau_bord.php',
        'professeur'           => $base . '/pages/professeur/tableau_bord.php',
        'collecteur_absence'   => $base . '/pages/super_admin/gerer_absence.php',
        'secretaire'           => $base . '/pages/super_admin/saisir_notes.php',
        'comptable'            => $base . '/pages/super_admin/finance.php',
        default                => $base . '/index.php',
    };
}

/**
 * Détermine si l'utilisateur courant a les droits COMPLETS (finance incluse).
 *
 * Règle métier (validée avec le client) :
 *   - role = 'super_admin'                          → accès TOTAL
 *   - role = 'admin' + fonction 'Super Administrateur' → accès TOTAL
 *   - role = 'admin' (autre fonction)               → tout SAUF la finance
 *
 * « Finance » = Gestion de Caisse, Dépenses, statistiques financières.
 */
function est_admin_complet(): bool {
    if (($_SESSION['role'] ?? '') === 'super_admin') {
        return true;
    }
    if (($_SESSION['role'] ?? '') === 'comptable') {
        return true;
    }
    if (($_SESSION['role'] ?? '') === 'admin') {
        return (($_SESSION['admin_tier'] ?? '') === 'complet');
    }
    return false;
}

/**
 * Garde des PAGES financières : autorise super_admin, admin (palier complet)
 * ET le rôle 'comptable'. Refuse tout le reste, puis applique require_finance().
 */
function require_finance_page(): void {
    require_role(['super_admin', 'admin', 'comptable']);
    require_finance();
}

/**
 * Exiger l'accès finance — à appeler en tête des pages financières.
 * Un 'administrateur' simple est refusé proprement.
 */
function require_finance(): void {
    if (!est_admin_complet()) {
        http_response_code(403);
        $back = e(url_tableau_bord($_SESSION['role'] ?? ''));
        echo <<<HTML
<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Accès refusé</title>
<style>body{display:flex;justify-content:center;align-items:center;height:100vh;font-family:Inter,sans-serif;background:#FAF8F5;margin:0}
.box{text-align:center}h1{color:#EF4444;font-size:4rem;margin:0}a{color:#6366F1;text-decoration:none}</style></head>
<body><div class="box"><h1>403</h1><p>Accès refusé. La gestion financière est réservée au Super Administrateur.</p>
<a href="{$back}">← Retour au tableau de bord</a></div></body></html>
HTML;
        exit;
    }
}

function journaliser(?int $utilisateur_id, string $action, string $extra = ''): void {
    try {
        $db = getDB();
        $ip = $_SERVER['REMOTE_ADDR'] ?? 'inconnu';
        $ua = substr($_SERVER['HTTP_USER_AGENT'] ?? 'inconnu', 0, 500);

        if ($extra !== '') {
            $action .= ' [' . substr($extra, 0, 80) . ']';
        }

        $db->prepare('INSERT INTO journal_securite (utilisateur_id, action, ip, user_agent) VALUES (:u, :a, :i, :ua)')
           ->execute([':u' => $utilisateur_id, ':a' => substr($action, 0, 200), ':i' => $ip, ':ua' => $ua]);
    } catch (Throwable $e) {
        error_log('journal_securite: ' . $e->getMessage());
    }
}

/**
 * URL de base de l'application — fonctionne quel que soit le nom du dossier.
 * Détecte automatiquement la racine de l'app : on remonte tant qu'on voit un
 * fichier `index.php` à la racine voisine d'un dossier `includes/`.
 */
function get_base_url(): string {
    static $cache = null;
    if ($cache !== null) return $cache;

    $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';

    // On compare le DOCUMENT_ROOT avec le répertoire racine de l'app (= dossier
    // parent de /includes/). La différence donne le sous-chemin web.
    $app_root = realpath(__DIR__ . '/..');
    $doc_root = realpath($_SERVER['DOCUMENT_ROOT'] ?? '');

    $sub_path = '';
    if ($app_root && $doc_root && str_starts_with($app_root, $doc_root)) {
        $sub_path = str_replace('\\', '/', substr($app_root, strlen($doc_root)));
        $sub_path = '/' . trim($sub_path, '/');
        if ($sub_path === '/') $sub_path = '';
    } else {
        // Fallback : déduire depuis SCRIPT_NAME
        $script = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? ''));
        // Si on est dans /pages/<role>/ ou /api/, on remonte
        $script = preg_replace('#/(pages/[^/]+|api)$#', '', $script);
        $sub_path = rtrim($script, '/');
    }

    return $cache = $protocol . '://' . $host . $sub_path;
}
