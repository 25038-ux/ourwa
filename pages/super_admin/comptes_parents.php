<?php
/**
 * Gestion des comptes parents — voir identifiant (téléphone), réinitialiser le mot de passe
 * et modifier l'identifiant (téléphone) en cas de nécessité.
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_staff_admin();
require_once __DIR__ . '/../../includes/parent_auth.php';

$db = getDB();
$message = '';
$type_message = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();
    $action = $_POST['action'] ?? '';
    $pid    = nettoyer_entier($_POST['parent_id'] ?? 0) ?? 0;

    if ($pid > 0) {
        if ($action === 'changer_identifiant') {
            $nouveau_tel = nettoyer($_POST['nouveau_telephone'] ?? '');
            $tel_norm = normaliser_telephone($nouveau_tel);
            if ($tel_norm === '' || strlen($tel_norm) < 6) {
                $message = 'Numéro de téléphone invalide.';
                $type_message = 'error';
            } else {
                $chk = $db->prepare('SELECT id FROM parents WHERE id <> :id AND
                    REPLACE(REPLACE(REPLACE(REPLACE(telephone," ",""),"-",""),"(",""),")","") = :tn');
                $chk->execute([':id'=>$pid, ':tn'=>$tel_norm]);
                if ($chk->fetchColumn()) {
                    $message = 'Ce numéro est déjà utilisé par un autre parent.';
                    $type_message = 'error';
                } else {
                    $db->prepare('UPDATE parents SET telephone = :t WHERE id = :id')
                       ->execute([':t' => $nouveau_tel, ':id' => $pid]);
                    journaliser($_SESSION['utilisateur_id'] ?? 0, "Changement identifiant parent #{$pid} -> {$nouveau_tel}");
                    $message = "Identifiant (téléphone) mis à jour.";
                    $type_message = 'success';
                    regenerer_csrf();
                }
            }
        } elseif ($action === 'reset_mdp') {
            $nouveau_mdp = (string) ($_POST['nouveau_mdp'] ?? '');
            $err = valider_mot_de_passe($nouveau_mdp);
            if ($err !== '') {
                $message = $err;
                $type_message = 'error';
            } else {
                $hash = password_hash($nouveau_mdp, PASSWORD_ARGON2ID);
                $db->prepare('UPDATE parents SET mot_de_passe = :h, doit_changer_mdp = TRUE, tentatives_echec = 0, bloque_jusqua = NULL WHERE id = :id')
                   ->execute([':h' => $hash, ':id' => $pid]);
                journaliser($_SESSION['utilisateur_id'] ?? 0, "Reset mot de passe parent #{$pid}");
                $message = "Mot de passe réinitialisé. Le parent devra le changer à la prochaine connexion.";
                $type_message = 'success';
                regenerer_csrf();
            }
        } elseif ($action === 'toggle_actif') {
            $st = $db->prepare('SELECT actif FROM parents WHERE id = :id');
            $st->execute([':id' => $pid]);
            $cur = (int) $st->fetchColumn();
            $db->prepare('UPDATE parents SET actif = :a WHERE id = :id')
               ->execute([':a' => $cur ? 0 : 1, ':id' => $pid]);
            $message = $cur ? 'Compte désactivé.' : 'Compte réactivé.';
            $type_message = 'success';
            regenerer_csrf();
        }
    }
}

$q = trim((string) ($_GET['q'] ?? ''));
$params = [];
$where  = '';
if ($q !== '') {
    $where = 'WHERE p.nom_complet LIKE :q
              OR REPLACE(REPLACE(REPLACE(p.telephone," ",""),"-",""),"+","") LIKE :qt';
    $params[':q']  = '%' . $q . '%';
    $params[':qt'] = '%' . preg_replace('/[^\d]/', '', $q) . '%';
}
$sql = "
    SELECT p.id, p.nom_complet, p.telephone, p.actif, p.derniere_connexion,
           p.doit_changer_mdp, p.email,
           COUNT(e.id) AS nb_enfants
    FROM parents p
    LEFT JOIN etudiants e ON e.parent_id = p.id
    $where
    GROUP BY p.id, p.nom_complet, p.telephone, p.actif, p.derniere_connexion, p.doit_changer_mdp, p.email
    ORDER BY p.nom_complet";
$st = $db->prepare($sql);
$st->execute($params);
$parents = $st->fetchAll();

$titre_page = 'Comptes des parents';
$sous_titre = 'Identifiants et mots de passe des comptes parents';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
<div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<div class="form-card" style="margin-bottom:1.5rem;">
    <form method="GET" style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap;">
        <div style="flex:1;min-width:240px;">
            <label for="q">🔍 Rechercher un parent par identifiant (nom ou téléphone)</label>
            <input type="text" id="q" name="q" value="<?= e($q) ?>" placeholder="Ex : Mohamed, ou 22 12 34 56" autofocus>
        </div>
        <button class="btn btn-primary" style="width:auto;">Rechercher</button>
        <?php if ($q !== ''): ?>
            <a href="comptes_parents.php" class="btn btn-secondary">Réinitialiser</a>
        <?php endif; ?>
    </form>
</div>

<div class="table-container">
    <div class="table-header">
        <h3>👨‍👩‍👧 Comptes parents</h3>
        <span class="badge badge-primary"><?= count($parents) ?></span>
    </div>
    <div class="overflow-x">
        <table>
            <thead>
                <tr><th>Parent</th><th>Identifiant (téléphone)</th><th>Enfants</th><th>Statut</th><th>Dernière connexion</th><th>Actions</th></tr>
            </thead>
            <tbody>
                <?php foreach ($parents as $p): ?>
                <tr>
                    <td>
                        <strong><?= e($p['nom_complet']) ?></strong>
                        <?php if ($p['email']): ?><br><small class="text-muted"><?= e($p['email']) ?></small><?php endif; ?>
                    </td>
                    <td><code><?= e($p['telephone']) ?></code>
                        <?php if ($p['doit_changer_mdp']): ?>
                            <br><small style="color:var(--secondary);">⚠ Doit changer mdp</small>
                        <?php endif; ?>
                    </td>
                    <td><span class="badge badge-primary"><?= e($p['nb_enfants']) ?></span></td>
                    <td>
                        <?= $p['actif']
                            ? '<span style="color:var(--success);">● Actif</span>'
                            : '<span style="color:var(--error);">● Inactif</span>' ?>
                    </td>
                    <td><small><?= e($p['derniere_connexion'] ?? 'Jamais') ?></small></td>
                    <td>
                        <div style="display:flex;gap:.35rem;flex-wrap:wrap;">
                            <button class="btn btn-sm btn-secondary" onclick="ouvrirModale('mp-id-<?= e($p['id']) ?>')">✏ Identifiant</button>
                            <button class="btn btn-sm btn-secondary" onclick="ouvrirModale('mp-mdp-<?= e($p['id']) ?>')">🔑 Reset mdp</button>
                            <form method="POST" style="display:inline;" onsubmit="return confirm('<?= $p['actif']?'Désactiver':'Réactiver' ?> ce compte ?');">
                                <?= champ_csrf() ?>
                                <input type="hidden" name="action" value="toggle_actif">
                                <input type="hidden" name="parent_id" value="<?= e($p['id']) ?>">
                                <button class="btn btn-sm <?= $p['actif']?'btn-danger':'btn-success' ?>">
                                    <?= $p['actif']?'Désactiver':'Réactiver' ?>
                                </button>
                            </form>
                        </div>
                    </td>
                </tr>
                <?php endforeach; ?>
                <?php if (empty($parents)): ?>
                    <tr><td colspan="6" class="text-center text-muted">Aucun parent.</td></tr>
                <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>

<!-- Modales -->
<?php foreach ($parents as $p): ?>
<div class="modal-overlay" id="mp-id-<?= e($p['id']) ?>">
    <div class="modal" style="max-width:480px;">
        <div class="modal-header">
            <h3>Modifier l'identifiant — <?= e($p['nom_complet']) ?></h3>
            <button class="modal-close" onclick="fermerModale('mp-id-<?= e($p['id']) ?>')">&times;</button>
        </div>
        <form method="POST">
            <?= champ_csrf() ?>
            <input type="hidden" name="action" value="changer_identifiant">
            <input type="hidden" name="parent_id" value="<?= e($p['id']) ?>">
            <div class="form-group">
                <label>Identifiant actuel</label>
                <input type="text" value="<?= e($p['telephone']) ?>" disabled>
            </div>
            <div class="form-group">
                <label>Nouveau numéro de téléphone *</label>
                <input type="text" name="nouveau_telephone" required placeholder="+222 XX XX XX XX">
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" onclick="fermerModale('mp-id-<?= e($p['id']) ?>')">Annuler</button>
                <button type="submit" class="btn btn-primary">Enregistrer</button>
            </div>
        </form>
    </div>
</div>
<div class="modal-overlay" id="mp-mdp-<?= e($p['id']) ?>">
    <div class="modal" style="max-width:480px;">
        <div class="modal-header">
            <h3>Réinitialiser le mot de passe — <?= e($p['nom_complet']) ?></h3>
            <button class="modal-close" onclick="fermerModale('mp-mdp-<?= e($p['id']) ?>')">&times;</button>
        </div>
        <form method="POST">
            <?= champ_csrf() ?>
            <input type="hidden" name="action" value="reset_mdp">
            <input type="hidden" name="parent_id" value="<?= e($p['id']) ?>">
            <div class="form-group">
                <label>Nouveau mot de passe *</label>
                <input type="text" name="nouveau_mdp" required placeholder="Minimum 6 caractères, 3 types">
                <small class="text-muted">Le parent sera obligé de le changer à la prochaine connexion.</small>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" onclick="fermerModale('mp-mdp-<?= e($p['id']) ?>')">Annuler</button>
                <button type="submit" class="btn btn-primary">Réinitialiser</button>
            </div>
        </form>
    </div>
</div>
<?php endforeach; ?>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
