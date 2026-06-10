<?php
require_once __DIR__ . '/../../includes/bootstrap.php';
require_once __DIR__ . '/../../includes/parent_auth.php';
require_once __DIR__ . '/../../includes/i18n.php';
$titre_page = t('resultats');
require __DIR__ . '/../../includes/parent_layout_header.php';
$pid = (int) $_SESSION['parent_id'];
$rows = $db->prepare('
    SELECT e.prenom, e.nom, m.nom AS matiere, no.valeur, no.type_note, no.trimestre, no.date_saisie
    FROM notes no
    JOIN etudiants e ON no.etudiant_id = e.id
    JOIN enseignements en ON no.enseignement_id = en.id
    JOIN matieres m ON en.matiere_id = m.id
    WHERE e.parent_id = :p
    ORDER BY no.date_saisie DESC');
$rows->execute([':p'=>$pid]);
$rows = $rows->fetchAll();
?>
<h1 class="page-greeting">📊 <span class="accent"><?= e(t('resultats')) ?></span></h1>
<p class="page-sub"><?= est_rtl() ? 'جميع النقاط المسجلة من قبل الأساتذة، من الأحدث إلى الأقدم.' : 'Toutes les notes saisies par les enseignants, du plus récent au plus ancien.' ?></p>

<?php if (!$rows): ?>
    <div class="g-card empty-state">
        <svg class="empty-state-illus" viewBox="0 0 120 120" fill="none">
            <circle cx="60" cy="60" r="50" fill="#cffafe"/>
            <rect x="35" y="40" width="50" height="50" rx="3" fill="white" stroke="#0e7490" stroke-width="2"/>
            <line x1="45" y1="55" x2="75" y2="55" stroke="#67e8f9" stroke-width="3" stroke-linecap="round"/>
            <line x1="45" y1="65" x2="70" y2="65" stroke="#67e8f9" stroke-width="3" stroke-linecap="round"/>
            <line x1="45" y1="75" x2="65" y2="75" stroke="#67e8f9" stroke-width="3" stroke-linecap="round"/>
        </svg>
        <h3><?= e(t('aucune_note')) ?></h3>
        <p><?= est_rtl() ? 'ستظهر النقاط هنا فور إدخالها من قبل الأساتذة.' : 'Les notes apparaîtront ici dès que les enseignants en saisiront.' ?></p>
    </div>
<?php else: ?>
<div class="g-table-wrap">
    <table class="g-table">
        <thead><tr><th><?= est_rtl() ? 'التلميذ' : 'Élève' ?></th><th><?= e(t('matiere')) ?></th><th><?= e(t('note')) ?></th><th><?= e(t('type_note')) ?></th><th><?= e(t('trimestre')) ?></th><th><?= e(t('date')) ?></th></tr></thead>
        <tbody>
        <?php foreach ($rows as $r):
            $val = (float) $r['valeur'];
            $cls = $val >= 14 ? 'pill-success' : ($val >= 10 ? 'pill-info' : 'pill-danger');
            $type_traduit = match(strtolower($r['type_note'])) {
                'devoir' => t('devoir'), 'controle' => t('controle'),
                'contrôle' => t('controle'), 'examen' => t('examen'),
                default => ucfirst($r['type_note'])
            };
        ?>
            <tr>
                <td><strong><?= e($r['prenom'] . ' ' . $r['nom']) ?></strong></td>
                <td><?= e($r['matiere']) ?></td>
                <td><span class="pill <?= $cls ?>"><?= e(rtrim(rtrim(number_format($val, 2, ',', ''), '0'), ','))?>/20</span></td>
                <td><?= e($type_traduit) ?></td>
                <td>T<?= e($r['trimestre']) ?></td>
                <td><?= e(date('d/m/Y', strtotime($r['date_saisie']))) ?></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
<?php endif; ?>
<?php require __DIR__ . '/../../includes/parent_layout_footer.php'; ?>
