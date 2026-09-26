<?php
require_once __DIR__ . '/includes/fonctions.php';
exiger_connexion();

$moi = (int) utilisateur()['id'];
$ma_dir = ma_direction();

function peut_valider(array $t, string $cote): bool
{
    if ($cote === 'depart' && $t['valide_depart_par']) return false;
    if ($cote === 'arrivee' && $t['valide_arrivee_par']) return false;
    if (est_admin()) return true;
    $dir = $cote === 'depart' ? $t['direction_depart_id'] : $t['direction_arrivee_id'];
    return ma_direction() === (int) $dir;
}

if (est_post()) {
    verifier_csrf();
    $t = ligne("SELECT t.*, m.direction_id AS dir_materiel, m.etat
                  FROM transferts t JOIN materiels m ON m.id = t.materiel_id
                 WHERE t.id = ? AND t.statut = 'en_attente'", [(int) ($_POST['id'] ?? 0)]);
    if (!$t) {
        flash('Cette demande a déjà été traitée.', 'erreur');
        rediriger('transferts.php');
    }
    $action = $_POST['action'] ?? '';

    if ($action === 'valider') {
        $cote = $_POST['cote'] === 'arrivee' ? 'arrivee' : 'depart';
        if (!peut_valider($t, $cote)) {
            flash("Vous n'êtes pas responsable de cette direction.", 'erreur');
            rediriger('transferts.php');
        }

        db()->beginTransaction();
        requete("UPDATE transferts SET valide_{$cote}_par = ?, valide_{$cote}_le = NOW() WHERE id = ?", [$moi, $t['id']]);
        $t["valide_{$cote}_par"] = $moi;

        // Les deux signatures sont là : le matériel change réellement de direction
        if ($t['valide_depart_par'] && $t['valide_arrivee_par']) {
            if ((int) $t['dir_materiel'] !== (int) $t['direction_depart_id'] || $t['etat'] === 'reforme') {
                requete("UPDATE transferts SET statut = 'annule', cloture_le = NOW() WHERE id = ?", [$t['id']]);
                db()->commit();
                flash('Le matériel a changé de situation entre-temps : la demande a été annulée.', 'erreur');
                rediriger('transferts.php');
            }
            requete('UPDATE materiels SET direction_id = ?, modifie_le = NOW() WHERE id = ?', [$t['direction_arrivee_id'], $t['materiel_id']]);
            requete("UPDATE transferts SET statut = 'valide', cloture_le = NOW() WHERE id = ?", [$t['id']]);
            journaliser((int) $t['materiel_id'], 'transfert', [
                'depart' => $t['direction_depart_id'], 'arrivee' => $t['direction_arrivee_id'],
                'observation' => $t['motif'],
            ]);
            flash('Transfert validé par les deux directions : le matériel a été déplacé.');
        } else {
            flash('Validation enregistrée. En attente de l\'autre direction.');
        }
        db()->commit();
    }

    if ($action === 'refuser') {
        $motif = post('motif_refus');
        if (!peut_valider($t, 'depart') && !peut_valider($t, 'arrivee') && !est_admin()) {
            flash("Vous ne pouvez pas refuser cette demande.", 'erreur');
        } elseif (!$motif) {
            flash('Indiquez la raison du refus.', 'erreur');
        } else {
            requete("UPDATE transferts SET statut = 'refuse', refuse_par = ?, motif_refus = ?, cloture_le = NOW() WHERE id = ?", [$moi, $motif, $t['id']]);
            flash('Demande refusée.');
        }
    }

    if ($action === 'annuler' && ((int) $t['demande_par'] === $moi || est_admin())) {
        requete("UPDATE transferts SET statut = 'annule', cloture_le = NOW() WHERE id = ?", [$t['id']]);
        flash('Demande annulée.');
    }

    rediriger('transferts.php');
}

$onglet = ($_GET['vue'] ?? '') === 'clotures' ? 'clotures' : 'attente';

$sql = "SELECT t.*, m.numero_inventaire, m.designation,
               dd.code AS dep_code, dd.nom AS dep_nom, da.code AS arr_code, da.nom AS arr_nom,
               ud.nom_complet AS demandeur, uvd.nom_complet AS val_dep, uva.nom_complet AS val_arr,
               ur.nom_complet AS refuseur
          FROM transferts t
          JOIN materiels m   ON m.id = t.materiel_id
          JOIN directions dd ON dd.id = t.direction_depart_id
          JOIN directions da ON da.id = t.direction_arrivee_id
          LEFT JOIN utilisateurs ud  ON ud.id = t.demande_par
          LEFT JOIN utilisateurs uvd ON uvd.id = t.valide_depart_par
          LEFT JOIN utilisateurs uva ON uva.id = t.valide_arrivee_par
          LEFT JOIN utilisateurs ur  ON ur.id = t.refuse_par";

$demandes = $onglet === 'attente'
    ? requete($sql . " WHERE t.statut = 'en_attente' ORDER BY t.demande_le")->fetchAll()
    : requete($sql . " WHERE t.statut <> 'en_attente' ORDER BY t.cloture_le DESC LIMIT 60")->fetchAll();

$nb_attente = (int) valeur("SELECT COUNT(*) FROM transferts WHERE statut = 'en_attente'");

const STATUTS = ['valide' => 'Validé', 'refuse' => 'Refusé', 'annule' => 'Annulé', 'en_attente' => 'En attente'];

$titre = 'Transferts';
$page  = 'transferts';
require __DIR__ . '/includes/haut.php';
?>

<div class="entete-page">
  <div>
    <h1>Transferts</h1>
    <p class="muet">Un matériel ne change de direction qu'après la validation des deux responsables d'inventaire.</p>
  </div>
</div>

<nav class="onglets">
  <a href="transferts.php" class="<?= $onglet === 'attente' ? 'actif' : '' ?>">En attente <span class="onglets__nb"><?= $nb_attente ?></span></a>
  <a href="?vue=clotures" class="<?= $onglet === 'clotures' ? 'actif' : '' ?>">Clôturés</a>
</nav>

<?php if (!$demandes): ?>
  <div class="bloc vide vide--grand">
    <p><strong><?= $onglet === 'attente' ? 'Aucune demande en attente.' : 'Aucun transfert clôturé pour le moment.' ?></strong></p>
    <p class="muet">Une demande se crée depuis la fiche d'un matériel, bouton « Demander un transfert ».</p>
  </div>
<?php endif; ?>

<div class="demandes">
  <?php foreach ($demandes as $t): ?>
    <article class="demande demande--<?= e($t['statut']) ?>">
      <div class="demande__materiel">
        <a href="materiel.php?id=<?= $t['materiel_id'] ?>"><?= etiquette($t['numero_inventaire']) ?></a>
        <h3><?= e($t['designation']) ?></h3>
        <p class="muet petit">Demandé par <?= e($t['demandeur'] ?? '—') ?>, <?= date_fr($t['demande_le']) ?></p>
      </div>

      <div class="demande__trajet">
        <span class="demande__dir"><span class="code-dir"><?= e($t['dep_code']) ?></span><small><?= e($t['dep_nom']) ?></small></span>
        <span class="demande__fleche" aria-hidden="true"></span>
        <span class="demande__dir"><span class="code-dir"><?= e($t['arr_code']) ?></span><small><?= e($t['arr_nom']) ?></small></span>
        <?php if ($t['motif']): ?><p class="demande__motif">« <?= e($t['motif']) ?> »</p><?php endif; ?>
      </div>

      <div class="demande__statut">
        <?php if ($t['statut'] === 'en_attente'): ?>
          <ul class="validations">
            <li class="<?= $t['val_dep'] ? 'ok' : '' ?>">Départ <?= $t['val_dep'] ? '<small>' . e($t['val_dep']) . '</small>' : '<small>en attente</small>' ?></li>
            <li class="<?= $t['val_arr'] ? 'ok' : '' ?>">Arrivée <?= $t['val_arr'] ? '<small>' . e($t['val_arr']) . '</small>' : '<small>en attente</small>' ?></li>
          </ul>
          <div class="demande__boutons">
            <?php foreach (['depart', 'arrivee'] as $cote): if (!peut_valider($t, $cote)) continue; ?>
              <form method="post">
                <?= champ_csrf() ?>
                <input type="hidden" name="id" value="<?= $t['id'] ?>">
                <input type="hidden" name="action" value="valider">
                <input type="hidden" name="cote" value="<?= $cote ?>">
                <button class="btn btn--plein btn--petit"><?= icone('coche', 15) ?> Valider <?= $cote === 'depart' ? 'le départ' : "l'arrivée" ?></button>
              </form>
            <?php endforeach; ?>

            <?php if (peut_valider($t, 'depart') || peut_valider($t, 'arrivee') || est_admin()): ?>
              <details class="refus">
                <summary class="btn btn--fantome btn--petit">Refuser</summary>
                <form method="post" data-valider novalidate>
                  <?= champ_csrf() ?>
                  <input type="hidden" name="id" value="<?= $t['id'] ?>">
                  <input type="hidden" name="action" value="refuser">
                  <input type="text" name="motif_refus" required placeholder="Raison du refus" maxlength="255">
                  <button class="btn btn--danger btn--petit">Confirmer le refus</button>
                </form>
              </details>
            <?php endif; ?>

            <?php if ((int) $t['demande_par'] === $moi): ?>
              <form method="post" data-confirmer="Annuler cette demande de transfert ?">
                <?= champ_csrf() ?>
                <input type="hidden" name="id" value="<?= $t['id'] ?>">
                <input type="hidden" name="action" value="annuler">
                <button class="lien-discret" type="submit">Annuler ma demande</button>
              </form>
            <?php endif; ?>
          </div>
        <?php else: ?>
          <span class="statut statut--<?= e($t['statut']) ?>"><?= STATUTS[$t['statut']] ?></span>
          <p class="muet petit"><?= date_fr($t['cloture_le']) ?></p>
          <?php if ($t['statut'] === 'refuse'): ?>
            <p class="petit">Refusé par <?= e($t['refuseur'] ?? '—') ?> : « <?= e($t['motif_refus']) ?> »</p>
          <?php endif; ?>
        <?php endif; ?>
      </div>
    </article>
  <?php endforeach; ?>
</div>

<?php require __DIR__ . '/includes/bas.php'; ?>
