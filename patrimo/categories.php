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
        $nb = (int) valeur('SELECT COUNT(*) FROM materiels WHERE categorie_id = ?', [$id]);
        if ($nb > 0) {
            flash("Impossible : $nb matériel(s) utilisent encore cette catégorie.", 'erreur');
        } else {
            requete('DELETE FROM categories WHERE id = ?', [$id]);
            flash('Catégorie supprimée.');
        }
        rediriger('categories.php');
    }

    $nom     = post('nom');
    $prefixe = mb_strtoupper(post('prefixe') ?? '');
    $desc    = post('description');

    if (!$nom) {
        $erreur = 'Le nom est obligatoire.';
    } elseif (!preg_match('/^[A-Z]{2,5}$/', $prefixe)) {
        $erreur = 'Le préfixe doit faire 2 à 5 lettres (ex. INF).';
    } elseif (valeur('SELECT id FROM categories WHERE (nom = ? OR prefixe = ?) AND id <> ?', [$nom, $prefixe, $id])) {
        $erreur = 'Ce nom ou ce préfixe existe déjà.';
    } else {
        if ($id) {
            requete('UPDATE categories SET nom = ?, prefixe = ?, description = ? WHERE id = ?', [$nom, $prefixe, $desc, $id]);
            flash("Catégorie « $nom » modifiée.");
        } else {
            requete('INSERT INTO categories (nom, prefixe, description) VALUES (?, ?, ?)', [$nom, $prefixe, $desc]);
            flash("Catégorie « $nom » créée.");
        }
        rediriger('categories.php');
    }
    $edition = ['id' => $id, 'nom' => $nom, 'prefixe' => $prefixe, 'description' => $desc];
}

if (!$edition && isset($_GET['modifier'])) {
    $edition = ligne('SELECT * FROM categories WHERE id = ?', [(int) $_GET['modifier']]);
}

$categories = requete(
    "SELECT c.*, COUNT(m.id) AS nb, SUM(m.etat = 'reforme') AS reformes
       FROM categories c LEFT JOIN materiels m ON m.categorie_id = c.id
      GROUP BY c.id, c.nom, c.prefixe, c.description
      ORDER BY c.nom"
)->fetchAll();

$titre = 'Catégories';
$page  = 'categories';
require __DIR__ . '/includes/haut.php';
?>

<div class="entete-page">
  <div>
    <h1>Catégories</h1>
    <p class="muet">Le préfixe sert de début au numéro d'inventaire : <span class="mono">INF</span>-2026-0001.</p>
  </div>
</div>

<div class="grille-referentiel">
  <div class="tableau-conteneur">
    <table class="tableau">
      <thead><tr><th>Préfixe</th><th>Catégorie</th><th class="num">Matériels</th><th></th></tr></thead>
      <tbody>
        <?php foreach ($categories as $c): ?>
          <tr class="<?= $edition && (int) $edition['id'] === (int) $c['id'] ? 'ligne-active' : '' ?>">
            <td><span class="prefixe"><?= e($c['prefixe']) ?></span></td>
            <td><strong><?= e($c['nom']) ?></strong><small class="muet"><?= e($c['description'] ?? '') ?></small></td>
            <td class="num">
              <a href="materiels.php?categorie=<?= $c['id'] ?>"><?= (int) $c['nb'] ?></a>
              <?php if ($c['reformes']): ?><small class="muet"><?= (int) $c['reformes'] ?> réformé(s)</small><?php endif; ?>
            </td>
            <td class="actions-ligne">
              <a class="btn-icone" href="?modifier=<?= $c['id'] ?>" title="Modifier"><?= icone('crayon', 16) ?></a>
              <form method="post" data-confirmer="Supprimer la catégorie « <?= e($c['nom']) ?> » ?">
                <?= champ_csrf() ?>
                <input type="hidden" name="action" value="supprimer">
                <input type="hidden" name="id" value="<?= $c['id'] ?>">
                <button class="btn-icone btn-icone--danger" title="Supprimer" <?= $c['nb'] ? 'disabled' : '' ?>><?= icone('poubelle', 16) ?></button>
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
    <h2><?= !empty($edition['id']) ? 'Modifier la catégorie' : 'Nouvelle catégorie' ?></h2>
    <?php if ($erreur): ?><div class="flash flash--erreur"><?= e($erreur) ?></div><?php endif; ?>
    <label class="champ">
      <span>Nom *</span>
      <input type="text" name="nom" value="<?= e($edition['nom'] ?? '') ?>" required maxlength="80" placeholder="Informatique">
    </label>
    <label class="champ">
      <span>Préfixe *</span>
      <input type="text" name="prefixe" class="mono" value="<?= e($edition['prefixe'] ?? '') ?>" required maxlength="5" pattern="[A-Za-z]{2,5}" placeholder="INF">
      <small class="aide">2 à 5 lettres, en majuscules.</small>
    </label>
    <label class="champ">
      <span>Description</span>
      <textarea name="description" rows="3" maxlength="255" placeholder="Ce que regroupe cette catégorie"><?= e($edition['description'] ?? '') ?></textarea>
    </label>
    <div class="formulaire__pied">
      <?php if (!empty($edition['id'])): ?><a class="btn btn--fantome" href="categories.php">Annuler</a><?php endif; ?>
      <button class="btn btn--encre" type="submit"><?= !empty($edition['id']) ? 'Enregistrer' : 'Créer' ?></button>
    </div>
  </form>
</div>

<?php require __DIR__ . '/includes/bas.php'; ?>
