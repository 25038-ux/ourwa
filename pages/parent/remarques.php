<?php
require_once __DIR__ . '/../../includes/bootstrap.php';
require_once __DIR__ . '/../../includes/parent_auth.php';
require_once __DIR__ . '/../../includes/i18n.php';
$titre_page = t('remarques');
require __DIR__ . '/../../includes/parent_layout_header.php';
$pid = (int) $_SESSION['parent_id'];
$rows = $db->prepare('
    SELECT e.prenom, e.nom, r.contenu, r.gravite, r.auteur_nom, r.date_creation
    FROM remarques r JOIN etudiants e ON r.etudiant_id = e.id
    WHERE e.parent_id = :p ORDER BY r.date_creation DESC');
$rows->execute([':p'=>$pid]);
$rows = $rows->fetchAll();
$couleurs_pill = ['info'=>'pill-info','positif'=>'pill-success','avertissement'=>'pill-warning','grave'=>'pill-danger'];
$couleurs_bar  = ['info'=>'var(--ocean-500)','positif'=>'var(--success)','avertissement'=>'var(--warning)','grave'=>'var(--danger)'];
$libelles = est_rtl()
    ? ['info'=>'معلومة','positif'=>'تهنئة','avertissement'=>'تحذير','grave'=>'خطير']
    : ['info'=>'Information','positif'=>'Félicitations','avertissement'=>'Avertissement','grave'=>'Grave'];
?>
<h1 class="page-greeting">💬 <span class="accent"><?= e(t('remarques')) ?></span></h1>
<p class="page-sub"><?= est_rtl() ? 'جميع التعليقات المتروكة من قبل الأساتذة.' : 'Tous les commentaires laissés par les professeurs.' ?></p>

<?php if (!$rows): ?>
    <div class="g-card empty-state">
        <svg class="empty-state-illus" viewBox="0 0 120 120" fill="none">
            <circle cx="60" cy="60" r="50" fill="#cffafe"/>
            <path d="M35 55 Q35 45 45 45 L75 45 Q85 45 85 55 L85 70 Q85 80 75 80 L60 80 L50 88 L50 80 L45 80 Q35 80 35 70 Z" fill="#67e8f9" stroke="#0e7490" stroke-width="2"/>
        </svg>
        <h3><?= e(t('aucune_remarque')) ?></h3>
        <p><?= est_rtl() ? 'ستظهر تعليقات الأساتذة هنا.' : 'Les commentaires des enseignants apparaîtront ici.' ?></p>
    </div>
<?php else: ?>
<div style="display:grid;gap:1rem;">
<?php foreach ($rows as $i => $r):
    $g = $r['gravite']; ?>
<div class="g-card" style="border-left:4px solid <?= $couleurs_bar[$g] ?? 'var(--ocean-500)' ?>;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;margin-bottom:.6rem;">
        <div>
            <strong style="font-size:1.1rem;"><?= e($r['prenom'] . ' ' . $r['nom']) ?></strong>
            <span class="pill <?= $couleurs_pill[$g] ?? 'pill-info' ?>" style="margin-<?= est_rtl() ? 'right' : 'left' ?>:.5rem;"><?= e($libelles[$g] ?? $g) ?></span>
        </div>
        <time style="font-size:.78rem;color:var(--ink-500);"><?= e(date('d/m/Y H:i', strtotime($r['date_creation']))) ?></time>
    </div>
    <p style="margin:0 0 .5rem;color:var(--ink-700);white-space:pre-line;line-height:1.55;"><?= e($r['contenu']) ?></p>
    <small style="color:var(--ink-500);">— <?= e($r['auteur_nom']) ?></small>
</div>
<?php endforeach; ?>
</div>
<?php endif; ?>
<?php require __DIR__ . '/../../includes/parent_layout_footer.php'; ?>
