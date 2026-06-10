<?php
/**
 * Super Admin — Recherche étudiants et professeurs
 * Shows Niveau info in results
 */
require_once __DIR__ . '/../../includes/bootstrap.php';

require_staff_admin();

$db = getDB();
$query = nettoyer($_GET['q'] ?? '');
$resultats_etudiants = [];
$resultats_profs = [];

$message_expell = '';
$type_expell = '';

// --- Action : EXPELL ---
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'expell') {
    exiger_csrf();
    $etudiant_id = nettoyer_entier($_POST['etudiant_id'] ?? 0) ?? 0;
    $motif       = nettoyer($_POST['motif'] ?? '');

    if ($etudiant_id) {
        try {
            $stmt = $db->prepare('SELECT nom, prenom, rim, nni FROM etudiants WHERE id = :e');
            $stmt->execute([':e' => $etudiant_id]);
            $et = $stmt->fetch();
            if ($et) {
                $db->beginTransaction();
                // 1. Enregistrer dans expulsions (NNI+RIM bloqués)
                $db->prepare('INSERT INTO expulsions (nni, rim, nom, prenom, motif, expulse_par) VALUES (:nni,:rim,:nom,:pre,:mo,:by)
                              ON DUPLICATE KEY UPDATE motif = :mo2, expulse_par = :by2, date_expulsion = NOW()')
                   ->execute([
                       ':nni' => $et['nni'], ':rim' => $et['rim'],
                       ':nom' => $et['nom'], ':pre' => $et['prenom'],
                       ':mo'  => $motif ?: null, ':by' => $_SESSION['utilisateur_id'] ?? null,
                       ':mo2' => $motif ?: null, ':by2' => $_SESSION['utilisateur_id'] ?? null,
                   ]);
                // 2. Supprimer l'étudiant et données liées
                $db->prepare('DELETE FROM notes WHERE etudiant_id = :e')->execute([':e' => $etudiant_id]);
                $db->prepare('DELETE FROM paiements WHERE etudiant_id = :e')->execute([':e' => $etudiant_id]);
                $db->prepare('DELETE FROM absences WHERE etudiant_id = :e')->execute([':e' => $etudiant_id]);
                $db->prepare('DELETE FROM remarques WHERE etudiant_id = :e')->execute([':e' => $etudiant_id]);
                $db->prepare('DELETE FROM reinscriptions WHERE etudiant_id = :e')->execute([':e' => $etudiant_id]);
                $db->prepare('DELETE FROM etudiants WHERE id = :e')->execute([':e' => $etudiant_id]);
                $db->commit();
                journaliser($_SESSION['utilisateur_id'] ?? 0, "Expulsion étudiant {$et['prenom']} {$et['nom']} (NNI {$et['nni']}, RIM {$et['rim']})");
                $message_expell = "Étudiant expulsé. Ce NNI ({$et['nni']}) et RIM ({$et['rim']}) ne pourront plus être réinscrits.";
                $type_expell = 'success';
                regenerer_csrf();
            }
        } catch (Throwable $ex) {
            if ($db->inTransaction()) $db->rollBack();
            $message_expell = 'Erreur : ' . $ex->getMessage();
            $type_expell = 'error';
        }
    }
}

if (!empty($query) && strlen($query) >= 2) {
    $like = '%' . $query . '%';
    
    $stmt = $db->prepare('
        SELECT e.*, g.nom AS groupe_nom, n.nom AS niveau_nom
        FROM etudiants e
        JOIN groupes g ON e.groupe_id = g.id
        LEFT JOIN niveaux n ON g.niveau_id = n.id
        WHERE e.nom LIKE :q OR e.prenom LIKE :q2 OR e.identifiant LIKE :q3 OR e.nom_parent LIKE :q4
        ORDER BY e.nom, e.prenom LIMIT 50
    ');
    $stmt->execute([':q' => $like, ':q2' => $like, ':q3' => $like, ':q4' => $like]);
    $resultats_etudiants = $stmt->fetchAll();
    
    $stmt = $db->prepare('
        SELECT p.*, u.identifiant, u.derniere_connexion
        FROM professeurs p
        JOIN utilisateurs u ON p.utilisateur_id = u.id
        WHERE p.nom LIKE :q OR p.prenom LIKE :q2 OR u.identifiant LIKE :q3
        ORDER BY p.nom, p.prenom LIMIT 50
    ');
    $stmt->execute([':q' => $like, ':q2' => $like, ':q3' => $like]);
    $resultats_profs = $stmt->fetchAll();
}

// Load profile detail
$profil_type = $_GET['type'] ?? '';
$profil_id = nettoyer_entier($_GET['profil_id'] ?? 0);
$profil_detail = null;
$profil_notes = [];
$profil_enseignements = [];

if ($profil_type === 'etudiant' && $profil_id) {
    $stmt = $db->prepare('
        SELECT e.*, g.nom AS groupe_nom, n.nom AS niveau_nom, n.tarif_mensuel
        FROM etudiants e
        JOIN groupes g ON e.groupe_id = g.id
        LEFT JOIN niveaux n ON g.niveau_id = n.id
        WHERE e.id = :id
    ');
    $stmt->execute([':id' => $profil_id]);
    $profil_detail = $stmt->fetch();
    if ($profil_detail) {
        $stmt = $db->prepare('
            SELECT m.nom AS matiere, no.valeur, no.type_note, no.trimestre, CONCAT(p.prenom," ",p.nom) AS prof
            FROM notes no
            JOIN enseignements en ON no.enseignement_id = en.id
            JOIN matieres m ON en.matiere_id = m.id
            JOIN professeurs p ON en.professeur_id = p.id
            WHERE no.etudiant_id = :eid ORDER BY no.trimestre, m.nom, no.type_note
        ');
        $stmt->execute([':eid' => $profil_id]);
        $profil_notes = $stmt->fetchAll();
    }
} elseif ($profil_type === 'professeur' && $profil_id) {
    $stmt = $db->prepare('SELECT p.*, u.identifiant, u.derniere_connexion FROM professeurs p JOIN utilisateurs u ON p.utilisateur_id = u.id WHERE p.id = :id');
    $stmt->execute([':id' => $profil_id]);
    $profil_detail = $stmt->fetch();
    if ($profil_detail) {
        $stmt = $db->prepare('
            SELECT g.nom AS groupe_nom, m.nom AS matiere_nom, n.nom AS niveau_nom
            FROM enseignements e
            JOIN groupes g ON e.groupe_id = g.id
            JOIN matieres m ON e.matiere_id = m.id
            LEFT JOIN niveaux n ON g.niveau_id = n.id
            WHERE e.professeur_id = :pid ORDER BY n.nom, g.nom
        ');
        $stmt->execute([':pid' => $profil_id]);
        $profil_enseignements = $stmt->fetchAll();
    }
}

$titre_page = 'Recherche';
$sous_titre = 'Rechercher un étudiant ou un professeur';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message_expell): ?>
    <div class="alert alert-<?= e($type_expell) ?>"><?= e($message_expell) ?></div>
<?php endif; ?>

<!-- Search Form -->
<div class="form-card" style="max-width:100%;">
    <h3>🔍 Rechercher</h3>
    <form method="GET" id="form-recherche">
        <div class="form-row">
            <div class="form-group" style="flex:3;">
                <label for="q">Nom, prénom ou identifiant</label>
                <input type="text" id="q" name="q" value="<?= e($query) ?>" placeholder="Tapez au moins 2 caractères..." autofocus required minlength="2">
            </div>
            <div class="form-group" style="flex:1;display:flex;align-items:flex-end;">
                <button type="submit" class="btn btn-primary" style="width:100%;">Rechercher</button>
            </div>
        </div>
    </form>
</div>

<?php if ($profil_detail && $profil_type === 'etudiant'): ?>
<!-- Student Profile -->
<div class="profile-card">
    <div class="profile-header-card">
        <div class="profile-avatar"><?= strtoupper(substr($profil_detail['prenom'], 0, 1) . substr($profil_detail['nom'], 0, 1)) ?></div>
        <div>
            <h2><?= e($profil_detail['prenom'] . ' ' . $profil_detail['nom']) ?></h2>
            <p class="text-muted"><?= e($profil_detail['identifiant']) ?> — <?= e($profil_detail['niveau_nom'] ?? '') ?> / <?= e($profil_detail['groupe_nom']) ?></p>
        </div>
    </div>
    <div class="profile-info-grid">
        <div><strong>Niveau :</strong> <span class="badge badge-primary"><?= e($profil_detail['niveau_nom'] ?? '—') ?></span></div>
        <div><strong>Groupe :</strong> <?= e($profil_detail['groupe_nom']) ?></div>
        <div><strong>Parent :</strong> <?= e($profil_detail['nom_parent']) ?></div>
        <div><strong>Tél. parent :</strong> <?= e($profil_detail['telephone_parent']) ?></div>
        <div><strong>Tarif mensuel :</strong> <?= e(number_format($profil_detail['tarif_mensuel'] ?? $profil_detail['frais_mensuel'], 0, ',', ' ')) ?> MRU</div>
        <div><strong>Inscrit le :</strong> <?= e($profil_detail['date_inscription']) ?></div>
    </div>
    <?php if (!empty($profil_notes)): ?>
    <h3 style="margin-top:1.5rem;">Notes</h3>
    <div class="overflow-x">
        <table>
            <thead><tr><th>Trimestre</th><th>Matière</th><th>Type</th><th>Note</th><th>Professeur</th></tr></thead>
            <tbody>
                <?php foreach ($profil_notes as $n): ?>
                <tr>
                    <td>T<?= e($n['trimestre']) ?></td>
                    <td><?= e($n['matiere']) ?></td>
                    <td><span class="badge <?= $n['type_note'] === 'examen' ? 'badge-warning' : 'badge-primary' ?>"><?= e(ucfirst($n['type_note'])) ?></span></td>
                    <td><strong><?= e(number_format($n['valeur'], 2)) ?>/20</strong></td>
                    <td><?= e($n['prof']) ?></td>
                </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>
    <?php endif; ?>
    <div style="display:flex;gap:.5rem;margin-top:1.5rem;flex-wrap:wrap;">
        <a href="recherche.php?q=<?= e(urlencode($query)) ?>" class="btn btn-secondary" style="width:auto;">← Retour</a>
        <button type="button" class="btn btn-danger" style="width:auto;" onclick="ouvrirModale('m-expell')">
            🚫 Expell
        </button>
    </div>
</div>

<!-- Modale d'expulsion -->
<div class="modal-overlay" id="m-expell">
    <div class="modal" style="max-width:500px;">
        <div class="modal-header">
            <h3 style="color:var(--error);">🚫 Expulser <?= e($profil_detail['prenom'] . ' ' . $profil_detail['nom']) ?></h3>
            <button class="modal-close" onclick="fermerModale('m-expell')">&times;</button>
        </div>
        <form method="POST">
            <?= champ_csrf() ?>
            <input type="hidden" name="action" value="expell">
            <input type="hidden" name="etudiant_id" value="<?= e($profil_detail['id']) ?>">

            <div class="alert alert-warning" style="font-size:.88rem;">
                ⚠ <strong>Action irréversible.</strong><br>
                Cet étudiant sera supprimé de la base.<br>
                Son <strong>NNI (<?= e($profil_detail['nni'] ?? '—') ?>)</strong> et son
                <strong>RIM (<?= e($profil_detail['rim'] ?? '—') ?>)</strong> seront <strong>bloqués</strong> :
                impossible de l'inscrire à nouveau dans l'établissement.
            </div>

            <div class="form-group">
                <label>Motif (facultatif)</label>
                <textarea name="motif" rows="3" placeholder="Ex : Comportement répété, violence…"></textarea>
            </div>

            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" onclick="fermerModale('m-expell')">Annuler</button>
                <button type="submit" class="btn btn-danger" onclick="return confirm('Confirmer l\'expulsion définitive ?');">🚫 Confirmer l'expulsion</button>
            </div>
        </form>
    </div>
</div>
<!-- Professor Profile -->
<div class="profile-card">
    <div class="profile-header-card">
        <div class="profile-avatar" style="background:var(--primary);"><?= strtoupper(substr($profil_detail['prenom'], 0, 1) . substr($profil_detail['nom'], 0, 1)) ?></div>
        <div>
            <h2><?= e($profil_detail['prenom'] . ' ' . $profil_detail['nom']) ?></h2>
            <p class="text-muted">Professeur — <?= e($profil_detail['identifiant']) ?></p>
        </div>
    </div>
    <div class="profile-info-grid">
        <div><strong>Téléphone :</strong> <?= e($profil_detail['telephone']) ?></div>
        <div><strong>Classes :</strong> <?= e($profil_detail['nb_classes']) ?></div>
        <div><strong>Heures/mois :</strong> <?= e($profil_detail['heures_par_mois']) ?>h</div>
        <div><strong>Tarif horaire :</strong> <?= e(number_format($profil_detail['prix_par_heure'], 0, ',', ' ')) ?> MRU/h</div>
        <div><strong>Salaire :</strong> <?= e(number_format($profil_detail['salaire'], 0, ',', ' ')) ?> MRU</div>
        <div><strong>Dernière connexion :</strong> <?= e($profil_detail['derniere_connexion'] ?? 'Jamais') ?></div>
    </div>
    <?php if (!empty($profil_enseignements)): ?>
    <h3 style="margin-top:1.5rem;">Enseignements (par Niveau)</h3>
    <div class="overflow-x">
        <table>
            <thead><tr><th>Niveau</th><th>Groupe</th><th>Matière</th></tr></thead>
            <tbody>
                <?php foreach ($profil_enseignements as $ens): ?>
                <tr>
                    <td><span class="badge badge-primary"><?= e($ens['niveau_nom'] ?? '—') ?></span></td>
                    <td><strong><?= e($ens['groupe_nom']) ?></strong></td>
                    <td><?= e($ens['matiere_nom']) ?></td>
                </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>
    <?php endif; ?>
    <a href="recherche.php?q=<?= e(urlencode($query)) ?>" class="btn btn-secondary mt-2" style="width:auto;">← Retour</a>
</div>

<?php elseif (!empty($query)): ?>
<!-- Search Results -->
<?php if (!empty($resultats_etudiants)): ?>
<div class="table-container">
    <div class="table-header"><h3>Étudiants trouvés</h3><span class="badge badge-primary"><?= count($resultats_etudiants) ?></span></div>
    <div class="overflow-x">
        <table>
            <thead><tr><th>Identifiant</th><th>Nom</th><th>Niveau</th><th>Groupe</th><th>Action</th></tr></thead>
            <tbody>
                <?php foreach ($resultats_etudiants as $et): ?>
                <tr>
                    <td><strong><?= e($et['identifiant']) ?></strong></td>
                    <td><?= e($et['prenom'] . ' ' . $et['nom']) ?></td>
                    <td><span class="badge badge-primary"><?= e($et['niveau_nom'] ?? '—') ?></span></td>
                    <td><?= e($et['groupe_nom']) ?></td>
                    <td><a href="recherche.php?type=etudiant&profil_id=<?= e($et['id']) ?>&q=<?= e(urlencode($query)) ?>" class="btn btn-sm btn-secondary">Voir profil</a></td>
                </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>
</div>
<?php endif; ?>

<?php if (!empty($resultats_profs)): ?>
<div class="table-container">
    <div class="table-header"><h3>Professeurs trouvés</h3><span class="badge badge-primary"><?= count($resultats_profs) ?></span></div>
    <div class="overflow-x">
        <table>
            <thead><tr><th>Identifiant</th><th>Nom</th><th>Classes</th><th>Action</th></tr></thead>
            <tbody>
                <?php foreach ($resultats_profs as $p): ?>
                <tr>
                    <td><strong><?= e($p['identifiant']) ?></strong></td>
                    <td><?= e($p['prenom'] . ' ' . $p['nom']) ?></td>
                    <td><span class="badge badge-primary"><?= e($p['nb_classes']) ?></span></td>
                    <td><a href="recherche.php?type=professeur&profil_id=<?= e($p['id']) ?>&q=<?= e(urlencode($query)) ?>" class="btn btn-sm btn-secondary">Voir profil</a></td>
                </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>
</div>
<?php endif; ?>

<?php if (empty($resultats_etudiants) && empty($resultats_profs)): ?>
<div class="empty-state">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>
    <p>Aucun résultat trouvé pour « <?= e($query) ?> »</p>
</div>
<?php endif; ?>
<?php endif; ?>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
