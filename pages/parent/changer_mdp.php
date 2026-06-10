<?php
require_once __DIR__ . '/../../includes/bootstrap.php';
require_once __DIR__ . '/../../includes/parent_auth.php';
require_once __DIR__ . '/../../includes/i18n.php';
$titre_page = t('changer_mdp');
$message=''; $type_message='';
$premiere = isset($_GET['premiere']);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_parent();
    exiger_csrf();
    $actuel = (string)($_POST['actuel'] ?? '');
    $nouveau = (string)($_POST['nouveau'] ?? '');
    $confirm = (string)($_POST['confirm'] ?? '');
    $pid = (int) $_SESSION['parent_id'];
    $db = getDB();
    $st = $db->prepare('SELECT mot_de_passe FROM parents WHERE id = :id');
    $st->execute([':id'=>$pid]);
    $hash = $st->fetchColumn();

    if (!password_verify($actuel, $hash)) {
        $message=est_rtl() ? 'كلمة المرور الحالية غير صحيحة.' : 'Mot de passe actuel incorrect.'; $type_message='error';
    } elseif ($nouveau !== $confirm) {
        $message=est_rtl() ? 'التأكيد لا يتطابق.' : 'La confirmation ne correspond pas.'; $type_message='error';
    } elseif (($err = valider_mot_de_passe($nouveau)) !== '') {
        $message=$err; $type_message='error';
    } else {
        $db->prepare('UPDATE parents SET mot_de_passe=:h, doit_changer_mdp=FALSE WHERE id=:id')
           ->execute([':h'=>password_hash($nouveau, PASSWORD_ARGON2ID), ':id'=>$pid]);
        $message=t('mdp_change_succes'); $type_message='success';
        $premiere=false;
    }
}
require __DIR__ . '/../../includes/parent_layout_header.php';
?>
<h1 class="page-greeting">🔒 <span class="accent"><?= est_rtl() ? 'الأمان' : 'Sécurité' ?></span></h1>
<p class="page-sub"><?= est_rtl() ? 'غيّر كلمة المرور بانتظام لحماية حسابك.' : 'Changez régulièrement votre mot de passe pour protéger votre compte.' ?></p>

<?php if ($premiere): ?>
<div class="g-alert g-alert-info">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
    <span><?= e(t('changement_obligatoire')) ?></span>
</div>
<?php endif; ?>
<?php if ($message): ?>
<div class="g-alert g-alert-<?= e($type_message) ?>">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><?php
        echo $type_message === 'success'
            ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'
            : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
    ?></svg>
    <span><?= e($message) ?></span>
</div>
<?php endif; ?>

<div class="g-card" style="max-width:480px;">
    <form method="POST" class="g-form">
        <?= csrf_field() ?>
        <div class="g-field"><label><?= e(t('mdp_actuel')) ?></label><input type="password" name="actuel" required autocomplete="current-password"></div>
        <div class="g-field"><label><?= e(t('nouveau_mdp')) ?></label><input type="password" name="nouveau" required autocomplete="new-password"></div>
        <div class="g-field"><label><?= e(t('confirmer_mdp')) ?></label><input type="password" name="confirm" required autocomplete="new-password"></div>
        <small style="color:var(--ink-500);font-size:.82rem;"><?= est_rtl() ? '٨ أحرف على الأقل، ٣ أنواع (حرف كبير، صغير، رقم، رمز).' : '≥ 8 caractères, au moins 3 types (majuscule, minuscule, chiffre, symbole).' ?></small>
        <button type="submit" class="g-btn g-btn-primary" style="margin-top:.5rem;"><?= e(t('enregistrer')) ?></button>
    </form>
</div>
<?php require __DIR__ . '/../../includes/parent_layout_footer.php'; ?>
