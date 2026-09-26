<?php
require_once __DIR__ . '/includes/fonctions.php';
exiger_connexion();

$type      = $_GET['type'] ?? '';
$direction = (int) ($_GET['direction'] ?? 0);
$du        = $_GET['du'] ?? '';
$au        = $_GET['au'] ?? '';
$q         = trim($_GET['q'] ?? '');
$page_num  = max(1, (int) ($_GET['page'] ?? 1));

$where = [];
$params = [];
if (isset(TYPES_MOUVEMENT[$type])) {
    $where[] = 'mv.type = ?';
    $params[] = $type;
}
if ($direction) {
    $where[] = '(mv.direction_depart_id = ? OR mv.direction_arrivee_id = ?)';
    array_push($params, $direction, $direction);
}
if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $du)) {
    $where[] = 'mv.date_mouvement >= ?';
    $params[] = $du . ' 00:00:00';
}
if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $au)) {
    $where[] = 'mv.date_mouvement <= ?';
    $params[] = $au . ' 23:59:59';
}
if ($q !== '') {
    $where[] = '(m.numero_inventaire LIKE ? OR m.designation LIKE ?)';
    array_push($params, "%$q%", "%$q%");
}
$sql_where = $where ? ' WHERE ' . implode(' AND ', $where) : '';

/* Export CSV (ouvre directement dans Excel grâce au BOM UTF-8 et au ;) */
if (($_GET['export'] ?? '') === 'csv') {
    $lignes = requete(SQL_MOUVEMENTS . $sql_where . ' ORDER BY mv.date_mouvement DESC', $params);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="historique-mouvements-' . date('Y-m-d') . '.csv"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, ['Date', 'N° inventaire', 'Désignation', 'Type', 'Direction de départ', "Direction d'arrivée",
                   'État avant', 'État après', 'Observation', 'Par'], ';', '"', '');
    foreach ($lignes as $l) {
        fputcsv($out, [
            date('d/m/Y H:i', strtotime($l['date_mouvement'])), $l['numero_inventaire'], $l['designation'],
            TYPES_MOUVEMENT[$l['type']], $l['dep_nom'], $l['arr_nom'],
            $l['etat_avant'] ? libelle_etat($l['etat_avant']) : '', $l['etat_apres'] ? libelle_etat($l['etat_apres']) : '',
            $l['observation'], $l['auteur'],
        ], ';', '"', '');
    }
    exit;
}

$total = (int) valeur('SELECT COUNT(*) FROM mouvements mv JOIN materiels m ON m.id = mv.materiel_id' . $sql_where, $params);
$par_page = 25;
$offset = ($page_num - 1) * $par_page;
$mouvements = requete(SQL_MOUVEMENTS . $sql_where . " ORDER BY mv.date_mouvement DESC, mv.id DESC LIMIT $par_page OFFSET $offset", $params)->fetchAll();

$titre = 'Historique';
$page  = 'mouvements';
require __DIR__ . '/includes/haut.php';
?>

<div class="entete-page">
  <div>
    <h1>Historique des mouvements</h1>
    <p class="muet"><?= $total ?> événement<?= $total > 1 ? 's' : '' ?> — entrées, affectations, transferts et changements d'état.</p>
  </div>
  <a class="btn btn--fantome" href="<?= e(url_avec(['export' => 'csv', 'page' => null])) ?>">Exporter en CSV</a>
</div>

<form class="filtres" method="get">
  <label class="filtres__recherche">
    <?= icone('recherche', 16) ?>
    <input type="search" name="q" value="<?= e($q) ?>" placeholder="N° ou désignation">
  </label>
  <select name="type" data-auto-submit aria-label="Type">
    <option value="">Tous les types</option>
    <?php foreach (TYPES_MOUVEMENT as $k => $l): ?>
      <option value="<?= $k ?>" <?= $type === $k ? 'selected' : '' ?>><?= $l ?></option>
    <?php endforeach; ?>
  </select>
  <select name="direction" data-auto-submit aria-label="Direction">
    <option value="">Toutes les directions</option>
    <?php foreach (liste_directions() as $d): ?>
      <option value="<?= $d['id'] ?>" <?= $direction === (int) $d['id'] ? 'selected' : '' ?>><?= e($d['code'] . ' · ' . $d['nom']) ?></option>
    <?php endforeach; ?>
  </select>
  <label class="filtres__date">Du <input type="date" name="du" value="<?= e($du) ?>" data-auto-submit></label>
  <label class="filtres__date">au <input type="date" name="au" value="<?= e($au) ?>" data-auto-submit></label>
  <?php if ($where): ?><a class="lien-discret" href="mouvements.php">Effacer</a><?php endif; ?>
</form>

<?php if (!$mouvements): ?>
  <div class="bloc vide vide--grand"><p><strong>Aucun mouvement sur cette période.</strong></p></div>
<?php else: ?>
  <div class="tableau-conteneur">
    <table class="tableau tableau--registre">
      <thead>
        <tr><th>Date</th><th>Matériel</th><th>Mouvement</th><th>Observation</th><th>Par</th></tr>
      </thead>
      <tbody>
        <?php $mois_courant = '';
        foreach ($mouvements as $mv):
            $mois = MOIS[date('n', strtotime($mv['date_mouvement'])) - 1] . ' ' . date('Y', strtotime($mv['date_mouvement']));
            if ($mois !== $mois_courant): $mois_courant = $mois; ?>
              <tr class="separateur-mois"><td colspan="5"><?= ucfirst($mois) ?></td></tr>
            <?php endif; ?>
          <tr>
            <td class="mono nowrap"><?= date('d/m/Y', strtotime($mv['date_mouvement'])) ?><small class="muet"><?= date('H\hi', strtotime($mv['date_mouvement'])) ?></small></td>
            <td>
              <a href="materiel.php?id=<?= $mv['materiel_id'] ?>"><?= etiquette($mv['numero_inventaire']) ?></a>
              <small class="muet"><?= e($mv['designation']) ?></small>
            </td>
            <td><span class="type-mvt type-mvt--<?= e($mv['type']) ?>"><?= e(TYPES_MOUVEMENT[$mv['type']]) ?></span><div class="petit"><?= resume_mouvement($mv) ?></div></td>
            <td class="observation"><?= e($mv['observation'] ?? '') ?></td>
            <td class="petit"><?= e($mv['auteur'] ?? '—') ?></td>
          </tr>
        <?php endforeach; ?>
      </tbody>
    </table>
  </div>
  <?= pagination($total, $page_num, $par_page) ?>
<?php endif; ?>

<?php require __DIR__ . '/includes/bas.php'; ?>
