<?php
/**
 * Super Admin — Tableau de bord financier
 * Charts : revenu par niveau, par groupe, donut revenus/charges/gain
 * KPIs : total étudiants, professeurs, revenu mensuel, gain net
 * Includes: depenses_supplementaires, excludes admin salary from charts
 */

require_once __DIR__ . '/../../includes/bootstrap.php';

require_staff_admin();

$db = getDB();
$peut_voir_finance = est_admin_complet();

// KPIs (toujours visibles)
$total_etudiants = $db->query('SELECT COUNT(*) FROM etudiants')->fetchColumn();
$total_professeurs = $db->query('SELECT COUNT(*) FROM professeurs')->fetchColumn();

// KPIs & données financières — UNIQUEMENT pour les comptes à accès complet.
$revenu_brut = $charges_profs = $charges_staff = $depenses_sup = 0;
$charges_totales = $gain_net = $paiements_mois = 0;
$revenus_niveaux = $revenus_groupes = [];

if ($peut_voir_finance) {
    $revenu_brut = $db->query('SELECT COALESCE(SUM(frais_mensuel), 0) FROM etudiants')->fetchColumn();
    $charges_profs = $db->query('SELECT COALESCE(SUM(salaire), 0) FROM professeurs')->fetchColumn();
    $charges_staff = $db->query('SELECT COALESCE(SUM(salaire), 0) FROM staff WHERE actif = TRUE')->fetchColumn();
    $depenses_sup = $db->query('SELECT COALESCE(SUM(montant), 0) FROM depenses')->fetchColumn();
    $charges_totales = $charges_profs + $charges_staff + $depenses_sup;
    $gain_net = $revenu_brut - $charges_totales;

    $paiements_mois = $db->query('SELECT COALESCE(SUM(montant), 0) FROM paiements WHERE MONTH(date_paiement) = MONTH(NOW()) AND YEAR(date_paiement) = YEAR(NOW())')->fetchColumn();

    $revenus_niveaux = $db->query('
        SELECT n.nom, COALESCE(SUM(e.frais_mensuel), 0) AS revenu
        FROM niveaux n
        LEFT JOIN groupes g ON g.niveau_id = n.id
        LEFT JOIN etudiants e ON e.groupe_id = g.id
        GROUP BY n.id, n.nom ORDER BY n.id
    ')->fetchAll();

    $revenus_groupes = $db->query('
        SELECT CONCAT(IFNULL(n.nom, "Sans niveau"), " — ", g.nom) AS nom, COALESCE(SUM(e.frais_mensuel), 0) AS revenu, COUNT(e.id) AS nb_etudiants
        FROM groupes g LEFT JOIN niveaux n ON g.niveau_id = n.id LEFT JOIN etudiants e ON e.groupe_id = g.id
        GROUP BY g.id, g.nom, n.nom ORDER BY n.nom, g.nom
    ')->fetchAll();
}

$titre_page = $peut_voir_finance ? 'Tableau de bord financier' : 'Tableau de bord';
$sous_titre = $peut_voir_finance
    ? 'Vue d\'ensemble des finances de l\'établissement'
    : 'Vue d\'ensemble de l\'établissement';
include __DIR__ . '/../../includes/layout_header.php';
?>

<!-- KPIs -->
<div class="kpi-grid">
    <div class="kpi-card">
        <div class="kpi-icon"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/></svg></div>
        <p class="kpi-label">Total étudiants</p>
        <p class="kpi-value"><?= e(number_format($total_etudiants, 0, ',', ' ')) ?></p>
        <p class="kpi-detail">Inscrits cette année</p>
    </div>
    <div class="kpi-card">
        <div class="kpi-icon"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342"/></svg></div>
        <p class="kpi-label">Total professeurs</p>
        <p class="kpi-value"><?= e(number_format($total_professeurs, 0, ',', ' ')) ?></p>
        <p class="kpi-detail">Enseignants actifs</p>
    </div>
    <?php if ($peut_voir_finance): ?>
    <div class="kpi-card kpi-warning">
        <div class="kpi-icon"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z"/></svg></div>
        <p class="kpi-label">Revenu mensuel</p>
        <p class="kpi-value"><?= e(number_format($revenu_brut, 0, ',', ' ')) ?></p>
        <p class="kpi-detail">MRU / mois</p>
    </div>
    <div class="kpi-card <?= $gain_net >= 0 ? 'kpi-success' : 'kpi-danger' ?>">
        <div class="kpi-icon"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></div>
        <p class="kpi-label">Gain net</p>
        <p class="kpi-value"><?= e(number_format($gain_net, 0, ',', ' ')) ?></p>
        <p class="kpi-detail">MRU après charges</p>
    </div>
    <?php endif; ?>
</div>

<?php if ($peut_voir_finance): ?>
<!-- Charts -->
<div class="charts-grid">
    <div class="chart-card">
        <h3>📊 Revenu par niveau</h3>
        <canvas id="chartNiveaux"></canvas>
    </div>
    <div class="chart-card">
        <h3>📊 Revenu par groupe</h3>
        <canvas id="chartGroupes"></canvas>
    </div>
    <div class="chart-card">
        <h3>🍩 Répartition financière</h3>
        <canvas id="chartDonut"></canvas>
    </div>
    <div class="chart-card">
        <h3>📈 Effectifs par groupe</h3>
        <canvas id="chartEffectifs"></canvas>
    </div>
</div>
<?php else: ?>
<div class="form-card" style="margin-top:1.5rem;">
    <h3>👋 Bienvenue</h3>
    <p class="text-muted">Vous disposez d'un accès administrateur complet à la gestion pédagogique
    (étudiants, groupes, niveaux, notes, absences, parents…). La gestion financière
    est réservée au Super Administrateur.</p>
</div>
<?php endif; ?>

<?php
$scripts_supplementaires = '<script>
// Palette de couleurs
const colors = ["#6366F1","#F59E0B","#10B981","#EF4444","#8B5CF6","#EC4899","#06B6D4","#F97316"];
const bgColors = colors.map(c => c + "20");

// Revenu par niveau
new Chart(document.getElementById("chartNiveaux"), {
    type: "bar",
    data: {
        labels: ' . json_encode(array_column($revenus_niveaux, 'nom')) . ',
        datasets: [{
            label: "Revenu (MRU)",
            data: ' . json_encode(array_map('floatval', array_column($revenus_niveaux, 'revenu'))) . ',
            backgroundColor: colors.slice(0, ' . count($revenus_niveaux) . '),
            borderRadius: 8, borderSkipped: false
        }]
    },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
});

// Revenu par groupe
new Chart(document.getElementById("chartGroupes"), {
    type: "bar",
    data: {
        labels: ' . json_encode(array_column($revenus_groupes, 'nom')) . ',
        datasets: [{
            label: "Revenu (MRU)",
            data: ' . json_encode(array_map('floatval', array_column($revenus_groupes, 'revenu'))) . ',
            backgroundColor: colors.slice(0, ' . count($revenus_groupes) . '),
            borderRadius: 8, borderSkipped: false
        }]
    },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
});

// Donut financier — no admin salary, includes depenses
new Chart(document.getElementById("chartDonut"), {
    type: "doughnut",
    data: {
        labels: ["Revenu brut", "Salaires professeurs", "Salaires staff", "Dépenses suppl.", "Gain net"],
        datasets: [{
            data: [' . $revenu_brut . ', ' . $charges_profs . ', ' . $charges_staff . ', ' . $depenses_sup . ', ' . max(0, $gain_net) . '],
            backgroundColor: ["#6366F1", "#F59E0B", "#06B6D4", "#EF4444", "#10B981"],
            borderWidth: 0, hoverOffset: 8
        }]
    },
    options: { responsive: true, cutout: "60%", plugins: { legend: { position: "bottom" } } }
});

// Effectifs par groupe
new Chart(document.getElementById("chartEffectifs"), {
    type: "bar",
    data: {
        labels: ' . json_encode(array_column($revenus_groupes, 'nom')) . ',
        datasets: [{
            label: "Nombre d\'étudiants",
            data: ' . json_encode(array_map('intval', array_column($revenus_groupes, 'nb_etudiants'))) . ',
            backgroundColor: "#818CF8", borderRadius: 8, borderSkipped: false
        }]
    },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
});
</script>';

include __DIR__ . '/../../includes/layout_footer.php';
?>
