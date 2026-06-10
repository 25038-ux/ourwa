<?php
/**
 * Hub FINANCE — Caisse, Revenue Live, Paiement du personnel, Dettes, Dépenses.
 * Chaque onglet est chargé EN AJAX dans la même page (fragment), sans iframe :
 * pas de double sidebar, pas de fenêtre qui bouge, modales natives.
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_finance_page();

$base = get_base_url();
$onglets = [
    'caisse'  => ['Gestion de Caisse',       'gestion_caisse.php', '💰'],
    'revenue' => ['Revenue Live',            'revenue_live.php',   '📈'],
    'staff'   => ['Paiement du personnel',   'paiement_staff.php', '💵'],
    'dette'   => ['Dettes',                  'dette.php',          '📋'],
    'depenses'=> ['Dépenses',                'depenses.php',       '🧾'],
];
$actif = isset($onglets[$_GET['tab'] ?? '']) ? $_GET['tab'] : 'caisse';

$titre_page = 'Finance';
$sous_titre = 'Caisse, revenus, salaires, dettes et dépenses';
include __DIR__ . '/../../includes/layout_header.php';
?>

<div class="hub-shell">
    <nav class="hub-nav" id="hub-nav" aria-label="Sections Finance">
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
