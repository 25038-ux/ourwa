<?php
require_once __DIR__ . '/../../includes/bootstrap.php';
require_once __DIR__ . '/../../includes/parent_auth.php';
require_once __DIR__ . '/../../includes/i18n.php';
$titre_page = t('messages');
require __DIR__ . '/../../includes/parent_layout_header.php';
$pid = (int) $_SESSION['parent_id'];
$db->prepare('UPDATE messages SET lu = TRUE WHERE parent_id = :p')->execute([':p'=>$pid]);
$rows = $db->prepare('SELECT expediteur, sujet, contenu, date_envoi FROM messages WHERE parent_id = :p ORDER BY date_envoi DESC');
$rows->execute([':p'=>$pid]);
$rows = $rows->fetchAll();
?>
<h1 class="page-greeting">✉️ <span class="accent"><?= e(t('messages')) ?></span></h1>
<p class="page-sub"><?= est_rtl() ? 'جميع الرسائل المرسلة من قبل المدرسة.' : 'Tous les messages envoyés par l\'établissement.' ?></p>

<?php if (!$rows): ?>
    <div class="g-card empty-state">
        <svg class="empty-state-illus" viewBox="0 0 120 120" fill="none">
            <circle cx="60" cy="60" r="50" fill="#cffafe"/>
            <rect x="35" y="48" width="50" height="36" rx="3" fill="white" stroke="#0e7490" stroke-width="2"/>
            <path d="M35 52 L60 70 L85 52" stroke="#0e7490" stroke-width="2" fill="none"/>
        </svg>
        <h3><?= e(t('aucun_message')) ?></h3>
        <p><?= est_rtl() ? 'لم تستلم أي رسالة بعد.' : 'Vous n\'avez reçu aucun message pour le moment.' ?></p>
    </div>
<?php else: ?>
<div style="display:grid;gap:1rem;">
<?php foreach ($rows as $i => $r): ?>
<div class="g-card">
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:.5rem;align-items:flex-start;margin-bottom:.7rem;">
        <strong style="font-size:1.15rem;color:var(--ink-900);"><?= e($r['sujet']) ?></strong>
        <time style="font-size:.78rem;color:var(--ink-500);"><?= e(date('d/m/Y H:i', strtotime($r['date_envoi']))) ?></time>
    </div>
    <p style="margin:0 0 .7rem;color:var(--ink-700);white-space:pre-line;line-height:1.6;"><?= e($r['contenu']) ?></p>
    <small style="color:var(--ink-500);">— <?= e($r['expediteur']) ?></small>
</div>
<?php endforeach; ?>
</div>
<?php endif; ?>
<?php require __DIR__ . '/../../includes/parent_layout_footer.php'; ?>
