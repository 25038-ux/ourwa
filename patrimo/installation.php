<?php
/*
 * Installation en un clic : crée les tables et charge les données de
 * démonstration à partir de sql/patrimo.sql. Ne fait rien si la base
 * contient déjà l'application.
 */
require_once __DIR__ . '/includes/db.php';

function deja_installe(): bool
{
    return (bool) requete("SHOW TABLES LIKE 'utilisateurs'")->fetchColumn();
}

$message = '';
$ok = false;

if (deja_installe()) {
    $message = "L'application est déjà installée.";
    $ok = true;
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $sql = file_get_contents(__DIR__ . '/sql/patrimo.sql');
    // On retire les commentaires puis on exécute chaque instruction une par une
    $sql = preg_replace('/^\s*--.*$/m', '', $sql);
    $instructions = array_filter(array_map('trim', preg_split('/;\s*\n/', $sql)));
    try {
        foreach ($instructions as $ins) {
            db()->exec($ins);
        }
        $message = 'Installation terminée : tables et données de démonstration créées.';
        $ok = true;
    } catch (PDOException $e) {
        $message = "L'installation a échoué : " . $e->getMessage();
    }
}
?>
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Installation · Patrimo</title>
<link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="assets/css/polices.css">
<link rel="stylesheet" href="assets/css/style.css?v=3">
</head>
<body class="page-connexion">
<main class="connexion__form" style="min-height:100vh">
  <div class="carte-connexion">
    <h2>Installation</h2>
    <?php if ($message): ?>
      <div class="flash flash--<?= $ok ? 'ok' : 'erreur' ?>"><?= htmlspecialchars($message) ?></div>
    <?php endif; ?>
    <?php if ($ok): ?>
      <p class="muet">Comptes de démonstration — mot de passe commun : <code>patrimo2026</code></p>
      <ul class="muet" style="margin:0;padding-left:18px">
        <li><code>admin</code> — responsable du patrimoine</li>
        <li><code>k.brahim</code> — inventaire DSI</li>
        <li><code>c.beibakar</code> — inventaire DAF</li>
      </ul>
      <a class="btn btn--encre btn--large" href="connexion.php">Aller à la connexion</a>
    <?php else: ?>
      <p class="muet">La base de données est vide. Ce bouton crée les 6 tables et charge les données de démonstration (64 matériels, 7 directions).</p>
      <form method="post"><button class="btn btn--encre btn--large" type="submit">Installer Patrimo</button></form>
    <?php endif; ?>
  </div>
</main>
</body>
</html>
