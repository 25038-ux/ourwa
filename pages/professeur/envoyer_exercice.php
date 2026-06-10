<?php
/**
 * Professeur — envoyer un exercice à un de ses groupes, avec pièces jointes
 * (images : JPG/PNG/WebP/GIF, ou PDF — max 5 MB par fichier, 5 fichiers max).
 * Tous les parents des élèves du groupe reçoivent une notification.
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_role('professeur');
require_once __DIR__ . '/../../includes/parent_auth.php';
require_once __DIR__ . '/../../includes/upload.php';

$db = getDB();
$message = '';
$type_message = '';

$stmt = $db->prepare('SELECT id FROM professeurs WHERE utilisateur_id = :uid');
$stmt->execute([':uid' => $_SESSION['utilisateur_id']]);
$prof = $stmt->fetch();
if (!$prof) { die('Profil professeur introuvable.'); }
$prof_id = $prof['id'];

$stmt = $db->prepare('
    SELECT e.id, CONCAT(g.nom," — ",m.nom) AS label, g.id AS groupe_id, m.nom AS matiere
    FROM enseignements e
    JOIN groupes g ON e.groupe_id = g.id
    JOIN matieres m ON e.matiere_id = m.id
    WHERE e.professeur_id = :p ORDER BY g.nom, m.nom');
$stmt->execute([':p' => $prof_id]);
$enseignements = $stmt->fetchAll();

const MAX_FICHIERS = 5;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();
    $ens_id  = nettoyer_entier($_POST['enseignement_id'] ?? 0);
    $titre   = nettoyer($_POST['titre'] ?? '');
    $desc    = trim((string) ($_POST['description'] ?? ''));
    $limite  = nettoyer($_POST['date_limite'] ?? '');

    // Vérifier que l'enseignement appartient bien au prof (anti-IDOR)
    $chk = $db->prepare('SELECT e.groupe_id, m.nom AS matiere FROM enseignements e JOIN matieres m ON e.matiere_id=m.id WHERE e.id=:e AND e.professeur_id=:p');
    $chk->execute([':e'=>$ens_id, ':p'=>$prof_id]);
    $ens = $chk->fetch();

    // Traiter les fichiers uploadés
    $pieces_jointes = [];
    $erreurs_upload = [];

    if (!empty($_FILES['fichiers']['name'][0])) {
        $nb = min(count($_FILES['fichiers']['name']), MAX_FICHIERS);
        for ($i = 0; $i < $nb; $i++) {
            if (empty($_FILES['fichiers']['name'][$i])) continue;
            $f = [
                'name'     => $_FILES['fichiers']['name'][$i],
                'type'     => $_FILES['fichiers']['type'][$i],
                'tmp_name' => $_FILES['fichiers']['tmp_name'][$i],
                'error'    => $_FILES['fichiers']['error'][$i],
                'size'     => $_FILES['fichiers']['size'][$i],
            ];
            $res = valider_et_deplacer_upload($f);
            if ($res['ok']) {
                $pieces_jointes[] = [
                    'nom'           => $res['nom'],
                    'chemin_public' => $res['url'],     // /uploads/exercices/xxxx.ext
                    'mime'          => $res['mime'],
                    'taille'        => $res['taille'],
                ];
            } else {
                $erreurs_upload[] = $f['name'] . ' : ' . $res['message'];
            }
        }
    }

    if (!$ens) {
        $message = 'Enseignement invalide.';
        $type_message = 'error';
    } elseif ($titre === '' || $desc === '') {
        $message = 'Titre et description obligatoires.';
        $type_message = 'error';
    } elseif (!empty($erreurs_upload) && empty($pieces_jointes)) {
        // Tous les uploads ont échoué
        $message = 'Échec des téléversements : ' . implode(' ', $erreurs_upload);
        $type_message = 'error';
    } else {
        $db->prepare('INSERT INTO exercices (enseignement_id, titre, description, pieces_jointes, date_limite) VALUES (:e,:t,:d,:pj,:l)')
           ->execute([
               ':e'  => $ens_id,
               ':t'  => $titre,
               ':d'  => $desc,
               ':pj' => $pieces_jointes ? json_encode($pieces_jointes, JSON_UNESCAPED_UNICODE) : null,
               ':l'  => ($limite ?: null),
           ]);

        // Notifier les parents
        $els = $db->prepare('SELECT id, prenom, nom FROM etudiants WHERE groupe_id = :g');
        $els->execute([':g' => $ens['groupe_id']]);
        $n = 0;
        $suffixe_pj = count($pieces_jointes) > 0 ? ' (' . count($pieces_jointes) . ' fichier' . (count($pieces_jointes) > 1 ? 's' : '') . ' joint' . (count($pieces_jointes) > 1 ? 's' : '') . ')' : '';
        foreach ($els->fetchAll() as $el) {
            notifier_parent_de_etudiant((int)$el['id'], 'exercice',
                'Nouvel exercice : ' . $ens['matiere'],
                "Exercice « {$titre} » pour {$el['prenom']} {$el['nom']}{$suffixe_pj}" .
                ($limite ? " (à rendre avant le " . date('d/m/Y', strtotime($limite)) . ")" : '') .
                ".\n\n" . $desc);
            $n++;
        }
        $msg_final = "Exercice envoyé. {$n} parent(s) notifié(s)";
        if (!empty($pieces_jointes)) $msg_final .= " avec " . count($pieces_jointes) . " fichier(s) joint(s)";
        if (!empty($erreurs_upload)) $msg_final .= ". ⚠ " . count($erreurs_upload) . " fichier(s) rejeté(s) : " . implode(' / ', $erreurs_upload);
        $message = $msg_final . '.';
        $type_message = !empty($erreurs_upload) ? 'warning' : 'success';
    }
}

$titre_page = 'Envoyer un exercice';
$sous_titre = 'Diffuser un exercice à un groupe (parents notifiés)';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
<div class="alert alert-<?= e($type_message === 'warning' ? 'info' : $type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<?php if (!$enseignements): ?>
<div class="alert alert-info">Vous n'avez aucun enseignement assigné.</div>
<?php else: ?>
<form method="POST" enctype="multipart/form-data" class="form-card" style="max-width:720px;">
    <?= csrf_field() ?>
    <div class="form-group">
        <label>Classe / Matière *</label>
        <select name="enseignement_id" required>
            <option value="">— Choisir —</option>
            <?php foreach ($enseignements as $en): ?>
                <option value="<?= e($en['id']) ?>"><?= e($en['label']) ?></option>
            <?php endforeach; ?>
        </select>
    </div>
    <div class="form-group"><label>Titre de l'exercice *</label><input type="text" name="titre" required maxlength="150"></div>
    <div class="form-group"><label>Description / consignes *</label><textarea name="description" rows="6" required></textarea></div>
    <div class="form-group"><label>Date limite (optionnel)</label><input type="date" name="date_limite"></div>

    <div class="form-group">
        <label>📎 Pièces jointes (optionnel — jusqu'à 5 fichiers, 5 MB max chacun)</label>
        <div id="dropzone" style="border:2px dashed #94a3b8;border-radius:12px;padding:1.5rem;text-align:center;background:#f8fafc;cursor:pointer;transition:all .2s;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:.5rem;">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p style="margin:0;font-weight:600;color:#334155;">Glissez-déposez vos fichiers ici</p>
            <p style="margin:.3rem 0 0;font-size:.85rem;color:#64748b;">ou <span style="color:#6366f1;text-decoration:underline;">parcourez</span> · JPG, PNG, WebP, GIF, PDF</p>
            <input type="file" id="files" name="fichiers[]" multiple accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" style="display:none;">
        </div>
        <div id="preview-list" style="margin-top:.75rem;display:flex;flex-direction:column;gap:.5rem;"></div>
    </div>

    <button type="submit" class="btn btn-primary">📨 Envoyer l'exercice</button>
</form>

<script>
(function () {
    const dz       = document.getElementById('dropzone');
    const input    = document.getElementById('files');
    const preview  = document.getElementById('preview-list');
    const MAX = 5;
    const MAX_SIZE = 5 * 1024 * 1024;

    function fmtSize(b) {
        if (b < 1024) return b + ' o';
        if (b < 1024*1024) return (b/1024).toFixed(1) + ' Ko';
        return (b/1024/1024).toFixed(1) + ' Mo';
    }

    function render(files) {
        preview.innerHTML = '';
        Array.from(files).slice(0, MAX).forEach(f => {
            const ok = f.size <= MAX_SIZE;
            const div = document.createElement('div');
            div.style.cssText = 'display:flex;align-items:center;gap:.75rem;padding:.6rem .85rem;background:white;border:1px solid #e2e8f0;border-radius:8px;';
            div.innerHTML = `
                <span style="font-size:1.5rem;">${f.type.startsWith('image/') ? '🖼️' : '📄'}</span>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:.88rem;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</div>
                    <div style="font-size:.75rem;color:${ok?'#64748b':'#dc2626'};">${fmtSize(f.size)}${ok?'':' — trop volumineux !'}</div>
                </div>`;
            preview.appendChild(div);
        });
    }

    dz.addEventListener('click', () => input.click());
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.style.borderColor = '#6366f1'; dz.style.background = '#eef2ff'; });
    dz.addEventListener('dragleave', () => { dz.style.borderColor = '#94a3b8'; dz.style.background = '#f8fafc'; });
    dz.addEventListener('drop', e => {
        e.preventDefault();
        dz.style.borderColor = '#94a3b8'; dz.style.background = '#f8fafc';
        input.files = e.dataTransfer.files;
        render(input.files);
    });
    input.addEventListener('change', () => render(input.files));
})();
</script>
<?php endif; ?>
<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
