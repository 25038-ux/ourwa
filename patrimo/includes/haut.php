<?php
/*
 * En-tête commun : <head>, barre latérale et barre du haut.
 * Variables attendues avant l'include : $titre, $page (clé du menu actif).
 */
$u = utilisateur();
$page = $page ?? '';
$a_traiter = transferts_a_traiter();
$flashs = $_SESSION['flash'] ?? [];
unset($_SESSION['flash']);

function lien_menu(string $cle, string $href, string $icone, string $libelle, string $actif, int $badge = 0): string
{
    $cls = $cle === $actif ? ' class="actif" aria-current="page"' : '';
    $b = $badge > 0 ? '<span class="menu__badge">' . $badge . '</span>' : '';
    return '<a href="' . $href . '"' . $cls . '>' . icone($icone) . '<span>' . $libelle . '</span>' . $b . '</a>';
}
?>
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= e($titre ?? 'Patrimo') ?> · <?= APP_NOM ?></title>
<link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="assets/css/polices.css">
<link rel="stylesheet" href="assets/css/style.css?v=3">
</head>
<body>

<div class="app">
  <aside class="lateral" id="lateral">
    <a class="marque" href="index.php">
      <svg class="marque__logo" viewBox="0 0 40 40" aria-hidden="true">
        <path d="M9 6h17l8 8v20H9z" fill="currentColor"/>
        <path d="M26 6v8h8" fill="none" stroke="var(--papier)" stroke-width="1.6" stroke-linejoin="round"/>
        <circle cx="15.5" cy="13" r="2.4" fill="var(--papier)"/>
        <path d="M14 22h13M14 26h13M14 30h8" stroke="var(--papier)" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
      <span>
        <strong>Patrimo</strong>
        <small>Registre du matériel</small>
      </span>
    </a>

    <nav class="menu">
      <p class="menu__titre">Suivi</p>
      <?= lien_menu('accueil', 'index.php', 'tableau', 'Tableau de bord', $page) ?>
      <?= lien_menu('materiels', 'materiels.php', 'boite', 'Matériels', $page) ?>
      <?= lien_menu('transferts', 'transferts.php', 'fleches', 'Transferts', $page, $a_traiter) ?>
      <?= lien_menu('mouvements', 'mouvements.php', 'horloge', 'Historique', $page) ?>

      <?php if (est_admin()): ?>
      <p class="menu__titre">Référentiel</p>
      <?= lien_menu('directions', 'directions.php', 'batiment', 'Directions', $page) ?>
      <?= lien_menu('categories', 'categories.php', 'etiquette', 'Catégories', $page) ?>
      <?= lien_menu('utilisateurs', 'utilisateurs.php', 'personnes', 'Utilisateurs', $page) ?>
      <?php endif; ?>
    </nav>

    <div class="profil">
      <span class="avatar"><?= e(initiales($u['nom_complet'])) ?></span>
      <span class="profil__nom">
        <strong><?= e($u['nom_complet']) ?></strong>
        <small><?= est_admin() ? 'Resp. du patrimoine' : 'Inventaire · ' . e($u['direction_code'] ?? '') ?></small>
      </span>
      <a class="profil__sortie" href="deconnexion.php" title="Se déconnecter"><?= icone('sortie') ?></a>
    </div>
  </aside>

  <div class="principal">
    <header class="barre">
      <button class="barre__menu" type="button" data-bascule-menu aria-label="Ouvrir le menu"><?= icone('menu', 20) ?></button>
      <form class="recherche" action="materiels.php" method="get" role="search">
        <?= icone('recherche') ?>
        <input type="search" name="q" placeholder="N° d'inventaire, désignation, direction…"
               value="<?= e($_GET['q'] ?? '') ?>" aria-label="Rechercher un matériel">
        <kbd>/</kbd>
      </form>
      <?php if (est_admin()): ?>
        <a class="btn btn--encre" href="materiel_form.php"><?= icone('plus', 16) ?> Nouveau matériel</a>
      <?php endif; ?>
    </header>

    <main class="contenu">
      <?php foreach ($flashs as $f): ?>
        <div class="flash flash--<?= e($f['type']) ?>" role="status">
          <?= icone($f['type'] === 'erreur' ? 'alerte' : 'coche', 16) ?>
          <span><?= e($f['msg']) ?></span>
          <button type="button" class="flash__fermer" aria-label="Fermer">&times;</button>
        </div>
      <?php endforeach; ?>
