<?php
/**
 * Super Admin — Gérer les Niveaux
 * Create/edit Niveaux, manage Groups per Niveau, manage Matières per Niveau
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_staff_admin();

$db = getDB();
$message = '';
$type_message = '';

// ============================================================================
//  POST ACTIONS
// ============================================================================
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();
    $action = $_POST['action'] ?? '';

    // --- Create Niveau ---
    if ($action === 'creer_niveau') {
        $nom = nettoyer($_POST['nom_niveau'] ?? '');
        $tarif = nettoyer_decimal($_POST['tarif_mensuel'] ?? 0) ?? 0;

        if (empty($nom)) {
            $message = 'Le nom du niveau est obligatoire.';
            $type_message = 'error';
        } elseif ($tarif < 0) {
            $message = 'Le tarif mensuel doit être positif.';
            $type_message = 'error';
        } else {
            try {
                $stmt = $db->prepare('INSERT INTO niveaux (nom, tarif_mensuel) VALUES (:nom, :tarif)');
                $stmt->execute([':nom' => $nom, ':tarif' => $tarif]);
                journaliser($_SESSION['utilisateur_id'], "Création niveau : {$nom}");
                $message = "Niveau « {$nom} » créé avec succès !";
                $type_message = 'success';
                regenerer_csrf();
            } catch (PDOException $ex) {
                $message = $ex->getCode() == 23000 ? 'Ce niveau existe déjà.' : 'Erreur : ' . $ex->getMessage();
                $type_message = 'error';
            }
        }
    }

    // --- Update tarif ---
    elseif ($action === 'modifier_tarif') {
        $niveau_id = nettoyer_entier($_POST['niveau_id'] ?? 0);
        $tarif = nettoyer_decimal($_POST['tarif_mensuel'] ?? 0) ?? 0;
        if ($niveau_id && $tarif >= 0) {
            $db->prepare('UPDATE niveaux SET tarif_mensuel = :t WHERE id = :id')->execute([':t' => $tarif, ':id' => $niveau_id]);
            $message = 'Tarif mensuel mis à jour.';
            $type_message = 'success';
            regenerer_csrf();
        }
    }

    // --- Create Group inside Niveau ---
    elseif ($action === 'creer_groupe') {
        $niveau_id = nettoyer_entier($_POST['niveau_id'] ?? 0);
        $nom = nettoyer($_POST['nom_groupe'] ?? '');
        $capacite = nettoyer_entier($_POST['capacite'] ?? 0) ?? 0;

        if (!$niveau_id || empty($nom) || $capacite < 1) {
            $message = 'Tous les champs sont obligatoires.';
            $type_message = 'error';
        } else {
            try {
                $stmt = $db->prepare('INSERT INTO groupes (nom, niveau_id, capacite) VALUES (:n, :ni, :c)');
                $stmt->execute([':n' => $nom, ':ni' => $niveau_id, ':c' => $capacite]);
                journaliser($_SESSION['utilisateur_id'], "Création groupe : {$nom} dans niveau #{$niveau_id}");
                $message = "Groupe « {$nom} » créé avec succès !";
                $type_message = 'success';
                regenerer_csrf();
            } catch (PDOException $ex) {
                $message = 'Erreur : ' . $ex->getMessage();
                $type_message = 'error';
            }
        }
    }

    // --- Add students to group (DÉSACTIVÉ) ---
    elseif ($action === 'ajouter_etudiants') {
        $message = 'L\'ajout direct d\'étudiants est désactivé. Utilisez le bouton « Inscrire un étudiant » dans le menu latéral.';
        $type_message = 'error';
    }

    // --- Create Matière inside Niveau ---
    elseif ($action === 'creer_matiere') {
        $niveau_id = nettoyer_entier($_POST['niveau_id'] ?? 0);
        $nom = nettoyer($_POST['nom_matiere'] ?? '');
        $coef = nettoyer_entier($_POST['coefficient'] ?? 1) ?? 1;

        if (!$niveau_id || empty($nom) || $coef < 1 || $coef > 10) {
            $message = 'Données invalides.';
            $type_message = 'error';
        } else {
            try {
                $stmt = $db->prepare('INSERT INTO matieres (nom, coefficient, niveau_id) VALUES (:nom, :coef, :niv)');
                $stmt->execute([':nom' => $nom, ':coef' => $coef, ':niv' => $niveau_id]);
                journaliser($_SESSION['utilisateur_id'], "Création matière : {$nom} dans niveau #{$niveau_id}");
                $message = "Matière « {$nom} » ajoutée au niveau !";
                $type_message = 'success';
                regenerer_csrf();
            } catch (PDOException $ex) {
                $message = $ex->getCode() == 23000 ? 'Cette matière existe déjà dans ce niveau.' : 'Erreur : ' . $ex->getMessage();
                $type_message = 'error';
            }
        }
    }

    // --- Delete Matière ---
    elseif ($action === 'supprimer_matiere') {
        $matiere_id = nettoyer_entier($_POST['matiere_id'] ?? 0);
        if ($matiere_id) {
            try {
                $db->prepare('DELETE FROM matieres WHERE id = :id')->execute([':id' => $matiere_id]);
                $message = 'Matière supprimée.';
                $type_message = 'success';
                regenerer_csrf();
            } catch (PDOException $ex) {
                $message = 'Impossible de supprimer : cette matière est utilisée dans des enseignements.';
                $type_message = 'error';
            }
        }
    }

    // --- Modifier coefficient ---
    elseif ($action === 'modifier_coef') {
        $matiere_id = nettoyer_entier($_POST['matiere_id'] ?? 0);
        $coef = nettoyer_entier($_POST['coefficient'] ?? 1) ?? 1;
        if ($matiere_id && $coef >= 1 && $coef <= 10) {
            $db->prepare('UPDATE matieres SET coefficient = :c WHERE id = :id')->execute([':c' => $coef, ':id' => $matiere_id]);
            $message = 'Coefficient modifié.';
            $type_message = 'success';
            regenerer_csrf();
        }
    }

    // --- Delete Niveau ---
    elseif ($action === 'supprimer_niveau') {
        $niveau_id = nettoyer_entier($_POST['niveau_id'] ?? 0);
        if ($niveau_id) {
            try {
                $db->beginTransaction();
                // Delete notes for students in groups of this niveau
                $db->prepare('DELETE n FROM notes n INNER JOIN etudiants e ON n.etudiant_id = e.id INNER JOIN groupes g ON e.groupe_id = g.id WHERE g.niveau_id = :nid')->execute([':nid' => $niveau_id]);
                // Delete paiements
                $db->prepare('DELETE p FROM paiements p INNER JOIN etudiants e ON p.etudiant_id = e.id INNER JOIN groupes g ON e.groupe_id = g.id WHERE g.niveau_id = :nid')->execute([':nid' => $niveau_id]);
                // Delete students
                $db->prepare('DELETE e FROM etudiants e INNER JOIN groupes g ON e.groupe_id = g.id WHERE g.niveau_id = :nid')->execute([':nid' => $niveau_id]);
                // Delete enseignements
                $db->prepare('DELETE en FROM enseignements en INNER JOIN groupes g ON en.groupe_id = g.id WHERE g.niveau_id = :nid')->execute([':nid' => $niveau_id]);
                // Delete groups
                $db->prepare('DELETE FROM groupes WHERE niveau_id = :nid')->execute([':nid' => $niveau_id]);
                // Delete matieres
                $db->prepare('DELETE FROM matieres WHERE niveau_id = :nid')->execute([':nid' => $niveau_id]);
                // Delete niveau
                $db->prepare('DELETE FROM niveaux WHERE id = :nid')->execute([':nid' => $niveau_id]);
                $db->commit();
                $message = 'Niveau supprimé avec succès.';
                $type_message = 'success';
            } catch (Throwable $ex) {
                if ($db->inTransaction()) $db->rollBack();
                $message = 'Erreur : ' . $ex->getMessage();
                $type_message = 'error';
            }
            regenerer_csrf();
        }
    }
    elseif ($action === 'supprimer_groupe') {
        // Suppression d'un groupe MÊME s'il n'est pas vide (cascade complète).
        $groupe_id = nettoyer_entier($_POST['groupe_id'] ?? 0);
        if ($groupe_id) {
            try {
                $db->beginTransaction();
                $db->prepare('DELETE n FROM notes n INNER JOIN etudiants e ON n.etudiant_id = e.id WHERE e.groupe_id = :g')->execute([':g' => $groupe_id]);
                $db->prepare('DELETE p FROM paiements p INNER JOIN etudiants e ON p.etudiant_id = e.id WHERE e.groupe_id = :g')->execute([':g' => $groupe_id]);
                $db->prepare('DELETE a FROM absences a INNER JOIN etudiants e ON a.etudiant_id = e.id WHERE e.groupe_id = :g')->execute([':g' => $groupe_id]);
                $db->prepare('DELETE r FROM remarques r INNER JOIN etudiants e ON r.etudiant_id = e.id WHERE e.groupe_id = :g')->execute([':g' => $groupe_id]);
                $db->prepare('DELETE FROM etudiants WHERE groupe_id = :g')->execute([':g' => $groupe_id]);
                $db->prepare('DELETE FROM enseignements WHERE groupe_id = :g')->execute([':g' => $groupe_id]);
                $db->prepare('DELETE FROM groupes WHERE id = :g')->execute([':g' => $groupe_id]);
                $db->commit();
                $message = 'Groupe (et ses étudiants) supprimé avec succès.';
                $type_message = 'success';
                journaliser($_SESSION['utilisateur_id'], "Suppression groupe #{$groupe_id}");
            } catch (Throwable $ex) {
                if ($db->inTransaction()) $db->rollBack();
                $message = 'Erreur : ' . $ex->getMessage();
                $type_message = 'error';
            }
            regenerer_csrf();
        }
    }
    elseif ($action === 'reinscrire_etudiant') {
        // Réinscription : déplacer un étudiant vers un autre groupe (niveau inférieur/supérieur)
        $etudiant_id = nettoyer_entier($_POST['etudiant_id'] ?? 0);
        $nouveau_groupe = nettoyer_entier($_POST['nouveau_groupe_id'] ?? 0);
        if ($etudiant_id && $nouveau_groupe) {
            try {
                $st = $db->prepare('SELECT groupe_id FROM etudiants WHERE id = :e');
                $st->execute([':e' => $etudiant_id]);
                $ancien = (int) $st->fetchColumn();

                $annee = date('Y') . '-' . (date('Y') + 1);
                $db->prepare('INSERT INTO reinscriptions (etudiant_id, ancien_groupe_id, nouveau_groupe_id, annee_scolaire) VALUES (:e,:a,:n,:an)')
                   ->execute([':e'=>$etudiant_id, ':a'=>$ancien, ':n'=>$nouveau_groupe, ':an'=>$annee]);

                // Aligner les frais sur le tarif du nouveau niveau
                $tar = $db->prepare('SELECT nv.tarif_mensuel FROM groupes g JOIN niveaux nv ON g.niveau_id = nv.id WHERE g.id = :g');
                $tar->execute([':g' => $nouveau_groupe]);
                $nouveau_tarif = $tar->fetchColumn();

                if ($nouveau_tarif !== false) {
                    $db->prepare('UPDATE etudiants SET groupe_id = :g, frais_mensuel = :f WHERE id = :e')
                       ->execute([':g'=>$nouveau_groupe, ':f'=>$nouveau_tarif, ':e'=>$etudiant_id]);
                } else {
                    $db->prepare('UPDATE etudiants SET groupe_id = :g WHERE id = :e')
                       ->execute([':g'=>$nouveau_groupe, ':e'=>$etudiant_id]);
                }

                require_once __DIR__ . '/../../includes/parent_auth.php';
                $info = $db->prepare('SELECT prenom, nom FROM etudiants WHERE id = :e');
                $info->execute([':e' => $etudiant_id]);
                $et = $info->fetch();
                notifier_parent_de_etudiant($etudiant_id, 'info', 'Réinscription',
                    "{$et['prenom']} {$et['nom']} a été réinscrit(e) dans une nouvelle classe pour l'année {$annee}.");

                $message = 'Étudiant réinscrit avec succès.';
                $type_message = 'success';
                journaliser($_SESSION['utilisateur_id'], "Réinscription étudiant #{$etudiant_id} -> groupe #{$nouveau_groupe}");
            } catch (Throwable $ex) {
                $message = 'Erreur : ' . $ex->getMessage();
                $type_message = 'error';
            }
            regenerer_csrf();
        }
    }
}

// ============================================================================
//  LOAD DATA
// ============================================================================
$niveau_selectionne = nettoyer_entier($_GET['niveau_id'] ?? 0) ?? 0;

$niveaux = $db->query('
    SELECT n.*, COUNT(DISTINCT g.id) AS nb_groupes, COUNT(DISTINCT e.id) AS nb_etudiants
    FROM niveaux n
    LEFT JOIN groupes g ON g.niveau_id = n.id
    LEFT JOIN etudiants e ON e.groupe_id = g.id
    GROUP BY n.id ORDER BY n.nom
')->fetchAll();

$groupes_niveau = [];
$matieres_niveau = [];

if ($niveau_selectionne) {
    $stmt = $db->prepare('
        SELECT g.*, COUNT(e.id) AS nb_etudiants
        FROM groupes g LEFT JOIN etudiants e ON e.groupe_id = g.id
        WHERE g.niveau_id = :nid GROUP BY g.id ORDER BY g.nom
    ');
    $stmt->execute([':nid' => $niveau_selectionne]);
    $groupes_niveau = $stmt->fetchAll();

    $stmt = $db->prepare('
        SELECT m.*, COUNT(en.id) AS nb_enseignements
        FROM matieres m LEFT JOIN enseignements en ON en.matiere_id = m.id
        WHERE m.niveau_id = :nid GROUP BY m.id ORDER BY m.nom
    ');
    $stmt->execute([':nid' => $niveau_selectionne]);
    $matieres_niveau = $stmt->fetchAll();

    // --- Statistiques d'évolution des effectifs (année N vs N-1) ---
    $annee_courante = (int) date('Y');

    // Snapshot automatique de l'effectif actuel (idempotent)
    foreach ($groupes_niveau as $gg) {
        $db->prepare('INSERT INTO effectifs_annuels (groupe_id, annee, effectif)
                      VALUES (:g,:a,:e)
                      ON DUPLICATE KEY UPDATE effectif = :e2, date_snapshot = NOW()')
           ->execute([':g'=>$gg['id'], ':a'=>$annee_courante, ':e'=>$gg['nb_etudiants'], ':e2'=>$gg['nb_etudiants']]);
    }

    $stats_evolution = [];
    foreach ($groupes_niveau as $gg) {
        $st = $db->prepare('SELECT annee, effectif FROM effectifs_annuels WHERE groupe_id = :g ORDER BY annee');
        $st->execute([':g' => $gg['id']]);
        $hist = $st->fetchAll();
        $actuel = (int) $gg['nb_etudiants'];
        $precedent = null;
        foreach ($hist as $h) {
            if ((int) $h['annee'] === $annee_courante - 1) { $precedent = (int) $h['effectif']; }
        }
        $delta = ($precedent !== null) ? $actuel - $precedent : null;
        $stats_evolution[] = [
            'groupe'    => $gg['nom'],
            'actuel'    => $actuel,
            'precedent' => $precedent,
            'delta'     => $delta,
        ];
    }

    // Liste des étudiants du niveau (pour la réinscription)
    $st = $db->prepare('
        SELECT e.id, e.nom, e.prenom, e.identifiant, g.nom AS groupe
        FROM etudiants e JOIN groupes g ON e.groupe_id = g.id
        WHERE g.niveau_id = :nid ORDER BY e.nom, e.prenom');
    $st->execute([':nid' => $niveau_selectionne]);
    $etudiants_niveau = $st->fetchAll();

    // Tous les groupes (pour choisir la destination de réinscription)
    $tous_groupes = $db->query('
        SELECT g.id, g.nom, IFNULL(n.nom,"Sans niveau") AS niveau
        FROM groupes g LEFT JOIN niveaux n ON g.niveau_id = n.id
        ORDER BY n.nom, g.nom')->fetchAll();
}

$titre_page = 'Gérer les Niveaux';
$sous_titre = 'Niveaux, groupes, matières et tarifs mensuels';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
    <div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<!-- Create Niveau Form -->
<div class="form-card">
    <h3>📚 Créer un Niveau</h3>
    <form method="POST">
        <?= champ_csrf() ?>
        <input type="hidden" name="action" value="creer_niveau">
        <div class="form-row">
            <div class="form-group">
                <label for="nom_niveau">Nom du niveau *</label>
                <input type="text" id="nom_niveau" name="nom_niveau" placeholder="Ex: 6ème" required maxlength="20">
            </div>
            <div class="form-group">
                <label for="tarif_mensuel">Tarif mensuel (MRU) *</label>
                <input type="number" id="tarif_mensuel" name="tarif_mensuel" min="0" step="100" value="15000" required>
            </div>
        </div>
        <button type="submit" class="btn btn-primary" style="width:auto;">Créer le Niveau</button>
    </form>
</div>

<!-- Niveaux List -->
<div class="table-container">
    <div class="table-header">
        <h3>Niveaux existants</h3>
        <span class="badge badge-primary"><?= count($niveaux) ?> niveaux</span>
    </div>
    <div class="overflow-x">
        <table>
            <thead><tr><th>Niveau</th><th>Tarif mensuel</th><th>Groupes</th><th>Étudiants</th><th>Actions</th></tr></thead>
            <tbody>
                <?php foreach ($niveaux as $n): ?>
                <tr style="<?= $niveau_selectionne == $n['id'] ? 'background:rgba(99,102,241,.06);' : '' ?>">
                    <td><strong><?= e($n['nom']) ?></strong></td>
                    <td>
                        <form method="POST" style="display:flex;gap:.4rem;align-items:center;">
                            <?= champ_csrf() ?>
                            <input type="hidden" name="action" value="modifier_tarif">
                            <input type="hidden" name="niveau_id" value="<?= e($n['id']) ?>">
                            <input type="number" name="tarif_mensuel" value="<?= e($n['tarif_mensuel']) ?>" min="0" step="100"
                                   style="width:100px;padding:.35rem .5rem;border:2px solid var(--border);border-radius:6px;font-size:.85rem;">
                            <span style="font-size:.8rem;color:var(--text-muted);">MRU</span>
                            <button type="submit" class="btn btn-sm btn-secondary" style="padding:.3rem .6rem;font-size:.8rem;">✓</button>
                        </form>
                    </td>
                    <td><span class="badge badge-primary"><?= e($n['nb_groupes']) ?></span></td>
                    <td><span class="badge badge-success"><?= e($n['nb_etudiants']) ?></span></td>
                    <td>
                        <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
                            <a href="?niveau_id=<?= e($n['id']) ?>" class="btn btn-sm btn-primary">Ouvrir</a>
                            <?php if ($n['nb_etudiants'] == 0 && $n['nb_groupes'] == 0): ?>
                            <form method="POST" style="display:inline;" onsubmit="return confirm('Supprimer ce niveau ?')">
                                <?= champ_csrf() ?>
                                <input type="hidden" name="action" value="supprimer_niveau">
                                <input type="hidden" name="niveau_id" value="<?= e($n['id']) ?>">
                                <button type="submit" class="btn btn-sm btn-danger">Supprimer</button>
                            </form>
                            <?php endif; ?>
                        </div>
                    </td>
                </tr>
                <?php endforeach; ?>
                <?php if (empty($niveaux)): ?>
                <tr><td colspan="5" class="text-center text-muted">Aucun niveau.</td></tr>
                <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>

<?php if ($niveau_selectionne):
    $niveau_nom = '';
    foreach ($niveaux as $n) { if ($n['id'] == $niveau_selectionne) $niveau_nom = $n['nom']; }
?>

<!-- Groups inside this Niveau -->
<div style="margin-top:2rem;padding-top:1.5rem;border-top:3px solid var(--primary);">
    <h2 style="color:var(--primary);margin-bottom:1.5rem;">📂 Niveau : <?= e($niveau_nom) ?></h2>

    <!-- Create Group -->
    <div class="form-card">
        <h3>Créer un groupe dans « <?= e($niveau_nom) ?> »</h3>
        <form method="POST">
            <?= champ_csrf() ?>
            <input type="hidden" name="action" value="creer_groupe">
            <input type="hidden" name="niveau_id" value="<?= e($niveau_selectionne) ?>">
            <div class="form-row">
                <div class="form-group">
                    <label for="nom_groupe">Nom du groupe *</label>
                    <input type="text" id="nom_groupe" name="nom_groupe" placeholder="Ex: <?= e($niveau_nom) ?> A" required maxlength="50">
                </div>
                <div class="form-group">
                    <label for="capacite">Capacité *</label>
                    <input type="number" id="capacite" name="capacite" min="1" max="100" value="30" required>
                </div>
            </div>
            <button type="submit" class="btn btn-primary" style="width:auto;">Créer le groupe</button>
        </form>
    </div>

    <!-- Groups Table -->
    <div class="table-container">
        <div class="table-header">
            <h3>Groupes dans « <?= e($niveau_nom) ?> »</h3>
            <span class="badge badge-primary"><?= count($groupes_niveau) ?></span>
        </div>
        <div class="overflow-x">
            <table>
                <thead><tr><th>Nom</th><th>Capacité</th><th>Inscrits</th><th>Actions</th></tr></thead>
                <tbody>
                    <?php foreach ($groupes_niveau as $g): ?>
                    <tr>
                        <td><strong><?= e($g['nom']) ?></strong></td>
                        <td><?= e($g['capacite']) ?></td>
                        <td>
                            <?php if ((int)$g['nb_etudiants'] > 0): ?>
                                <span class="badge badge-success"><?= e($g['nb_etudiants']) ?></span>
                            <?php else: ?>
                                <span class="badge badge-warning">Vide</span>
                            <?php endif; ?>
                        </td>
                        <td>
                            <a class="btn btn-sm btn-secondary" href="inscrire_etudiant.php">
                                ➕ Inscrire un étudiant
                            </a>
                            <form method="POST" style="display:inline;"
                                  onsubmit="return confirm('Supprimer le groupe « <?= e(addslashes($g['nom'])) ?> » ET ses <?= e($g['nb_etudiants']) ?> étudiant(s) ? Cette action est irréversible.');">
                                <?= champ_csrf() ?>
                                <input type="hidden" name="action" value="supprimer_groupe">
                                <input type="hidden" name="niveau_id" value="<?= e($niveau_selectionne) ?>">
                                <input type="hidden" name="groupe_id" value="<?= e($g['id']) ?>">
                                <button class="btn btn-sm btn-danger">🗑 Supprimer</button>
                            </form>
                        </td>
                    </tr>
                    <?php endforeach; ?>
    </div>

    <!-- 📈 Statistiques d'évolution des effectifs -->
    <div class="form-card" style="margin-top:1.5rem;">
        <h3>📈 Statistiques — évolution des effectifs</h3>
        <p class="text-muted" style="font-size:.88rem;">Comparaison de l'effectif actuel (<?= e((int)date('Y')) ?>) avec l'année précédente.</p>
        <div class="overflow-x">
            <table>
                <thead><tr><th>Groupe</th><th><?= e((int)date('Y')-1) ?></th><th><?= e((int)date('Y')) ?></th><th>Évolution</th></tr></thead>
                <tbody>
                    <?php foreach (($stats_evolution ?? []) as $s): ?>
                    <tr>
                        <td><strong><?= e($s['groupe']) ?></strong></td>
                        <td><?= $s['precedent'] === null ? '<span class="text-muted">—</span>' : e($s['precedent']) ?></td>
                        <td><?= e($s['actuel']) ?></td>
                        <td>
                            <?php if ($s['delta'] === null): ?>
                                <span class="text-muted">Pas de données N-1</span>
                            <?php elseif ($s['delta'] > 0): ?>
                                <span style="color:#10B981;font-weight:600;">▲ +<?= e($s['delta']) ?></span>
                            <?php elseif ($s['delta'] < 0): ?>
                                <span style="color:#EF4444;font-weight:600;">▼ <?= e($s['delta']) ?></span>
                            <?php else: ?>
                                <span class="text-muted">= stable</span>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                    <?php if (empty($stats_evolution)): ?>
                    <tr><td colspan="4" class="text-center text-muted">Aucun groupe à analyser.</td></tr>
                    <?php endif; ?>
                </tbody>
            </table>
        </div>
    </div>

    <!-- 🔄 Réinscription : déplacée vers sidebar « Réinscrire un étudiant » -->

    <!-- Matières for this Niveau -->
    <div class="form-card" style="margin-top:1.5rem;">
        <h3>📘 Ajouter une matière dans « <?= e($niveau_nom) ?> »</h3>
        <form method="POST">
            <?= champ_csrf() ?>
            <input type="hidden" name="action" value="creer_matiere">
            <input type="hidden" name="niveau_id" value="<?= e($niveau_selectionne) ?>">
            <div class="form-row">
                <div class="form-group">
                    <label for="nom_matiere">Nom de la matière *</label>
                    <input type="text" id="nom_matiere" name="nom_matiere" placeholder="Ex: Mathématiques" required>
                </div>
                <div class="form-group">
                    <label for="coefficient">Coefficient *</label>
                    <input type="number" id="coefficient" name="coefficient" min="1" max="10" value="1" required>
                </div>
            </div>
            <button type="submit" class="btn btn-primary" style="width:auto;">Ajouter la matière</button>
        </form>
    </div>

    <div class="table-container">
        <div class="table-header">
            <h3>Matières de « <?= e($niveau_nom) ?> »</h3>
            <span class="badge badge-primary"><?= count($matieres_niveau) ?></span>
        </div>
        <div class="overflow-x">
            <table>
                <thead><tr><th>Matière</th><th>Coefficient</th><th>Enseignements</th><th>Actions</th></tr></thead>
                <tbody>
                    <?php foreach ($matieres_niveau as $m): ?>
                    <tr>
                        <td><strong><?= e($m['nom']) ?></strong></td>
                        <td>
                            <form method="POST" style="display:inline-flex;align-items:center;gap:.5rem;">
                                <?= champ_csrf() ?>
                                <input type="hidden" name="action" value="modifier_coef">
                                <input type="hidden" name="matiere_id" value="<?= e($m['id']) ?>">
                                <input type="number" name="coefficient" value="<?= e($m['coefficient']) ?>" min="1" max="10"
                                       style="width:70px;padding:.3rem .5rem;border:2px solid var(--border);border-radius:8px;text-align:center;">
                                <button type="submit" class="btn btn-sm btn-secondary">✓</button>
                            </form>
                        </td>
                        <td><span class="badge badge-primary"><?= e($m['nb_enseignements']) ?></span></td>
                        <td>
                            <?php if ($m['nb_enseignements'] == 0): ?>
                            <form method="POST" style="display:inline;" onsubmit="return confirm('Supprimer cette matière ?')">
                                <?= champ_csrf() ?>
                                <input type="hidden" name="action" value="supprimer_matiere">
                                <input type="hidden" name="matiere_id" value="<?= e($m['id']) ?>">
                                <button type="submit" class="btn btn-sm btn-danger">Supprimer</button>
                            </form>
                            <?php else: ?>
                                <span class="text-muted">En utilisation</span>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                    <?php if (empty($matieres_niveau)): ?>
                    <tr><td colspan="4" class="text-center text-muted">Aucune matière.</td></tr>
                    <?php endif; ?>
                </tbody>
            </table>
        </div>
    </div>
</div>
<?php endif; ?>

<!-- Modal for adding students -->
<div class="modal-overlay" id="modale-etudiants">
    <div class="modal">
        <div class="modal-header">
            <h3 id="modale-titre">Ajouter des étudiants</h3>
            <button class="modal-close" onclick="fermerModale('modale-etudiants')">&times;</button>
        </div>
        <form method="POST" id="form-ajout-etudiants">
            <?= champ_csrf() ?>
            <input type="hidden" name="action" value="ajouter_etudiants">
            <input type="hidden" name="groupe_id" id="modale-groupe-id">
            <input type="hidden" name="nb_etudiants" id="modale-nb">

            <div class="form-group">
                <label for="nb_select">Nombre d'étudiants à ajouter</label>
                <select id="nb_select" onchange="genererChamps()">
                    <?php for ($i = 1; $i <= 15; $i++): ?>
                        <option value="<?= $i ?>"><?= $i ?></option>
                    <?php endfor; ?>
                </select>
            </div>

            <div id="champs-etudiants"></div>

            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" onclick="fermerModale('modale-etudiants')">Annuler</button>
                <button type="submit" class="btn btn-success">Enregistrer</button>
            </div>
        </form>
    </div>
</div>

<?php
$scripts_supplementaires = '<script>
function ouvrirAjoutEtudiants(groupeId, groupeNom, places) {
    document.getElementById("modale-titre").textContent = "Ajouter des étudiants — " + groupeNom;
    document.getElementById("modale-groupe-id").value = groupeId;
    genererChamps();
    ouvrirModale("modale-etudiants");
}
function genererChamps() {
    const nb = parseInt(document.getElementById("nb_select").value);
    document.getElementById("modale-nb").value = nb;
    let html = "";
    for (let i = 1; i <= nb; i++) {
        html += `<div style="background:var(--bg);padding:1rem;border-radius:var(--radius);margin-bottom:1rem;">
            <strong style="color:var(--primary);">Étudiant ${i}</strong>
            <div class="form-row mt-1">
                <div class="form-group"><label>Prénom *</label><input type="text" name="prenom_${i}" required></div>
                <div class="form-group"><label>Nom *</label><input type="text" name="nom_${i}" required></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Nom du parent *</label><input type="text" name="parent_${i}" required></div>
                <div class="form-group"><label>Tél. parent</label><input type="text" name="tel_${i}" placeholder="+222 XX XX XX XX"></div>
            </div>
        </div>`;
    }
    document.getElementById("champs-etudiants").innerHTML = html;
}
</script>';

include __DIR__ . '/../../includes/layout_footer.php';
?>
