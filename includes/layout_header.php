<?php
$__embed = isset($_GET['embed']);
if ($__embed) {
    // Mode fragment : on ne renvoie QUE le contenu interne de la page,
    // sans <html>/<head>/<body>/sidebar. Le hub l'injecte dans un conteneur.
    // Cela évite tout iframe, toute double-sidebar et tout recalcul de hauteur.
    echo '<div class="embed-fragment">';
    return;
}
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="El OURWA — Plateforme de gestion scolaire">
    <meta name="csrf-token" content="<?= e(generer_csrf()) ?>">
    <title><?= e($titre_page ?? 'El OURWA') ?> — El OURWA</title>

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Poppins:wght@600;700;800&display=swap" rel="stylesheet">

    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>

    <link rel="stylesheet" href="<?= e(get_base_url()) ?>/assets/css/style.css">
</head>
<body>
    <div class="app-layout">
        <?php include __DIR__ . '/sidebar.php'; ?>

        <main class="main-content" id="main-content">
            <header class="page-header">
                <div class="page-header-left">
                    <h1 class="page-title"><?= e($titre_page ?? 'Tableau de bord') ?></h1>
                    <?php if (!empty($sous_titre)): ?>
                        <p class="page-subtitle"><?= e($sous_titre) ?></p>
                    <?php endif; ?>
                </div>
                <div class="page-header-right">
                    <span class="header-date">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="18" height="18">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/>
                        </svg>
                        <?= e(date_fr()) ?>
                    </span>
                </div>
            </header>

            <div class="page-content">
