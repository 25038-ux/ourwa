<?php
/**
 * Hub GESTION DE SCOLARITÉ — Emploi du temps, Absences, Groupes, Niveaux,
 * Exclusions, Notes & bulletins. Chargement AJAX par fragment (sans iframe).
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_role(['super_admin', 'admin']);

$base = get_base_url();
$onglets = [
    'emploi'   => ['Emploi du temps',     'emploi_du_temps.php', '🗓️'],
    'absence'  => ['Gérer l\'absence',     'gerer_absence.php',   '✅'],
    'groupes'  => ['Groupes',             'gestion_groupes.php', '👥'],
    'niveaux'  => ['Niveaux',             'gerer_niveaux.php',   '📚'],
    'expelled' => ['Exclusions',          'expelled.php',        '🚫'],
    'notes'    => ['Notes & bulletins',   'notes_etudiants.php', '📝'],
];
$actif = isset($onglets[$_GET['tab'] ?? '']) ? $_GET['tab'] : 'emploi';

$titre_page = 'Gestion de scolarité';
$sous_titre = 'Emploi du temps, absences, groupes, niveaux, exclusions et notes';
include __DIR__ . '/../../includes/layout_header.php';
?>

<div class="hub-shell">
    <nav class="hub-nav" id="hub-nav" aria-label="Sections Scolarité">
        <?php foreach ($onglets as $key => [$label, $page, $ico]): ?>
            <button type="button" class="hub-tab <?= $actif===$key?'is-active':'' ?>"
                    data-tab="<?= e($key) ?>"
                    data-url="<?= e($base.'/pages/super_admin/'.$page) ?>">
                <span class="hub-tab-ico"><?= $ico ?></span>
                <span class="hub-tab-label"><?= e($label) ?></span>
            </button>
        <?php endforeach; ?>
    </nav>

    <div class="hub-panel" id="hub-panel" aria-live="polite">
        <div class="hub-skeleton">
            <div class="sk-bar"></div><div class="sk-bar sk-w70"></div><div class="sk-bar sk-w40"></div>
        </div>
    </div>
</div>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
