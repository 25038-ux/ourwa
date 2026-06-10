<?php
/**
 * Professeur — laisser une remarque sur le comportement d'un élève.
 * La remarque arrive immédiatement dans le compte parent.
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_role('professeur');
require_once __DIR__ . '/../../includes/parent_auth.php';

$db = getDB();
$message = '';
$type_message = '';

$stmt = $db->prepare('SELECT id, nom, prenom FROM professeurs WHERE utilisateur_id = :uid');
$stmt->execute([':uid' => $_SESSION['utilisateur_id']]);
$prof = $stmt->fetch();
if (!$prof) { die('Profil professeur introuvable.'); }
$prof_id = $prof['id'];

// Élèves accessibles = élèves des groupes que le prof enseigne
$stmt = $db->prepare('
    SELECT DISTINCT et.id, et.nom, et.prenom, g.nom AS groupe
    FROM etudiants et
    JOIN groupes g ON et.groupe_id = g.id
    JOIN enseignements e ON e.groupe_id = g.id
    WHERE e.professeur_id = :p
    ORDER BY g.nom, et.nom');
$stmt->execute([':p' => $prof_id]);
$eleves = $stmt->fetchAll();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();
    $eid     = nettoyer_entier($_POST['etudiant_id'] ?? 0);
    $contenu = trim((string) ($_POST['contenu'] ?? ''));
    $gravite = $_POST['gravite'] ?? 'info';
    if (!in_array($gravite, ['info','positif','avertissement','grave'], true)) $gravite = 'info';

    // Anti-IDOR : l'élève doit faire partie d'un groupe enseigné par ce prof
    $chk = $db->prepare('
        SELECT COUNT(*) FROM etudiants et
        JOIN enseignements e ON e.groupe_id = et.groupe_id
        WHERE et.id = :e AND e.professeur_id = :p');
    $chk->execute([':e'=>$eid, ':p'=>$prof_id]);

    if (!$chk->fetchColumn()) {
        $message = 'Élève non autorisé.';
        $type_message = 'error';
    } elseif ($contenu === '') {
        $message = 'La remarque ne peut pas être vide.';
        $type_message = 'error';
    } else {
        $auteur = $prof['prenom'] . ' ' . $prof['nom'];
        $db->prepare('INSERT INTO remarques (etudiant_id, auteur_type, auteur_id, auteur_nom, contenu, gravite)
                      VALUES (:e,"professeur",:a,:an,:c,:g)')
           ->execute([':e'=>$eid, ':a'=>$prof_id, ':an'=>$auteur, ':c'=>$contenu, ':g'=>$gravite]);

        $info = $db->prepare('SELECT prenom, nom FROM etudiants WHERE id = :e');
        $info->execute([':e' => $eid]);
        $et = $info->fetch();
        notifier_parent_de_etudiant($eid, 'remarque',
            'Remarque de ' . $auteur,
            "Concernant {$et['prenom']} {$et['nom']} : " . $contenu);

        $message = 'Remarque enregistrée et envoyée au parent.';
        $type_message = 'success';
    }
}

$titre_page = 'Remarques élèves';
$sous_titre = 'Communiquer une remarque au parent';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
<div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<?php if (!$eleves): ?>
<div class="alert alert-info">Aucun élève accessible (vous n'avez pas encore d'enseignement assigné).</div>
<?php else: ?>
<form method="POST" class="form-card" style="max-width:680px;">
    <?= csrf_field() ?>
    <div class="form-group">
        <label>Élève *</label>
        <select name="etudiant_id" required>
            <option value="">— Choisir —</option>
            <?php foreach ($eleves as $el): ?>
                <option value="<?= e($el['id']) ?>"><?= e($el['prenom'].' '.$el['nom'].' ('.$el['groupe'].')') ?></option>
            <?php endforeach; ?>
        </select>
    </div>
    <div class="form-group">
        <label>Type de remarque</label>
        <select name="gravite">
            <option value="info">Information</option>
            <option value="positif">Positif / félicitations</option>
            <option value="avertissement">Avertissement</option>
            <option value="grave">Grave</option>
        </select>
    </div>
    <div class="form-group"><label>Remarque *</label><textarea name="contenu" rows="5" required></textarea></div>
    <button class="btn btn-primary">📝 Envoyer la remarque</button>
</form>
<?php endif; ?>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
