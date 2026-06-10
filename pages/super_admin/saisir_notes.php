<?php
/**
 * Super Admin / Secrétaire — Saisir les notes (par Niveau → Groupe → Matière)
 *
 * Reprend exactement la logique et la formule du professeur :
 *   Moy_matière = (Moy_Devoirs × 0.4) + (Examen × 0.6)
 * mais le sélecteur n'est plus limité aux enseignements d'un prof :
 * on choisit un Niveau, un Groupe, puis l'enseignement (matière) de ce groupe.
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_role(['super_admin', 'admin', 'secretaire']);

$db = getDB();
$message = '';
$type_message = '';

$etudiants = [];
$enseignement_selectionne = null;
$trimestre_selectionne = 1;
$devoirs_existants = [];
$examens_existants = [];

// Niveaux pour le 1er sélecteur
$niveaux = $db->query('SELECT id, nom FROM niveaux ORDER BY nom')->fetchAll();

// Groupes (avec niveau) pour le cascade JS
$groupes = $db->query('
    SELECT g.id, g.nom, g.niveau_id, IFNULL(n.nom,"Sans niveau") AS niveau_nom
    FROM groupes g LEFT JOIN niveaux n ON g.niveau_id = n.id
    ORDER BY n.nom, g.nom')->fetchAll();

// Enseignements (groupe + matière + prof) pour le 3e sélecteur
$enseignements = $db->query('
    SELECT e.id, e.groupe_id, m.nom AS matiere_nom,
           CONCAT(m.nom) AS label
    FROM enseignements e
    JOIN matieres m ON e.matiere_id = m.id
    ORDER BY m.nom')->fetchAll();

// ============================================================================
//  CHARGEMENT DES NOTES EXISTANTES
// ============================================================================
$niveau_selectionne = nettoyer_entier($_GET['niveau_id'] ?? 0) ?? 0;
$groupe_selectionne = nettoyer_entier($_GET['groupe_id'] ?? 0) ?? 0;

if (isset($_GET['enseignement_id']) && isset($_GET['trimestre'])) {
    $ens_id = nettoyer_entier($_GET['enseignement_id']);
    $trimestre_selectionne = max(1, min(3, nettoyer_entier($_GET['trimestre']) ?? 1));

    $stmt = $db->prepare('SELECT e.*, g.id AS gid, g.niveau_id AS niv FROM enseignements e JOIN groupes g ON e.groupe_id = g.id WHERE e.id = :eid');
    $stmt->execute([':eid' => $ens_id]);
    $enseignement_selectionne = $stmt->fetch();

    if ($enseignement_selectionne) {
        $groupe_selectionne = (int) $enseignement_selectionne['gid'];
        $niveau_selectionne = (int) $enseignement_selectionne['niv'];
        $stmt = $db->prepare('SELECT et.id, et.identifiant, et.nom, et.prenom FROM etudiants et WHERE et.groupe_id = :gid ORDER BY et.nom, et.prenom');
        $stmt->execute([':gid' => $enseignement_selectionne['gid']]);
        $etudiants = $stmt->fetchAll();

        $stmt = $db->prepare('SELECT etudiant_id, type_note, numero_devoir, valeur FROM notes WHERE enseignement_id = :eid AND trimestre = :tri ORDER BY numero_devoir');
        $stmt->execute([':eid' => $ens_id, ':tri' => $trimestre_selectionne]);
        foreach ($stmt->fetchAll() as $n) {
            $eid = (int) $n['etudiant_id'];
            if ($n['type_note'] === 'devoir') {
                $devoirs_existants[$eid][(int) $n['numero_devoir']] = $n['valeur'];
            } else {
                $examens_existants[$eid] = $n['valeur'];
            }
        }
    }
}

// ============================================================================
//  ENREGISTREMENT DES NOTES
// ============================================================================
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();

    $ens_id   = nettoyer_entier($_POST['enseignement_id'] ?? 0);
    $trimestre = nettoyer_entier($_POST['trimestre'] ?? 0);

    $stmt = $db->prepare('SELECT id FROM enseignements WHERE id = :eid');
    $stmt->execute([':eid' => $ens_id]);

    if (!$stmt->fetch()) {
        $message = 'Enseignement introuvable.';
        $type_message = 'error';
    } elseif (!$trimestre || $trimestre < 1 || $trimestre > 3) {
        $message = 'Trimestre invalide.';
        $type_message = 'error';
    } else {
        $notes_sauvees = 0;

        $devoirs_post = $_POST['devoirs'] ?? [];
        foreach ($devoirs_post as $etudiant_id => $devoirs_par_num) {
            $etudiant_id = nettoyer_entier($etudiant_id);
            if (!$etudiant_id || !is_array($devoirs_par_num)) continue;

            $db->prepare('DELETE FROM notes WHERE etudiant_id=:e AND enseignement_id=:en AND trimestre=:t AND type_note="devoir"')
               ->execute([':e' => $etudiant_id, ':en' => $ens_id, ':t' => $trimestre]);

            $num = 1;
            foreach ($devoirs_par_num as $valeur) {
                $valeur = nettoyer_decimal($valeur);
                if ($valeur !== null && $valeur >= 0 && $valeur <= 20) {
                    try {
                        $db->prepare('INSERT INTO notes (etudiant_id, enseignement_id, valeur, trimestre, type_note, numero_devoir) VALUES (:e, :en, :v, :t, "devoir", :n)')
                           ->execute([':e' => $etudiant_id, ':en' => $ens_id, ':v' => $valeur, ':t' => $trimestre, ':n' => $num]);
                        $notes_sauvees++;
                    } catch (Exception $ex) {}
                    $num++;
                }
            }
        }

        $examens_post = $_POST['examens'] ?? [];
        foreach ($examens_post as $etudiant_id => $valeur) {
            $etudiant_id = nettoyer_entier($etudiant_id);
            $valeur = nettoyer_decimal($valeur);
            if ($etudiant_id && $valeur !== null && $valeur >= 0 && $valeur <= 20) {
                try {
                    $db->prepare('INSERT INTO notes (etudiant_id, enseignement_id, valeur, trimestre, type_note, numero_devoir) VALUES (:e, :en, :v, :t, "examen", 1) ON DUPLICATE KEY UPDATE valeur=:v2, date_saisie=NOW()')
                       ->execute([':e' => $etudiant_id, ':en' => $ens_id, ':v' => $valeur, ':t' => $trimestre, ':v2' => $valeur]);
                    $notes_sauvees++;
                } catch (Exception $ex) {}
            }
        }

        journaliser($_SESSION['utilisateur_id'], "Saisie admin de {$notes_sauvees} note(s) pour enseignement #{$ens_id}, T{$trimestre}");

        require_once __DIR__ . '/../../includes/parent_auth.php';
        $infos_ens = $db->prepare('SELECT m.nom AS matiere FROM enseignements e JOIN matieres m ON e.matiere_id=m.id WHERE e.id=:e');
        $infos_ens->execute([':e' => $ens_id]);
        $matiere_nom = (string) ($infos_ens->fetchColumn() ?: 'la matière');
        foreach (($_POST['examens'] ?? []) as $etudiant_id => $valeur) {
            $etudiant_id = nettoyer_entier($etudiant_id);
            $valeur = nettoyer_decimal($valeur);
            if ($etudiant_id && $valeur !== null && $valeur >= 0 && $valeur <= 20) {
                $st = $db->prepare('SELECT prenom, nom FROM etudiants WHERE id = :e');
                $st->execute([':e' => $etudiant_id]);
                if ($et = $st->fetch()) {
                    notifier_parent_de_etudiant((int)$etudiant_id, 'note',
                        'Nouvelle note : ' . $matiere_nom,
                        "{$et['prenom']} {$et['nom']} a eu " . rtrim(rtrim(number_format((float)$valeur,2,'.',''), '0'), '.') .
                        " en {$matiere_nom} (examen, trimestre {$trimestre}).");
                }
            }
        }

        header("Location: saisir_notes.php?enseignement_id={$ens_id}&trimestre={$trimestre}&succes=1");
        exit;
    }
}

if (isset($_GET['succes'])) {
    $message = 'Notes enregistrées avec succès !';
    $type_message = 'success';
}

$titre_page = 'Saisir les notes';
$sous_titre = 'Niveau → Groupe → Matière — Formule : (Moy_Devoirs × 0.4) + (Examen × 0.6)';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
    <div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<div class="form-card" style="max-width:100%;">
    <h3>Sélectionner le niveau, le groupe, la matière et le trimestre</h3>
    <form method="GET" id="form-selection">
        <div class="form-row">
            <div class="form-group">
                <label for="niveau_id">Niveau *</label>
                <select id="niveau_id" name="niveau_id" required onchange="filtrerGroupes()">
                    <option value="">— Choisir —</option>
                    <?php foreach ($niveaux as $n): ?>
                        <option value="<?= e($n['id']) ?>" <?= $niveau_selectionne == $n['id'] ? 'selected' : '' ?>><?= e($n['nom']) ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
            <div class="form-group">
                <label for="groupe_id">Groupe *</label>
                <select id="groupe_id" name="groupe_id" required onchange="filtrerEnseignements()">
                    <option value="">— Choisir un niveau d'abord —</option>
                </select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label for="enseignement_id">Matière *</label>
                <select id="enseignement_id" name="enseignement_id" required>
                    <option value="">— Choisir un groupe d'abord —</option>
                </select>
            </div>
            <div class="form-group">
                <label for="trimestre">Trimestre *</label>
                <select id="trimestre" name="trimestre" required>
                    <option value="1" <?= $trimestre_selectionne == 1 ? 'selected' : '' ?>>1er trimestre</option>
                    <option value="2" <?= $trimestre_selectionne == 2 ? 'selected' : '' ?>>2ème trimestre</option>
                    <option value="3" <?= $trimestre_selectionne == 3 ? 'selected' : '' ?>>3ème trimestre</option>
                </select>
            </div>
        </div>
        <button type="submit" class="btn btn-secondary">Charger les étudiants</button>
    </form>
</div>

<?php if (!empty($etudiants) && $enseignement_selectionne): ?>

<div style="background:linear-gradient(135deg,#6366F1,#8B5CF6);color:#fff;padding:.75rem 1.25rem;border-radius:12px;margin-bottom:1.5rem;font-size:.85rem;display:flex;align-items:center;gap:.75rem;">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="20" height="20" style="flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"/></svg>
    <span><strong>Formule :</strong> Moyenne matière = <strong>(Moyenne de tous les Devoirs × 40%)</strong> + <strong>(Examen × 60%)</strong> — Vous pouvez ajouter autant de devoirs que nécessaire.</span>
</div>

<div class="table-container">
    <div class="table-header">
        <h3>Saisie des notes — Trimestre <?= e($trimestre_selectionne) ?></h3>
        <span class="badge badge-primary"><?= count($etudiants) ?> étudiants</span>
    </div>
    <form method="POST" id="form-notes">
        <?= champ_csrf() ?>
        <input type="hidden" name="enseignement_id" value="<?= e($enseignement_selectionne['id']) ?>">
        <input type="hidden" name="trimestre" value="<?= e($trimestre_selectionne) ?>">

        <div class="overflow-x">
            <table id="table-notes">
                <thead>
                    <tr id="thead-row">
                        <th>#</th>
                        <th>Identifiant</th>
                        <th>Nom complet</th>
                        <th id="devoirs-header" style="background:rgba(99,102,241,.08);min-width:280px;">
                            📝 Devoirs
                            <button type="button" class="btn btn-sm btn-secondary" onclick="ajouterDevoir()" style="margin-left:.5rem;padding:.2rem .6rem;font-size:.75rem;">+ Devoir</button>
                            <span id="nb-devoirs-badge" style="font-size:.7rem;color:#888;margin-left:.3rem;"></span>
                        </th>
                        <th style="background:rgba(245,158,11,.08);">📄 Examen /20</th>
                        <th>Moy. matière</th>
                    </tr>
                </thead>
                <tbody id="tbody-notes">
                    <?php foreach ($etudiants as $i => $et):
                        $devoirs_etu = $devoirs_existants[(int) $et['id']] ?? [];
                        $examen_etu  = $examens_existants[(int) $et['id']] ?? null;
                    ?>
                    <tr data-etudiant="<?= e($et['id']) ?>">
                        <td><?= $i + 1 ?></td>
                        <td><strong><?= e($et['identifiant']) ?></strong></td>
                        <td><?= e($et['prenom'] . ' ' . $et['nom']) ?></td>
                        <td style="background:rgba(99,102,241,.03);">
                            <div class="devoirs-container" id="devoirs-<?= e($et['id']) ?>" style="display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;">
                                <?php
                                $max_num = !empty($devoirs_etu) ? max(array_keys($devoirs_etu)) : 1;
                                for ($n = 1; $n <= $max_num; $n++):
                                    $val = $devoirs_etu[$n] ?? '';
                                ?>
                                <div class="devoir-item" style="display:flex;align-items:center;gap:.2rem;">
                                    <span style="font-size:.7rem;color:#888;">D<?= $n ?></span>
                                    <input type="number"
                                           name="devoirs[<?= e($et['id']) ?>][]"
                                           value="<?= e((string)$val) ?>"
                                           min="0" max="20" step="0.25"
                                           placeholder="—"
                                           class="note-input devoir-input"
                                           data-etudiant="<?= e($et['id']) ?>"
                                           style="width:70px;padding:.35rem .4rem;border:2px solid var(--border);border-radius:8px;text-align:center;font-size:.9rem;"
                                           oninput="recalcMoy(<?= e($et['id']) ?>)">
                                    <?php if ($n > 1): ?>
                                    <button type="button" onclick="supprimerDevoir(this)" style="background:none;border:none;color:#ef4444;cursor:pointer;padding:.2rem;font-size:.9rem;" title="Supprimer ce devoir">×</button>
                                    <?php endif; ?>
                                </div>
                                <?php endfor; ?>
                            </div>
                        </td>
                        <td style="background:rgba(245,158,11,.03);">
                            <input type="number"
                                   name="examens[<?= e($et['id']) ?>]"
                                   value="<?= e($examen_etu !== null ? (string)$examen_etu : '') ?>"
                                   min="0" max="20" step="0.25"
                                   placeholder="—"
                                   class="note-input examen-input"
                                   data-etudiant="<?= e($et['id']) ?>"
                                   style="width:80px;padding:.35rem .4rem;border:2px solid var(--border);border-radius:8px;text-align:center;font-size:.9rem;"
                                   oninput="recalcMoy(<?= e($et['id']) ?>)">
                        </td>
                        <td>
                            <span class="moy-display badge" id="moy-<?= e($et['id']) ?>" style="font-size:.85rem;">—</span>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>

        <div style="padding:1rem 1.5rem;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
            <p style="font-size:.8rem;color:var(--text-muted);margin:0;">
                Les moyennes affichées sont indicatives et recalculées en temps réel.<br>
                <strong>Formule :</strong> Moy = (Moy.Devoirs × 0.4) + (Examen × 0.6)
            </p>
            <button type="submit" class="btn btn-success">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                Enregistrer les notes
            </button>
        </div>
    </form>
</div>

<?php elseif (isset($_GET['enseignement_id']) && empty($etudiants)): ?>
<div class="empty-state">
    <p>Aucun étudiant trouvé pour ce groupe.</p>
</div>
<?php endif; ?>

<script>
// Données pour le cascade Niveau -> Groupe -> Matière
var GROUPES = <?= json_encode($groupes) ?>;
var ENSEIGNEMENTS = <?= json_encode($enseignements) ?>;
var SEL_GROUPE = <?= (int)$groupe_selectionne ?>;
var SEL_ENS = <?= isset($_GET['enseignement_id']) ? (int)nettoyer_entier($_GET['enseignement_id']) : 0 ?>;

function filtrerGroupes() {
    var niv = document.getElementById('niveau_id').value;
    var sel = document.getElementById('groupe_id');
    sel.innerHTML = '<option value="">— Choisir —</option>';
    GROUPES.forEach(function(g) {
        if (String(g.niveau_id) === String(niv)) {
            var o = document.createElement('option');
            o.value = g.id; o.textContent = g.nom;
            if (String(g.id) === String(SEL_GROUPE)) o.selected = true;
            sel.appendChild(o);
        }
    });
    filtrerEnseignements();
}
function filtrerEnseignements() {
    var grp = document.getElementById('groupe_id').value;
    var sel = document.getElementById('enseignement_id');
    sel.innerHTML = '<option value="">— Choisir —</option>';
    ENSEIGNEMENTS.forEach(function(en) {
        if (String(en.groupe_id) === String(grp)) {
            var o = document.createElement('option');
            o.value = en.id; o.textContent = en.matiere_nom;
            if (String(en.id) === String(SEL_ENS)) o.selected = true;
            sel.appendChild(o);
        }
    });
}
document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('niveau_id').value) filtrerGroupes();
});

// ─── Recalcul moyenne ───
function recalcMoy(etudiantId) {
    var container = document.getElementById("devoirs-" + etudiantId);
    var devoirInputs = container ? container.querySelectorAll(".devoir-input") : [];
    var examenInput = document.querySelector('.examen-input[data-etudiant="' + etudiantId + '"]');
    var moySpan = document.getElementById("moy-" + etudiantId);
    if (!moySpan) return;
    var devVals = [];
    devoirInputs.forEach(function(inp) {
        var v = parseFloat(inp.value);
        if (!isNaN(v) && v >= 0 && v <= 20) devVals.push(v);
    });
    var moyDev = devVals.length > 0 ? devVals.reduce(function(a, b){ return a + b; }, 0) / devVals.length : null;
    var exVal = examenInput ? parseFloat(examenInput.value) : NaN;
    var exam = !isNaN(exVal) && exVal >= 0 && exVal <= 20 ? exVal : null;
    var moy = null;
    if (moyDev !== null && exam !== null) moy = (moyDev * 0.4) + (exam * 0.6);
    else if (moyDev !== null) moy = moyDev;
    else if (exam !== null) moy = exam;
    if (moy !== null) {
        moySpan.textContent = moy.toFixed(2);
        moySpan.className = "moy-display badge " + (moy >= 10 ? "badge-success" : "badge-danger");
    } else { moySpan.textContent = "—"; moySpan.className = "moy-display badge"; }
}
function ajouterDevoir() {
    var rows = document.querySelectorAll("#tbody-notes tr");
    var currentMax = 0;
    rows.forEach(function(row) {
        var items = row.querySelectorAll(".devoir-item");
        if (items.length > currentMax) currentMax = items.length;
    });
    var newNum = currentMax + 1;
    rows.forEach(function(row) {
        var etudiantId = row.getAttribute("data-etudiant");
        var container = document.getElementById("devoirs-" + etudiantId);
        if (!container) return;
        var div = document.createElement("div");
        div.className = "devoir-item";
        div.style.cssText = "display:flex;align-items:center;gap:.2rem;";
        div.innerHTML =
            '<span style="font-size:.7rem;color:#888;">D' + newNum + '</span>' +
            '<input type="number" name="devoirs[' + etudiantId + '][]" ' +
            'min="0" max="20" step="0.25" placeholder="—" ' +
            'class="note-input devoir-input" data-etudiant="' + etudiantId + '" ' +
            'style="width:70px;padding:.35rem .4rem;border:2px solid var(--border);border-radius:8px;text-align:center;font-size:.9rem;" ' +
            'oninput="recalcMoy(' + etudiantId + ')">' +
            '<button type="button" onclick="supprimerDevoir(this)" ' +
            'style="background:none;border:none;color:#ef4444;cursor:pointer;padding:.2rem;font-size:.9rem;" ' +
            'title="Supprimer ce devoir">×</button>';
        container.appendChild(div);
    });
    var badge = document.getElementById("nb-devoirs-badge");
    if (badge) badge.textContent = newNum + " devoir(s)";
}
function supprimerDevoir(btn) {
    var item = btn.closest(".devoir-item");
    if (!item) return;
    var container = item.parentElement;
    var etudiantId = container ? container.id.replace("devoirs-", "") : null;
    item.remove();
    if (etudiantId) recalcMoy(etudiantId);
    container.querySelectorAll(".devoir-item").forEach(function(it, idx) {
        var lbl = it.querySelector("span");
        if (lbl) lbl.textContent = "D" + (idx + 1);
    });
}
document.addEventListener("DOMContentLoaded", function() {
    document.querySelectorAll("#tbody-notes tr").forEach(function(row) {
        var eid = row.getAttribute("data-etudiant");
        if (eid) recalcMoy(parseInt(eid));
    });
    var firstRow = document.querySelector("#tbody-notes tr");
    if (firstRow) {
        var n = firstRow.querySelectorAll(".devoir-item").length;
        var badge = document.getElementById("nb-devoirs-badge");
        if (badge && n > 0) badge.textContent = n + " devoir(s)";
    }
});
</script>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
