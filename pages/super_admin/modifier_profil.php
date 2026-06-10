<?php
/**
 * Super Admin — Modifier Profil
 *
 * Permet au super admin de modifier :
 *  - Son identifiant de connexion (nouveau)
 *  - Son nom / prénom
 *  - Son mot de passe
 *
 * Toute modification sensible (identifiant, mot de passe) exige la saisie du
 * mot de passe actuel pour ré-authentification.
 */

require_once __DIR__ . '/../../includes/bootstrap.php';
require_staff_admin();

$db = getDB();
$message = '';
$type_message = '';

// Profil courant
$stmt = $db->prepare('SELECT identifiant, nom, prenom FROM utilisateurs WHERE id = :id');
$stmt->execute([':id' => $_SESSION['utilisateur_id']]);
$profil = $stmt->fetch();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();
    $action = $_POST['action'] ?? '';

    // ------------------------------------------------------------------------
    //  Changer nom / prénom
    // ------------------------------------------------------------------------
    if ($action === 'changer_nom') {
        $nouveau_nom    = nettoyer($_POST['nom'] ?? '');
        $nouveau_prenom = nettoyer($_POST['prenom'] ?? '');

        if ($nouveau_nom === '' || $nouveau_prenom === '') {
            $message = 'Le nom et le prénom sont obligatoires.';
            $type_message = 'error';
        } elseif (mb_strlen($nouveau_nom) > 100 || mb_strlen($nouveau_prenom) > 100) {
            $message = 'Nom ou prénom trop long (100 caractères max).';
            $type_message = 'error';
        } else {
            $stmt = $db->prepare('UPDATE utilisateurs SET nom = :nom, prenom = :prenom WHERE id = :id');
            $stmt->execute([
                ':nom' => $nouveau_nom,
                ':prenom' => $nouveau_prenom,
                ':id' => $_SESSION['utilisateur_id']
            ]);

            $_SESSION['nom_complet'] = $nouveau_prenom . ' ' . $nouveau_nom;
            $profil['nom']    = $nouveau_nom;
            $profil['prenom'] = $nouveau_prenom;

            journaliser($_SESSION['utilisateur_id'], 'Modification du nom de profil');
            $message = 'Nom modifié avec succès.';
            $type_message = 'success';
            regenerer_csrf();
        }
    }

    // ------------------------------------------------------------------------
    //  Changer identifiant (login)
    // ------------------------------------------------------------------------
    elseif ($action === 'changer_identifiant') {
        $nouvel_identifiant = nettoyer($_POST['nouvel_identifiant'] ?? '');
        $mdp_actuel         = (string) ($_POST['mdp_actuel_id'] ?? '');

        // Vérifier le mot de passe actuel
        $stmt = $db->prepare('SELECT mot_de_passe FROM utilisateurs WHERE id = :id');
        $stmt->execute([':id' => $_SESSION['utilisateur_id']]);
        $hash = $stmt->fetchColumn();

        if (!password_verify($mdp_actuel, $hash)) {
            $message = 'Mot de passe actuel incorrect.';
            $type_message = 'error';
        } elseif (!valider_identifiant($nouvel_identifiant)) {
            $message = 'Identifiant invalide : 3 à 100 caractères, lettres/chiffres/@./-/_ uniquement.';
            $type_message = 'error';
        } elseif ($nouvel_identifiant === $profil['identifiant']) {
            $message = 'Le nouvel identifiant est identique à l\'actuel.';
            $type_message = 'error';
        } else {
            // Vérifier unicité
            $stmt = $db->prepare('SELECT COUNT(*) FROM utilisateurs WHERE identifiant = :id AND id != :uid');
            $stmt->execute([':id' => $nouvel_identifiant, ':uid' => $_SESSION['utilisateur_id']]);
            if ((int) $stmt->fetchColumn() > 0) {
                $message = 'Cet identifiant est déjà utilisé par un autre compte.';
                $type_message = 'error';
            } else {
                $stmt = $db->prepare('UPDATE utilisateurs SET identifiant = :id WHERE id = :uid');
                $stmt->execute([':id' => $nouvel_identifiant, ':uid' => $_SESSION['utilisateur_id']]);

                $_SESSION['identifiant'] = $nouvel_identifiant;
                $profil['identifiant']   = $nouvel_identifiant;

                journaliser($_SESSION['utilisateur_id'], "Modification identifiant : -> {$nouvel_identifiant}");
                $message = 'Identifiant modifié avec succès. Utilisez le nouveau pour vos prochaines connexions.';
                $type_message = 'success';
                regenerer_csrf();
            }
        }
    }

    // ------------------------------------------------------------------------
    //  Changer mot de passe
    // ------------------------------------------------------------------------
    elseif ($action === 'changer_mdp') {
        $ancien    = (string) ($_POST['ancien_mdp'] ?? '');
        $nouveau   = (string) ($_POST['nouveau_mdp'] ?? '');
        $confirmer = (string) ($_POST['confirmer_mdp'] ?? '');

        $stmt = $db->prepare('SELECT mot_de_passe FROM utilisateurs WHERE id = :id');
        $stmt->execute([':id' => $_SESSION['utilisateur_id']]);
        $hash = $stmt->fetchColumn();

        if (!password_verify($ancien, $hash)) {
            $message = 'L\'ancien mot de passe est incorrect.';
            $type_message = 'error';
        } elseif (($err_mdp = valider_mot_de_passe($nouveau)) !== '') {
            $message = $err_mdp;
            $type_message = 'error';
        } elseif ($nouveau !== $confirmer) {
            $message = 'Les deux mots de passe ne correspondent pas.';
            $type_message = 'error';
        } elseif (password_verify($nouveau, $hash)) {
            $message = 'Le nouveau mot de passe doit être différent de l\'ancien.';
            $type_message = 'error';
        } else {
            $new_hash = password_hash($nouveau, PASSWORD_ARGON2ID);
            $db->prepare('UPDATE utilisateurs SET mot_de_passe = :mdp WHERE id = :id')
               ->execute([':mdp' => $new_hash, ':id' => $_SESSION['utilisateur_id']]);

            journaliser($_SESSION['utilisateur_id'], 'Changement de mot de passe');
            $message = 'Mot de passe modifié avec succès.';
            $type_message = 'success';
            regenerer_csrf();
        }
    }
}

$titre_page = 'Mon profil';
$sous_titre = 'Modifier mon identifiant, mon nom et mon mot de passe';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
    <div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<!-- Récapitulatif -->
<div class="form-card">
    <h3>Identité actuelle</h3>
    <div class="profile-info-grid">
        <div>
            <strong>Identifiant de connexion</strong>
            <span><?= e($profil['identifiant'] ?? '—') ?></span>
        </div>
        <div>
            <strong>Nom complet</strong>
            <span><?= e(trim(($profil['prenom'] ?? '') . ' ' . ($profil['nom'] ?? '')) ?: '—') ?></span>
        </div>
        <div>
            <strong>Rôle</strong>
            <span>Super Administrateur</span>
        </div>
    </div>
</div>

<!-- Changer nom -->
<div class="form-card">
    <h3>Modifier mon nom</h3>
    <form method="POST">
        <?= champ_csrf() ?>
        <input type="hidden" name="action" value="changer_nom">
        <div class="form-row">
            <div class="form-group">
                <label for="prenom">Prénom *</label>
                <input type="text" id="prenom" name="prenom"
                       value="<?= e($profil['prenom'] ?? '') ?>" required maxlength="100">
            </div>
            <div class="form-group">
                <label for="nom">Nom *</label>
                <input type="text" id="nom" name="nom"
                       value="<?= e($profil['nom'] ?? '') ?>" required maxlength="100">
            </div>
        </div>
        <button type="submit" class="btn btn-primary" style="width:auto;">Enregistrer</button>
    </form>
</div>

<!-- Changer identifiant (NOUVEAU) -->
<div class="form-card">
    <h3>Modifier mon identifiant de connexion</h3>
    <p class="text-muted" style="margin-bottom:1rem;font-size:.9rem;">
        Votre identifiant actuel est <strong><?= e($profil['identifiant'] ?? '—') ?></strong>.
        Le mot de passe actuel est requis pour confirmer ce changement.
    </p>
    <form method="POST" autocomplete="off">
        <?= champ_csrf() ?>
        <input type="hidden" name="action" value="changer_identifiant">
        <div class="form-group">
            <label for="nouvel_identifiant">Nouvel identifiant *</label>
            <input type="text" id="nouvel_identifiant" name="nouvel_identifiant"
                   placeholder="ex. directeur@supnum.mr" required maxlength="100"
                   pattern="[a-zA-Z0-9._@\-]{3,100}"
                   title="3 à 100 caractères : lettres, chiffres, @, . - _">
        </div>
        <div class="form-group">
            <label for="mdp_actuel_id">Mot de passe actuel *</label>
            <input type="password" id="mdp_actuel_id" name="mdp_actuel_id" required autocomplete="current-password">
        </div>
        <button type="submit" class="btn btn-primary" style="width:auto;">Modifier l'identifiant</button>
    </form>
</div>

<!-- Changer mot de passe -->
<div class="form-card">
    <h3>Modifier mon mot de passe</h3>
    <p class="text-muted" style="margin-bottom:1rem;font-size:.9rem;">
        Minimum <?= e(PASSWORD_MIN_LENGTH) ?> caractères, combinant au moins 3 types
        (minuscules, majuscules, chiffres, symboles).
    </p>
    <form method="POST" autocomplete="off">
        <?= champ_csrf() ?>
        <input type="hidden" name="action" value="changer_mdp">
        <div class="form-group">
            <label for="ancien_mdp">Mot de passe actuel *</label>
            <input type="password" id="ancien_mdp" name="ancien_mdp" required autocomplete="current-password">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label for="nouveau_mdp">Nouveau mot de passe *</label>
                <input type="password" id="nouveau_mdp" name="nouveau_mdp" required autocomplete="new-password">
            </div>
            <div class="form-group">
                <label for="confirmer_mdp">Confirmer *</label>
                <input type="password" id="confirmer_mdp" name="confirmer_mdp" required autocomplete="new-password">
            </div>
        </div>
        <button type="submit" class="btn btn-primary" style="width:auto;">Modifier le mot de passe</button>
    </form>
</div>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
