<?php
/**
 * Messagerie : envoi d'un message vers
 *   (A) un parent ciblé via search (nom OU téléphone),
 *   (B) tous les parents d'un niveau + groupe précis,
 *   (C) tous les parents d'un niveau (tous groupes).
 *
 * Règles :
 *   - Au moins UNE des deux options (A) ou (B/C) doit être renseignée.
 *   - Les deux ne peuvent pas être utilisées ensemble.
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_staff_admin();
require_once __DIR__ . '/../../includes/parent_auth.php';

$db = getDB();
$message = '';
$type_message = '';

// Recherche AJAX-like via GET (search parent par nom/téléphone)
$q_parent = trim((string) ($_GET['qp'] ?? ''));
$parents_resultats = [];
if ($q_parent !== '' && mb_strlen($q_parent) >= 2) {
    $st = $db->prepare('
        SELECT id, nom_complet, telephone
        FROM parents
        WHERE actif = TRUE
          AND ( nom_complet LIKE :q
             OR REPLACE(REPLACE(REPLACE(telephone," ",""),"-",""),"+","") LIKE :qt )
        ORDER BY nom_complet LIMIT 30');
    $st->execute([
        ':q'  => '%' . $q_parent . '%',
        ':qt' => '%' . preg_replace('/[^\d]/', '', $q_parent) . '%',
    ]);
    $parents_resultats = $st->fetchAll();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();

    $sujet   = nettoyer($_POST['sujet'] ?? '');
    $contenu = trim((string) ($_POST['contenu'] ?? ''));
    $parent_id = nettoyer_entier($_POST['parent_id'] ?? 0) ?? 0;
    $niveau_id = nettoyer_entier($_POST['niveau_id'] ?? 0) ?? 0;
    $groupe_id = nettoyer_entier($_POST['groupe_id'] ?? 0) ?? 0;

    $mode_individuel = ($parent_id > 0);
    $mode_diffusion  = ($niveau_id > 0);

    if ($sujet === '' || $contenu === '') {
        $message = 'Sujet et contenu obligatoires.';
        $type_message = 'error';
    } elseif (!$mode_individuel && !$mode_diffusion) {
        $message = 'Veuillez choisir un parent OU un niveau (au moins une option requise).';
        $type_message = 'error';
    } elseif ($mode_individuel && $mode_diffusion) {
        $message = 'Vous ne pouvez pas combiner « parent ciblé » et « diffusion par niveau ». Choisissez UNE des deux options.';
        $type_message = 'error';
    } else {
        $expediteur = $_SESSION['nom_complet'] ?? 'Administration';
        $cibles = [];

        if ($mode_individuel) {
            $cibles = [$parent_id];
        } else {
            if ($groupe_id > 0) {
                $st = $db->prepare('
                    SELECT DISTINCT e.parent_id
                    FROM etudiants e
                    JOIN groupes g ON e.groupe_id = g.id
                    WHERE g.niveau_id = :nv AND e.groupe_id = :gp AND e.parent_id IS NOT NULL');
                $st->execute([':nv' => $niveau_id, ':gp' => $groupe_id]);
            } else {
                $st = $db->prepare('
                    SELECT DISTINCT e.parent_id
                    FROM etudiants e
                    JOIN groupes g ON e.groupe_id = g.id
                    WHERE g.niveau_id = :nv AND e.parent_id IS NOT NULL');
                $st->execute([':nv' => $niveau_id]);
            }
            $cibles = $st->fetchAll(PDO::FETCH_COLUMN);
        }

        if (!$cibles) {
            $message = 'Aucun destinataire trouvé pour ces critères.';
            $type_message = 'error';
        } else {
            $ins = $db->prepare('INSERT INTO messages (parent_id, expediteur, sujet, contenu) VALUES (:p,:ex,:su,:co)');
            foreach ($cibles as $pid) {
                $ins->execute([':p' => $pid, ':ex' => $expediteur, ':su' => $sujet, ':co' => $contenu]);
                notifier_parent((int)$pid, 'message', 'Nouveau message : ' . $sujet, $contenu);
            }
            $message = count($cibles) . ' message(s) envoyé(s).';
            $type_message = 'success';
            regenerer_csrf();
        }
    }
}

$niveaux = $db->query('SELECT id, nom FROM niveaux ORDER BY nom')->fetchAll();
$groupes_par_niveau = [];
foreach ($db->query('SELECT id, nom, niveau_id FROM groupes ORDER BY nom') as $g) {
    $groupes_par_niveau[(int)$g['niveau_id']][] = ['id'=>(int)$g['id'], 'nom'=>$g['nom']];
}

$titre_page = 'Messagerie parents';
$sous_titre = 'Cibler un parent par recherche OU diffuser par niveau/groupe';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
<div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<form method="POST" class="form-card" style="max-width:780px;" id="form-messagerie">
    <?= csrf_field() ?>

    <h3 style="margin-top:0;">📨 Nouveau message</h3>
    <p class="text-muted" style="font-size:.88rem;margin-bottom:1.5rem;">
        Choisissez <strong>UNE</strong> des deux méthodes ci-dessous. Au moins une est obligatoire.
    </p>

    <fieldset id="mode-individuel" style="border:2px solid var(--border);border-radius:var(--radius);padding:1rem;margin-bottom:1rem;">
        <legend style="padding:0 .5rem;font-weight:600;color:var(--primary);">A. Cibler UN parent</legend>
        <div class="form-group">
            <label for="qp">🔍 Rechercher un parent (nom ou téléphone)</label>
            <input type="text" id="qp" placeholder="Tapez au moins 2 caractères..." value="<?= e($q_parent) ?>" oninput="rechercheParent(this.value)">
            <div id="resultats-parents" style="margin-top:.5rem;max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;display:<?= $q_parent!==''?'block':'none' ?>;">
                <?php foreach ($parents_resultats as $p): ?>
                    <label style="display:flex;gap:.6rem;align-items:center;padding:.55rem .75rem;border-bottom:1px solid var(--border);cursor:pointer;" onclick="selectionnerParent('<?= e($p['id']) ?>','<?= e(addslashes($p['nom_complet'].' — '.$p['telephone'])) ?>')">
                        <input type="radio" name="_choix_parent" value="<?= e($p['id']) ?>" style="margin:0;">
                        <div><strong><?= e($p['nom_complet']) ?></strong>
                            <small class="text-muted">— <?= e($p['telephone']) ?></small></div>
                    </label>
                <?php endforeach; ?>
                <?php if ($q_parent !== '' && empty($parents_resultats)): ?>
                    <p style="padding:.75rem;color:var(--text-muted);text-align:center;margin:0;">Aucun parent trouvé.</p>
                <?php endif; ?>
            </div>
        </div>
        <input type="hidden" name="parent_id" id="parent_id" value="">
        <div id="parent-choisi" style="margin-top:.5rem;font-size:.9rem;color:var(--success);font-weight:600;"></div>
    </fieldset>

    <p style="text-align:center;margin:1rem 0;color:var(--text-muted);font-weight:600;">— OU —</p>

    <fieldset id="mode-diffusion" style="border:2px solid var(--border);border-radius:var(--radius);padding:1rem;margin-bottom:1rem;">
        <legend style="padding:0 .5rem;font-weight:600;color:var(--primary);">B. Diffuser à un Niveau (et éventuellement à un Groupe)</legend>
        <div class="form-row">
            <div class="form-group">
                <label for="niveau_id">Niveau</label>
                <select name="niveau_id" id="niveau_id" onchange="majGroupes()">
                    <option value="">— Choisir un niveau —</option>
                    <?php foreach ($niveaux as $n): ?>
                        <option value="<?= e($n['id']) ?>"><?= e($n['nom']) ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
            <div class="form-group">
                <label for="groupe_id">Groupe (laisser vide = tous les groupes)</label>
                <select name="groupe_id" id="groupe_id" disabled>
                    <option value="">— Tous les groupes du niveau —</option>
                </select>
            </div>
        </div>
    </fieldset>

    <div class="form-group"><label>Sujet *</label><input type="text" name="sujet" required maxlength="200"></div>
    <div class="form-group"><label>Message *</label><textarea name="contenu" rows="6" required></textarea></div>

    <button type="submit" class="btn btn-primary" style="width:auto;">📨 Envoyer</button>
</form>

<?php
$groupes_json = json_encode($groupes_par_niveau, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
$scripts_supplementaires = '<script>
const GROUPES_PAR_NIVEAU = ' . $groupes_json . ';

function majGroupes() {
    const nv = document.getElementById("niveau_id").value;
    const sel = document.getElementById("groupe_id");
    sel.innerHTML = "<option value=\"\">— Tous les groupes du niveau —</option>";
    if (!nv) { sel.disabled = true; return; }
    sel.disabled = false;
    (GROUPES_PAR_NIVEAU[nv] || []).forEach(g => {
        const o = document.createElement("option");
        o.value = g.id; o.textContent = g.nom;
        sel.appendChild(o);
    });
    document.getElementById("parent_id").value = "";
    document.getElementById("parent-choisi").textContent = "";
    document.querySelectorAll("input[name=_choix_parent]").forEach(r => r.checked = false);
}

let timerRecherche;
function rechercheParent(val) {
    clearTimeout(timerRecherche);
    if (val.length < 2) { document.getElementById("resultats-parents").style.display = "none"; return; }
    timerRecherche = setTimeout(() => {
        const u = new URL(window.location.href);
        u.searchParams.set("qp", val);
        window.location.href = u.toString();
    }, 600);
}

function selectionnerParent(id, label) {
    document.getElementById("parent_id").value = id;
    document.getElementById("parent-choisi").textContent = "✓ Parent sélectionné : " + label;
    document.getElementById("niveau_id").value = "";
    document.getElementById("groupe_id").innerHTML = "<option value=\"\">— Tous les groupes du niveau —</option>";
    document.getElementById("groupe_id").disabled = true;
}

document.getElementById("form-messagerie").addEventListener("submit", function(e) {
    const pid = document.getElementById("parent_id").value;
    const nv  = document.getElementById("niveau_id").value;
    if (!pid && !nv) {
        e.preventDefault();
        alert("Veuillez sélectionner un parent OU un niveau.");
    } else if (pid && nv) {
        e.preventDefault();
        alert("Vous ne pouvez pas utiliser les deux options en même temps.");
    }
});
</script>';

include __DIR__ . '/../../includes/layout_footer.php';
?>
