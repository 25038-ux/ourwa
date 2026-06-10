<?php
require_once __DIR__ . '/../../includes/bootstrap.php';
require_once __DIR__ . '/../../includes/parent_auth.php';
require_once __DIR__ . '/../../includes/i18n.php';
$titre_page = t('accueil');
require __DIR__ . '/../../includes/parent_layout_header.php';

$pid = (int) $_SESSION['parent_id'];
$stmt = $db->prepare('
    SELECT e.id, e.nom, e.prenom, e.identifiant,
           g.nom AS groupe, IFNULL(n.nom,"—") AS niveau,
           (SELECT COUNT(*) FROM absences a
              WHERE a.etudiant_id = e.id AND a.statut IN ("absent","retard")) AS abs,
           (SELECT ROUND(AVG(valeur),2) FROM notes no
              WHERE no.etudiant_id = e.id) AS moy
    FROM etudiants e
    JOIN groupes g ON e.groupe_id = g.id
    LEFT JOIN niveaux n ON g.niveau_id = n.id
    WHERE e.parent_id = :p
    ORDER BY e.nom');
$stmt->execute([':p' => $pid]);
$enfants = $stmt->fetchAll();

// Hour-aware greeting
$h = (int) date('G');
$_lg = function_exists('langue_courante') ? langue_courante() : 'fr';
if ($_lg === 'ar') {
    $salut = $h < 5 ? 'مساء الخير' : ($h < 12 ? 'صباح الخير' : ($h < 18 ? 'مرحباً' : 'مساء الخير'));
} else {
    $salut = $h < 5 ? 'Bonne nuit' : ($h < 12 ? 'Bonjour' : ($h < 18 ? 'Bon après-midi' : 'Bonsoir'));
}
?>

<h1 class="page-greeting"><?= e($salut) ?>, <span class="accent"><?= e($_SESSION['parent_nom']) ?></span> 👋</h1>
<p class="page-sub"><?= e(t(count($enfants) > 1 ? 'apercu_enfants' : 'apercu_enfant')) ?></p>

<?php if (!$enfants): ?>
    <div class="g-card empty-state">
        <svg class="empty-state-illus" viewBox="0 0 120 120" fill="none">
            <circle cx="60" cy="60" r="50" fill="#cffafe"/>
            <rect x="35" y="50" width="50" height="40" rx="4" fill="#67e8f9" stroke="#0e7490" stroke-width="2"/>
            <path d="M40 50 L40 40 Q40 35 45 35 L75 35 Q80 35 80 40 L80 50" stroke="#0e7490" stroke-width="2" fill="none"/>
            <line x1="45" y1="65" x2="75" y2="65" stroke="#0e7490" stroke-width="2" stroke-linecap="round"/>
            <line x1="45" y1="75" x2="65" y2="75" stroke="#0e7490" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <h3><?= e(t('aucun_enfant')) ?></h3>
        <p><?= e(t('contactez_etablissement')) ?></p>
    </div>
<?php else: ?>

<div class="child-grid">
    <?php foreach ($enfants as $i => $enf):
        $initiale = mb_strtoupper(mb_substr($enf['prenom'], 0, 1));
        $moy_aff = $enf['moy'] !== null ? rtrim(rtrim(number_format((float)$enf['moy'], 2, ',', ''), '0'), ',') : '—';
    ?>
    <article class="child-card" style="animation: slideIn <?= 400 + $i * 80 ?>ms var(--ease) backwards;cursor:pointer;" onclick="window.location.href='enfant.php?id=<?= e($enf['id']) ?>'">
        <div class="child-card-header">
            <div class="child-avatar-lg"><?= e($initiale) ?></div>
            <div>
                <h3 class="child-name"><?= e($enf['prenom'] . ' ' . $enf['nom']) ?></h3>
                <p class="child-class"><?= e($enf['niveau']) ?> · <?= e($enf['groupe']) ?></p>
            </div>
            <div style="margin-<?= est_rtl() ? 'right' : 'left' ?>:auto;color:var(--ocean-600);font-size:1.4rem;"><?= est_rtl() ? '‹' : '›' ?></div>
        </div>

        <div class="child-stats">
            <div class="stat-tile">
                <div class="stat-value"><?= e($moy_aff) ?><?= $enf['moy'] !== null ? '<span style="font-size:1rem;opacity:.6;">/20</span>' : '' ?></div>
                <div class="stat-label"><?= e(t('moyenne')) ?></div>
            </div>
            <div class="stat-tile">
                <div class="stat-value"><?= e($enf['abs']) ?></div>
                <div class="stat-label"><?= e(t('absences')) ?></div>
            </div>
        </div>
        <div style="margin-top:.75rem;text-align:center;font-size:.85rem;color:var(--ocean-700);font-weight:600;">
            👆 <?= e(function_exists('t') ? t('voir_details') : 'Voir détails') ?>
        </div>
    </article>
    <?php endforeach; ?>
</div>

<?php endif; ?>

<?php require __DIR__ . '/../../includes/parent_layout_footer.php'; ?>
