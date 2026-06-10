<?php
/**
 * Sidebar dynamique selon le rôle.
 */
require_once __DIR__ . '/sanitize.php';

// SVG icônes réutilisés
$ICN_HOME    = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12L11.204 3.045a1.125 1.125 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"/></svg>';
$ICN_USER_ADD= '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z"/></svg>';
$ICN_STUDENT = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-3-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z"/></svg>';
$ICN_LEVELS  = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z"/></svg>';
$ICN_GROUPS  = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"/></svg>';
$ICN_CHECK   = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
$ICN_MSG     = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"/></svg>';
$ICN_CAP     = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84"/></svg>';
$ICN_CASH    = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/></svg>';
$ICN_EXPENSE = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
$ICN_NOTES   = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25"/></svg>';
$ICN_STAFF   = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/></svg>';
$ICN_SEARCH  = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>';
$ICN_PROFILE = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z"/></svg>';
$ICN_REIN    = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>';
$ICN_BAN     = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg>';
$ICN_CAL     = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg>';
$ICN_KEY     = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"/></svg>';

$menus = [
    'super_admin' => [
        ['titre' => 'Tableau de bord',        'url' => '/pages/super_admin/tableau_bord.php',      'icone' => $ICN_HOME],
        ['titre' => 'Créer un utilisateur',   'url' => '/pages/super_admin/creer_utilisateur.php', 'icone' => $ICN_USER_ADD],
        ['titre' => 'Inscrire un étudiant',   'url' => '/pages/super_admin/inscrire_etudiant.php', 'icone' => $ICN_STUDENT],
        ['titre' => 'Réinscrire un étudiant', 'url' => '/pages/super_admin/reinscrire_etudiant.php','icone'=> $ICN_REIN],
        ['titre' => 'Gestion de scolarité',   'url' => '/pages/super_admin/scolarite.php',         'icone' => $ICN_CAP],
        ['titre' => 'Cours du soir',          'url' => '/pages/super_admin/cours_du_soir.php',     'icone' => $ICN_CAL],
        ['titre' => 'Saisir les notes',       'url' => '/pages/super_admin/saisir_notes.php',      'icone' => $ICN_NOTES],
        ['titre' => 'Finance',                'url' => '/pages/super_admin/finance.php',           'finance' => true, 'icone' => $ICN_CASH],
        ['titre' => 'Messagerie parents',     'url' => '/pages/super_admin/messagerie.php',        'icone' => $ICN_MSG],
        ['titre' => 'Gérer les professeurs',  'url' => '/pages/super_admin/gerer_professeurs.php', 'icone' => $ICN_CAP],
        ['titre' => 'Ajouter Staff',          'url' => '/pages/super_admin/ajouter_staff.php',     'icone' => $ICN_STAFF],
        ['titre' => 'Statistiques',           'url' => '/pages/super_admin/statistiques.php',      'icone' => $ICN_LEVELS],
        ['titre' => 'Recherche',              'url' => '/pages/super_admin/recherche.php',         'icone' => $ICN_SEARCH],
        ['titre' => 'Mon profil',             'url' => '/pages/super_admin/modifier_profil.php',   'icone' => $ICN_PROFILE],
        ['titre' => 'Comptes des parents',    'url' => '/pages/super_admin/comptes_parents.php',   'icone' => $ICN_KEY],
        ['titre' => 'Comptes des professeurs','url' => '/pages/super_admin/comptes_profs.php',     'icone' => $ICN_KEY],
    ],
    'professeur' => [
        ['titre' => 'Tableau de bord',    'url' => '/pages/professeur/tableau_bord.php',    'icone' => $ICN_HOME],
        ['titre' => 'Envoyer un exercice','url' => '/pages/professeur/envoyer_exercice.php','icone' => $ICN_MSG],
        ['titre' => 'Remarques élèves',   'url' => '/pages/professeur/remarques.php',       'icone' => $ICN_MSG],
        ['titre' => 'Mes classes',        'url' => '/pages/professeur/mes_classes.php',     'icone' => $ICN_CAP],
        ['titre' => 'Mon emploi du temps','url' => '/pages/professeur/emploi.php',          'icone' => $ICN_CAL],
    ],
    'collecteur_absence' => [
        ['titre' => 'Gérer l\'absence',    'url' => '/pages/super_admin/gerer_absence.php', 'icone' => $ICN_CHECK],
    ],
    'secretaire' => [
        ['titre' => 'Saisir les notes',   'url' => '/pages/super_admin/saisir_notes.php',  'icone' => $ICN_NOTES],
    ],
    'comptable' => [
        ['titre' => 'Finance', 'url' => '/pages/super_admin/finance.php', 'icone' => $ICN_CASH],
    ],
];

// 'admin' partage le menu super_admin ; entrées 'finance' filtrées pour les admins restreints.
$menus['admin'] = $menus['super_admin'];

$role = $_SESSION['role'] ?? '';
$menu_actuel = $menus[$role] ?? [];
$page_courante = $_SERVER['SCRIPT_NAME'] ?? '';
$base = get_base_url();
?>

<aside class="sidebar" id="sidebar">
    <div class="sidebar-header">
        <div class="sidebar-logo">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="32" height="32">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342"/>
            </svg>
            <span>El OURWA</span>
        </div>
    </div>

    <nav class="sidebar-nav">
        <?php
        $peut_finance = function_exists('est_admin_complet') ? est_admin_complet() : false;
        foreach ($menu_actuel as $item):
            if (!empty($item['finance']) && !$peut_finance) {
                continue;
            }
            $url_complete = $base . $item['url'];
            $est_actif = str_contains($page_courante, basename($item['url']));
        ?>
            <a href="<?= e($url_complete) ?>" class="sidebar-link <?= $est_actif ? 'active' : '' ?>">
                <span class="sidebar-icon"><?= $item['icone'] ?></span>
                <span class="sidebar-text"><?= e($item['titre']) ?></span>
            </a>
        <?php endforeach; ?>
    </nav>

    <div class="sidebar-footer">
        <div class="sidebar-user">
            <div class="sidebar-avatar">
                <?= e(strtoupper(mb_substr($_SESSION['nom_complet'] ?? 'U', 0, 1))) ?>
            </div>
            <div class="sidebar-user-info">
                <span class="sidebar-user-name"><?= e($_SESSION['nom_complet'] ?? 'Utilisateur') ?></span>
                <span class="sidebar-user-role"><?= e(ucfirst(str_replace('_', ' ', $_SESSION['role'] ?? ''))) ?></span>
            </div>
        </div>
        <a href="<?= e($base) ?>/deconnexion.php" class="sidebar-link sidebar-logout">
            <span class="sidebar-icon">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"/>
                </svg>
            </span>
            <span class="sidebar-text">Déconnexion</span>
        </a>
    </div>
</aside>

<button class="sidebar-toggle" id="sidebar-toggle" aria-label="Ouvrir le menu">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="24" height="24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"/>
    </svg>
</button>
