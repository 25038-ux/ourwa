<?php
/**
 * Super Admin — Gestion des Groupes (vue hiérarchique Niveau → Groupes → Étudiants)
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_staff_admin();

$db = getDB();
$message = '';
$type_message = '';

// POST: Delete group or student
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();
    $action = $_POST['action'] ?? '';

    if ($action === 'supprimer_groupe') {
        $groupe_id = nettoyer_entier($_POST['groupe_id'] ?? 0);
        if ($groupe_id) {
            try {
                $db->beginTransaction();
                $db->prepare('DELETE FROM notes WHERE etudiant_id IN (SELECT id FROM etudiants WHERE groupe_id = :g)')->execute([':g' => $groupe_id]);
                $db->prepare('DELETE FROM paiements WHERE etudiant_id IN (SELECT id FROM etudiants WHERE groupe_id = :g)')->execute([':g' => $groupe_id]);
                $db->prepare('DELETE FROM etudiants WHERE groupe_id = :g')->execute([':g' => $groupe_id]);
                $db->prepare('DELETE FROM enseignements WHERE groupe_id = :g')->execute([':g' => $groupe_id]);
                $db->prepare('DELETE FROM groupes WHERE id = :g')->execute([':g' => $groupe_id]);
                $db->commit();
                $message = 'Groupe supprimé avec succès.';
                $type_message = 'success';
            } catch (Throwable $ex) {
                if ($db->inTransaction()) $db->rollBack();
                $message = 'Erreur : ' . $ex->getMessage();
                $type_message = 'error';
            }
            regenerer_csrf();
        }
    }

    elseif ($action === 'supprimer_etudiant') {
        $etudiant_id = nettoyer_entier($_POST['etudiant_id'] ?? 0);
        if ($etudiant_id) {
            try {
                $db->beginTransaction();
                $db->prepare('DELETE FROM notes WHERE etudiant_id = :e')->execute([':e' => $etudiant_id]);
                $db->prepare('DELETE FROM paiements WHERE etudiant_id = :e')->execute([':e' => $etudiant_id]);
                $db->prepare('DELETE FROM etudiants WHERE id = :e')->execute([':e' => $etudiant_id]);
                $db->commit();
                $message = 'Étudiant supprimé.';
                $type_message = 'success';
            } catch (Throwable $ex) {
                if ($db->inTransaction()) $db->rollBack();
                $message = 'Erreur : ' . $ex->getMessage();
                $type_message = 'error';
            }
            regenerer_csrf();
        }
    }
}

// Navigation
$groupe_id = nettoyer_entier($_GET['groupe_id'] ?? 0) ?? 0;

// Load all niveaux with their groups
$niveaux = $db->query('
    SELECT n.*, COUNT(DISTINCT g.id) AS nb_groupes, COUNT(DISTINCT e.id) AS nb_etudiants
    FROM niveaux n
    LEFT JOIN groupes g ON g.niveau_id = n.id
    LEFT JOIN etudiants e ON e.groupe_id = g.id
    GROUP BY n.id ORDER BY n.nom
')->fetchAll();

$titre_page = 'Gestion de Groupes';
$sous_titre = 'Vue hiérarchique : Niveau → Groupes → Étudiants';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
    <div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<?php if ($groupe_id): ?>
<!-- ====== Student detail for a group ====== -->
<?php
$stmt = $db->prepare('SELECT g.*, n.nom AS niveau_nom, n.tarif_mensuel FROM groupes g LEFT JOIN niveaux n ON g.niveau_id = n.id WHERE g.id = :gid');
$stmt->execute([':gid' => $groupe_id]);
$groupe = $stmt->fetch();

$stmt = $db->prepare('SELECT * FROM etudiants WHERE groupe_id = :gid ORDER BY nom, prenom');
$stmt->execute([':gid' => $groupe_id]);
$etudiants = $stmt->fetchAll();
?>
<?php if ($groupe): ?>
<div style="margin-bottom:1rem;display:flex;gap:.5rem;flex-wrap:wrap;" class="no-print">
    <a href="gestion_groupes.php" class="btn btn-secondary">← Retour</a>
    <button type="button" onclick="window.print()" class="btn btn-primary">🖨️ Imprimer la liste</button>
</div>

<h2 style="color:var(--primary);">
    <span class="badge badge-primary"><?= e($groupe['niveau_nom'] ?? '—') ?></span>
    <?= e($groupe['nom']) ?>
</h2>
<p class="text-muted" style="margin-bottom:1.5rem;">
    Capacité : <?= e($groupe['capacite']) ?> · Tarif : <?= e(number_format($groupe['tarif_mensuel'] ?? 0, 0, ',', ' ')) ?> MRU/mois
</p>

<div class="print-header" style="display:none;">
    <h1 style="text-align:center;margin:0 0 .25rem;">El OURWA</h1>
    <h2 style="text-align:center;margin:0 0 1rem;color:#333;">Liste des étudiants — <?= e($groupe['niveau_nom']) ?> / <?= e($groupe['nom']) ?></h2>
    <p style="text-align:center;color:#666;font-size:.9rem;">Imprimé le <?= e(date('d/m/Y H:i')) ?></p>
</div>

<div class="table-container">
    <div class="table-header">
        <h3>Étudiants</h3>
        <span class="badge badge-primary"><?= count($etudiants) ?></span>
    </div>
    <div class="overflow-x">
        <table>
            <thead><tr><th>#</th><th>Matricule</th><th>Nom complet</th><th>Parent</th><th>Tél.</th><th>Inscrit le</th><th class="no-print">Action</th></tr></thead>
            <tbody>
                <?php foreach ($etudiants as $i => $et): ?>
                <tr>
                    <td><?= $i + 1 ?></td>
                    <td><strong><?= e($et['identifiant']) ?></strong></td>
                    <td><strong><?= e($et['prenom'] . ' ' . $et['nom']) ?></strong></td>
                    <td><?= e($et['nom_parent']) ?></td>
                    <td><?= e($et['telephone_parent']) ?></td>
                    <td><?= e($et['date_inscription']) ?></td>
                    <td class="no-print">
                        <form method="POST" style="display:inline;" onsubmit="return confirm('Supprimer cet étudiant ? Ses notes et paiements seront aussi supprimés.')">
                            <?= champ_csrf() ?>
                            <input type="hidden" name="action" value="supprimer_etudiant">
                            <input type="hidden" name="etudiant_id" value="<?= e($et['id']) ?>">
                            <button type="submit" class="btn btn-sm btn-danger">Supprimer</button>
                        </form>
                    </td>
                </tr>
                <?php endforeach; ?>
                <?php if (empty($etudiants)): ?>
                <tr><td colspan="7" class="text-center text-muted">Aucun étudiant dans ce groupe.</td></tr>
                <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>
<?php endif; ?>

<?php else: ?>
<!-- ====== Hierarchical view: Niveau → Groups ====== -->
<?php foreach ($niveaux as $n):
    $stmt = $db->prepare('
        SELECT g.*, COUNT(e.id) AS nb_etudiants
        FROM groupes g LEFT JOIN etudiants e ON e.groupe_id = g.id
        WHERE g.niveau_id = :nid GROUP BY g.id ORDER BY g.nom
    ');
    $stmt->execute([':nid' => $n['id']]);
    $groupes = $stmt->fetchAll();
?>
<div class="table-container" style="margin-bottom:1.5rem;">
    <div class="table-header">
        <h3>📚 <?= e($n['nom']) ?> <span style="font-weight:400;font-size:.85rem;color:var(--text-muted);">(<?= e(number_format($n['tarif_mensuel'], 0, ',', ' ')) ?> MRU/mois)</span></h3>
        <span class="badge badge-primary"><?= e($n['nb_etudiants']) ?> étudiant(s)</span>
    </div>
    <div class="overflow-x">
        <table>
            <thead><tr><th>Groupe</th><th>Capacité</th><th>Inscrits</th><th>Actions</th></tr></thead>
            <tbody>
                <?php foreach ($groupes as $g): ?>
                <tr>
                    <td><strong><?= e($g['nom']) ?></strong></td>
                    <td><?= e($g['capacite']) ?></td>
                    <td>
                        <span class="badge <?= $g['nb_etudiants'] > 0 ? 'badge-success' : 'badge-warning' ?>">
                            <?= e($g['nb_etudiants']) ?> / <?= e($g['capacite']) ?>
                        </span>
                    </td>
                    <td>
                        <div style="display:flex;gap:.5rem;">
                            <a href="gestion_groupes.php?groupe_id=<?= e($g['id']) ?>" class="btn btn-sm btn-secondary">Voir étudiants</a>
                            <?php if ($g['nb_etudiants'] == 0): ?>
                            <form method="POST" style="display:inline;" onsubmit="return confirm('Supprimer ce groupe ?')">
                                <?= champ_csrf() ?>
                                <input type="hidden" name="action" value="supprimer_groupe">
                                <input type="hidden" name="groupe_id" value="<?= e($g['id']) ?>">
                                <button type="submit" class="btn btn-sm btn-danger">Supprimer</button>
                            </form>
                            <?php endif; ?>
                        </div>
                    </td>
                </tr>
                <?php endforeach; ?>
                <?php if (empty($groupes)): ?>
                <tr><td colspan="4" class="text-center text-muted">Aucun groupe dans ce niveau.</td></tr>
                <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>
<?php endforeach; ?>

<?php if (empty($niveaux)): ?>
<div class="empty-state">
    <p>Aucun niveau créé. <a href="gerer_niveaux.php">Créer un niveau</a> pour commencer.</p>
</div>
<?php endif; ?>
<?php endif; ?>

<style>
@media print {
    body { background:#fff !important; }
    .sidebar, .topbar, .page-header, .no-print { display:none !important; }
    .main-content { margin:0 !important; padding:0 !important; }
    .print-header { display:block !important; }
    table { width:100% !important; border-collapse:collapse !important; }
    th, td { border:1px solid #999 !important; padding:.5rem !important; font-size:.85rem !important; }
    .badge { background:transparent !important; color:#000 !important; border:1px solid #000 !important; padding:1px 6px !important; }
}
</style>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
