<?php
/**
 * Connexion au portail PARENT — design split-screen "Glass Ocean".
 */
require_once __DIR__ . '/includes/bootstrap.php';
require_once __DIR__ . '/includes/parent_auth.php';

demarrer_session();
require_once __DIR__ . '/includes/i18n.php';
$lg  = langue_courante();
$rtl = est_rtl();

if (parent_est_connecte()) {
    header('Location: ' . get_base_url() . '/pages/parent/tableau_bord.php');
    exit;
}

$erreur = '';
$info   = '';
if (isset($_GET['erreur']) && $_GET['erreur'] === 'session') {
    $erreur = $lg === 'ar' ? 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مجدداً.' : 'Votre session a expiré. Veuillez vous reconnecter.';
}
if (isset($_GET['deconnexion'])) {
    $info = $lg === 'ar' ? 'تم تسجيل الخروج.' : 'Vous avez été déconnecté.';
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();
    $tel = nettoyer($_POST['telephone'] ?? '');
    $mdp = (string) ($_POST['mot_de_passe'] ?? '');
    if ($tel === '' || $mdp === '') {
        $erreur = t('champs_requis');
    } else {
        $r = tenter_connexion_parent($tel, $mdp);
        if ($r['succes']) {
            $dest = $r['doit_changer']
                ? '/pages/parent/changer_mdp.php?premiere=1'
                : '/pages/parent/tableau_bord.php';
            header('Location: ' . get_base_url() . $dest);
            exit;
        }
        $erreur = $r['message'];
    }
}
$base = get_base_url();
?>
<!DOCTYPE html>
<html lang="<?= e($lg) ?>" dir="<?= $rtl ? 'rtl' : 'ltr' ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="robots" content="noindex, nofollow">
    <meta name="theme-color" content="#0e7490">
    <title><?= e(t('titre_connexion_parent')) ?> — <?= e(t('app_nom')) ?></title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <?php if ($rtl): ?>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&display=swap" rel="stylesheet">
    <?php endif; ?>
    <link rel="stylesheet" href="<?= e($base) ?>/assets/css/parent.css">
    <?php if ($rtl): ?>
    <style>html,body{font-family:'Cairo','Segoe UI',system-ui,sans-serif;}</style>
    <?php endif; ?>
</head>
<body class="parent-login-body" dir="<?= $rtl ? 'rtl' : 'ltr' ?>">

<!-- Bouton langue flottant -->
<a href="?lang=<?= $lg === 'fr' ? 'ar' : 'fr' ?>" style="position:fixed;top:1.2rem;<?= $rtl ? 'left' : 'right' ?>:1.2rem;z-index:100;background:rgba(255,255,255,.95);color:#0e7490;padding:.55rem 1rem;border-radius:24px;text-decoration:none;font-weight:700;font-size:.9rem;box-shadow:0 4px 16px rgba(14,116,144,.25);backdrop-filter:blur(8px);">
    <?= $lg === 'fr' ? '🇲🇷 العربية' : '🇫🇷 Français' ?>
</a>

<!-- ===== Hero gauche ===== -->
<div class="login-hero">
    <div class="login-hero-content">
        <div class="login-hero-logo">
            <div class="badge">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
                    <path d="M6 12v5c3 3 9 3 12 0v-5"/>
                </svg>
            </div>
            El OURWA
        </div>

        <h1><?= e(t('hero_titre_l1')) ?><br><em><?= e(t('hero_titre_l2')) ?></em></h1>
        <p class="login-hero-lede">
            <?= e(t('hero_lede')) ?>
        </p>

        <div class="login-hero-features">
            <div class="login-feature">
                <div class="login-feature-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                </div>
                <span><?= e(t('feat_notif')) ?></span>
            </div>
            <div class="login-feature">
                <div class="login-feature-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                </div>
                <span><?= e(t('feat_classe')) ?></span>
            </div>
            <div class="login-feature">
                <div class="login-feature-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                </div>
                <span><?= e(t('feat_secu')) ?></span>
            </div>
        </div>
    </div>

    <!-- Illustration SVG : enfant qui lit, totalement custom -->
    <svg class="login-illustration" viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
            <linearGradient id="bookGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#a5f3fc"/>
                <stop offset="100%" stop-color="#67e8f9"/>
            </linearGradient>
            <linearGradient id="shirtGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#fef3c7"/>
                <stop offset="100%" stop-color="#fde68a"/>
            </linearGradient>
        </defs>
        <!-- ombre douce -->
        <ellipse cx="160" cy="290" rx="100" ry="10" fill="rgba(0,0,0,0.15)"/>
        <!-- corps -->
        <path d="M100 200 Q100 160 160 160 Q220 160 220 200 L220 280 L100 280 Z" fill="url(#shirtGrad)"/>
        <!-- bras gauche tenant le livre -->
        <path d="M100 200 Q80 215 90 240 L110 235 Z" fill="url(#shirtGrad)"/>
        <!-- bras droit -->
        <path d="M220 200 Q240 215 230 240 L210 235 Z" fill="url(#shirtGrad)"/>
        <!-- livre ouvert -->
        <path d="M85 235 L160 220 L235 235 L235 260 L160 245 L85 260 Z" fill="url(#bookGrad)" stroke="#0e7490" stroke-width="2" stroke-linejoin="round"/>
        <path d="M160 220 L160 245" stroke="#0e7490" stroke-width="1.5"/>
        <line x1="100" y1="240" x2="145" y2="232" stroke="#0e7490" stroke-width="1" opacity="0.5"/>
        <line x1="100" y1="246" x2="145" y2="238" stroke="#0e7490" stroke-width="1" opacity="0.5"/>
        <line x1="175" y1="232" x2="220" y2="240" stroke="#0e7490" stroke-width="1" opacity="0.5"/>
        <line x1="175" y1="238" x2="220" y2="246" stroke="#0e7490" stroke-width="1" opacity="0.5"/>
        <!-- tête -->
        <circle cx="160" cy="125" r="48" fill="#fcd5b5"/>
        <!-- cheveux -->
        <path d="M115 125 Q115 75 160 75 Q205 75 205 125 Q205 105 195 100 Q180 92 160 92 Q140 92 125 100 Q115 105 115 125 Z" fill="#4a2e1d"/>
        <!-- yeux fermés (concentré sur le livre) -->
        <path d="M140 130 Q145 134 150 130" stroke="#2c1810" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M170 130 Q175 134 180 130" stroke="#2c1810" stroke-width="2" fill="none" stroke-linecap="round"/>
        <!-- bouche souriante -->
        <path d="M152 148 Q160 154 168 148" stroke="#2c1810" stroke-width="2" fill="none" stroke-linecap="round"/>
        <!-- petites étoiles flottantes -->
        <g opacity="0.85">
            <path d="M55 60 L57 66 L63 66 L58 70 L60 76 L55 72 L50 76 L52 70 L47 66 L53 66 Z" fill="#fef3c7"/>
            <path d="M270 95 L271 99 L275 99 L272 102 L273 106 L270 103 L267 106 L268 102 L265 99 L269 99 Z" fill="#fef3c7"/>
            <path d="M40 180 L41.5 184 L45.5 184 L42 187 L43.5 191 L40 188 L36.5 191 L38 187 L34.5 184 L38.5 184 Z" fill="#fef3c7"/>
        </g>
    </svg>

    <div class="login-hero-footer">
        <?= e(t('footer_copyright')) ?>
    </div>
</div>

<!-- ===== Formulaire droit ===== -->
<div class="login-form-wrap">
    <div class="login-form-card">
        <h2><?= e(t('bonjour')) ?> 👋</h2>
        <p class="lede"><?= e(t('connectez_vous')) ?></p>

        <?php if ($erreur): ?>
            <div class="g-alert g-alert-error">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span><?= e($erreur) ?></span>
            </div>
        <?php endif; ?>

        <?php if ($info): ?>
            <div class="g-alert g-alert-success">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                <span><?= e($info) ?></span>
            </div>
        <?php endif; ?>

        <form method="POST" autocomplete="on">
            <?= csrf_field() ?>

            <div class="float-field">
                <input type="text" id="telephone" name="telephone" required autocomplete="username"
                       placeholder=" " inputmode="tel">
                <label for="telephone"><?= e(t('identifiant')) ?></label>
            </div>

            <div class="float-field">
                <input type="password" id="mot_de_passe" name="mot_de_passe" required
                       autocomplete="current-password" placeholder=" ">
                <label for="mot_de_passe"><?= e(t('mot_de_passe')) ?></label>
                <button type="button" class="pwd-toggle" onclick="togglePwd(this)" aria-label="Show/Hide">
                    <svg id="pwd-eye" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                </button>
            </div>

            <button type="submit" class="g-btn g-btn-primary g-btn-block" style="margin-top:1rem;">
                <?= e(t('se_connecter')) ?>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>
        </form>

        <p style="text-align:center;margin-top:2rem;font-size:.88rem;color:var(--ink-500);">
            <a href="<?= e($base) ?>/index.php" style="color:var(--ocean-700);text-decoration:none;font-weight:600;">
                ← <?= e(t('acces_admin')) ?>
            </a>
        </p>
    </div>
</div>

<script>
function togglePwd(btn) {
    const inp = btn.previousElementSibling.previousElementSibling;
    const isPwd = inp.type === 'password';
    inp.type = isPwd ? 'text' : 'password';
    btn.querySelector('svg').innerHTML = isPwd
        ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
        : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
}
</script>
</body>
</html>
