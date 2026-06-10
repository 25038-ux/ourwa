<?php
/**
 * Authentification des comptes PARENTS.
 *
 * Connexion par numéro de téléphone + mot de passe (défini par l'admin).
 * Réutilise exactement les mêmes garanties de sécurité que auth.php :
 *  - Argon2id
 *  - Anti brute-force par compte ET par IP
 *  - Empreinte de session (UA + préfixe IP)
 *  - Régénération périodique de l'ID de session
 *  - Journalisation des évènements sensibles
 *
 * Les sessions parent sont CLOISONNÉES des sessions staff :
 * la clé de session est $_SESSION['parent_id'] (jamais 'utilisateur_id'),
 * ce qui empêche tout croisement de privilèges.
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/security_headers.php';
require_once __DIR__ . '/sanitize.php';     // pour valider_mot_de_passe() & nettoyer()
require_once __DIR__ . '/auth.php';   // pour demarrer_session(), empreinte_session(), journaliser(), get_base_url()

/**
 * Normaliser un numéro de téléphone pour servir d'identifiant stable :
 * on ne garde que les chiffres (et un éventuel +). Cela permet à un parent
 * de taper "+222 12 34 56 78" ou "12345678" indifféremment.
 */
function normaliser_telephone(string $tel): string {
    $tel = preg_replace('/[^\d+]/', '', $tel);
    return trim($tel);
}

/**
 * Le parent est-il connecté ? (vérifie empreinte + timeout, comme le staff)
 */
function parent_est_connecte(): bool {
    demarrer_session();

    if (!isset($_SESSION['parent_id'])) {
        return false;
    }

    if (!isset($_SESSION['parent_empreinte']) ||
        !hash_equals($_SESSION['parent_empreinte'], empreinte_session())) {
        journaliser(null, 'Empreinte de session PARENT invalide (vol potentiel)');
        parent_deconnecter();
        return false;
    }

    if (isset($_SESSION['parent_derniere_activite']) &&
        (time() - $_SESSION['parent_derniere_activite']) > SESSION_TIMEOUT) {
        parent_deconnecter();
        return false;
    }

    if (!isset($_SESSION['parent_regen_at']) ||
        (time() - $_SESSION['parent_regen_at']) > SESSION_REGEN_PERIOD) {
        session_regenerate_id(true);
        $_SESSION['parent_regen_at'] = time();
    }

    $_SESSION['parent_derniere_activite'] = time();
    return true;
}

/**
 * Exiger qu'un parent soit connecté pour accéder à la page.
 */
function require_parent(): void {
    if (!parent_est_connecte()) {
        header('Location: ' . get_base_url() . '/parent_connexion.php?erreur=session');
        exit;
    }
}

/**
 * Anti brute-force par IP, spécifique aux connexions parent.
 */
function parent_ip_bloquee(string $ip): bool {
    try {
        $db = getDB();
        $stmt = $db->prepare(
            'SELECT COUNT(*) FROM journal_securite
             WHERE ip = :ip AND action LIKE "Connexion parent échouée%"
             AND date > DATE_SUB(NOW(), INTERVAL :sec SECOND)'
        );
        $stmt->execute([':ip' => $ip, ':sec' => IP_LOCKOUT]);
        return ((int) $stmt->fetchColumn()) >= IP_MAX_ATTEMPTS;
    } catch (Throwable $e) {
        return false;
    }
}

/**
 * Tenter la connexion d'un parent.
 * @return array{succes:bool, message:string, doit_changer:bool}
 */
function tenter_connexion_parent(string $telephone, string $mot_de_passe): array {
    $ip  = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $tel = normaliser_telephone($telephone);

    if ($parent_ip_bloquee = parent_ip_bloquee($ip)) {
        journaliser(null, 'Connexion parent refusée — IP bloquée', $ip);
        return ['succes' => false, 'message' => 'Trop de tentatives depuis votre réseau. Réessayez plus tard.', 'doit_changer' => false];
    }

    $db = getDB();

    // Recherche tolérante : on compare la version normalisée des deux côtés.
    $stmt = $db->prepare(
        "SELECT * FROM parents
         WHERE REPLACE(REPLACE(REPLACE(REPLACE(telephone,' ',''),'-',''),'(',''),')','') = :tel
         AND actif = TRUE"
    );
    $stmt->execute([':tel' => $tel]);
    $p = $stmt->fetch();

    // Compte inconnu — on simule une vérification pour éviter l'énumération par timing.
    if (!$p) {
        password_verify($mot_de_passe, '$argon2id$v=19$m=65536,t=4,p=1$YWFhYWFhYWFhYWFhYWFhYQ$0000000000000000000000000000000000000000000');
        journaliser(null, 'Connexion parent échouée (compte inconnu)', $tel);
        return ['succes' => false, 'message' => 'Numéro ou mot de passe incorrect.', 'doit_changer' => false];
    }

    if ($p['bloque_jusqua'] !== null && strtotime($p['bloque_jusqua']) > time()) {
        $minutes = max(1, (int) ceil((strtotime($p['bloque_jusqua']) - time()) / 60));
        journaliser(null, "Connexion parent bloquée (compte verrouillé) #{$p['id']}");
        return ['succes' => false, 'message' => "Compte verrouillé. Réessayez dans {$minutes} minute(s).", 'doit_changer' => false];
    }

    if (!password_verify($mot_de_passe, $p['mot_de_passe'])) {
        $tentatives = (int) $p['tentatives_echec'] + 1;
        $bloque = null;
        if ($tentatives >= MAX_LOGIN_ATTEMPTS) {
            $bloque = date('Y-m-d H:i:s', time() + LOCKOUT_DURATION);
            $tentatives = 0;
        }
        $db->prepare('UPDATE parents SET tentatives_echec = :t, bloque_jusqua = :b WHERE id = :id')
           ->execute([':t' => $tentatives, ':b' => $bloque, ':id' => $p['id']]);
        journaliser(null, "Connexion parent échouée (mot de passe) #{$p['id']}", $ip);

        if ($bloque) {
            return ['succes' => false, 'message' => 'Trop de tentatives échouées. Compte verrouillé 15 minutes.', 'doit_changer' => false];
        }
        return ['succes' => false, 'message' => 'Numéro ou mot de passe incorrect.', 'doit_changer' => false];
    }

    // Rehash si nécessaire (algorithme amélioré)
    if (password_needs_rehash($p['mot_de_passe'], PASSWORD_ARGON2ID)) {
        $db->prepare('UPDATE parents SET mot_de_passe = :h WHERE id = :id')
           ->execute([':h' => password_hash($mot_de_passe, PASSWORD_ARGON2ID), ':id' => $p['id']]);
    }

    $db->prepare('UPDATE parents SET tentatives_echec = 0, bloque_jusqua = NULL, derniere_connexion = NOW() WHERE id = :id')
       ->execute([':id' => $p['id']]);

    demarrer_session();
    session_regenerate_id(true);

    // Cloisonnement strict : aucune clé staff n'est posée.
    $_SESSION['parent_id']                = (int) $p['id'];
    $_SESSION['parent_nom']               = $p['nom_complet'];
    $_SESSION['parent_telephone']         = $p['telephone'];
    $_SESSION['parent_empreinte']         = empreinte_session();
    $_SESSION['parent_derniere_activite'] = time();
    $_SESSION['parent_regen_at']          = time();

    journaliser(null, "Connexion parent réussie #{$p['id']}");

    return [
        'succes'       => true,
        'message'      => 'Connexion réussie.',
        'doit_changer' => (bool) $p['doit_changer_mdp'],
    ];
}

function parent_deconnecter(): void {
    demarrer_session();
    if (isset($_SESSION['parent_id'])) {
        journaliser(null, "Déconnexion parent #{$_SESSION['parent_id']}");
    }
    // On ne détruit que les clés parent (au cas où un staff partagerait le navigateur).
    foreach (array_keys($_SESSION) as $k) {
        if (str_starts_with($k, 'parent_')) {
            unset($_SESSION[$k]);
        }
    }
    if (empty($_SESSION)) {
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000,
                $params['path'], $params['domain'], $params['secure'], $params['httponly']);
        }
        session_destroy();
    }
}

/**
 * Créer un compte parent (appelé depuis l'inscription d'étudiant).
 * Le mot de passe est choisi par l'admin ; le parent devra le changer.
 * @return array{succes:bool, message:string, parent_id:int}
 */
function creer_compte_parent(string $nom_complet, string $telephone, string $mot_de_passe, ?string $email = null): array {
    $db  = getDB();
    $tel = normaliser_telephone($telephone);

    if (mb_strlen(trim($nom_complet)) < 3) {
        return ['succes' => false, 'message' => 'Nom du parent trop court.', 'parent_id' => 0];
    }
    if (strlen($tel) < 6) {
        return ['succes' => false, 'message' => 'Numéro de téléphone invalide.', 'parent_id' => 0];
    }
    $err_mdp = valider_mot_de_passe($mot_de_passe);
    if ($err_mdp !== '') {
        return ['succes' => false, 'message' => $err_mdp, 'parent_id' => 0];
    }

    // Existe déjà ? On renvoie son id (un parent peut avoir plusieurs enfants).
    $stmt = $db->prepare(
        "SELECT id FROM parents
         WHERE REPLACE(REPLACE(REPLACE(REPLACE(telephone,' ',''),'-',''),'(',''),')','') = :tel"
    );
    $stmt->execute([':tel' => $tel]);
    $existing = $stmt->fetchColumn();
    if ($existing) {
        return ['succes' => true, 'message' => 'Parent déjà existant — étudiant rattaché.', 'parent_id' => (int) $existing];
    }

    $hash = password_hash($mot_de_passe, PASSWORD_ARGON2ID);
    $stmt = $db->prepare(
        'INSERT INTO parents (telephone, mot_de_passe, nom_complet, email, doit_changer_mdp)
         VALUES (:tel, :mdp, :nom, :email, TRUE)'
    );
    $stmt->execute([
        ':tel'   => $telephone,
        ':mdp'   => $hash,
        ':nom'   => trim($nom_complet),
        ':email' => $email ?: null,
    ]);

    return ['succes' => true, 'message' => 'Compte parent créé.', 'parent_id' => (int) $db->lastInsertId()];
}

/**
 * Pousser une notification vers un parent (feed temps réel + navigateur).
 */
function notifier_parent(int $parent_id, string $type, string $titre, string $contenu, ?int $etudiant_id = null): void {
    if ($parent_id <= 0) return;
    try {
        $db = getDB();
        $db->prepare(
            'INSERT INTO notifications (parent_id, etudiant_id, type, titre, contenu)
             VALUES (:p, :e, :t, :ti, :c)'
        )->execute([
            ':p'  => $parent_id,
            ':e'  => $etudiant_id,
            ':t'  => $type,
            ':ti' => mb_substr($titre, 0, 200),
            ':c'  => $contenu,
        ]);
    } catch (Throwable $e) {
        error_log('notifier_parent: ' . $e->getMessage());
    }
}

/**
 * Notifier le parent d'un étudiant donné (résout parent_id automatiquement).
 */
function notifier_parent_de_etudiant(int $etudiant_id, string $type, string $titre, string $contenu): void {
    try {
        $db = getDB();
        $stmt = $db->prepare('SELECT parent_id FROM etudiants WHERE id = :e');
        $stmt->execute([':e' => $etudiant_id]);
        $pid = (int) $stmt->fetchColumn();
        if ($pid > 0) {
            notifier_parent($pid, $type, $titre, $contenu, $etudiant_id);
        }
    } catch (Throwable $e) {
        error_log('notifier_parent_de_etudiant: ' . $e->getMessage());
    }
}
