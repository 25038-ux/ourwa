<?php
require_once __DIR__ . '/includes/fonctions.php';
exiger_connexion();

/* --- Chiffres globaux --- */
$par_etat = array_fill_keys(array_keys(ETATS), 0);
foreach (requete('SELECT etat, COUNT(*) n FROM materiels GROUP BY etat') as $r) {
    $par_etat[$r['etat']] = (int) $r['n'];
}
$total        = array_sum($par_etat);
$en_magasin   = (int) valeur('SELECT COUNT(*) FROM materiels WHERE direction_id IS NULL');
$nb_directions = (int) valeur('SELECT COUNT(*) FROM directions');

/* --- Répartition par direction (barres empilées par état) --- */
$directions = requete(
    "SELECT d.id, d.code, d.nom,
            COUNT(m.id) AS total,
            SUM(m.etat = 'en_service')    AS en_service,
            SUM(m.etat = 'en_panne')      AS en_panne,
            SUM(m.etat = 'en_reparation') AS en_reparation,
            SUM(m.etat = 'reforme')       AS reforme
       FROM directions d
       LEFT JOIN materiels m ON m.direction_id = d.id
      GROUP BY d.id, d.code, d.nom
      ORDER BY total DESC, d.nom"
)->fetchAll();
$max_dir = max(1, ...array_map(fn($d) => (int) $d['total'], $directions ?: [['total' => 1]]));

$categories = requete(
    'SELECT c.nom, c.prefixe, COUNT(m.id) AS n
       FROM categories c LEFT JOIN materiels m ON m.categorie_id = c.id
      GROUP BY c.id, c.nom, c.prefixe ORDER BY n DESC'
)->fetchAll();

/* --- Matériels en panne, du plus ancien au plus récent --- */
$pannes = requete(
    "SELECT m.id, m.numero_inventaire, m.designation, d.code AS dir_code,
            (SELECT MAX(date_mouvement) FROM mouvements
              WHERE materiel_id = m.id AND type = 'etat') AS depuis
       FROM materiels m LEFT JOIN directions d ON d.id = m.direction_id
      WHERE m.etat = 'en_panne'
      ORDER BY depuis ASC LIMIT 5"
)->fetchAll();

$transferts = requete(
    "SELECT t.*, m.numero_inventaire, m.designation,
            dd.code AS dep_code, da.code AS arr_code
       FROM transferts t
       JOIN materiels m   ON m.id = t.materiel_id
       JOIN directions dd ON dd.id = t.direction_depart_id
       JOIN directions da ON da.id = t.direction_arrivee_id
      WHERE t.statut = 'en_attente'
      ORDER BY t.demande_le LIMIT 4"
)->fetchAll();

$derniers = requete(SQL_MOUVEMENTS . ' ORDER BY mv.date_mouvement DESC, mv.id DESC LIMIT 9')->fetchAll();

function pct(int $n, int $total): string
{
    return ($total ? round($n * 100 / $total) : 0) . "\u{202F}%"; // espace fine insécable avant %
}

$titre = 'Tableau de bord';
$page  = 'accueil';
require __DIR__ . '/includes/haut.php';
?>

<div class="entete-page">
  <div>
    <p class="surtitre"><?= aujourdhui_fr() ?></p>
    <h1>État du parc</h1>
    <p class="muet"><?= $total ?> matériels suivis dans <?= $nb_directions ?> directions<?php if ($en_magasin): ?>, dont <?= $en_magasin ?> encore au magasin central<?php endif; ?>.</p>
  </div>
</div>

<section class="registre" aria-label="Chiffres clés">
  <div class="registre__case registre__case--total">
    <span class="registre__label">Total inventorié</span>
    <span class="registre__nombre"><?= $total ?></span>
    <div class="repartition" aria-hidden="true">
      <?php foreach ($par_etat as $etat => $n): if (!$n) continue; ?>
        <span class="fond--<?= $etat ?>" style="flex:<?= $n ?>"></span>
      <?php endforeach; ?>
    </div>
  </div>
  <?php foreach ($par_etat as $etat => $n): ?>
    <a class="registre__case" href="materiels.php?etat=<?= $etat ?>">
      <span class="registre__label"><i class="point point--<?= $etat ?>"></i><?= libelle_etat($etat) ?></span>
      <span class="registre__nombre"><?= $n ?></span>
      <span class="registre__pct"><?= pct($n, $total) ?></span>
    </a>
  <?php endforeach; ?>
</section>

<div class="grille-accueil">
 <div class="colonne">
  <section class="bloc bloc--directions">
    <header class="bloc__tete">
      <h2>Matériels par direction</h2>
      <ul class="legende">
        <?php foreach (ETATS as $k => $l): ?><li><i class="point point--<?= $k ?>"></i><?= $l ?></li><?php endforeach; ?>
      </ul>
    </header>
    <ul class="barres">
      <?php foreach ($directions as $d): ?>
        <li>
          <a href="materiels.php?direction=<?= $d['id'] ?>" class="barres__nom" title="<?= e($d['nom']) ?>">
            <span class="mono"><?= e($d['code']) ?></span> <?= e($d['nom']) ?>
          </a>
          <span class="barres__piste">
            <span class="barres__plein" style="width:<?= round($d['total'] / $max_dir * 100, 1) ?>%">
              <?php foreach (array_keys(ETATS) as $k): if (!(int) $d[$k]) continue; ?>
                <span class="fond--<?= $k ?>" style="flex:<?= (int) $d[$k] ?>" title="<?= (int) $d[$k] . ' ' . mb_strtolower(libelle_etat($k)) ?>"></span>
              <?php endforeach; ?>
            </span>
          </span>
          <span class="barres__total"><?= (int) $d['total'] ?></span>
        </li>
      <?php endforeach; ?>
    </ul>
  </section>

  <section class="bloc bloc--journal">
    <header class="bloc__tete">
      <h2>Derniers mouvements</h2>
      <a class="lien-discret" href="mouvements.php">Historique complet</a>
    </header>
    <ol class="journal">
      <?php foreach ($derniers as $mv): ?>
        <li class="journal__ligne journal__ligne--<?= e($mv['type']) ?>">
          <time class="mono" datetime="<?= e($mv['date_mouvement']) ?>"><?= date('d/m', strtotime($mv['date_mouvement'])) ?></time>
          <div>
            <p><a href="materiel.php?id=<?= $mv['materiel_id'] ?>"><?= e($mv['designation']) ?></a></p>
            <p class="journal__detail"><?= resume_mouvement($mv) ?></p>
          </div>
        </li>
      <?php endforeach; ?>
    </ol>
  </section>
 </div>

 <div class="colonne">
  <section class="bloc">
    <header class="bloc__tete">
      <h2>Transferts à valider</h2>
      <a class="lien-discret" href="transferts.php">Tout voir</a>
    </header>
    <?php if (!$transferts): ?>
      <p class="vide">Aucune demande en attente.</p>
    <?php else: ?>
      <ul class="liste-simple">
        <?php foreach ($transferts as $t): ?>
          <li>
            <a href="materiel.php?id=<?= $t['materiel_id'] ?>"><?= etiquette($t['numero_inventaire']) ?></a>
            <span class="liste-simple__texte"><?= e($t['designation']) ?>
              <small><?= e($t['dep_code']) ?> → <?= e($t['arr_code']) ?> ·
                <?= $t['valide_depart_par'] ? 'attend l\'arrivée' : 'attend le départ' ?></small>
            </span>
          </li>
        <?php endforeach; ?>
      </ul>
    <?php endif; ?>

    <header class="bloc__tete bloc__tete--sep">
      <h2>En panne</h2>
      <a class="lien-discret" href="materiels.php?etat=en_panne">Liste</a>
    </header>
    <?php if (!$pannes): ?>
      <p class="vide">Rien à signaler.</p>
    <?php else: ?>
      <ul class="liste-simple">
        <?php foreach ($pannes as $p): ?>
          <li>
            <a href="materiel.php?id=<?= $p['id'] ?>"><?= etiquette($p['numero_inventaire']) ?></a>
            <span class="liste-simple__texte"><?= e($p['designation']) ?>
              <small><?= e($p['dir_code'] ?? 'Magasin') ?> · signalé <?= $p['depuis'] ? il_y_a($p['depuis']) : '' ?></small>
            </span>
          </li>
        <?php endforeach; ?>
      </ul>
    <?php endif; ?>
  </section>

  <section class="bloc">
    <header class="bloc__tete"><h2>Par catégorie</h2></header>
    <table class="mini-table">
      <?php foreach ($categories as $c): ?>
        <tr>
          <td><span class="prefixe"><?= e($c['prefixe']) ?></span> <?= e($c['nom']) ?></td>
          <td class="num"><?= (int) $c['n'] ?></td>
        </tr>
      <?php endforeach; ?>
    </table>
  </section>
 </div>
</div>

<?php require __DIR__ . '/includes/bas.php'; ?>
