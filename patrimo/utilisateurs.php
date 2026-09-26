<?php
require_once __DIR__ . '/includes/fonctions.php';
exiger_admin();

$edition = null;
$erreur = '';
$moi = (int) utilisateur()['id'];

if (est_post()) {
    verifier_csrf();
    $id = (int) ($_POST['id'] ?? 0);

    if (($_POST['action'] ?? '') === 'basculer') {
        if ($id === $moi) {
            flash('Vous ne pouvez pas désactiver votre propre compte.', 'erreur');
        } else {
            requete('UPDATE utilisateurs SET actif = 1 - actif WHERE id = ?', [$id]);
            flash('Compte mis à jour.');
        }
        rediriger('utilisateurs.php');
    }

    $nom   = post('nom_complet');
    $ident = mb_strtolower(post('identifiant') ?? '');
    $role  = ($_POST['role'] ?? '') === 'admin' ? 'admin' : 'responsable';
    $dir   = (int) ($_POST['direction_id'] ?? 0) ?: null;
    $mdp   = (string) ($_POST['mot_de_passe'] ?? '');

    if (!$nom) {
        $erreur = 'Le nom est obligatoire.';
    } elseif (!preg_match('/^[a-z0-9._-]{3,50}$/', $ident)) {
        $erreur = 'Identifiant : 3 caractères minimum, lettres, chiffres, point ou tiret.';
    } elseif (valeur('SELECT id FROM utilisateurs WHERE identifiant = ? AND id <> ?', [$ident, $id])) {
        $erreur = 'Cet identifiant est déjà pris.';
    } elseif ($role === 'responsable' && !$dir) {
        $erreur = "Un responsable d'inventaire doit être rattaché à une direction.";
    } elseif ((!$id || $mdp !== '') && mb_strlen($mdp) < 8) {
        $erreur = 'Le mot de passe doit faire au moins 8 caractères.';
    } elseif ($id === $moi && $role !== 'admin') {
        $erreur = 'Vous ne pouvez pas retirer vos propres droits d\'administration.';
    } else {
        if ($role === 'admin') $dir = null;
        if ($id) {
            requete('UPDATE utilisateurs SET nom_complet = ?, identifiant = ?, role = ?, direction_id = ? WHERE id = ?', [$nom, $ident, $role, $dir, $id]);
            if ($mdp !== '') {
                requete('UPDATE utilisateurs SET mot_de_passe = ? WHERE id = ?', [password_hash($mdp, PASSWORD_DEFAULT), $id]);
            }
            flash("Compte de $nom modifié.");
        } else {
            requete('INSERT INTO utilisateurs (nom_complet, identifiant, mot_de_passe, role, direction_id) VALUES (?, ?, ?, ?, ?)',
                    [$nom, $ident, password_hash($mdp, PASSWORD_DEFAULT), $role, $dir]);
            flash("Compte créé pour $nom.");
        }
        rediriger('utilisateurs.php');
    }
    $edition = ['id' => $id, 'nom_complet' => $nom, 'identifiant' => $ident, 'role' => $role, 'direction_id' => $dir];
}

if (!$edition && isset($_GET['modifier'])) {
    $edition = ligne('SELECT id, nom_complet, identifiant, role, direction_id FROM utilisateurs WHERE id = ?', [(int) $_GET['modifier']]);
}

$utilisateurs = requete(
    'SELECT u.*, d.code AS dir_code FROM utilisateurs u LEFT JOIN directions d ON d.id = u.direction_id
      ORDER BY u.role, u.nom_complet'
)->fetchAll();

$titre = 'Utilisateurs';
$page  = 'utilisateurs';
require __DIR__ . '/includes/haut.php';
?>

<div class="entete-page">
  <div>
    <h1>Utilisateurs</h1>
    <p class="muet">Chaque direction a son responsable d'inventaire : c'est lui qui valide les transferts qui la concernent.</p>
  </div>
</div>

<div class="grille-referentiel">
  <div class="tableau-conteneur">
    <table class="tableau">
      <thead><tr><th>Nom</th><th>Rôle</th><th>Dernière connexion</th><th></th></tr></thead>
      <tbody>
        <?php foreach ($utilisateurs as $u): ?>
          <tr class="<?= $u['actif'] ? '' : 'ligne-inactive' ?>">
            <td>
              <span class="avec-avatar"><span class="avatar avatar--petit"><?= e(initiales($u['nom_complet'])) ?></span>
              <span><strong><?= e($u['nom_complet']) ?></strong><small class="muet mono"><?= e($u['identifiant']) ?></small></span></span>
            </td>
            <td><?= $u['role'] === 'admin' ? 'Resp. du patrimoine' : 'Inventaire <span class="code-dir">' . e($u['dir_code'] ?? '?') . '</span>' ?>
              <?php if (!$u['actif']): ?><small class="muet">Compte désactivé</small><?php endif; ?></td>
            <td class="petit"><?= $u['derniere_cnx'] ? il_y_a($u['derniere_cnx']) : '<span class="muet">jamais</span>' ?></td>
            <td class="actions-ligne">
              <a class="btn-icone" href="?modifier=<?= $u['id'] ?>" title="Modifier"><?= icone('crayon', 16) ?></a>
              <?php if ((int) $u['id'] !== $moi): ?>
                <form method="post">
                  <?= champ_csrf() ?>
                  <input type="hidden" name="action" value="basculer">
                  <input type="hidden" name="id" value="<?= $u['id'] ?>">
                  <button class="btn-icone" title="<?= $u['actif'] ? 'Désactiver' : 'Réactiver' ?>"><?= icone($u['actif'] ? 'croix' : 'coche', 16) ?></button>
                </form>
              <?php endif; ?>
            </td>
          </tr>
        <?php endforeach; ?>
      </tbody>
    </table>
  </div>

  <form method="post" class="bloc formulaire-lateral" data-valider novalidate>
    <?= champ_csrf() ?>
    <input type="hidden" name="id" value="<?= (int) ($edition['id'] ?? 0) ?>">
    <h2><?= !empty($edition['id']) ? 'Modifier le compte' : 'Nouveau compte' ?></h2>
    <?php if ($erreur): ?><div class="flash flash--erreur"><?= e($erreur) ?></div><?php endif; ?>
    <label class="champ">
      <span>Nom complet *</span>
      <input type="text" name="nom_complet" value="<?= e($edition['nom_complet'] ?? '') ?>" required maxlength="100">
    </label>
    <label class="champ">
      <span>Identifiant *</span>
      <input type="text" name="identifiant" class="mono" value="<?= e($edition['identifiant'] ?? '') ?>" required maxlength="50" pattern="[A-Za-z0-9._\-]{3,50}" placeholder="prenom.nom" autocomplete="off">
    </label>
    <label class="champ">
      <span>Rôle</span>
      <select name="role" data-role>
        <option value="responsable" <?= ($edition['role'] ?? '') !== 'admin' ? 'selected' : '' ?>>Responsable d'inventaire</option>
        <option value="admin" <?= ($edition['role'] ?? '') === 'admin' ? 'selected' : '' ?>>Responsable du patrimoine (admin)</option>
      </select>
    </label>
    <label class="champ" data-champ-direction>
      <span>Direction</span>
      <select name="direction_id">
        <option value="">Choisir…</option>
        <?php foreach (liste_directions() as $d): ?>
          <option value="<?= $d['id'] ?>" <?= (int) ($edition['direction_id'] ?? 0) === (int) $d['id'] ? 'selected' : '' ?>><?= e($d['code'] . ' · ' . $d['nom']) ?></option>
        <?php endforeach; ?>
      </select>
    </label>
    <label class="champ">
      <span>Mot de passe <?= !empty($edition['id']) ? '<small>(laisser vide pour ne pas changer)</small>' : '*' ?></span>
      <input type="password" name="mot_de_passe" minlength="8" <?= empty($edition['id']) ? 'required' : '' ?> autocomplete="new-password">
    </label>
    <div class="formulaire__pied">
      <?php if (!empty($edition['id'])): ?><a class="btn btn--fantome" href="utilisateurs.php">Annuler</a><?php endif; ?>
      <button class="btn btn--encre" type="submit"><?= !empty($edition['id']) ? 'Enregistrer' : 'Créer le compte' ?></button>
    </div>
  </form>
</div>

<?php require __DIR__ . '/includes/bas.php'; ?>
