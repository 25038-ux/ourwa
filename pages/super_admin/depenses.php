<?php
/**
 * Super Admin — Dépenses Supplémentaires
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_finance_page();

$db = getDB();
$message = '';
$type_message = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();
    $action = $_POST['action'] ?? 'ajouter';

    if ($action === 'ajouter') {
        $montant = nettoyer_decimal($_POST['montant'] ?? 0) ?? 0;
        $description = nettoyer($_POST['description'] ?? '');

        if ($montant <= 0) {
            $message = 'Le montant doit être supérieur à 0.';
            $type_message = 'error';
        } elseif (empty($description)) {
            $message = 'La description est obligatoire.';
            $type_message = 'error';
        } else {
            $res = lire_lignes_paiement(true, $montant);
            if (!$res['ok']) {
                $message = $res['message'];
                $type_message = 'error';
            } else {
                try {
                    $db->beginTransaction();
                    $stmt = $db->prepare('INSERT INTO depenses (montant, description) VALUES (:m, :d)');
                    $stmt->execute([':m' => $montant, ':d' => $description]);
                    $did = (int) $db->lastInsertId();
                    enregistrer_lignes_paiement('depense', $did, $res['lignes'], 'sortant');
                    $db->commit();
                    journaliser($_SESSION['utilisateur_id'], "Dépense ajoutée : {$montant} MRU — {$description}");
                    $message = "Dépense de " . number_format($montant, 0, ',', ' ') . " MRU ajoutée avec succès.";
                    $type_message = 'success';
                    regenerer_csrf();
                } catch (Throwable $e) {
                    if ($db->inTransaction()) $db->rollBack();
                    $message = "Erreur lors de l'enregistrement de la dépense.";
                    $type_message = 'error';
                }
            }
        }
    } elseif ($action === 'supprimer') {
        $depense_id = nettoyer_entier($_POST['depense_id'] ?? 0);
        if ($depense_id) {
            $db->prepare("DELETE FROM paiement_lignes WHERE source_type='depense' AND source_id=:id")->execute([':id'=>$depense_id]);
            $db->prepare('DELETE FROM depenses WHERE id = :id')->execute([':id' => $depense_id]);
            $message = 'Dépense supprimée.';
            $type_message = 'success';
            regenerer_csrf();
        }
    }
}

$depenses = $db->query('SELECT * FROM depenses ORDER BY date_depense DESC')->fetchAll();
$total_depenses = $db->query('SELECT COALESCE(SUM(montant), 0) FROM depenses')->fetchColumn();

$titre_page = 'Dépenses supplémentaires';
$sous_titre = 'Enregistrer et suivre les dépenses exceptionnelles';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
    <div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<!-- KPI -->
<div class="kpi-grid" style="grid-template-columns:1fr;">
    <div class="kpi-card kpi-danger">
        <div class="kpi-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        </div>
        <p class="kpi-label">Total des dépenses supplémentaires</p>
        <p class="kpi-value"><?= e(number_format($total_depenses, 0, ',', ' ')) ?></p>
        <p class="kpi-detail">MRU</p>
    </div>
</div>

<!-- Add Depense Form -->
<div class="form-card">
    <h3>💸 Nouvelle dépense</h3>
    <form method="POST">
        <?= champ_csrf() ?>
        <input type="hidden" name="action" value="ajouter">
        <div class="form-row">
            <div class="form-group">
                <label for="montant">Montant (MRU) *</label>
                <input type="number" id="montant" name="montant" min="1" step="1" required placeholder="Ex: 5000">
            </div>
        </div>
        <div class="form-group">
            <label for="description">Description du paiement *</label>
            <textarea id="description" name="description" rows="3" required placeholder="Ex: Achat de fournitures scolaires, réparation climatisation..." style="width:100%;padding:.75rem 1rem;border:2px solid var(--border);border-radius:var(--radius);font-size:.9rem;font-family:inherit;resize:vertical;"></textarea>
        </div>
        <?= widget_moyens_paiement('sortant', 0, 'depmp') ?>
        <button type="submit" class="btn btn-primary" style="width:auto;margin-top:.75rem;">Enregistrer la dépense</button>
    </form>
</div>
<?= widget_moyens_paiement_js() ?>

<!-- Depenses List -->
<div class="table-container">
    <div class="table-header">
        <h3>Historique des dépenses</h3>
        <span class="badge badge-primary"><?= count($depenses) ?></span>
    </div>
    <div class="overflow-x">
        <table>
            <thead><tr><th>Date</th><th>Montant</th><th>Description</th><th>Moyen(s)</th><th>Action</th></tr></thead>
            <tbody>
                <?php foreach ($depenses as $d): ?>
                <tr>
                    <td><?= e($d['date_depense']) ?></td>
                    <td><strong style="color:var(--danger);"><?= e(number_format($d['montant'], 0, ',', ' ')) ?> MRU</strong></td>
                    <td><?= e($d['description']) ?></td>
                    <td><?= e(resume_moyens('depense', (int)$d['id'])) ?></td>
                    <td>
                        <form method="POST" style="display:inline;" onsubmit="return confirm('Supprimer cette dépense ?')">
                            <?= champ_csrf() ?>
                            <input type="hidden" name="action" value="supprimer">
                            <input type="hidden" name="depense_id" value="<?= e($d['id']) ?>">
                            <button type="submit" class="btn btn-sm btn-danger">Supprimer</button>
                        </form>
                    </td>
                </tr>
                <?php endforeach; ?>
                <?php if (empty($depenses)): ?>
                <tr><td colspan="5" class="text-center text-muted">Aucune dépense enregistrée.</td></tr>
                <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
