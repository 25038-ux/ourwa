<?php
/**
 * Super Admin — Créer un utilisateur
 * Rôles : professeur, admin (avec palier de pouvoir : restreint / complet).
 * No salary field — admin salary is always 0, professor salary is computed from hours
 */
require_once __DIR__ . '/../../includes/bootstrap.php';

require_staff_admin();

$db = getDB();
$message = '';
$type_message = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();
    
    $identifiant = nettoyer($_POST['identifiant'] ?? '');
    $mot_de_passe = $_POST['mot_de_passe'] ?? '';
    $role = $_POST['role'] ?? '';
    $nom = nettoyer($_POST['nom'] ?? '');
    $prenom = nettoyer($_POST['prenom'] ?? '');
    $sexe = ($_POST['sexe'] ?? '') === 'M' ? 'M' : (($_POST['sexe'] ?? '') === 'F' ? 'F' : null);
    $telephone = nettoyer_telephone($_POST['telephone'] ?? '');
    
    // Validation
    if (!valider_identifiant($identifiant)) {
        $message = 'Identifiant invalide (3-100 caractères, lettres, chiffres, @, ., -, _).';
        $type_message = 'error';
    } elseif (strlen($mot_de_passe) < 6) {
        $message = 'Le mot de passe doit contenir au moins 6 caractères.';
        $type_message = 'error';
    } elseif (!in_array($role, ['admin', 'professeur', 'collecteur_absence', 'secretaire', 'comptable'], true)) {
        $message = 'Rôle invalide.';
        $type_message = 'error';
    } elseif (empty($nom) || empty($prenom)) {
        $message = 'Le nom et le prénom sont obligatoires.';
        $type_message = 'error';
    } else {
        // Vérifier unicité
        $stmt = $db->prepare('SELECT COUNT(*) FROM utilisateurs WHERE identifiant = :id');
        $stmt->execute([':id' => $identifiant]);
        if ($stmt->fetchColumn() > 0) {
            $message = 'Cet identifiant existe déjà.';
            $type_message = 'error';
        } else {
            try {
                $db->beginTransaction();

                $hash = password_hash($mot_de_passe, PASSWORD_ARGON2ID);
                $stmt = $db->prepare('INSERT INTO utilisateurs (identifiant, mot_de_passe, role) VALUES (:id, :mdp, :role)');
                $stmt->execute([':id' => $identifiant, ':mdp' => $hash, ':role' => $role]);
                $user_id = $db->lastInsertId();

                if ($role === 'professeur') {
                    $stmt = $db->prepare('INSERT INTO professeurs (utilisateur_id, nom, prenom, sexe, telephone, salaire) VALUES (:uid, :nom, :prenom, :sexe, :tel, 0)');
                    $stmt->execute([':uid' => $user_id, ':nom' => $nom, ':prenom' => $prenom, ':sexe' => $sexe, ':tel' => $telephone]);
                } elseif ($role === 'admin') {
                    // Palier d'admin : 'Super Administrateur' = accès total (finance incluse),
                    // toute autre fonction = accès restreint (pas de finance).
                    $palier = $_POST['palier_admin'] ?? 'restreint';
                    $fonction = ($palier === 'complet')
                        ? 'Super Administrateur'
                        : nettoyer($_POST['fonction'] ?? 'Administrateur');
                    if ($fonction === '') { $fonction = 'Administrateur'; }
                    $stmt = $db->prepare('INSERT INTO personnel_admin (utilisateur_id, nom, prenom, sexe, telephone, fonction, salaire) VALUES (:uid, :nom, :prenom, :sexe, :tel, :fct, 0)');
                    $stmt->execute([':uid' => $user_id, ':nom' => $nom, ':prenom' => $prenom, ':sexe' => $sexe, ':tel' => $telephone, ':fct' => $fonction]);
                } elseif ($role === 'collecteur_absence') {
                    // Collecteur d'absence — stocké dans personnel_admin avec fonction dédiée
                    $stmt = $db->prepare('INSERT INTO personnel_admin (utilisateur_id, nom, prenom, sexe, telephone, fonction, salaire) VALUES (:uid, :nom, :prenom, :sexe, :tel, :fct, 0)');
                    $stmt->execute([':uid' => $user_id, ':nom' => $nom, ':prenom' => $prenom, ':sexe' => $sexe, ':tel' => $telephone, ':fct' => 'Collecteur d\'absence']);
                } elseif ($role === 'secretaire' || $role === 'comptable') {
                    $fct = ($role === 'secretaire') ? 'Secrétaire' : 'Comptable';
                    $stmt = $db->prepare('INSERT INTO personnel_admin (utilisateur_id, nom, prenom, sexe, telephone, fonction, salaire) VALUES (:uid, :nom, :prenom, :sexe, :tel, :fct, 0)');
                    $stmt->execute([':uid' => $user_id, ':nom' => $nom, ':prenom' => $prenom, ':sexe' => $sexe, ':tel' => $telephone, ':fct' => $fct]);
                }
                
                $db->commit();
                journaliser($_SESSION['utilisateur_id'], "Création utilisateur : {$identifiant} ({$role})");
                $message = "Utilisateur \"{$prenom} {$nom}\" créé avec succès !";
                $type_message = 'success';
                regenerer_csrf();
            } catch (Exception $ex) {
                $db->rollBack();
                $message = 'Erreur lors de la création : ' . $ex->getMessage();
                $type_message = 'error';
            }
        }
    }
}

$titre_page = 'Créer un utilisateur';
$sous_titre = 'Ajouter un professeur ou un administrateur';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
    <div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<div class="form-card">
    <h3>Nouvel utilisateur</h3>
    <form method="POST" id="form-creer-utilisateur" novalidate>
        <?= champ_csrf() ?>
        
        <div class="form-row">
            <div class="form-group">
                <label for="identifiant">Identifiant *</label>
                <input type="text" id="identifiant" name="identifiant" placeholder="user@supnum.mr" required>
                <span class="field-error" id="err-identifiant"></span>
            </div>
            <div class="form-group">
                <label for="mot_de_passe">Mot de passe *</label>
                <div style="position:relative;">
                    <input type="password" id="mot_de_passe" name="mot_de_passe" placeholder="Minimum 6 caractères" required style="padding-right:3rem;">
                    <button type="button" class="toggle-mdp" id="toggle-mdp-creer" aria-label="Afficher/masquer le mot de passe" tabindex="-1"
                            style="position:absolute;right:.75rem;top:50%;transform:translateY(-50%);background:transparent;border:none;cursor:pointer;color:var(--text-muted);padding:.4rem;border-radius:8px;display:flex;align-items:center;justify-content:center;">
                        <svg id="icon-eye-creer" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="18" height="18">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/>
                            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                        </svg>
                    </button>
                </div>
                <span class="field-error" id="err-mot_de_passe"></span>
            </div>
        </div>
        
        <div class="form-group">
            <label for="role">Rôle *</label>
            <select id="role" name="role" required onchange="toggleChamps()">
                <option value="">— Sélectionner un rôle —</option>
                <option value="professeur">Professeur</option>
                <option value="admin">Administrateur</option>
                <option value="collecteur_absence">Collecteur d'absence</option>
                <option value="secretaire">Secrétaire (saisie des notes uniquement)</option>
                <option value="comptable">Comptable (finances uniquement)</option>
            </select>
            <span class="field-error" id="err-role"></span>
        </div>

        <div class="form-group hidden" id="champ-palier">
            <label for="palier_admin">Niveau d'accès de l'administrateur *</label>
            <select id="palier_admin" name="palier_admin" onchange="toggleChamps()">
                <option value="restreint">Administrateur — accès complet SAUF la finance</option>
                <option value="complet">Super Administrateur — accès TOTAL (finance incluse)</option>
            </select>
            <small style="color:var(--text-muted);display:block;margin-top:.35rem;">
                « Super Administrateur » voit tout, y compris la Gestion de Caisse et les Dépenses.
                « Administrateur » gère tout le reste mais n'accède pas aux pages financières.
            </small>
        </div>
        
        <div class="form-row">
            <div class="form-group">
                <label for="nom">Nom *</label>
                <input type="text" id="nom" name="nom" required>
                <span class="field-error" id="err-nom"></span>
            </div>
            <div class="form-group">
                <label for="prenom">Prénom *</label>
                <input type="text" id="prenom" name="prenom" required>
                <span class="field-error" id="err-prenom"></span>
            </div>
        </div>
        
        <div class="form-group">
            <label for="telephone">Téléphone</label>
            <input type="text" id="telephone" name="telephone" placeholder="+222 XX XX XX XX">
            <span class="field-error" id="err-telephone"></span>
        </div>

        <div class="form-group">
            <label for="sexe">Sexe</label>
            <select id="sexe" name="sexe">
                <option value="">— Choisir —</option>
                <option value="M">Masculin</option>
                <option value="F">Féminin</option>
            </select>
        </div>
        
        <div class="form-group hidden" id="champ-fonction">
            <label for="fonction">Fonction</label>
            <input type="text" id="fonction" name="fonction" placeholder="Ex: Secrétaire, Comptable...">
        </div>
        
        <button type="submit" class="btn btn-primary">Créer l'utilisateur</button>
    </form>
</div>

<?php
$scripts_supplementaires = '<script>
function toggleChamps() {
    const role = document.getElementById("role").value;
    const isAdmin = (role === "admin");
    document.getElementById("champ-palier").classList.toggle("hidden", !isAdmin);
    // Le champ fonction libre na de sens que pour un admin restreint.
    const palier = document.getElementById("palier_admin").value;
    document.getElementById("champ-fonction").classList.toggle("hidden", !(isAdmin && palier === "restreint"));
}

// Toggle password visibility
(function() {
    var btn = document.getElementById("toggle-mdp-creer");
    var input = document.getElementById("mot_de_passe");
    if (!btn || !input) return;
    btn.addEventListener("click", function() {
        input.type = input.type === "password" ? "text" : "password";
        btn.classList.toggle("shown");
    });
})();
</script>';
include __DIR__ . '/../../includes/layout_footer.php';
?>
