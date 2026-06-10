<?php
/**
 * Gérer l'absence : niveau -> groupe -> liste des étudiants -> présent/absent.
 * Toute absence est immédiatement notifiée au compte parent.
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_admin_ou_collecteur();
require_once __DIR__ . '/../../includes/parent_auth.php';

$db = getDB();
$message = '';
$type_message = '';

$niveaux = $db->query('SELECT id, nom FROM niveaux ORDER BY id')->fetchAll();

$niveau_id = nettoyer_entier($_GET['niveau_id'] ?? 0) ?? 0;
$groupe_id = nettoyer_entier($_GET['groupe_id'] ?? 0) ?? 0;
$date_abs  = nettoyer($_GET['date'] ?? date('Y-m-d'));
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date_abs)) { $date_abs = date('Y-m-d'); }

$groupes = [];
if ($niveau_id) {
    $stmt = $db->prepare('SELECT id, nom FROM groupes WHERE niveau_id = :n ORDER BY nom');
    $stmt->execute([':n' => $niveau_id]);
    $groupes = $stmt->fetchAll();
}

// Enregistrement de l'appel
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();
    $groupe_id = nettoyer_entier($_POST['groupe_id'] ?? 0);
    $date_abs  = nettoyer($_POST['date_abs'] ?? date('Y-m-d'));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date_abs)) { $date_abs = date('Y-m-d'); }
    $statuts = $_POST['statut'] ?? [];   // [etudiant_id => 'present'|'absent'|'retard']

    if ($groupe_id && is_array($statuts)) {
        $nb_abs = 0;
        foreach ($statuts as $eid => $st) {
            $eid = (int) $eid;
            $st  = in_array($st, ['present','absent','retard'], true) ? $st : 'present';

            // upsert
            $db->prepare('
                INSERT INTO absences (etudiant_id, enseignement_id, date_absence, statut, saisi_par)
                VALUES (:e, NULL, :d, :s, :u)
                ON DUPLICATE KEY UPDATE statut = :s2, date_saisie = NOW()')
               ->execute([
                   ':e'=>$eid, ':d'=>$date_abs, ':s'=>$st,
                   ':u'=>$_SESSION['utilisateur_id'] ?? null, ':s2'=>$st,
               ]);

            if ($st === 'absent' || $st === 'retard') {
                $info = $db->prepare('SELECT prenom, nom FROM etudiants WHERE id = :e');
                $info->execute([':e' => $eid]);
                $et = $info->fetch();
                if ($et) {
                    $libelle = $st === 'absent' ? 'absent(e)' : 'en retard';
                    notifier_parent_de_etudiant($eid, 'absence',
                        'Absence signalée',
                        "{$et['prenom']} {$et['nom']} a été marqué(e) {$libelle} le " . date('d/m/Y', strtotime($date_abs)) . '.');
                    $nb_abs++;
                }
            }
        }
        $message = "Appel enregistré. {$nb_abs} absence(s)/retard(s) signalé(s) aux parents.";
        $type_message = 'success';
    }
}

// Charger les étudiants du groupe + statut déjà saisi pour la date
$etudiants = [];
if ($groupe_id) {
    $stmt = $db->prepare('SELECT id, nom, prenom, identifiant FROM etudiants WHERE groupe_id = :g ORDER BY nom, prenom');
    $stmt->execute([':g' => $groupe_id]);
    $etudiants = $stmt->fetchAll();

    $stmt = $db->prepare('SELECT etudiant_id, statut FROM absences WHERE date_absence = :d AND etudiant_id IN (SELECT id FROM etudiants WHERE groupe_id = :g)');
    $stmt->execute([':d' => $date_abs, ':g' => $groupe_id]);
    $deja = [];
    foreach ($stmt->fetchAll() as $r) { $deja[(int)$r['etudiant_id']] = $r['statut']; }
}

$titre_page = "Gérer l'absence";
$sous_titre = 'Appel par niveau et par groupe';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
<div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<form method="GET" class="form-card" style="display:flex;gap:1rem;align-items:flex-end;flex-wrap:wrap;margin-bottom:1.5rem;">
    <div class="form-group">
        <label>Niveau</label>
        <select name="niveau_id" onchange="this.form.submit()">
            <option value="">— Choisir —</option>
            <?php foreach ($niveaux as $n): ?>
                <option value="<?= e($n['id']) ?>" <?= $n['id']==$niveau_id?'selected':'' ?>><?= e($n['nom']) ?></option>
            <?php endforeach; ?>
        </select>
    </div>
    <?php if ($groupes): ?>
    <div class="form-group">
        <label>Groupe</label>
        <select name="groupe_id" onchange="this.form.submit()">
            <option value="">— Choisir —</option>
            <?php foreach ($groupes as $g): ?>
                <option value="<?= e($g['id']) ?>" <?= $g['id']==$groupe_id?'selected':'' ?>><?= e($g['nom']) ?></option>
            <?php endforeach; ?>
        </select>
    </div>
    <?php endif; ?>
    <div class="form-group">
        <label>Date</label>
        <input type="date" name="date" value="<?= e($date_abs) ?>" onchange="this.form.submit()">
    </div>
</form>

<?php if ($groupe_id && $etudiants): ?>
<form method="POST" class="form-card">
    <?= csrf_field() ?>
    <input type="hidden" name="groupe_id" value="<?= e($groupe_id) ?>">
    <input type="hidden" name="date_abs" value="<?= e($date_abs) ?>">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <h3 style="margin:0;">Appel du <?= e(date('d/m/Y', strtotime($date_abs))) ?> — <?= count($etudiants) ?> étudiant(s)</h3>
        <div style="display:flex;gap:.5rem;">
            <button type="button" class="btn btn-sm btn-secondary" onclick="tous('present')">Tous présents</button>
            <button type="button" class="btn btn-sm btn-secondary" onclick="tous('absent')">Tous absents</button>
        </div>
    </div>
    <div class="table-responsive">
        <table class="data-table">
            <thead><tr><th>Étudiant</th><th>Matricule</th><th>Présent</th><th>Absent</th><th>Retard</th></tr></thead>
            <tbody>
                <?php foreach ($etudiants as $e):
                    $cur = $deja[(int)$e['id']] ?? 'present'; ?>
                <tr>
                    <td><strong><?= e($e['prenom'].' '.$e['nom']) ?></strong></td>
                    <td><?= e($e['identifiant']) ?></td>
                    <td style="text-align:center;"><input type="radio" name="statut[<?= e($e['id']) ?>]" value="present" <?= $cur=='present'?'checked':'' ?>></td>
                    <td style="text-align:center;"><input type="radio" name="statut[<?= e($e['id']) ?>]" value="absent" <?= $cur=='absent'?'checked':'' ?>></td>
                    <td style="text-align:center;"><input type="radio" name="statut[<?= e($e['id']) ?>]" value="retard" <?= $cur=='retard'?'checked':'' ?>></td>
                </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>
    <div style="margin-top:1.5rem;">
        <button class="btn btn-primary">💾 Enregistrer l'appel & notifier les parents</button>
    </div>
</form>
<script>
function tous(val){ document.querySelectorAll('input[type=radio][value="'+val+'"]').forEach(r=>r.checked=true); }
</script>
<?php elseif ($groupe_id): ?>
<div class="alert alert-info">Aucun étudiant dans ce groupe.</div>
<?php else: ?>
<div class="alert alert-info">Sélectionnez un niveau puis un groupe pour faire l'appel.</div>
<?php endif; ?>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
