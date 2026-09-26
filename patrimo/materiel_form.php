<?php
require_once __DIR__ . '/includes/fonctions.php';
exiger_admin();

$id = (int) ($_GET['id'] ?? 0);
$modif = $id > 0;

$m = [
    'numero_inventaire' => '', 'designation' => '', 'categorie_id' => '', 'marque' => '',
    'modele' => '', 'numero_serie' => '', 'date_acquisition' => date('Y-m-d'),
    'etat' => 'en_service', 'direction_id' => '', 'observation' => '',
];

if ($modif) {
    $m = ligne('SELECT m.*, d.nom AS dir_nom FROM materiels m LEFT JOIN directions d ON d.id = m.direction_id WHERE m.id = ?', [$id]);
    if (!$m) rediriger('materiels.php');
}

$erreurs = [];

if (est_post()) {
    verifier_csrf();

    $saisie = [
        'numero_inventaire' => mb_strtoupper(post('numero_inventaire') ?? ''),
        'designation'       => post('designation'),
        'categorie_id'      => (int) ($_POST['categorie_id'] ?? 0),
        'marque'            => post('marque'),
        'modele'            => post('modele'),
        'numero_serie'      => post('numero_serie'),
        'date_acquisition'  => post('date_acquisition'),
        'observation'       => post('observation'),
    ];

    if (!preg_match('/^[A-Z0-9][A-Z0-9\-\/]{2,29}$/', $saisie['numero_inventaire'])) {
        $erreurs['numero_inventaire'] = 'Format attendu : lettres, chiffres et tirets (ex. INF-2025-0012).';
    } elseif (valeur('SELECT id FROM materiels WHERE numero_inventaire = ? AND id <> ?', [$saisie['numero_inventaire'], $id])) {
        $erreurs['numero_inventaire'] = 'Ce numéro est déjà attribué à un autre matériel.';
    }
    if (!$saisie['designation']) {
        $erreurs['designation'] = 'La désignation est obligatoire.';
    }
    if (!valeur('SELECT id FROM categories WHERE id = ?', [$saisie['categorie_id']])) {
        $erreurs['categorie_id'] = 'Choisissez une catégorie.';
    }
    if ($saisie['date_acquisition']) {
        $dt = DateTime::createFromFormat('Y-m-d', $saisie['date_acquisition']);
        if (!$dt || $dt->format('Y-m-d') !== $saisie['date_acquisition']) {
            $erreurs['date_acquisition'] = 'Date invalide.';
        } elseif ($saisie['date_acquisition'] > date('Y-m-d')) {
            $erreurs['date_acquisition'] = "La date d'acquisition ne peut pas être dans le futur.";
        }
    }

    // Champs propres à la création : état et direction de départ
    if (!$modif) {
        $saisie['etat'] = isset(ETATS[$_POST['etat'] ?? '']) ? $_POST['etat'] : 'en_service';
        $saisie['direction_id'] = (int) ($_POST['direction_id'] ?? 0) ?: null;
        if ($saisie['direction_id'] && !valeur('SELECT id FROM directions WHERE id = ?', [$saisie['direction_id']])) {
            $erreurs['direction_id'] = 'Direction inconnue.';
        }
    }

    if (!$erreurs) {
        if ($modif) {
            requete(
                'UPDATE materiels SET numero_inventaire = ?, designation = ?, categorie_id = ?, marque = ?, modele = ?,
                        numero_serie = ?, date_acquisition = ?, observation = ?, modifie_le = NOW()
                  WHERE id = ?',
                [$saisie['numero_inventaire'], $saisie['designation'], $saisie['categorie_id'], $saisie['marque'],
                 $saisie['modele'], $saisie['numero_serie'], $saisie['date_acquisition'], $saisie['observation'], $id]
            );
            flash('Fiche mise à jour.');
        } else {
            db()->beginTransaction();
            requete(
                'INSERT INTO materiels (numero_inventaire, designation, categorie_id, marque, modele, numero_serie,
                                        date_acquisition, etat, direction_id, observation)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$saisie['numero_inventaire'], $saisie['designation'], $saisie['categorie_id'], $saisie['marque'],
                 $saisie['modele'], $saisie['numero_serie'], $saisie['date_acquisition'], $saisie['etat'],
                 $saisie['direction_id'], $saisie['observation']]
            );
            $id = (int) db()->lastInsertId();
            journaliser($id, 'entree', ['arrivee' => $saisie['direction_id'], 'etat_apres' => $saisie['etat'],
                                        'observation' => 'Enregistrement dans l\'inventaire']);
            db()->commit();
            flash($saisie['numero_inventaire'] . ' ajouté à l\'inventaire.');
        }
        rediriger('materiel.php?id=' . $id);
    }

    $m = array_merge($m, $saisie);
}

/* Prochain numéro libre par préfixe et par année, pour la suggestion automatique en JS */
$prochains = [];
foreach (requete('SELECT numero_inventaire FROM materiels')->fetchAll(PDO::FETCH_COLUMN) as $num) {
    if (preg_match('/^([A-Z]+)-(\d{4})-(\d+)$/', $num, $p)) {
        $cle = $p[1] . '-' . $p[2];
        $prochains[$cle] = max($prochains[$cle] ?? 0, (int) $p[3]);
    }
}

function erreur_champ(array $erreurs, string $cle): string
{
    return isset($erreurs[$cle]) ? '<span class="champ__erreur">' . e($erreurs[$cle]) . '</span>' : '';
}

$titre = $modif ? 'Modifier ' . $m['numero_inventaire'] : 'Nouveau matériel';
$page  = 'materiels';
require __DIR__ . '/includes/haut.php';
?>

<a class="retour" href="<?= $modif ? 'materiel.php?id=' . $id : 'materiels.php' ?>"><?= icone('retour', 16) ?> <?= $modif ? 'Retour à la fiche' : 'Matériels' ?></a>

<div class="entete-page">
  <div>
    <h1><?= $modif ? 'Modifier la fiche' : 'Enregistrer un matériel' ?></h1>
    <p class="muet"><?= $modif
        ? "L'état et la direction se modifient depuis la fiche, pour garder une trace dans l'historique."
        : 'Les champs marqués d\'un astérisque sont obligatoires.' ?></p>
  </div>
</div>

<form method="post" class="formulaire bloc" data-valider novalidate
      data-prochains='<?= e(json_encode($prochains)) ?>' <?= $modif ? '' : 'data-suggestion' ?>>
  <?= champ_csrf() ?>

  <fieldset>
    <legend>Identification</legend>
    <div class="grille-champs">
      <label class="champ">
        <span>Catégorie *</span>
        <select name="categorie_id" required>
          <option value="">Choisir…</option>
          <?php foreach (liste_categories() as $c): ?>
            <option value="<?= $c['id'] ?>" data-prefixe="<?= e($c['prefixe']) ?>" <?= (int) $m['categorie_id'] === (int) $c['id'] ? 'selected' : '' ?>><?= e($c['nom']) ?></option>
          <?php endforeach; ?>
        </select>
        <?= erreur_champ($erreurs, 'categorie_id') ?>
      </label>

      <label class="champ">
        <span>N° d'inventaire *</span>
        <input type="text" name="numero_inventaire" class="mono" value="<?= e($m['numero_inventaire']) ?>"
               required maxlength="30" pattern="[A-Za-z0-9][A-Za-z0-9\-\/]{2,29}" placeholder="INF-2026-0001" autocomplete="off">
        <small class="aide" data-aide-numero><?= $modif ? '' : 'Proposé automatiquement selon la catégorie et l\'année.' ?></small>
        <?= erreur_champ($erreurs, 'numero_inventaire') ?>
      </label>

      <label class="champ champ--large">
        <span>Désignation *</span>
        <input type="text" name="designation" value="<?= e($m['designation']) ?>" required maxlength="150"
               placeholder="Ex. : Ordinateur portable, Armoire métallique 2 portes…">
        <?= erreur_champ($erreurs, 'designation') ?>
      </label>

      <label class="champ">
        <span>Marque</span>
        <input type="text" name="marque" value="<?= e($m['marque']) ?>" maxlength="60">
      </label>
      <label class="champ">
        <span>Modèle</span>
        <input type="text" name="modele" value="<?= e($m['modele']) ?>" maxlength="80">
      </label>
      <label class="champ">
        <span>Numéro de série</span>
        <input type="text" name="numero_serie" class="mono" value="<?= e($m['numero_serie']) ?>" maxlength="80">
      </label>
      <label class="champ">
        <span>Date d'acquisition</span>
        <input type="date" name="date_acquisition" value="<?= e($m['date_acquisition']) ?>" max="<?= date('Y-m-d') ?>">
        <?= erreur_champ($erreurs, 'date_acquisition') ?>
      </label>
    </div>
  </fieldset>

  <fieldset>
    <legend>Situation</legend>
    <?php if ($modif): ?>
      <div class="grille-champs">
        <div class="champ"><span>État</span><p><?= badge_etat($m['etat']) ?></p></div>
        <div class="champ"><span>Direction</span><p><?= e($m['dir_nom'] ?? 'Magasin central') ?></p></div>
      </div>
    <?php else: ?>
      <div class="grille-champs">
        <label class="champ">
          <span>Direction d'affectation</span>
          <select name="direction_id">
            <option value="">Magasin central (à affecter plus tard)</option>
            <?php foreach (liste_directions() as $d): ?>
              <option value="<?= $d['id'] ?>" <?= (int) $m['direction_id'] === (int) $d['id'] ? 'selected' : '' ?>><?= e($d['code'] . ' · ' . $d['nom']) ?></option>
            <?php endforeach; ?>
          </select>
          <?= erreur_champ($erreurs, 'direction_id') ?>
        </label>
        <label class="champ">
          <span>État à l'entrée</span>
          <select name="etat">
            <?php foreach (ETATS as $k => $l): ?>
              <option value="<?= $k ?>" <?= $m['etat'] === $k ? 'selected' : '' ?>><?= $l ?></option>
            <?php endforeach; ?>
          </select>
        </label>
      </div>
    <?php endif; ?>
    <label class="champ">
      <span>Observation</span>
      <textarea name="observation" rows="3" placeholder="Référence du bon de livraison, garantie, remarques…"><?= e($m['observation']) ?></textarea>
    </label>
  </fieldset>

  <div class="formulaire__pied">
    <a class="btn btn--fantome" href="<?= $modif ? 'materiel.php?id=' . $id : 'materiels.php' ?>">Annuler</a>
    <button class="btn btn--encre" type="submit"><?= $modif ? 'Enregistrer les modifications' : 'Ajouter à l\'inventaire' ?></button>
  </div>
</form>

<?php require __DIR__ . '/includes/bas.php'; ?>
