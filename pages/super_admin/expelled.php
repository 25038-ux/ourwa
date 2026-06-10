<?php
/**
 * Liste des étudiants expulsés (NNI + RIM bloqués) avec option de débloquer.
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_staff_admin();

$db = getDB();
$message = '';
$type_message = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'debloquer') {
    exiger_csrf();
    $id = nettoyer_entier($_POST['id'] ?? 0) ?? 0;
    if ($id) {
        $st = $db->prepare('SELECT nni, rim, prenom, nom FROM expulsions WHERE id = :i');
        $st->execute([':i' => $id]);
        $row = $st->fetch();
        if ($row) {
            $db->prepare('DELETE FROM expulsions WHERE id = :i')->execute([':i' => $id]);
            journaliser($_SESSION['utilisateur_id'] ?? 0, "Déblocage NNI {$row['nni']} / RIM {$row['rim']} ({$row['prenom']} {$row['nom']})");
            $message = "« {$row['prenom']} {$row['nom']} » débloqué(e). L'inscription est de nouveau possible.";
            $type_message = 'success';
            regenerer_csrf();
        }
    }
}

$q = trim((string) ($_GET['q'] ?? ''));
$where  = '';
$params = [];
if ($q !== '') {
    // Placeholders distincts car PDO::ATTR_EMULATE_PREPARES = false interdit la réutilisation
    $where = ' WHERE nom LIKE :q1 OR prenom LIKE :q2 OR nni LIKE :q3 OR rim LIKE :q4';
    $p = '%' . $q . '%';
    $params = [':q1' => $p, ':q2' => $p, ':q3' => $p, ':q4' => $p];
}

$ct = $db->prepare("SELECT COUNT(*) FROM expulsions $where");
$ct->execute($params);
$total = (int) $ct->fetchColumn();
$pg = paginer($_GET['page'] ?? 1, $total, 25);

$sql = "SELECT * FROM expulsions $where ORDER BY date_expulsion DESC LIMIT {$pg['limit']} OFFSET {$pg['offset']}";
$stmt = $db->prepare($sql);
$stmt->execute($params);
$expulses = $stmt->fetchAll();

$titre_page = 'Liste des Expelled';
$sous_titre = 'Étudiants exclus — NNI + RIM bloqués';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
    <div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<div class="form-card" style="margin-bottom:1.5rem;">
    <form method="GET" style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap;">
        <div class="form-group" style="flex:1;min-width:240px;margin-bottom:0;">
            <label for="q">🔍 Rechercher par nom, NNI ou RIM</label>
            <input type="text" id="q" name="q" value="<?= e($q) ?>" placeholder="Ex : Ahmed, ou un NNI" autofocus>
        </div>
        <button class="btn btn-primary" style="width:auto;">Rechercher</button>
        <?php if ($q !== ''): ?>
            <a href="expelled.php" class="btn btn-secondary">Réinitialiser</a>
        <?php endif; ?>
    </form>
</div>

<div class="table-container">
    <div class="table-header">
        <h3>🚫 Étudiants expulsés</h3>
        <span class="badge badge-danger"><?= count($expulses) ?></span>
    </div>
    <div class="overflow-x">
        <table>
            <thead>
                <tr>
                    <th>Étudiant</th><th>NNI</th><th>RIM</th><th>Motif</th><th>Date</th><th>Action</th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ($expulses as $ex): ?>
                <tr>
                    <td><strong><?= e($ex['prenom'] . ' ' . $ex['nom']) ?></strong></td>
                    <td><code><?= e($ex['nni']) ?></code></td>
                    <td><code><?= e($ex['rim']) ?></code></td>
                    <td><?= e($ex['motif'] ?: '—') ?></td>
                    <td><small><?= e(date('d/m/Y H:i', strtotime($ex['date_expulsion']))) ?></small></td>
                    <td>
                        <form method="POST" style="display:inline;" onsubmit="return confirm('Débloquer cet étudiant ? Il pourra à nouveau être inscrit.');">
                            <?= champ_csrf() ?>
                            <input type="hidden" name="action" value="debloquer">
                            <input type="hidden" name="id" value="<?= e($ex['id']) ?>">
                            <button class="btn btn-sm btn-success" type="submit">✓ Débloquer</button>
                        </form>
                    </td>
                </tr>
                <?php endforeach; ?>
                <?php if (empty($expulses)): ?>
                <tr><td colspan="6" class="text-center text-muted">Aucun étudiant expulsé.</td></tr>
                <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>

<?php afficher_pagination($pg, $_GET); ?>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
