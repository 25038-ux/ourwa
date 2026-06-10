<?php
/**
 * Professeur — Mes classes (détail par groupe, grouped by Niveau)
 */
require_once __DIR__ . '/../../includes/bootstrap.php';

require_role('professeur');

$db = getDB();

$stmt = $db->prepare('SELECT id FROM professeurs WHERE utilisateur_id = :uid');
$stmt->execute([':uid' => $_SESSION['utilisateur_id']]);
$professeur = $stmt->fetch();

if (!$professeur) die('Erreur : profil introuvable.');

$prof_id = $professeur['id'];

// Mes groupes distincts with Niveau info
$stmt = $db->prepare('
    SELECT DISTINCT g.id, g.nom, n.nom AS niveau_nom, n.id AS niveau_id, g.capacite,
           COUNT(DISTINCT et.id) AS nb_etudiants,
           GROUP_CONCAT(DISTINCT m.nom ORDER BY m.nom SEPARATOR ", ") AS matieres
    FROM enseignements e
    JOIN groupes g ON e.groupe_id = g.id
    LEFT JOIN niveaux n ON g.niveau_id = n.id
    JOIN matieres m ON e.matiere_id = m.id
    LEFT JOIN etudiants et ON et.groupe_id = g.id
    WHERE e.professeur_id = :pid
    GROUP BY g.id, g.nom, n.nom, n.id, g.capacite
    ORDER BY n.nom, g.nom
');
$stmt->execute([':pid' => $prof_id]);
$mes_groupes = $stmt->fetchAll();

// Group by niveau for display
$par_niveau = [];
foreach ($mes_groupes as $g) {
    $niv = $g['niveau_nom'] ?? 'Sans niveau';
    $par_niveau[$niv][] = $g;
}

// Détail d'un groupe si demandé
$etudiants_detail = [];
$groupe_detail = null;

if (isset($_GET['groupe']) && ($gid = nettoyer_entier($_GET['groupe']))) {
    $stmt = $db->prepare('SELECT COUNT(*) FROM enseignements WHERE professeur_id = :pid AND groupe_id = :gid');
    $stmt->execute([':pid' => $prof_id, ':gid' => $gid]);
    
    if ($stmt->fetchColumn() > 0) {
        $stmt = $db->prepare('SELECT g.*, n.nom AS niveau_nom FROM groupes g LEFT JOIN niveaux n ON g.niveau_id = n.id WHERE g.id = :gid');
        $stmt->execute([':gid' => $gid]);
        $groupe_detail = $stmt->fetch();
        
        $stmt = $db->prepare('SELECT * FROM etudiants WHERE groupe_id = :gid ORDER BY nom, prenom');
        $stmt->execute([':gid' => $gid]);
        $etudiants_detail = $stmt->fetchAll();
    }
}

$titre_page = 'Mes classes';
$sous_titre = 'Détail de vos groupes assignés par niveau';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($groupe_detail): ?>
<div class="table-container mb-2">
    <div class="table-header">
        <h3>📋 <?= e($groupe_detail['nom']) ?> — <?= e($groupe_detail['niveau_nom'] ?? '—') ?></h3>
        <a href="mes_classes.php" class="btn btn-sm btn-secondary">← Retour</a>
    </div>
    <div class="overflow-x">
        <table>
            <thead><tr><th>#</th><th>Identifiant</th><th>Nom complet</th></tr></thead>
            <tbody>
                <?php foreach ($etudiants_detail as $i => $et): ?>
                <tr>
                    <td><?= $i + 1 ?></td>
                    <td><strong><?= e($et['identifiant']) ?></strong></td>
                    <td><?= e($et['prenom'] . ' ' . $et['nom']) ?></td>
                </tr>
                <?php endforeach; ?>
                <?php if (empty($etudiants_detail)): ?>
                <tr><td colspan="3" class="text-center text-muted" style="padding:2rem;">Aucun étudiant.</td></tr>
                <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>
<?php endif; ?>

<?php foreach ($par_niveau as $niveau_nom => $groupes_niv): ?>
<div class="table-container" style="margin-bottom:1.5rem;">
    <div class="table-header"><h3>📚 <?= e($niveau_nom) ?></h3></div>
    <div class="overflow-x">
        <table>
            <thead><tr><th>Groupe</th><th>Matières enseignées</th><th>Étudiants</th><th>Actions</th></tr></thead>
            <tbody>
                <?php foreach ($groupes_niv as $g): ?>
                <tr>
                    <td><strong><?= e($g['nom']) ?></strong></td>
                    <td><?= e($g['matieres']) ?></td>
                    <td><?= e($g['nb_etudiants']) ?> / <?= e($g['capacite']) ?></td>
                    <td><a href="?groupe=<?= e($g['id']) ?>" class="btn btn-sm btn-secondary">Voir les étudiants</a></td>
                </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>
</div>
<?php endforeach; ?>

<?php if (empty($mes_groupes)): ?>
<div class="empty-state">
    <p>Aucun groupe assigné.</p>
</div>
<?php endif; ?>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
