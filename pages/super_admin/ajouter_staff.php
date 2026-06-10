<?php
/**
 * Super Admin — Ajouter Staff
 */
require_once __DIR__ . '/../../includes/bootstrap.php';

require_staff_admin();

$db = getDB();
$message = '';
$type_message = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();
    $action = $_POST['action'] ?? 'ajouter';
    
    if ($action === 'ajouter') {
        $nom = nettoyer($_POST['nom'] ?? '');
        $prenom = nettoyer($_POST['prenom'] ?? '');
        $sexe = ($_POST['sexe'] ?? '') === 'M' ? 'M' : (($_POST['sexe'] ?? '') === 'F' ? 'F' : null);
        $telephone = nettoyer_telephone($_POST['telephone'] ?? '');
        $fonction = nettoyer($_POST['fonction'] ?? '');
        $salaire = nettoyer_decimal($_POST['salaire'] ?? 0) ?? 0;
        $date_embauche = $_POST['date_embauche'] ?? date('Y-m-d');
        
        if (empty($nom) || empty($prenom) || empty($fonction)) {
            $message = 'Le nom, le prénom et la fonction sont obligatoires.';
            $type_message = 'error';
        } else {
            $stmt = $db->prepare('INSERT INTO staff (nom, prenom, sexe, telephone, fonction, salaire, date_embauche) VALUES (:nom, :prenom, :sexe, :tel, :fct, :sal, :date)');
            $stmt->execute([':nom' => $nom, ':prenom' => $prenom, ':sexe' => $sexe, ':tel' => $telephone, ':fct' => $fonction, ':sal' => $salaire, ':date' => $date_embauche]);
            journaliser($_SESSION['utilisateur_id'], "Ajout staff : {$prenom} {$nom}");
            $message = "Personnel \"{$prenom} {$nom}\" ajouté avec succès !";
            $type_message = 'success';
            regenerer_csrf();
        }
    } elseif ($action === 'supprimer') {
        $staff_id = nettoyer_entier($_POST['staff_id'] ?? 0);
        if ($staff_id) {
            $db->prepare('DELETE FROM staff WHERE id = :id')->execute([':id' => $staff_id]);
            $message = 'Personnel supprimé.';
            $type_message = 'success';
            regenerer_csrf();
        }
    }
}

$staff_list = $db->query('SELECT * FROM staff ORDER BY actif DESC, nom ASC')->fetchAll();

$titre_page = 'Ajouter Staff';
$sous_titre = 'Gérer le personnel non-enseignant';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
    <div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<div class="form-card">
    <h3>Nouveau personnel</h3>
    <form method="POST">
        <?= champ_csrf() ?>
        <input type="hidden" name="action" value="ajouter">
        <div class="form-row">
            <div class="form-group">
                <label for="prenom">Prénom *</label>
                <input type="text" id="prenom" name="prenom" required>
            </div>
            <div class="form-group">
                <label for="nom">Nom *</label>
                <input type="text" id="nom" name="nom" required>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label for="fonction">Fonction *</label>
                <input type="text" id="fonction" name="fonction" placeholder="Agent de nettoyage, Gardien..." required>
            </div>
            <div class="form-group">
                <label for="sexe">Sexe</label>
                <select id="sexe" name="sexe">
                    <option value="">— Choisir —</option>
                    <option value="M">Masculin</option>
                    <option value="F">Féminin</option>
                </select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label for="telephone">Téléphone</label>
                <input type="text" id="telephone" name="telephone" placeholder="+222 XX XX XX XX">
            </div>
            <div class="form-group"></div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label for="salaire">Salaire mensuel (MRU) *</label>
                <input type="number" id="salaire" name="salaire" step="0.01" min="0" required>
            </div>
            <div class="form-group">
                <label for="date_embauche">Date d'embauche *</label>
                <input type="date" id="date_embauche" name="date_embauche" value="<?= date('Y-m-d') ?>" required>
            </div>
        </div>
        <button type="submit" class="btn btn-primary" style="width:auto;">Ajouter</button>
    </form>
</div>

<div class="table-container">
    <div class="table-header"><h3>Personnel existant</h3><span class="badge badge-primary"><?= count($staff_list) ?></span></div>
    <div class="overflow-x">
        <table>
            <thead><tr><th>Nom</th><th>Fonction</th><th>Tél</th><th>Salaire</th><th>Embauche</th><th>Statut</th><th>Actions</th></tr></thead>
            <tbody>
                <?php if (empty($staff_list)): ?>
                    <tr><td colspan="7" class="text-center text-muted" style="padding:2rem;">Aucun personnel.</td></tr>
                <?php else: ?>
                    <?php foreach ($staff_list as $s): ?>
                    <tr style="<?= !$s['actif'] ? 'opacity:.5;' : '' ?>">
                        <td><strong><?= e($s['prenom'] . ' ' . $s['nom']) ?></strong></td>
                        <td><?= e($s['fonction']) ?></td>
                        <td><?= e($s['telephone']) ?></td>
                        <td><?= e(number_format($s['salaire'], 0, ',', ' ')) ?> MRU</td>
                        <td><?= e($s['date_embauche']) ?></td>
                        <td><span class="badge <?= $s['actif'] ? 'badge-success' : 'badge-danger' ?>"><?= $s['actif'] ? 'Actif' : 'Inactif' ?></span></td>
                        <td>
                            <form method="POST" style="display:inline;" onsubmit="return confirm('Supprimer ?')">
                                <?= champ_csrf() ?>
                                <input type="hidden" name="action" value="supprimer">
                                <input type="hidden" name="staff_id" value="<?= e($s['id']) ?>">
                                <button type="submit" class="btn btn-sm btn-danger">Supprimer</button>
                            </form>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
