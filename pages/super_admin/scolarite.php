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
    'absence'  => ['Gérer l\'absence',     'gerer_absence.php',   '✓'],
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
    <nav class="hub-nav" id="hub-nav">
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

<script>
(function () {
    var nav = document.getElementById('hub-nav');
    var panel = document.getElementById('hub-panel');
    var current = <?= json_encode($actif) ?>;
    function setActive(key) {
        nav.querySelectorAll('.hub-tab').forEach(function (b) { b.classList.toggle('is-active', b.dataset.tab === key); });
    }
    function runScripts(container) {
        container.querySelectorAll('script').forEach(function (old) {
            var s = document.createElement('script');
            if (old.src) { s.src = old.src; } else { s.textContent = old.textContent; }
            old.parentNode.replaceChild(s, old);
        });
    }
    function load(key, url, push) {
        setActive(key);
        panel.classList.add('is-loading');
        panel.innerHTML = '<div class="hub-skeleton"><div class="sk-bar"></div><div class="sk-bar sk-w70"></div><div class="sk-bar sk-w40"></div></div>';
        fetch(url + '?embed=1', { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
            .then(function (r) { return r.text(); })
            .then(function (html) {
                panel.innerHTML = html; runScripts(panel); panel.classList.remove('is-loading');
                if (push) history.replaceState(null, '', '?tab=' + key);
                panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            })
            .catch(function () {
                panel.classList.remove('is-loading');
                panel.innerHTML = '<div class="alert alert-error">Impossible de charger cette section. Réessayez.</div>';
            });
    }
    nav.addEventListener('click', function (e) {
        var btn = e.target.closest('.hub-tab'); if (!btn) return;
        load(btn.dataset.tab, btn.dataset.url, true);
    });
    var firstBtn = nav.querySelector('.hub-tab[data-tab="' + current + '"]') || nav.querySelector('.hub-tab');
    load(firstBtn.dataset.tab, firstBtn.dataset.url, false);
})();
</script>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
