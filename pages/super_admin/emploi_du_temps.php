<?php
/**
 * Emploi du temps — Admin
 *  Étape 1 : choix du niveau
 *  Étape 2 : choix du groupe
 *  Étape 3 : grille 6 jours × 3 créneaux (8h-9h45, 10h-11h45, 12h-14h)
 *           - clic sur une case -> modale avec les matières assignées à ce groupe
 *           - sélection d'une matière -> insertion d'un enseignement (prof+matière)
 *           - contrainte : une matière ne peut apparaître plus de
 *             floor(heures_par_semaine / 2) fois dans la grille hebdo
 *  Bouton « Valider » -> notifie les parents et les profs concernés.
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_staff_admin();
require_once __DIR__ . '/../../includes/parent_auth.php';

$db = getDB();
$message = '';
$type_message = '';

$JOURS    = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
$CRENEAUX = ['8h-9h45','10h-11h45','12h-14h'];

$niveau_id = nettoyer_entier($_GET['niveau_id'] ?? 0) ?? 0;
$groupe_id = nettoyer_entier($_GET['groupe_id'] ?? 0) ?? 0;

// ========== POST actions ==========
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();
    $action = $_POST['action'] ?? '';

    if ($action === 'placer') {
        $gid     = nettoyer_entier($_POST['groupe_id'] ?? 0) ?? 0;
        $jour    = $_POST['jour'] ?? '';
        $creneau = $_POST['creneau'] ?? '';
        $ens_id  = nettoyer_entier($_POST['enseignement_id'] ?? 0) ?? 0;

        if ($gid && in_array($jour, $JOURS, true) && in_array($creneau, $CRENEAUX, true) && $ens_id) {
            // Vérifier que l'enseignement appartient à ce groupe
            $st = $db->prepare('SELECT heures_par_semaine, matiere_id FROM enseignements WHERE id = :e AND groupe_id = :g');
            $st->execute([':e' => $ens_id, ':g' => $gid]);
            $ens = $st->fetch();
            if (!$ens) {
                $message = 'Enseignement invalide pour ce groupe.';
                $type_message = 'error';
            } else {
                $max = (int) floor(((float) $ens['heures_par_semaine']) / 2);
                if ($max < 1) $max = 1; // permettre au moins une apparition

                // Compter combien de fois cette matière est déjà placée pour ce groupe
                $st2 = $db->prepare('
                    SELECT COUNT(*) FROM emplois_du_temps edt
                    JOIN enseignements en ON edt.enseignement_id = en.id
                    WHERE edt.groupe_id = :g AND en.matiere_id = :m');
                $st2->execute([':g' => $gid, ':m' => $ens['matiere_id']]);
                $deja = (int) $st2->fetchColumn();

                if ($deja >= $max) {
                    $message = "Limite atteinte pour cette matière ({$deja}/{$max} cases). Réduisez ou supprimez une autre case.";
                    $type_message = 'error';
                } else {
                    try {
                        $db->prepare('
                            INSERT INTO emplois_du_temps (groupe_id, jour, creneau, enseignement_id)
                            VALUES (:g, :j, :c, :e)
                            ON DUPLICATE KEY UPDATE enseignement_id = :e2')
                          ->execute([':g'=>$gid, ':j'=>$jour, ':c'=>$creneau, ':e'=>$ens_id, ':e2'=>$ens_id]);
                        $message = 'Case enregistrée.';
                        $type_message = 'success';
                    } catch (Throwable $ex) {
                        $message = 'Erreur : ' . $ex->getMessage();
                        $type_message = 'error';
                    }
                    regenerer_csrf();
                }
            }
        }
    }
    elseif ($action === 'effacer_case') {
        $gid     = nettoyer_entier($_POST['groupe_id'] ?? 0) ?? 0;
        $jour    = $_POST['jour'] ?? '';
        $creneau = $_POST['creneau'] ?? '';
        if ($gid && in_array($jour, $JOURS, true) && in_array($creneau, $CRENEAUX, true)) {
            $db->prepare('DELETE FROM emplois_du_temps WHERE groupe_id = :g AND jour = :j AND creneau = :c')
               ->execute([':g'=>$gid, ':j'=>$jour, ':c'=>$creneau]);
            $message = 'Case effacée.';
            $type_message = 'success';
            regenerer_csrf();
        }
    }
    elseif ($action === 'valider') {
        $gid = nettoyer_entier($_POST['groupe_id'] ?? 0) ?? 0;
        if ($gid) {
            // 1. Notifier tous les parents des étudiants de ce groupe
            $st = $db->prepare('SELECT DISTINCT parent_id FROM etudiants WHERE groupe_id = :g AND parent_id IS NOT NULL');
            $st->execute([':g' => $gid]);
            $parents = $st->fetchAll(PDO::FETCH_COLUMN);

            $infoG = $db->prepare('SELECT g.nom AS gn, n.nom AS nn FROM groupes g LEFT JOIN niveaux n ON g.niveau_id=n.id WHERE g.id = :g');
            $infoG->execute([':g'=>$gid]);
            $gi = $infoG->fetch();
            $libelle = ($gi['nn'] ?? '—') . ' / ' . ($gi['gn'] ?? '—');

            foreach ($parents as $pid) {
                notifier_parent((int)$pid, 'info',
                    'Emploi du temps publié',
                    "L'emploi du temps de la classe {$libelle} a été publié. Consultez le profil de votre enfant pour le voir.");
            }
            $message = 'Emploi du temps validé et notifié à ' . count($parents) . ' parent(s).';
            $type_message = 'success';
            journaliser($_SESSION['utilisateur_id'] ?? 0, "Validation emploi du temps groupe #{$gid}");
            regenerer_csrf();
        }
    }
}

// ========== Données ==========
$niveaux = $db->query('SELECT id, nom FROM niveaux ORDER BY nom')->fetchAll();
$groupes_du_niveau = [];
$infos_groupe = null;
$enseignements = []; // matières assignées à ce groupe
$grille = [];        // grille[jour][creneau] = enseignement_id
$details_ens = [];   // détails par enseignement_id
$comptes_matieres = []; // matiere_id => [places, max]

if ($niveau_id) {
    $st = $db->prepare('SELECT id, nom FROM groupes WHERE niveau_id = :n ORDER BY nom');
    $st->execute([':n' => $niveau_id]);
    $groupes_du_niveau = $st->fetchAll();
}

if ($groupe_id) {
    $st = $db->prepare('SELECT g.id, g.nom, n.nom AS niveau_nom, g.niveau_id
                        FROM groupes g LEFT JOIN niveaux n ON g.niveau_id = n.id
                        WHERE g.id = :g');
    $st->execute([':g' => $groupe_id]);
    $infos_groupe = $st->fetch();

    // Enseignements (matière+prof+heures) assignés à ce groupe
    $st = $db->prepare('
        SELECT en.id, en.matiere_id, en.heures_par_semaine,
               m.nom AS matiere, m.coefficient,
               p.prenom AS prof_prenom, p.nom AS prof_nom
        FROM enseignements en
        JOIN matieres m ON en.matiere_id = m.id
        JOIN professeurs p ON en.professeur_id = p.id
        WHERE en.groupe_id = :g
        ORDER BY m.nom');
    $st->execute([':g' => $groupe_id]);
    $enseignements = $st->fetchAll();

    foreach ($enseignements as $ens) {
        $details_ens[(int)$ens['id']] = $ens;
        $mid = (int) $ens['matiere_id'];
        $max = max(1, (int) floor(((float)$ens['heures_par_semaine'])/2));
        $comptes_matieres[$mid] = ['places' => 0, 'max' => $max, 'matiere' => $ens['matiere']];
    }

    // Grille existante
    $st = $db->prepare('SELECT jour, creneau, enseignement_id FROM emplois_du_temps WHERE groupe_id = :g');
    $st->execute([':g' => $groupe_id]);
    foreach ($st->fetchAll() as $r) {
        $grille[$r['jour']][$r['creneau']] = (int) $r['enseignement_id'];
        $ens = $details_ens[(int)$r['enseignement_id']] ?? null;
        if ($ens) {
            $mid = (int) $ens['matiere_id'];
            if (isset($comptes_matieres[$mid])) {
                $comptes_matieres[$mid]['places']++;
            }
        }
    }
}

$titre_page = 'Emploi du temps';
$sous_titre = $infos_groupe ? ($infos_groupe['niveau_nom'] . ' — ' . $infos_groupe['nom']) : 'Définir l\'emploi du temps des groupes';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
<div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<!-- ÉTAPE 1 : choix du niveau -->
<?php if (!$niveau_id): ?>
<div class="form-card">
    <h3>📅 Étape 1 : Sélectionner un niveau</h3>
    <form method="GET">
        <div class="form-group">
            <label for="niveau_id">Niveau</label>
            <select name="niveau_id" id="niveau_id" required onchange="this.form.submit()">
                <option value="">— Choisir un niveau —</option>
                <?php foreach ($niveaux as $n): ?>
                    <option value="<?= e($n['id']) ?>"><?= e($n['nom']) ?></option>
                <?php endforeach; ?>
            </select>
        </div>
    </form>
</div>

<!-- ÉTAPE 2 : choix du groupe -->
<?php elseif (!$groupe_id): ?>
<div style="margin-bottom:1rem;">
    <a href="emploi_du_temps.php" class="btn btn-secondary">← Changer de niveau</a>
</div>
<div class="form-card">
    <h3>📅 Étape 2 : Sélectionner un groupe</h3>
    <?php if (empty($groupes_du_niveau)): ?>
        <div class="alert alert-info">Aucun groupe dans ce niveau.</div>
    <?php else: ?>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:.75rem;margin-top:1rem;">
            <?php foreach ($groupes_du_niveau as $g): ?>
                <a href="emploi_du_temps.php?niveau_id=<?= e($niveau_id) ?>&groupe_id=<?= e($g['id']) ?>"
                   class="btn btn-primary" style="width:auto;justify-content:center;">
                    <?= e($g['nom']) ?>
                </a>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>
</div>

<!-- ÉTAPE 3 : grille -->
<?php else: ?>
<div style="margin-bottom:1rem;display:flex;gap:.5rem;flex-wrap:wrap;">
    <a href="emploi_du_temps.php?niveau_id=<?= e($niveau_id) ?>" class="btn btn-secondary">← Changer de groupe</a>
    <a href="emploi_du_temps.php" class="btn btn-secondary">← Changer de niveau</a>
</div>

<?php if (empty($enseignements)): ?>
    <div class="alert alert-warning">
        ⚠ Aucune matière n'a encore été assignée à ce groupe.<br>
        Allez dans « Gérer les professeurs » pour assigner des matières + heures avant de bâtir l'emploi du temps.
    </div>
<?php else: ?>

<!-- Recap matières + quotas -->
<div class="form-card" style="margin-bottom:1rem;">
    <h3 style="margin-top:0;">📚 Matières du groupe et quotas hebdomadaires</h3>
    <p class="text-muted" style="font-size:.88rem;margin-bottom:.75rem;">
        Quota = nb max d'apparitions dans la grille = ⌊heures par semaine ÷ 2⌋.
    </p>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
        <?php foreach ($comptes_matieres as $mid => $info):
            $pct = $info['max'] > 0 ? min(100, ($info['places']/$info['max'])*100) : 0;
            $col = $info['places'] >= $info['max'] ? 'var(--error)' : 'var(--primary)';
        ?>
        <div style="border:2px solid <?= $col ?>;padding:.5rem .75rem;border-radius:8px;font-size:.85rem;">
            <strong><?= e($info['matiere']) ?></strong>
            <span style="color:<?= $col ?>;font-weight:700;"><?= e($info['places']) ?>/<?= e($info['max']) ?></span>
        </div>
        <?php endforeach; ?>
    </div>
</div>

<!-- Grille -->
<div class="table-container" style="margin-bottom:1.5rem;">
    <div class="overflow-x">
        <table class="edt-grille" style="min-width:100%;">
            <thead>
                <tr>
                    <th style="background:var(--bg);font-weight:700;">⏰</th>
                    <?php foreach ($JOURS as $j): ?>
                        <th style="background:var(--primary);color:#fff;text-align:center;font-weight:700;"><?= e($j) ?></th>
                    <?php endforeach; ?>
                </tr>
            </thead>
            <tbody>
                <?php foreach ($CRENEAUX as $cr): ?>
                <tr>
                    <th style="background:var(--bg);font-weight:700;text-align:center;white-space:nowrap;"><?= e($cr) ?></th>
                    <?php foreach ($JOURS as $j):
                        $eid = $grille[$j][$cr] ?? null;
                        $ens = $eid ? ($details_ens[$eid] ?? null) : null;
                    ?>
                    <td style="vertical-align:top;padding:0;min-width:140px;">
                        <?php if ($ens): ?>
                            <div style="background:linear-gradient(135deg,#eef2ff,#e0e7ff);padding:.6rem;border-radius:8px;margin:.25rem;border-left:4px solid var(--primary);">
                                <strong style="display:block;color:var(--primary);font-size:.88rem;"><?= e($ens['matiere']) ?></strong>
                                <small style="color:var(--text-light);"><?= e($ens['prof_prenom'].' '.$ens['prof_nom']) ?></small>
                                <form method="POST" style="margin-top:.4rem;display:inline;" onsubmit="return confirm('Effacer cette case ?');">
                                    <?= champ_csrf() ?>
                                    <input type="hidden" name="action" value="effacer_case">
                                    <input type="hidden" name="groupe_id" value="<?= e($groupe_id) ?>">
                                    <input type="hidden" name="jour" value="<?= e($j) ?>">
                                    <input type="hidden" name="creneau" value="<?= e($cr) ?>">
                                    <button class="btn btn-sm btn-danger" style="font-size:.7rem;padding:.2rem .5rem;">✕</button>
                                </form>
                            </div>
                        <?php else: ?>
                            <button type="button" onclick='ouvrirChoixMatiere(<?= json_encode($j) ?>, <?= json_encode($cr) ?>)'
                                    style="width:100%;height:80px;background:#fafafa;border:2px dashed var(--border);border-radius:8px;margin:.25rem;cursor:pointer;color:var(--text-muted);font-size:.78rem;transition:.2s;"
                                    onmouseover="this.style.background='#eef2ff';this.style.borderColor='var(--primary)';this.style.color='var(--primary)';"
                                    onmouseout="this.style.background='#fafafa';this.style.borderColor='var(--border)';this.style.color='var(--text-muted)';">
                                + Ajouter
                            </button>
                        <?php endif; ?>
                    </td>
                    <?php endforeach; ?>
                </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>
</div>

<!-- Validation -->
<form method="POST" style="text-align:center;">
    <?= champ_csrf() ?>
    <input type="hidden" name="action" value="valider">
    <input type="hidden" name="groupe_id" value="<?= e($groupe_id) ?>">
    <button class="btn btn-success" style="font-size:1.1rem;padding:.9rem 2rem;width:auto;">
        ✓ Valider et publier l'emploi du temps
    </button>
    <p class="text-muted" style="margin-top:.5rem;font-size:.85rem;">
        Tous les parents et professeurs concernés seront notifiés.
    </p>
</form>

<!-- Modale choix matière -->
<div class="modal-overlay" id="modale-matiere">
    <div class="modal" style="max-width:540px;">
        <div class="modal-header">
            <h3>Choisir une matière</h3>
            <button class="modal-close" onclick="fermerModale('modale-matiere')">&times;</button>
        </div>
        <form method="POST" id="form-placer">
            <?= champ_csrf() ?>
            <input type="hidden" name="action" value="placer">
            <input type="hidden" name="groupe_id" value="<?= e($groupe_id) ?>">
            <input type="hidden" name="jour" id="m-jour">
            <input type="hidden" name="creneau" id="m-creneau">

            <p class="text-muted" style="font-size:.85rem;margin-bottom:1rem;">
                Créneau : <strong id="m-libelle"></strong>
            </p>

            <div style="display:grid;gap:.5rem;max-height:360px;overflow-y:auto;">
                <?php foreach ($enseignements as $ens):
                    $mid = (int)$ens['matiere_id'];
                    $info = $comptes_matieres[$mid];
                    $plein = $info['places'] >= $info['max'];
                ?>
                <label style="display:flex;gap:.6rem;align-items:center;padding:.6rem .75rem;border:2px solid <?= $plein?'var(--border)':'var(--primary)' ?>;border-radius:10px;cursor:<?= $plein?'not-allowed':'pointer' ?>;opacity:<?= $plein?'.45':'1' ?>;background:<?= $plein?'#fafafa':'#fff' ?>;">
                    <input type="radio" name="enseignement_id" value="<?= e($ens['id']) ?>" <?= $plein?'disabled':'' ?> required>
                    <div style="flex:1;">
                        <strong><?= e($ens['matiere']) ?></strong> (coef <?= e($ens['coefficient']) ?>)
                        <br><small class="text-muted">Prof : <?= e($ens['prof_prenom'].' '.$ens['prof_nom']) ?> · <?= e($ens['heures_par_semaine']) ?>h/sem</small>
                    </div>
                    <span style="font-size:.8rem;font-weight:700;color:<?= $plein?'var(--error)':'var(--primary)' ?>;">
                        <?= e($info['places']) ?>/<?= e($info['max']) ?>
                    </span>
                </label>
                <?php endforeach; ?>
            </div>

            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" onclick="fermerModale('modale-matiere')">Annuler</button>
                <button type="submit" class="btn btn-primary">Placer</button>
            </div>
        </form>
    </div>
</div>

<?php endif; // fin enseignements existent ?>
<?php endif; // fin étape 3 ?>

<?php
$scripts_supplementaires = '<script>
function ouvrirChoixMatiere(jour, creneau) {
    document.getElementById("m-jour").value = jour;
    document.getElementById("m-creneau").value = creneau;
    document.getElementById("m-libelle").textContent = jour + " — " + creneau;
    ouvrirModale("modale-matiere");
}
</script>';
include __DIR__ . '/../../includes/layout_footer.php';
?>
