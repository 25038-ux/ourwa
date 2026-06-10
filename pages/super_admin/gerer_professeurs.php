<?php
/**
 * Super Admin — Gérer les professeurs
 * Assignment: select Niveau first, then Matière list for that Niveau populates
 */

require_once __DIR__ . '/../../includes/bootstrap.php';
require_staff_admin();

$db = getDB();
$message = '';
$type_message = '';

// Helper: recalculate hours + salary
function recalculer_salaire(PDO $db, int $prof_id): void {
    $stmt = $db->prepare('SELECT COALESCE(SUM(heures_par_semaine), 0) FROM enseignements WHERE professeur_id = :p');
    $stmt->execute([':p' => $prof_id]);
    $h_sem = (float) $stmt->fetchColumn();

    $stmt = $db->prepare('SELECT COUNT(DISTINCT groupe_id) FROM enseignements WHERE professeur_id = :p');
    $stmt->execute([':p' => $prof_id]);
    $nb_classes = (int) $stmt->fetchColumn();

    $stmt = $db->prepare('SELECT prix_par_heure FROM professeurs WHERE id = :p');
    $stmt->execute([':p' => $prof_id]);
    $tarif = (float) $stmt->fetchColumn();

    $heures_mois = $h_sem * 4;
    $salaire     = $heures_mois * $tarif;

    $db->prepare('UPDATE professeurs SET heures_par_mois = :hm, nb_classes = :nc, salaire = :s WHERE id = :p')
       ->execute([':hm' => (int) round($heures_mois), ':nc' => $nb_classes, ':s' => $salaire, ':p' => $prof_id]);
}

// POST ACTIONS
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();
    $action = $_POST['action'] ?? 'assigner';

    if ($action === 'assigner') {
        $prof_id    = nettoyer_entier($_POST['professeur_id'] ?? 0) ?? 0;
        $groupe_id  = nettoyer_entier($_POST['groupe_id'] ?? 0) ?? 0;
        $matiere_id = nettoyer_entier($_POST['matiere_id'] ?? 0) ?? 0;
        $h_sem      = nettoyer_decimal($_POST['heures_par_semaine'] ?? 0) ?? 0;

        if (!$prof_id || !$groupe_id || !$matiere_id) {
            $message = 'Professeur, groupe et matière sont obligatoires.';
            $type_message = 'error';
        } elseif ($h_sem <= 0 || $h_sem > 40) {
            $message = 'Le nombre d\'heures par semaine doit être entre 0.5 et 40.';
            $type_message = 'error';
        } else {
            try {
                $db->prepare('INSERT INTO enseignements (professeur_id, groupe_id, matiere_id, heures_par_semaine) VALUES (:p, :g, :m, :h)')
                   ->execute([':p' => $prof_id, ':g' => $groupe_id, ':m' => $matiere_id, ':h' => $h_sem]);
                recalculer_salaire($db, $prof_id);
                $message = 'Assignation créée avec succès !';
                $type_message = 'success';
                regenerer_csrf();
            } catch (PDOException $ex) {
                $message = ($ex->getCode() == 23000)
                    ? 'Cette assignation existe déjà.'
                    : 'Erreur : ' . $ex->getMessage();
                $type_message = 'error';
            }
        }
    }

    elseif ($action === 'mettre_a_jour_tarif') {
        $prof_id = nettoyer_entier($_POST['professeur_id'] ?? 0) ?? 0;
        $tarif   = nettoyer_decimal($_POST['prix_par_heure'] ?? 0) ?? 0;
        if ($prof_id && $tarif >= 0) {
            $db->prepare('UPDATE professeurs SET prix_par_heure = :t WHERE id = :p')
               ->execute([':t' => $tarif, ':p' => $prof_id]);
            recalculer_salaire($db, $prof_id);
            $message = 'Tarif horaire mis à jour. Salaire recalculé.';
            $type_message = 'success';
            regenerer_csrf();
        }
    }

    elseif ($action === 'modifier_heures') {
        $ens_id = nettoyer_entier($_POST['enseignement_id'] ?? 0) ?? 0;
        $h_sem  = nettoyer_decimal($_POST['heures_par_semaine'] ?? 0) ?? 0;
        if ($ens_id && $h_sem > 0 && $h_sem <= 40) {
            $stmt = $db->prepare('SELECT professeur_id FROM enseignements WHERE id = :id');
            $stmt->execute([':id' => $ens_id]);
            $prof_id = (int) $stmt->fetchColumn();
            if ($prof_id) {
                $db->prepare('UPDATE enseignements SET heures_par_semaine = :h WHERE id = :id')
                   ->execute([':h' => $h_sem, ':id' => $ens_id]);
                recalculer_salaire($db, $prof_id);
                $message = 'Volume horaire mis à jour.';
                $type_message = 'success';
            }
            regenerer_csrf();
        }
    }

    elseif ($action === 'supprimer_assignation') {
        $ens_id = nettoyer_entier($_POST['enseignement_id'] ?? 0) ?? 0;
        if ($ens_id) {
            $stmt = $db->prepare('SELECT professeur_id FROM enseignements WHERE id = :id');
            $stmt->execute([':id' => $ens_id]);
            $prof_id = (int) $stmt->fetchColumn();
            if ($prof_id) {
                $db->prepare('DELETE FROM enseignements WHERE id = :id')->execute([':id' => $ens_id]);
                recalculer_salaire($db, $prof_id);
                $message = 'Assignation supprimée.';
                $type_message = 'success';
            }
            regenerer_csrf();
        }
    }

    elseif ($action === 'supprimer_professeur') {
        $prof_id = nettoyer_entier($_POST['professeur_id'] ?? 0) ?? 0;
        if ($prof_id) {
            try {
                $stmt = $db->prepare('SELECT p.nom, p.prenom, p.utilisateur_id FROM professeurs p WHERE p.id = :id');
                $stmt->execute([':id' => $prof_id]);
                $prof_info = $stmt->fetch();
                if ($prof_info) {
                    $db->beginTransaction();
                    $db->prepare('DELETE FROM professeurs WHERE id = :id')->execute([':id' => $prof_id]);
                    $db->prepare('DELETE FROM utilisateurs WHERE id = :id')->execute([':id' => $prof_info['utilisateur_id']]);
                    $db->commit();
                    $message = "Professeur « {$prof_info['prenom']} {$prof_info['nom']} » supprimé.";
                    $type_message = 'success';
                }
            } catch (Throwable $ex) {
                if ($db->inTransaction()) $db->rollBack();
                $message = 'Erreur : ' . $ex->getMessage();
                $type_message = 'error';
            }
            regenerer_csrf();
        }
    }
}

// LOAD DATA
$professeurs = $db->query('
    SELECT p.*, u.identifiant,
           COALESCE(SUM(e.heures_par_semaine), 0) AS total_h_sem
    FROM professeurs p
    JOIN utilisateurs u ON p.utilisateur_id = u.id
    LEFT JOIN enseignements e ON e.professeur_id = p.id
    GROUP BY p.id, u.identifiant
    ORDER BY p.nom, p.prenom
')->fetchAll();

$niveaux = $db->query('SELECT * FROM niveaux ORDER BY nom')->fetchAll();
$groupes = $db->query('SELECT g.*, n.nom AS niveau_nom FROM groupes g LEFT JOIN niveaux n ON g.niveau_id = n.id ORDER BY n.nom, g.nom')->fetchAll();

// Matieres grouped by niveau (for JSON)
$matieres_par_niveau = [];
$all_matieres = $db->query('SELECT * FROM matieres WHERE niveau_id IS NOT NULL ORDER BY nom')->fetchAll();
foreach ($all_matieres as $m) {
    $matieres_par_niveau[$m['niveau_id']][] = ['id' => $m['id'], 'nom' => $m['nom']];
}

$enseignements = $db->query('
    SELECT e.id, e.heures_par_semaine,
           CONCAT(p.prenom, " ", p.nom) AS prof_nom,
           p.prix_par_heure,
           g.nom AS groupe_nom, m.nom AS matiere_nom,
           n.nom AS niveau_nom
    FROM enseignements e
    JOIN professeurs p ON e.professeur_id = p.id
    JOIN groupes g     ON e.groupe_id = g.id
    JOIN matieres m    ON e.matiere_id = m.id
    LEFT JOIN niveaux n ON g.niveau_id = n.id
    ORDER BY p.nom, n.nom, g.nom, m.nom
')->fetchAll();

$titre_page = 'Gérer les professeurs';
$sous_titre = 'Assigner matières/groupes, définir tarifs horaires et calculer les salaires';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
    <div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<!-- New Assignment -->
<div class="form-card">
    <h3>Nouvelle assignation</h3>
    <p class="text-muted" style="margin-bottom:1rem;font-size:.9rem;">
        Sélectionnez d'abord un <strong>Niveau</strong>, puis la <strong>Matière</strong> de ce niveau sera chargée automatiquement.
    </p>
    <form method="POST" novalidate>
        <?= champ_csrf() ?>
        <input type="hidden" name="action" value="assigner">
        <div class="form-group">
            <label for="professeur_id">Professeur *</label>
            <select id="professeur_id" name="professeur_id" required>
                <option value="">— Sélectionner —</option>
                <?php foreach ($professeurs as $p): ?>
                    <option value="<?= e($p['id']) ?>">
                        <?= e($p['prenom'] . ' ' . $p['nom']) ?>
                        — <?= e(number_format((float)$p['prix_par_heure'], 0, ',', ' ')) ?> MRU/h
                    </option>
                <?php endforeach; ?>
            </select>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label for="assign_niveau_id">Niveau *</label>
                <select id="assign_niveau_id" name="assign_niveau_id" required onchange="chargerMatieres()">
                    <option value="">— Sélectionner un niveau —</option>
                    <?php foreach ($niveaux as $n): ?>
                        <option value="<?= e($n['id']) ?>"><?= e($n['nom']) ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
            <div class="form-group">
                <label for="matiere_id">Matière *</label>
                <select id="matiere_id" name="matiere_id" required disabled>
                    <option value="">— Sélectionnez d'abord un niveau —</option>
                </select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label for="groupe_id">Groupe *</label>
                <select id="groupe_id" name="groupe_id" required>
                    <option value="">— Sélectionner —</option>
                    <?php foreach ($groupes as $g): ?>
                        <option value="<?= e($g['id']) ?>" data-niveau="<?= e($g['niveau_id'] ?? '') ?>">
                            <?= e($g['nom']) ?> (<?= e($g['niveau_nom'] ?? '—') ?>)
                        </option>
                    <?php endforeach; ?>
                </select>
            </div>
            <div class="form-group">
                <label for="heures_par_semaine">Heures / semaine *</label>
                <input type="number" id="heures_par_semaine" name="heures_par_semaine"
                       min="0.5" max="40" step="0.5" placeholder="ex. 4" required>
            </div>
        </div>
        <button type="submit" class="btn btn-primary">Assigner</button>
    </form>
</div>

<!-- Professors Table -->
<div class="table-container">
    <div class="table-header">
        <h3>Professeurs & salaires</h3>
        <span class="badge badge-primary"><?= count($professeurs) ?></span>
    </div>
    <div class="overflow-x">
        <table>
            <thead>
                <tr>
                    <th>Nom</th><th>Identifiant</th><th>Classes</th>
                    <th>Heures/sem</th><th>Prix/heure</th><th>Salaire mensuel</th><th>Supprimer</th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ($professeurs as $p):
                    $h_sem = (float) $p['total_h_sem'];
                    $tarif = (float) $p['prix_par_heure'];
                    $salaire_calc = $h_sem * 4 * $tarif;
                ?>
                <tr>
                    <td><strong><?= e($p['prenom'] . ' ' . $p['nom']) ?></strong></td>
                    <td><?= e($p['identifiant']) ?></td>
                    <td><span class="badge badge-primary"><?= e($p['nb_classes']) ?></span></td>
                    <td><strong><?= e(number_format($h_sem, 1, ',', ' ')) ?></strong> h</td>
                    <td>
                        <form method="POST" style="display:flex;gap:.4rem;align-items:center;">
                            <?= champ_csrf() ?>
                            <input type="hidden" name="action" value="mettre_a_jour_tarif">
                            <input type="hidden" name="professeur_id" value="<?= e($p['id']) ?>">
                            <input type="number" name="prix_par_heure" value="<?= e($tarif) ?>" min="0" step="50"
                                   style="width:90px;padding:.35rem .5rem;border:2px solid var(--border);border-radius:6px;font-size:.85rem;">
                            <button type="submit" class="btn btn-sm btn-secondary" style="padding:.3rem .6rem;">✓</button>
                        </form>
                    </td>
                    <td><strong style="color:var(--success);"><?= e(number_format($salaire_calc, 0, ',', ' ')) ?> MRU</strong></td>
                    <td>
                        <form method="POST" style="display:inline;" onsubmit="return confirm('Supprimer ce professeur ?');">
                            <?= champ_csrf() ?>
                            <input type="hidden" name="action" value="supprimer_professeur">
                            <input type="hidden" name="professeur_id" value="<?= e($p['id']) ?>">
                            <button type="submit" class="btn btn-sm btn-danger">Supprimer</button>
                        </form>
                    </td>
                </tr>
                <?php endforeach; ?>
                <?php if (empty($professeurs)): ?>
                <tr><td colspan="7" class="text-center text-muted">Aucun professeur.</td></tr>
                <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>

<!-- Existing Assignments -->
<div class="table-container">
    <div class="table-header">
        <h3>Assignations existantes</h3>
        <span class="badge badge-primary"><?= count($enseignements) ?></span>
    </div>
    <div class="overflow-x">
        <table>
            <thead>
                <tr><th>Professeur</th><th>Niveau</th><th>Groupe</th><th>Matière</th><th>Heures/sem</th><th>Coût mensuel</th><th>Actions</th></tr>
            </thead>
            <tbody>
                <?php foreach ($enseignements as $ens):
                    $cout = (float) $ens['heures_par_semaine'] * 4 * (float) $ens['prix_par_heure'];
                ?>
                <tr>
                    <td><strong><?= e($ens['prof_nom']) ?></strong></td>
                    <td><span class="badge badge-primary"><?= e($ens['niveau_nom'] ?? '—') ?></span></td>
                    <td><?= e($ens['groupe_nom']) ?></td>
                    <td><?= e($ens['matiere_nom']) ?></td>
                    <td>
                        <form method="POST" style="display:flex;gap:.3rem;align-items:center;">
                            <?= champ_csrf() ?>
                            <input type="hidden" name="action" value="modifier_heures">
                            <input type="hidden" name="enseignement_id" value="<?= e($ens['id']) ?>">
                            <input type="number" name="heures_par_semaine" value="<?= e($ens['heures_par_semaine']) ?>"
                                   min="0.5" max="40" step="0.5"
                                   style="width:70px;padding:.35rem .5rem;border:2px solid var(--border);border-radius:6px;font-size:.85rem;">
                            <button type="submit" class="btn btn-sm btn-secondary" style="padding:.3rem .6rem;">✓</button>
                        </form>
                    </td>
                    <td><?= e(number_format($cout, 0, ',', ' ')) ?> MRU</td>
                    <td>
                        <form method="POST" style="display:inline;" onsubmit="return confirm('Supprimer ?');">
                            <?= champ_csrf() ?>
                            <input type="hidden" name="action" value="supprimer_assignation">
                            <input type="hidden" name="enseignement_id" value="<?= e($ens['id']) ?>">
                            <button type="submit" class="btn btn-sm btn-danger">Supprimer</button>
                        </form>
                    </td>
                </tr>
                <?php endforeach; ?>
                <?php if (empty($enseignements)): ?>
                <tr><td colspan="7" class="text-center text-muted">Aucune assignation.</td></tr>
                <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>

<?php
$scripts_supplementaires = '<script>
// Matieres per niveau JSON data
var matieresParNiveau = ' . json_encode($matieres_par_niveau) . ';

function chargerMatieres() {
    var niveauId = document.getElementById("assign_niveau_id").value;
    var select = document.getElementById("matiere_id");
    select.innerHTML = "";

    if (!niveauId || !matieresParNiveau[niveauId]) {
        select.innerHTML = "<option value=\"\">— Sélectionnez d\'abord un niveau —</option>";
        select.disabled = true;
        return;
    }

    select.disabled = false;
    select.innerHTML = "<option value=\"\">— Sélectionner une matière —</option>";
    matieresParNiveau[niveauId].forEach(function(m) {
        var opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.nom;
        select.appendChild(opt);
    });

    // Also filter groups by niveau
    var groupeSelect = document.getElementById("groupe_id");
    var options = groupeSelect.querySelectorAll("option");
    options.forEach(function(opt) {
        if (opt.value === "") { opt.style.display = ""; return; }
        opt.style.display = (opt.getAttribute("data-niveau") === niveauId) ? "" : "none";
    });
    groupeSelect.value = "";
}
</script>';

include __DIR__ . '/../../includes/layout_footer.php';
?>
