<?php
require_once __DIR__ . '/includes/fonctions.php';
exiger_connexion();

$q         = trim($_GET['q'] ?? '');
$direction = $_GET['direction'] ?? '';
$categorie = (int) ($_GET['categorie'] ?? 0);
$etat      = $_GET['etat'] ?? '';
$page_num  = max(1, (int) ($_GET['page'] ?? 1));

/* Construction du WHERE selon les filtres remplis */
$where  = [];
$params = [];

if ($q !== '') {
    // Recherche par n° d'inventaire, désignation ou direction (code ou nom) — + marque et n° de série
    $where[] = '(m.numero_inventaire LIKE ? OR m.designation LIKE ? OR m.marque LIKE ?
                 OR m.numero_serie LIKE ? OR d.nom LIKE ? OR d.code = ?)';
    $like = '%' . $q . '%';
    array_push($params, $like, $like, $like, $like, $like, $q);
}
if ($direction === 'magasin') {
    $where[] = 'm.direction_id IS NULL';
} elseif ((int) $direction > 0) {
    $where[] = 'm.direction_id = ?';
    $params[] = (int) $direction;
}
if ($categorie) {
    $where[] = 'm.categorie_id = ?';
    $params[] = $categorie;
}
if (isset(ETATS[$etat])) {
    $where[] = 'm.etat = ?';
    $params[] = $etat;
}
$sql_where = $where ? 'WHERE ' . implode(' AND ', $where) : '';

$from = 'FROM materiels m
         JOIN categories c ON c.id = m.categorie_id
         LEFT JOIN directions d ON d.id = m.direction_id';

$total = (int) valeur("SELECT COUNT(*) $from $sql_where", $params);
$offset = ($page_num - 1) * PAR_PAGE;

$materiels = requete(
    "SELECT m.*, c.nom AS categorie, d.code AS dir_code, d.nom AS dir_nom
       $from $sql_where
      ORDER BY m.numero_inventaire
      LIMIT " . PAR_PAGE . " OFFSET $offset",
    $params
)->fetchAll();

$filtre_actif = $q !== '' || $direction !== '' || $categorie || $etat !== '';

$titre = 'Matériels';
$page  = 'materiels';
require __DIR__ . '/includes/haut.php';
?>

<div class="entete-page">
  <div>
    <h1>Matériels</h1>
    <p class="muet">
      <?php if ($filtre_actif): ?>
        <?= $total ?> résultat<?= $total > 1 ? 's' : '' ?><?= $q !== '' ? ' pour « ' . e($q) . ' »' : '' ?>
      <?php else: ?>
        <?= $total ?> matériels enregistrés, triés par numéro d'inventaire.
      <?php endif; ?>
    </p>
  </div>
</div>

<form class="filtres" method="get">
  <label class="filtres__recherche">
    <?= icone('recherche', 16) ?>
    <input type="search" name="q" value="<?= e($q) ?>" placeholder="Rechercher…">
  </label>
  <select name="direction" data-auto-submit aria-label="Direction">
    <option value="">Toutes les directions</option>
    <option value="magasin" <?= $direction === 'magasin' ? 'selected' : '' ?>>— Magasin central (non affecté)</option>
    <?php foreach (liste_directions() as $d): ?>
      <option value="<?= $d['id'] ?>" <?= (int) $direction === (int) $d['id'] ? 'selected' : '' ?>><?= e($d['code'] . ' · ' . $d['nom']) ?></option>
    <?php endforeach; ?>
  </select>
  <select name="categorie" data-auto-submit aria-label="Catégorie">
    <option value="">Toutes catégories</option>
    <?php foreach (liste_categories() as $c): ?>
      <option value="<?= $c['id'] ?>" <?= $categorie === (int) $c['id'] ? 'selected' : '' ?>><?= e($c['nom']) ?></option>
    <?php endforeach; ?>
  </select>
  <div class="segments" role="group" aria-label="État">
    <a href="<?= e(url_avec(['etat' => null, 'page' => null])) ?>" class="<?= $etat === '' ? 'actif' : '' ?>">Tous</a>
    <?php foreach (ETATS as $k => $l): ?>
      <a href="<?= e(url_avec(['etat' => $k, 'page' => null])) ?>" class="<?= $etat === $k ? 'actif' : '' ?>"><i class="point point--<?= $k ?>"></i><?= $l ?></a>
    <?php endforeach; ?>
  </div>
  <?php if ($etat !== ''): ?><input type="hidden" name="etat" value="<?= e($etat) ?>"><?php endif; ?>
  <noscript><button class="btn">Filtrer</button></noscript>
  <?php if ($filtre_actif): ?><a class="lien-discret" href="materiels.php">Effacer les filtres</a><?php endif; ?>
</form>

<?php if (!$materiels): ?>
  <div class="bloc vide vide--grand">
    <p><strong>Aucun matériel ne correspond.</strong></p>
    <p class="muet">Vérifiez l'orthographe ou essayez avec une partie du numéro (ex. « 2023 » ou « INF »).</p>
  </div>
<?php else: ?>
  <div class="tableau-conteneur">
    <table class="tableau">
      <thead>
        <tr>
          <th>N° inventaire</th>
          <th>Désignation</th>
          <th>Catégorie</th>
          <th>Direction</th>
          <th>Acquis le</th>
          <th>État</th>
        </tr>
      </thead>
      <tbody>
        <?php foreach ($materiels as $m): ?>
          <tr data-href="materiel.php?id=<?= $m['id'] ?>">
            <td><?= etiquette($m['numero_inventaire']) ?></td>
            <td>
              <a class="tableau__lien" href="materiel.php?id=<?= $m['id'] ?>"><?= e($m['designation']) ?></a>
              <small class="muet"><?= e(trim($m['marque'] . ' ' . $m['modele'])) ?></small>
            </td>
            <td><?= e($m['categorie']) ?></td>
            <td>
              <?php if ($m['dir_code']): ?>
                <span class="code-dir" title="<?= e($m['dir_nom']) ?>"><?= e($m['dir_code']) ?></span>
              <?php else: ?>
                <span class="muet">Magasin</span>
              <?php endif; ?>
            </td>
            <td class="mono"><?= date_courte($m['date_acquisition']) ?></td>
            <td><?= badge_etat($m['etat']) ?></td>
          </tr>
        <?php endforeach; ?>
      </tbody>
    </table>
  </div>
  <?= pagination($total, $page_num) ?>
<?php endif; ?>

<?php require __DIR__ . '/includes/bas.php'; ?>
