<?php
/**
 * El OURWA — Page de connexion (point d'entrée).
 */

require_once __DIR__ . '/includes/bootstrap.php';

demarrer_session();

// Déjà connecté → tableau de bord
if (est_connecte()) {
    header('Location: ' . url_tableau_bord($_SESSION['role']));
    exit;
}

$erreur = '';
$identifiant_saisi = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();

    $identifiant  = nettoyer($_POST['identifiant'] ?? '');
    $mot_de_passe = (string) ($_POST['mot_de_passe'] ?? '');
    $identifiant_saisi = $identifiant;

    if ($identifiant === '' || $mot_de_passe === '') {
        $erreur = 'Veuillez remplir tous les champs.';
    } else {
        $r = tenter_connexion($identifiant, $mot_de_passe);
        if ($r['succes']) {
            header('Location: ' . url_tableau_bord($r['role']));
            exit;
        }
        $erreur = $r['message'];
    }
}

if (isset($_GET['erreur']) && $_GET['erreur'] === 'session_expiree') {
    $erreur = 'Votre session a expiré. Veuillez vous reconnecter.';
}
if (isset($_GET['deconnexion'])) {
    $info = 'Vous avez été déconnecté avec succès.';
}
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="El OURWA — Connexion sécurisée à la plateforme de gestion scolaire">
    <meta name="robots" content="noindex, nofollow">
    <title>Connexion — El OURWA</title>

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Poppins:wght@600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="<?= e(get_base_url()) ?>/assets/css/style.css">
</head>
<body class="login-body">

    <!-- Décor d'arrière-plan animé -->
    <div class="login-bg" aria-hidden="true">
        <div class="login-blob login-blob-1"></div>
        <div class="login-blob login-blob-2"></div>
        <div class="login-blob login-blob-3"></div>
    </div>

    <div class="login-page">
        <div class="login-container">

            <div class="login-brand">
                <div class="login-brand-logo">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" width="44" height="44">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5"/>
                    </svg>
                </div>
                <h1>El OURWA</h1>
                <p>Plateforme de gestion scolaire</p>
            </div>

            <div class="login-card">
                <div class="login-card-header">
                    <h2>Bienvenue</h2>
                    <p>Connectez-vous pour accéder à votre espace</p>
                </div>

                <?php if (!empty($erreur)): ?>
                    <div class="alert alert-error">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" width="18" height="18">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
                        </svg>
                        <span><?= e($erreur) ?></span>
                    </div>
                <?php endif; ?>

                <?php if (!empty($info)): ?>
                    <div class="alert alert-success">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" width="18" height="18">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                        <span><?= e($info) ?></span>
                    </div>
                <?php endif; ?>

                <form method="POST" action="" id="form-connexion" autocomplete="off" novalidate>
                    <?= champ_csrf() ?>

                    <div class="form-group form-group-icon">
                        <label for="identifiant">Identifiant</label>
                        <div class="input-wrapper">
                            <svg class="input-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="18" height="18">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/>
                            </svg>
                            <input type="text" id="identifiant" name="identifiant"
                                   value="<?= e($identifiant_saisi) ?>"
                                   placeholder="ex. enseignant@supnum.mr"
                                   required autofocus autocomplete="username"
                                   maxlength="100">
                        </div>
                    </div>

                    <div class="form-group form-group-icon">
                        <label for="mot_de_passe">Mot de passe</label>
                        <div class="input-wrapper">
                            <svg class="input-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="18" height="18">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
                            </svg>
                            <input type="password" id="mot_de_passe" name="mot_de_passe"
                                   placeholder="Votre mot de passe"
                                   required autocomplete="current-password">
                            <button type="button" id="toggle-mdp" class="toggle-mdp" aria-label="Afficher/masquer le mot de passe" tabindex="-1">
                                <svg id="icon-eye" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="18" height="18">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/>
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                                </svg>
                            </button>
                        </div>
                    </div>

                    <button type="submit" class="btn btn-primary btn-login" id="btn-connexion">
                        <span>Se connecter</span>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" width="18" height="18">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/>
                        </svg>
                    </button>
                </form>

                <div style="text-align:center;margin-top:1.25rem;padding-top:1.25rem;border-top:1px solid rgba(0,0,0,.08);">
                    <a href="<?= e(get_base_url()) ?>/parent_connexion.php"
                       style="color:var(--primary);text-decoration:none;font-weight:600;font-size:.92rem;">
                        👨‍👩‍👧 Espace Parents — suivre la scolarité de mon enfant →
                    </a>
                </div>

                <div class="login-secure-badge">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="14" height="14">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/>
                    </svg>
                    <span>Connexion chiffrée &amp; sécurisée</span>
                </div>
            </div>

            <p class="login-footer">© <?= date('Y') ?> El OURWA — Tous droits réservés</p>
        </div>
    </div>

    <script>
        // Toggle affichage mot de passe
        (function() {
            var btn = document.getElementById('toggle-mdp');
            var input = document.getElementById('mot_de_passe');
            if (!btn || !input) return;
            btn.addEventListener('click', function() {
                input.type = input.type === 'password' ? 'text' : 'password';
                btn.classList.toggle('shown');
            });
        })();

        // Empêche le double-submit
        (function() {
            var f = document.getElementById('form-connexion');
            var b = document.getElementById('btn-connexion');
            if (!f || !b) return;
            f.addEventListener('submit', function() {
                b.disabled = true;
                b.classList.add('loading');
                b.querySelector('span').textContent = 'Connexion en cours...';
            });
        })();
    </script>
</body>
</html>
