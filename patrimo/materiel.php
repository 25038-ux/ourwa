<?php
require_once __DIR__ . '/includes/fonctions.php';
exiger_connexion();

$id = (int) ($_GET['id'] ?? 0);

function charger_materiel(int $id): ?array
{
    return ligne(
        'SELECT m.*, c.nom AS categorie, c.prefixe,
                d.code AS dir_code, d.nom AS dir_nom, d.localisation
           FROM materiels m
           JOIN categories c ON c.id = m.categorie_id
           LEFT JOIN directions d ON d.id = m.direction_id
          WHERE m.id = ?',
        [$id]
    );
}

$m = charger_materiel($id);
if (!$m) {
    flash("Ce matériel n'existe pas ou a été supprimé.", 'erreur');
    rediriger('materiels.php');
}

$dir_actuelle = $m['direction_id'] ? (int) $m['direction_id'] : null;
$transfert_en_cours = ligne(
    "SELECT t.*, da.nom AS arr_nom, da.code AS arr_code
       FROM transferts t JOIN directions da ON da.id = t.direction_arrivee_id
      WHERE t.materiel_id = ? AND t.statut = 'en_attente'",
    [$id]
);

/* ------------------------------------------------------------------
   Traitement des actions (un seul formulaire POST par action)
   ------------------------------------------------------------------ */
if (est_post()) {
    verifier_csrf();
    $action = $_POST['action'] ?? '';
    $retour = 'materiel.php?id=' . $id;

    if ($action === 'etat') {
        $nouvel = $_POST['etat'] ?? '';
        $obs    = post('observation');

        if (!peut_gerer($dir_actuelle)) {
            flash("Seul le responsable de la direction peut changer l'état de ce matériel.", 'erreur');
        } elseif ($m['etat'] === 'reforme') {
            flash('Un matériel réformé ne peut plus changer d\'état.', 'erreur');
        } elseif (!isset(ETATS[$nouvel]) || $nouvel === $m['etat']) {
            flash('Choisissez un état différent de l\'état actuel.', 'erreur');
        } elseif (!$obs) {
            flash('Indiquez une observation (cause de la panne, prestataire, décision…).', 'erreur');
        } else {
            db()->beginTransaction();
            requete('UPDATE materiels SET etat = ?, modifie_le = NOW() WHERE id = ?', [$nouvel, $id]);
            journaliser($id, 'etat', [
                'depart' => $dir_actuelle, 'arrivee' => $dir_actuelle,
                'etat_avant' => $m['etat'], 'etat_apres' => $nouvel, 'observation' => $obs,
            ]);
            // Un matériel réformé ne peut plus partir : on annule la demande éventuelle
            if ($nouvel === 'reforme' && $transfert_en_cours) {
                requete("UPDATE transferts SET statut = 'annule', cloture_le = NOW() WHERE id = ?", [$transfert_en_cours['id']]);
            }
            db()->commit();
            flash('État mis à jour : ' . libelle_etat($nouvel) . '.');
        }
        rediriger($retour);
    }

    if ($action === 'affecter' && est_admin()) {
        $dest = (int) ($_POST['direction_id'] ?? 0);
        if ($dir_actuelle) {
            flash('Ce matériel est déjà affecté. Passez par une demande de transfert.', 'erreur');
        } elseif (!ligne('SELECT id FROM directions WHERE id = ?', [$dest])) {
            flash('Choisissez une direction.', 'erreur');
        } else {
            requete('UPDATE materiels SET direction_id = ?, modifie_le = NOW() WHERE id = ?', [$dest, $id]);
            journaliser($id, 'affectation', ['arrivee' => $dest, 'observation' => post('observation')]);
            flash('Matériel affecté.');
        }
        rediriger($retour);
    }

    if ($action === 'transfert') {
        $dest  = (int) ($_POST['direction_id'] ?? 0);
        $motif = post('motif');

        if (!$dir_actuelle || !peut_gerer($dir_actuelle)) {
            flash('Vous ne pouvez demander un transfert que depuis votre direction.', 'erreur');
        } elseif ($m['etat'] === 'reforme') {
            flash('Un matériel réformé ne peut pas être transféré.', 'erreur');
        } elseif ($transfert_en_cours) {
            flash('Une demande de transfert est déjà en cours pour ce matériel.', 'erreur');
        } elseif ($dest === $dir_actuelle || !ligne('SELECT id FROM directions WHERE id = ?', [$dest])) {
            flash('Choisissez une direction d\'arrivée différente de la direction actuelle.', 'erreur');
        } elseif (!$motif) {
            flash('Précisez le motif du transfert.', 'erreur');
        } else {
            // Si c'est le responsable de départ qui demande, sa validation est implicite
            $auto = !est_admin() && ma_direction() === $dir_actuelle;
            requete(
                'INSERT INTO transferts (materiel_id, direction_depart_id, direction_arrivee_id, motif, demande_par,
                                         valide_depart_par, valide_depart_le)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$id, $dir_actuelle, $dest, $motif, utilisateur()['id'],
                 $auto ? utilisateur()['id'] : null, $auto ? date('Y-m-d H:i:s') : null]
            );
            flash('Demande de transfert envoyée. Le matériel changera de direction après validation.');
        }
        rediriger($retour);
    }

    if ($action === 'supprimer' && est_admin()) {
        requete('DELETE FROM materiels WHERE id = ?', [$id]);
        flash('Matériel ' . $m['numero_inventaire'] . ' supprimé de l\'inventaire.');
        rediriger('materiels.php');
    }

    rediriger($retour);
}

$historique = requete(SQL_MOUVEMENTS . ' WHERE mv.materiel_id = ? ORDER BY mv.date_mouvement DESC, mv.id DESC', [$id])->fetchAll();

$age = '';
if ($m['date_acquisition']) {
    $ans = (int) (new DateTime($m['date_acquisition']))->diff(new DateTime())->y;
    $age = $ans < 1 ? "moins d'un an" : $ans . ' an' . ($ans > 1 ? 's' : '');
}
$gerable = peut_gerer($dir_actuelle);

$titre = $m['numero_inventaire'];
$page  = 'materiels';
require __DIR__ . '/includes/haut.php';
?>

<a class="retour" href="materiels.php"><?= icone('retour', 16) ?> Matériels</a>

<div class="fiche">
  <div class="fiche__principal">

    <article class="plaque" id="plaque">
      <div class="plaque__haut">
        <span class="plaque__cat"><?= e($m['prefixe']) ?> · <?= e($m['categorie']) ?></span>
        <span class="plaque__org"><?= e(APP_ORGANISME) ?></span>
      </div>
      <p class="plaque__numero mono"><?= e($m['numero_inventaire']) ?></p>
      <div class="codebarre" aria-hidden="true" data-code="<?= e($m['numero_inventaire']) ?>"></div>
      <h1 class="plaque__titre"><?= e($m['designation']) ?></h1>
      <p class="plaque__sous"><?= e(trim($m['marque'] . ' ' . $m['modele'])) ?: '&nbsp;' ?></p>
      <span class="tampon tampon--<?= e($m['etat']) ?>"><?= e(libelle_etat($m['etat'])) ?></span>
    </article>

    <section class="bloc">
      <header class="bloc__tete"><h2>Informations</h2>
        <?php if (est_admin()): ?>
          <a class="btn btn--petit" href="materiel_form.php?id=<?= $id ?>"><?= icone('crayon', 15) ?> Modifier</a>
        <?php endif; ?>
      </header>
      <dl class="infos">
        <div><dt>Direction actuelle</dt>
          <dd><?php if ($m['dir_nom']): ?><?= e($m['dir_nom']) ?> <span class="code-dir"><?= e($m['dir_code']) ?></span>
              <?php if ($m['localisation']): ?><small class="muet"><?= e($m['localisation']) ?></small><?php endif; ?>
              <?php else: ?><span class="muet">Magasin central — non affecté</span><?php endif; ?></dd></div>
        <div><dt>Numéro de série</dt><dd class="mono"><?= e($m['numero_serie'] ?: '—') ?></dd></div>
        <div><dt>Marque</dt><dd><?= e($m['marque'] ?: '—') ?></dd></div>
        <div><dt>Modèle</dt><dd><?= e($m['modele'] ?: '—') ?></dd></div>
        <div><dt>Date d'acquisition</dt><dd><?= date_fr($m['date_acquisition']) ?><?= $age ? ' <small class="muet">(' . $age . ')</small>' : '' ?></dd></div>
        <div><dt>Dernière modification</dt><dd><?= date_fr($m['modifie_le'] ?? $m['cree_le'], true) ?></dd></div>
        <?php if ($m['observation']): ?>
          <div class="infos__large"><dt>Observation</dt><dd><?= nl2br(e($m['observation'])) ?></dd></div>
        <?php endif; ?>
      </dl>
    </section>

    <section class="bloc">
      <header class="bloc__tete"><h2>Historique des mouvements</h2><span class="muet"><?= count($historique) ?> événement<?= count($historique) > 1 ? 's' : '' ?></span></header>
      <ol class="chronologie">
        <?php foreach ($historique as $mv): ?>
          <li class="chronologie__point chronologie__point--<?= e($mv['type']) ?>">
            <div class="chronologie__date mono">
              <?= date('d/m/Y', strtotime($mv['date_mouvement'])) ?>
              <small><?= date('H\hi', strtotime($mv['date_mouvement'])) ?></small>
            </div>
            <div class="chronologie__corps">
              <p class="chronologie__type"><?= e(TYPES_MOUVEMENT[$mv['type']]) ?></p>
              <p><?= resume_mouvement($mv) ?></p>
              <?php if ($mv['observation']): ?><p class="chronologie__obs">« <?= e($mv['observation']) ?> »</p><?php endif; ?>
              <?php if ($mv['auteur']): ?><p class="muet petit">par <?= e($mv['auteur']) ?></p><?php endif; ?>
            </div>
          </li>
        <?php endforeach; ?>
      </ol>
    </section>
  </div>

  <aside class="fiche__actions">
    <?php if ($transfert_en_cours): ?>
      <div class="encart encart--attente">
        <p class="encart__titre"><?= icone('fleches', 16) ?> Transfert en cours</p>
        <p>Vers <strong><?= e($transfert_en_cours['arr_nom']) ?></strong>, demandé <?= il_y_a($transfert_en_cours['demande_le']) ?>.</p>
        <ul class="validations">
          <li class="<?= $transfert_en_cours['valide_depart_par'] ? 'ok' : '' ?>">Direction de départ</li>
          <li class="<?= $transfert_en_cours['valide_arrivee_par'] ? 'ok' : '' ?>">Direction d'arrivée</li>
        </ul>
        <a class="lien-discret" href="transferts.php">Voir la demande</a>
      </div>
    <?php endif; ?>

    <?php if ($m['etat'] === 'reforme'): ?>
      <div class="encart encart--reforme">
        <p class="encart__titre">Matériel réformé</p>
        <p>Il est sorti du parc actif. Sa fiche et son historique restent consultables.</p>
      </div>
    <?php elseif ($gerable): ?>

      <form method="post" class="encart" data-valider novalidate>
        <?= champ_csrf() ?>
        <input type="hidden" name="action" value="etat">
        <p class="encart__titre">Changer l'état</p>
        <div class="choix-etat">
          <?php foreach (ETATS as $k => $l): if ($k === $m['etat']) continue; ?>
            <label><input type="radio" name="etat" value="<?= $k ?>" required><span><i class="point point--<?= $k ?>"></i><?= $l ?></span></label>
          <?php endforeach; ?>
        </div>
        <label class="champ">
          <span>Observation</span>
          <textarea name="observation" rows="2" required placeholder="Ex. : écran noir au démarrage, envoyé chez le prestataire"></textarea>
        </label>
        <button class="btn btn--plein" type="submit" data-confirmer-reforme>Enregistrer</button>
      </form>

      <?php if ($dir_actuelle && !$transfert_en_cours): ?>
        <form method="post" class="encart" data-valider novalidate>
          <?= champ_csrf() ?>
          <input type="hidden" name="action" value="transfert">
          <p class="encart__titre">Demander un transfert</p>
          <label class="champ">
            <span>Vers la direction</span>
            <select name="direction_id" required>
              <option value="">Choisir…</option>
              <?php foreach (liste_directions() as $d): if ((int) $d['id'] === $dir_actuelle) continue; ?>
                <option value="<?= $d['id'] ?>"><?= e($d['code'] . ' · ' . $d['nom']) ?></option>
              <?php endforeach; ?>
            </select>
          </label>
          <label class="champ">
            <span>Motif</span>
            <input type="text" name="motif" required maxlength="255" placeholder="Ex. : renfort du service courrier">
          </label>
          <p class="aide">Le matériel restera à la <?= e($m['dir_code']) ?> jusqu'à la validation des deux responsables d'inventaire.</p>
          <button class="btn" type="submit"><?= icone('fleches', 16) ?> Envoyer la demande</button>
        </form>
      <?php endif; ?>

      <?php if (!$dir_actuelle && est_admin()): ?>
        <form method="post" class="encart" data-valider novalidate>
          <?= champ_csrf() ?>
          <input type="hidden" name="action" value="affecter">
          <p class="encart__titre">Affecter à une direction</p>
          <label class="champ">
            <span>Direction</span>
            <select name="direction_id" required>
              <option value="">Choisir…</option>
              <?php foreach (liste_directions() as $d): ?>
                <option value="<?= $d['id'] ?>"><?= e($d['code'] . ' · ' . $d['nom']) ?></option>
              <?php endforeach; ?>
            </select>
          </label>
          <label class="champ">
            <span>Observation <small>(facultatif)</small></span>
            <input type="text" name="observation" maxlength="255" placeholder="Ex. : bureau 12, remplacement du poste HS">
          </label>
          <button class="btn btn--plein" type="submit">Affecter</button>
        </form>
      <?php endif; ?>

    <?php else: ?>
      <div class="encart encart--info">
        <p>Ce matériel appartient à <?= $m['dir_nom'] ? 'la direction <strong>' . e($m['dir_code']) . '</strong>' : 'au magasin central' ?>.
           Seul son responsable d'inventaire peut modifier son état ou demander un transfert.</p>
      </div>
    <?php endif; ?>

    <div class="encart encart--outils">
      <button class="btn btn--fantome" type="button" data-imprimer><?= icone('imprimer', 16) ?> Imprimer l'étiquette</button>
      <?php if (est_admin()): ?>
        <form method="post" data-confirmer="Supprimer définitivement <?= e($m['numero_inventaire']) ?> et tout son historique ? Pour un matériel hors d'usage, préférez l'état « Réformé ».">
          <?= champ_csrf() ?>
          <input type="hidden" name="action" value="supprimer">
          <button class="btn btn--fantome btn--danger" type="submit"><?= icone('poubelle', 16) ?> Supprimer</button>
        </form>
      <?php endif; ?>
    </div>
  </aside>
</div>

<?php require __DIR__ . '/includes/bas.php'; ?>
