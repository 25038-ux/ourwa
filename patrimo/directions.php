<?php
require_once __DIR__ . '/includes/fonctions.php';
exiger_admin();

$edition = null;
$erreur = '';

if (est_post()) {
    verifier_csrf();
    $action = $_POST['action'] ?? '';
    $id = (int) ($_POST['id'] ?? 0);

    if ($action === 'supprimer') {
        $nb = (int) valeur('SELECT COUNT(*) FROM materiels WHERE direction_id = ?', [$id]);
        $nb_tr = (int) valeur('SELECT COUNT(*) FROM transferts WHERE direction_depart_id = ? OR direction_arrivee_id = ?', [$id, $id]);
        if ($nb > 0) {
            flash("Impossible : $nb matériel(s) sont encore affectés à cette direction. Transférez-les d'abord.", 'erreur');
        } elseif ($nb_tr > 0) {
            flash('Impossible : cette direction apparaît dans des demandes de transfert.', 'erreur');
        } else {
            requete('DELETE FROM directions WHERE id = ?', [$id]);
            flash('Direction supprimée.');
        }
        rediriger('directions.php');
    }

    // Ajout ou modification
    $code = mb_strtoupper(post('code') ?? '');
    $nom  = post('nom');
    $loc  = post('localisation');
    $tel  = post('telephone');

    if (!preg_match('/^[A-Z0-9]{2,12}$/', $code)) {
        $erreur = 'Le code doit contenir 2 à 12 lettres ou chiffres (ex. DAF).';
    } elseif (!$nom) {
        $erreur = 'Le nom de la direction est obligatoire.';
    } elseif (valeur('SELECT id FROM directions WHERE code = ? AND id <> ?', [$code, $id])) {
        $erreur = "Le code $code est déjà utilisé.";
    } else {
        if ($id) {
            requete('UPDATE directions SET code = ?, nom = ?, localisation = ?, telephone = ? WHERE id = ?', [$code, $nom, $loc, $tel, $id]);
            flash("Direction $code modifiée.");
        } else {
            requete('INSERT INTO directions (code, nom, localisation, telephone) VALUES (?, ?, ?, ?)', [$code, $nom, $loc, $tel]);
            flash("Direction $code ajoutée.");
        }
        rediriger('directions.php');
    }
    $edition = ['id' => $id, 'code' => $code, 'nom' => $nom, 'localisation' => $loc, 'telephone' => $tel];
}

if (!$edition && isset($_GET['modifier'])) {
    $edition = ligne('SELECT * FROM directions WHERE id = ?', [(int) $_GET['modifier']]);
}

$directions = requete(
    "SELECT d.*, COUNT(m.id) AS nb, SUM(m.etat = 'en_panne') AS pannes,
            (SELECT GROUP_CONCAT(u.nom_complet SEPARATOR ', ') FROM utilisateurs u
              WHERE u.direction_id = d.id AND u.actif = 1) AS responsables
       FROM directions d LEFT JOIN materiels m ON m.direction_id = d.id
      GROUP BY d.id, d.code, d.nom, d.localisation, d.telephone, d.cree_le
      ORDER BY d.nom"
)->fetchAll();

$titre = 'Directions';
$page  = 'directions';
require __DIR__ . '/includes/haut.php';
?>

<div class="entete-page">
  <div>
    <h1>Directions</h1>
    <p class="muet">Les services auxquels le matériel peut être affecté.</p>
  </div>
</div>

<div class="grille-referentiel">
  <div class="tableau-conteneur">
    <table class="tableau">
      <thead><tr><th>Code</th><th>Direction</th><th>Responsable d'inventaire</th><th class="num">Matériels</th><th></th></tr></thead>
      <tbody>
        <?php foreach ($directions as $d): ?>
          <tr class="<?= $edition && (int) $edition['id'] === (int) $d['id'] ? 'ligne-active' : '' ?>">
            <td><span class="code-dir"><?= e($d['code']) ?></span></td>
            <td>
              <strong><?= e($d['nom']) ?></strong>
              <small class="muet"><?= e(implode(' · ', array_filter([$d['localisation'], $d['telephone']]))) ?></small>
            </td>
            <td><?= $d['responsables'] ? e($d['responsables']) : '<span class="muet">Non désigné</span>' ?></td>
            <td class="num">
              <a href="materiels.php?direction=<?= $d['id'] ?>"><?= (int) $d['nb'] ?></a>
              <?php if ($d['pannes']): ?><small class="texte-panne"><?= (int) $d['pannes'] ?> en panne</small><?php endif; ?>
            </td>
            <td class="actions-ligne">
              <a class="btn-icone" href="?modifier=<?= $d['id'] ?>" title="Modifier"><?= icone('crayon', 16) ?></a>
              <form method="post" data-confirmer="Supprimer la direction <?= e($d['code']) ?> ?">
                <?= champ_csrf() ?>
                <input type="hidden" name="action" value="supprimer">
                <input type="hidden" name="id" value="<?= $d['id'] ?>">
                <button class="btn-icone btn-icone--danger" title="Supprimer" <?= $d['nb'] ? 'disabled' : '' ?>><?= icone('poubelle', 16) ?></button>
              </form>
            </td>
          </tr>
        <?php endforeach; ?>
      </tbody>
    </table>
  </div>

  <form method="post" class="bloc formulaire-lateral" data-valider novalidate>
    <?= champ_csrf() ?>
    <input type="hidden" name="id" value="<?= (int) ($edition['id'] ?? 0) ?>">
    <h2><?= !empty($edition['id']) ? 'Modifier ' . e($edition['code']) : 'Nouvelle direction' ?></h2>
    <?php if ($erreur): ?><div class="flash flash--erreur"><?= e($erreur) ?></div><?php endif; ?>
    <label class="champ">
      <span>Code *</span>
      <input type="text" name="code" class="mono" value="<?= e($edition['code'] ?? '') ?>" required maxlength="12" pattern="[A-Za-z0-9]{2,12}" placeholder="DAF">
    </label>
    <label class="champ">
      <span>Nom *</span>
      <input type="text" name="nom" value="<?= e($edition['nom'] ?? '') ?>" required maxlength="120" placeholder="Direction des Affaires Financières">
    </label>
    <label class="champ">
      <span>Localisation</span>
      <input type="text" name="localisation" value="<?= e($edition['localisation'] ?? '') ?>" maxlength="120" placeholder="Bâtiment A, 1er étage">
    </label>
    <label class="champ">
      <span>Téléphone</span>
      <input type="tel" name="telephone" value="<?= e($edition['telephone'] ?? '') ?>" maxlength="30">
    </label>
    <div class="formulaire__pied">
      <?php if (!empty($edition['id'])): ?><a class="btn btn--fantome" href="directions.php">Annuler</a><?php endif; ?>
      <button class="btn btn--encre" type="submit"><?= !empty($edition['id']) ? 'Enregistrer' : 'Ajouter' ?></button>
    </div>
  </form>
</div>

<?php require __DIR__ . '/includes/bas.php'; ?>
