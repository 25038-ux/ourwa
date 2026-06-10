<?php
require_once __DIR__ . '/../../includes/bootstrap.php';
require_once __DIR__ . '/../../includes/parent_auth.php';
require_once __DIR__ . '/../../includes/upload.php';
require_once __DIR__ . '/../../includes/i18n.php';
$titre_page = t('exercices');
require __DIR__ . '/../../includes/parent_layout_header.php';
$pid = (int) $_SESSION['parent_id'];

$rows = $db->prepare('
    SELECT DISTINCT x.id, x.titre, x.description, x.date_limite, x.date_envoi,
                    x.pieces_jointes, m.nom AS matiere, g.nom AS groupe
    FROM exercices x
    JOIN enseignements en ON x.enseignement_id = en.id
    JOIN matieres m ON en.matiere_id = m.id
    JOIN groupes g ON en.groupe_id = g.id
    JOIN etudiants e ON e.groupe_id = g.id
    WHERE e.parent_id = :p
    ORDER BY x.date_envoi DESC');
$rows->execute([':p'=>$pid]);
$rows = $rows->fetchAll();
?>
<h1 class="page-greeting">📚 <span class="accent"><?= e(t('exercices')) ?></span></h1>
<p class="page-sub"><?= est_rtl() ? 'جميع التمارين الموكلة من قبل الأساتذة.' : 'Tous les devoirs et exercices donnés par les enseignants.' ?></p>

<?php if (!$rows): ?>
    <div class="g-card empty-state">
        <svg class="empty-state-illus" viewBox="0 0 120 120" fill="none">
            <circle cx="60" cy="60" r="50" fill="#cffafe"/>
            <rect x="38" y="40" width="44" height="55" rx="3" fill="white" stroke="#0e7490" stroke-width="2"/>
            <line x1="46" y1="55" x2="74" y2="55" stroke="#67e8f9" stroke-width="2.5" stroke-linecap="round"/>
            <line x1="46" y1="65" x2="74" y2="65" stroke="#67e8f9" stroke-width="2.5" stroke-linecap="round"/>
            <line x1="46" y1="75" x2="66" y2="75" stroke="#67e8f9" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        <h3><?= e(t('aucun_exercice')) ?></h3>
        <p><?= est_rtl() ? 'ستظهر التمارين الجديدة هنا فور إرسالها.' : 'Les nouveaux exercices apparaîtront ici dès qu\'ils seront envoyés.' ?></p>
    </div>
<?php else: ?>
<div style="display:grid;gap:1.25rem;">
<?php foreach ($rows as $i => $r):
    $pj = !empty($r['pieces_jointes']) ? json_decode($r['pieces_jointes'], true) : [];
    if (!is_array($pj)) $pj = [];
    $depasse = $r['date_limite'] && strtotime($r['date_limite']) < strtotime(date('Y-m-d'));
?>
<article class="g-card">
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:.5rem;align-items:flex-start;margin-bottom:.6rem;">
        <div>
            <h3 style="margin:0;font-size:1.3rem;color:var(--ink-900);"><?= e($r['titre']) ?></h3>
            <p style="margin:.25rem 0 0;color:var(--ocean-700);font-size:.85rem;font-weight:600;">
                <?= e($r['matiere']) ?> · <?= e($r['groupe']) ?>
            </p>
        </div>
        <time style="font-size:.78rem;color:var(--ink-500);"><?= e(date('d/m/Y', strtotime($r['date_envoi']))) ?></time>
    </div>

    <p style="margin:.5rem 0;color:var(--ink-700);white-space:pre-line;line-height:1.55;"><?= e($r['description']) ?></p>

    <?php if (!empty($pj)): ?>
    <div class="attachment-grid">
        <?php foreach ($pj as $f):
            $url = e($base . $f['chemin_public']);
            $est_image = str_starts_with($f['mime'] ?? '', 'image/');
        ?>
            <?php if ($est_image): ?>
                <a class="attachment-card" href="<?= $url ?>" onclick="event.preventDefault();openLightbox('<?= $url ?>');" title="<?= e($f['nom']) ?>">
                    <img loading="lazy" src="<?= $url ?>" alt="<?= e($f['nom']) ?>">
                </a>
            <?php else: ?>
                <a class="attachment-card" href="<?= $url ?>" target="_blank" rel="noopener" title="<?= e($f['nom']) ?>">
                    <div class="attachment-pdf">
                        <?= icone_fichier($f['mime'] ?? '') ?>
                        <div class="name"><?= e($f['nom']) ?></div>
                    </div>
                </a>
            <?php endif; ?>
        <?php endforeach; ?>
    </div>
    <?php endif; ?>

    <?php if ($r['date_limite']): ?>
        <div style="margin-top:1rem;display:inline-flex;align-items:center;gap:.4rem;padding:.4rem .85rem;border-radius:var(--r-full);font-size:.82rem;font-weight:600;background:<?= $depasse ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)' ?>;color:<?= $depasse ? '#b91c1c' : '#b45309' ?>;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <?= $depasse ? (est_rtl() ? 'انقضى الأجل — ' : 'Date dépassée — ') : (est_rtl() ? 'تسليم قبل ' : 'À rendre avant le ') ?><?= e(date('d/m/Y', strtotime($r['date_limite']))) ?>
        </div>
    <?php endif; ?>
</article>
<?php endforeach; ?>
</div>
<?php endif; ?>
<?php require __DIR__ . '/../../includes/parent_layout_footer.php'; ?>
