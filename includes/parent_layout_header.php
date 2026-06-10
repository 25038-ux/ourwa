<?php
/** En-tête commun du portail parent — design Glass Ocean. */
if (!function_exists('parent_est_connecte')) {
    require_once __DIR__ . '/parent_auth.php';
}
require_parent();
require_once __DIR__ . '/i18n.php';
$lg  = langue_courante();
$rtl = est_rtl();
$base = get_base_url();
$pid  = (int) $_SESSION['parent_id'];
$db   = getDB();
$non_lues = (int) $db->query("SELECT COUNT(*) FROM notifications WHERE parent_id = $pid AND lu = FALSE")->fetchColumn();

// Initiale pour l'avatar
$nom_parent = (string) ($_SESSION['parent_nom'] ?? '');
$initiale = mb_strtoupper(mb_substr($nom_parent, 0, 1) ?: 'P');

// Page courante (pour highlight de la nav)
$pg = basename($_SERVER['SCRIPT_NAME']);
$liens = [
    'tableau_bord.php' => ['label'=>t('accueil'),    'svg'=>'<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'],
    'resultats.php'    => ['label'=>t('resultats'),  'svg'=>'<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>'],
    'absences.php'     => ['label'=>t('absences'),   'svg'=>'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'],
    'remarques.php'    => ['label'=>t('remarques'),  'svg'=>'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'],
    'exercices.php'    => ['label'=>t('exercices'),  'svg'=>'<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'],
    'messages.php'     => ['label'=>t('messages'),   'svg'=>'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'],
    'changer_mdp.php'  => ['label'=>t('profil'),     'svg'=>'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'],
];
?>
<!DOCTYPE html>
<html lang="<?= e($lg) ?>" dir="<?= $rtl ? 'rtl' : 'ltr' ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="csrf-token" content="<?= e(generer_csrf()) ?>">
    <meta name="robots" content="noindex, nofollow">
    <meta name="theme-color" content="#06b6d4">
    <title><?= e($titre_page ?? t('app_nom')) ?> — <?= e(t('app_nom')) ?></title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <?php if ($rtl): ?>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&display=swap" rel="stylesheet">
    <?php endif; ?>
    <link rel="stylesheet" href="<?= e($base) ?>/assets/css/parent.css">
    <?php if ($rtl): ?>
    <style>
        html, body { font-family: 'Cairo', 'Segoe UI', system-ui, sans-serif !important; }
        body[dir="rtl"] .parent-nav a svg,
        body[dir="rtl"] .parent-bottom-nav a svg { margin-right:0; margin-left:.5rem; }
        body[dir="rtl"] .parent-top-right { flex-direction: row-reverse; }
        body[dir="rtl"] .child-card { text-align: right; }
        body[dir="rtl"] .notif-pop { left: 1rem !important; right: auto !important; }
    </style>
    <?php endif; ?>
</head>
<body class="parent-body" dir="<?= $rtl ? 'rtl' : 'ltr' ?>">
<div class="parent-shell">

    <!-- ===== Top glass bar ===== -->
    <header class="parent-top">
        <div class="parent-brand">
            <div class="parent-brand-logo">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
                    <path d="M6 12v5c3 3 9 3 12 0v-5"/>
                </svg>
            </div>
            <div>
                <?= e(t('app_nom')) ?>
                <small><?= e(t('titre_connexion_parent')) ?></small>
            </div>
        </div>

        <div class="parent-top-right">
            <!-- Sélecteur de langue -->
            <a href="?lang=<?= $lg === 'fr' ? 'ar' : 'fr' ?>" class="lang-toggle" style="background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);color:#fff;padding:.4rem .75rem;border-radius:8px;text-decoration:none;font-weight:600;font-size:.85rem;backdrop-filter:blur(8px);">
                <?= $lg === 'fr' ? '🇲🇷 العربية' : '🇫🇷 Français' ?>
            </a>

            <button class="notif-bell" onclick="toggleNotif()" aria-label="<?= e(t('notifications')) ?>">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                <span class="notif-badge" id="notifBadge" style="<?= $non_lues ? '' : 'display:none;' ?>"><?= e($non_lues) ?></span>
            </button>

            <div class="parent-user-chip">
                <div class="parent-avatar"><?= e($initiale) ?></div>
                <span class="name"><?= e($nom_parent) ?></span>
            </div>

            <a href="<?= e($base) ?>/parent_deconnexion.php" class="g-btn g-btn-ghost" style="padding:.4rem .85rem;min-height:36px;font-size:.8rem;" aria-label="Déconnexion">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </a>
        </div>
    </header>

    <!-- ===== Nav desktop ===== -->
    <nav class="parent-nav" aria-label="Navigation principale">
        <?php foreach ($liens as $f => $l): ?>
            <a href="<?= e($base) ?>/pages/parent/<?= $f ?>" class="<?= $pg===$f?'active':'' ?>">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><?= $l['svg'] ?></svg>
                <?= e($l['label']) ?>
            </a>
        <?php endforeach; ?>
    </nav>

    <main>
