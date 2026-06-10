<?php
/**
 * Gestion des comptes professeurs — voir identifiant, réinitialiser le mdp,
 * modifier l'identifiant si nécessaire.
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_staff_admin();

$db = getDB();
$message = '';
$type_message = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();
    $action = $_POST['action'] ?? '';
    $uid    = nettoyer_entier($_POST['utilisateur_id'] ?? 0) ?? 0;

    if ($uid > 0) {
        if ($action === 'changer_identifiant') {
            $nouveau = nettoyer($_POST['nouveau_identifiant'] ?? '');
            if (!valider_identifiant($nouveau)) {
                $message = 'Identifiant invalide (3-100 caractères, lettres, chiffres, @, ., -, _).';
                $type_message = 'error';
            } else {
                $chk = $db->prepare('SELECT id FROM utilisateurs WHERE id <> :u AND identifiant = :i');
                $chk->execute([':u' => $uid, ':i' => $nouveau]);
                if ($chk->fetchColumn()) {
                    $message = 'Cet identifiant est déjà utilisé.';
                    $type_message = 'error';
                } else {
                    $db->prepare('UPDATE utilisateurs SET identifiant = :i WHERE id = :u')
                       ->execute([':i' => $nouveau, ':u' => $uid]);
                    journaliser($_SESSION['utilisateur_id'] ?? 0, "Changement identifiant prof user #{$uid} -> {$nouveau}");
                    $message = "Identifiant mis à jour.";
                    $type_message = 'success';
                    regenerer_csrf();
                }
            }
        } elseif ($action === 'reset_mdp') {
            $nouveau_mdp = (string) ($_POST['nouveau_mdp'] ?? '');
            if (strlen($nouveau_mdp) < 6) {
                $message = 'Le mot de passe doit contenir au moins 6 caractères.';
                $type_message = 'error';
            } else {
                $hash = password_hash($nouveau_mdp, PASSWORD_ARGON2ID);
                $db->prepare('UPDATE utilisateurs SET mot_de_passe = :h, tentatives_echec = 0, bloque_jusqua = NULL WHERE id = :u')
                   ->execute([':h' => $hash, ':u' => $uid]);
                journaliser($_SESSION['utilisateur_id'] ?? 0, "Reset mot de passe prof user #{$uid}");
                $message = "Mot de passe réinitialisé.";
                $type_message = 'success';
                regenerer_csrf();
            }
        } elseif ($action === 'toggle_actif') {
            $st = $db->prepare('SELECT actif FROM utilisateurs WHERE id = :u');
            $st->execute([':u' => $uid]);
            $cur = (int) $st->fetchColumn();
            $db->prepare('UPDATE utilisateurs SET actif = :a WHERE id = :u')
               ->execute([':a' => $cur ? 0 : 1, ':u' => $uid]);
            $message = $cur ? 'Compte désactivé.' : 'Compte réactivé.';
            $type_message = 'success';
            regenerer_csrf();
        }
    }
}

$q = trim((string) ($_GET['q'] ?? ''));
$params = [];
$where  = " WHERE u.role = 'professeur' ";
if ($q !== '') {
    $where .= " AND (u.identifiant LIKE :q OR p.nom LIKE :q OR p.prenom LIKE :q OR p.telephone LIKE :qt)";
    $params[':q']  = '%' . $q . '%';
    $params[':qt'] = '%' . preg_replace('/[^\d]/', '', $q) . '%';
}

$sql = "
    SELECT u.id AS uid, u.identifiant, u.actif, u.derniere_connexion,
           p.id AS pid, p.nom, p.prenom, p.telephone, p.nb_classes, p.salaire
    FROM utilisateurs u
    LEFT JOIN professeurs p ON p.utilisateur_id = u.id
    $where
    ORDER BY p.nom, p.prenom";
$st = $db->prepare($sql);
$st->execute($params);
$profs = $st->fetchAll();

$titre_page = 'Comptes des professeurs';
$sous_titre = 'Identifiants et mots de passe des comptes professeurs';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
<div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<div class="form-card" style="margin-bottom:1.5rem;">
    <form method="GET" style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap;">
        <div style="flex:1;min-width:240px;">
            <label for="q">🔍 Rechercher un professeur par identifiant ou nom</label>
            <input type="text" id="q" name="q" value="<?= e($q) ?>" placeholder="Ex : prof@supnum.mr ou Sass" autofocus>
        </div>
        <button class="btn btn-primary" style="width:auto;">Rechercher</button>
        <?php if ($q !== ''): ?>
            <a href="comptes_profs.php" class="btn btn-secondary">Réinitialiser</a>
        <?php endif; ?>
    </form>
</div>

<div class="table-container">
    <div class="table-header">
        <h3>🎓 Comptes professeurs</h3>
        <span class="badge badge-primary"><?= count($profs) ?></span>
    </div>
    <div class="overflow-x">
        <table>
            <thead>
                <tr><th>Professeur</th><th>Identifiant</th><th>Classes</th><th>Statut</th><th>Dernière connexion</th><th>Actions</th></tr>
            </thead>
            <tbody>
                <?php foreach ($profs as $p): ?>
                <tr>
                    <td><strong><?= e($p['prenom'] . ' ' . $p['nom']) ?></strong>
                        <?php if ($p['telephone']): ?><br><small class="text-muted"><?= e($p['telephone']) ?></small><?php endif; ?>
                    </td>
                    <td><code><?= e($p['identifiant']) ?></code></td>
                    <td><span class="badge badge-primary"><?= e($p['nb_classes'] ?? 0) ?></span></td>
                    <td><?= $p['actif']
                        ? '<span style="color:var(--success);">● Actif</span>'
                        : '<span style="color:var(--error);">● Inactif</span>' ?></td>
                    <td><small><?= e($p['derniere_connexion'] ?? 'Jamais') ?></small></td>
                    <td>
                        <div style="display:flex;gap:.35rem;flex-wrap:wrap;">
                            <button class="btn btn-sm btn-secondary" onclick="ouvrirModale('mt-id-<?= e($p['uid']) ?>')">✏ Identifiant</button>
                            <button class="btn btn-sm btn-secondary" onclick="ouvrirModale('mt-mdp-<?= e($p['uid']) ?>')">🔑 Reset mdp</button>
                            <form method="POST" style="display:inline;" onsubmit="return confirm('<?= $p['actif']?'Désactiver':'Réactiver' ?> ce compte ?');">
                                <?= champ_csrf() ?>
                                <input type="hidden" name="action" value="toggle_actif">
                                <input type="hidden" name="utilisateur_id" value="<?= e($p['uid']) ?>">
                                <button class="btn btn-sm <?= $p['actif']?'btn-danger':'btn-success' ?>">
                                    <?= $p['actif']?'Désactiver':'Réactiver' ?>
                                </button>
                            </form>
                        </div>
                    </td>
                </tr>
                <?php endforeach; ?>
                <?php if (empty($profs)): ?>
                    <tr><td colspan="6" class="text-center text-muted">Aucun professeur.</td></tr>
                <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>

<?php foreach ($profs as $p): ?>
<div class="modal-overlay" id="mt-id-<?= e($p['uid']) ?>">
    <div class="modal" style="max-width:480px;">
        <div class="modal-header">
            <h3>Modifier l'identifiant — <?= e($p['prenom'] . ' ' . $p['nom']) ?></h3>
            <button class="modal-close" onclick="fermerModale('mt-id-<?= e($p['uid']) ?>')">&times;</button>
        </div>
        <form method="POST">
            <?= champ_csrf() ?>
            <input type="hidden" name="action" value="changer_identifiant">
            <input type="hidden" name="utilisateur_id" value="<?= e($p['uid']) ?>">
            <div class="form-group">
                <label>Identifiant actuel</label>
                <input type="text" value="<?= e($p['identifiant']) ?>" disabled>
            </div>
            <div class="form-group">
                <label>Nouvel identifiant *</label>
                <input type="text" name="nouveau_identifiant" required placeholder="prof@supnum.mr">
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" onclick="fermerModale('mt-id-<?= e($p['uid']) ?>')">Annuler</button>
                <button type="submit" class="btn btn-primary">Enregistrer</button>
            </div>
        </form>
    </div>
</div>
<div class="modal-overlay" id="mt-mdp-<?= e($p['uid']) ?>">
    <div class="modal" style="max-width:480px;">
        <div class="modal-header">
            <h3>Réinitialiser le mot de passe — <?= e($p['prenom'] . ' ' . $p['nom']) ?></h3>
            <button class="modal-close" onclick="fermerModale('mt-mdp-<?= e($p['uid']) ?>')">&times;</button>
        </div>
        <form method="POST">
            <?= champ_csrf() ?>
            <input type="hidden" name="action" value="reset_mdp">
            <input type="hidden" name="utilisateur_id" value="<?= e($p['uid']) ?>">
            <div class="form-group">
                <label>Nouveau mot de passe *</label>
                <input type="text" name="nouveau_mdp" required placeholder="Minimum 6 caractères">
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" onclick="fermerModale('mt-mdp-<?= e($p['uid']) ?>')">Annuler</button>
                <button type="submit" class="btn btn-primary">Réinitialiser</button>
            </div>
        </form>
    </div>
</div>
<?php endforeach; ?>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
