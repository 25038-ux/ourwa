<?php
require_once __DIR__ . '/includes/fonctions.php';

if (utilisateur()) rediriger('index.php');

$erreur = '';
$identifiant = '';

// Petit frein contre les essais répétés : 5 échecs = 5 minutes d'attente
$echecs  = $_SESSION['echecs'] ?? 0;
$bloque  = ($_SESSION['bloque_jusqua'] ?? 0) > time();

if (est_post()) {
    verifier_csrf();
    $identifiant = trim($_POST['identifiant'] ?? '');
    $mdp = (string) ($_POST['mot_de_passe'] ?? '');

    if ($bloque) {
        $erreur = 'Trop de tentatives. Réessayez dans quelques minutes.';
    } elseif ($identifiant === '' || $mdp === '') {
        $erreur = 'Renseignez votre identifiant et votre mot de passe.';
    } elseif (connecter($identifiant, $mdp)) {
        unset($_SESSION['echecs'], $_SESSION['bloque_jusqua']);
        rediriger('index.php');
    } else {
        $_SESSION['echecs'] = ++$echecs;
        if ($echecs >= 5) {
            $_SESSION['bloque_jusqua'] = time() + 300;
            $_SESSION['echecs'] = 0;
        }
        $erreur = 'Identifiant ou mot de passe incorrect.';
    }
}
?>
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connexion · <?= APP_NOM ?></title>
<link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="assets/css/polices.css">
<link rel="stylesheet" href="assets/css/style.css?v=3">
</head>
<body class="page-connexion">

<main class="connexion">
  <section class="connexion__visuel" aria-hidden="true">
    <div class="connexion__entete">
      <svg class="marque__logo" viewBox="0 0 40 40">
        <path d="M9 6h17l8 8v20H9z" fill="currentColor"/>
        <path d="M26 6v8h8" fill="none" stroke="var(--encre)" stroke-width="1.6" stroke-linejoin="round"/>
        <circle cx="15.5" cy="13" r="2.4" fill="var(--encre)"/>
        <path d="M14 22h13M14 26h13M14 30h8" stroke="var(--encre)" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
      <span>Patrimo</span>
    </div>

    <h1>Où se trouve ce matériel, dans quel état,<br><em>et par où est-il passé&nbsp;?</em></h1>

    <!-- La "fiche" décorative reprend une vraie fiche d'inventaire papier -->
    <div class="fiche-papier">
      <div class="fiche-papier__trou"></div>
      <p class="fiche-papier__titre">Fiche d'inventaire</p>
      <dl>
        <dt>N°</dt><dd class="mono">IMP-2022-0003</dd>
        <dt>Désignation</dt><dd>Imprimante laser HP LaserJet Pro M404dn</dd>
        <dt>Direction</dt><dd>Affaires Financières</dd>
        <dt>Acquis le</dt><dd class="mono">14/03/2022</dd>
      </dl>
      <ol class="fiche-papier__lignes">
        <li><span class="mono">14/03/22</span> Entrée — magasin central</li>
        <li><span class="mono">21/03/22</span> Affectée à la DAF</li>
        <li><span class="mono">02/11/24</span> Bourrage répété, en panne</li>
        <li><span class="mono">19/11/24</span> Retour de réparation</li>
      </ol>
      <span class="tampon">En service</span>
    </div>

    <p class="connexion__pied">Direction du Patrimoine — suivi du cycle de vie des équipements</p>
  </section>

  <section class="connexion__form">
    <form method="post" class="carte-connexion" data-valider novalidate>
      <h2>Connexion</h2>
      <p class="muet">Accès réservé aux responsables d'inventaire.</p>

      <?php if (isset($_GET['expire'])): ?>
        <div class="flash flash--info">Votre session a expiré, reconnectez-vous.</div>
      <?php endif; ?>
      <?php if ($erreur): ?>
        <div class="flash flash--erreur"><?= e($erreur) ?></div>
      <?php endif; ?>

      <?= champ_csrf() ?>
      <label class="champ">
        <span>Identifiant</span>
        <input type="text" name="identifiant" value="<?= e($identifiant) ?>" autocomplete="username" required autofocus>
      </label>

      <label class="champ">
        <span>Mot de passe</span>
        <span class="champ__mdp">
          <input type="password" name="mot_de_passe" autocomplete="current-password" required>
          <button type="button" data-voir-mdp>Afficher</button>
        </span>
      </label>

      <button class="btn btn--encre btn--large" type="submit">Se connecter</button>

      <details class="demo">
        <summary>Comptes de démonstration</summary>
        <p>Mot de passe commun : <code>patrimo2026</code></p>
        <ul>
          <li><code>admin</code> — responsable du patrimoine</li>
          <li><code>k.brahim</code> — inventaire DSI</li>
          <li><code>c.beibakar</code> — inventaire DAF</li>
        </ul>
      </details>
    </form>
  </section>
</main>

<script src="assets/js/app.js?v=3"></script>
</body>
</html>
