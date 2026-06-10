<?php
require_once __DIR__ . '/../../includes/bootstrap.php';
require_once __DIR__ . '/../../includes/parent_auth.php';
require_once __DIR__ . '/../../includes/i18n.php';
$titre_page = t('absences');
require __DIR__ . '/../../includes/parent_layout_header.php';
$pid = (int) $_SESSION['parent_id'];
$rows = $db->prepare('
    SELECT e.prenom, e.nom, a.date_absence, a.statut, a.justifiee
    FROM absences a JOIN etudiants e ON a.etudiant_id = e.id
    WHERE e.parent_id = :p AND a.statut IN("absent","retard")
    ORDER BY a.date_absence DESC');
$rows->execute([':p'=>$pid]);
$rows = $rows->fetchAll();
?>
<h1 class="page-greeting">📅 <span class="accent"><?= e(t('absences')) ?></span></h1>
<p class="page-sub"><?= e(t('historique_absences')) ?></p>

<?php if (!$rows): ?>
    <div class="g-card empty-state">
        <svg class="empty-state-illus" viewBox="0 0 120 120" fill="none">
            <circle cx="60" cy="60" r="50" fill="#d1fae5"/>
            <path d="M42 60 L55 73 L80 48" stroke="#10b981" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
        <h3><?= est_rtl() ? 'ممتاز ! 🎉' : 'Parfait ! 🎉' ?></h3>
        <p><?= e(t('aucune_absence')) ?></p>
    </div>
<?php else: ?>
<div class="g-table-wrap">
    <table class="g-table">
        <thead><tr><th><?= e(est_rtl() ? 'التلميذ' : 'Élève') ?></th><th><?= e(t('date')) ?></th><th><?= est_rtl() ? 'الحالة' : 'Statut' ?></th><th><?= est_rtl() ? 'مبرر' : 'Justifiée' ?></th></tr></thead>
        <tbody>
        <?php foreach ($rows as $r): ?>
            <tr>
                <td data-label="<?= est_rtl() ? 'التلميذ' : 'Élève' ?>"><strong><?= e($r['prenom'] . ' ' . $r['nom']) ?></strong></td>
                <td data-label="<?= e(t('date')) ?>"><?= e(date('d/m/Y', strtotime($r['date_absence']))) ?></td>
                <td data-label="<?= est_rtl() ? 'الحالة' : 'Statut' ?>">
                    <?php if ($r['statut'] === 'absent'): ?>
                        <span class="pill pill-danger"><?= est_rtl() ? 'غائب' : 'Absent' ?></span>
                    <?php else: ?>
                        <span class="pill pill-warning"><?= est_rtl() ? 'متأخر' : 'Retard' ?></span>
                    <?php endif; ?>
                </td>
                <td data-label="<?= est_rtl() ? 'مبرر' : 'Justifiée' ?>"><?= $r['justifiee'] ? '✓ '.t('oui') : '— '.t('non') ?></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
<?php endif; ?>
<?php require __DIR__ . '/../../includes/parent_layout_footer.php'; ?>
