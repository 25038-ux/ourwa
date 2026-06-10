<?php
/**
 * Statistiques — répartition par sexe (personnel + étudiants par niveau/groupe).
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_role(['super_admin', 'admin']);

$db = getDB();

function compte_sexe(PDO $db, string $table, string $where = '1'): array {
    $sql = "SELECT
              SUM(CASE WHEN sexe='M' THEN 1 ELSE 0 END) AS m,
              SUM(CASE WHEN sexe='F' THEN 1 ELSE 0 END) AS f,
              SUM(CASE WHEN sexe IS NULL THEN 1 ELSE 0 END) AS nd,
              COUNT(*) AS total
            FROM {$table} WHERE {$where}";
    $r = $db->query($sql)->fetch();
    return ['m'=>(int)$r['m'], 'f'=>(int)$r['f'], 'nd'=>(int)$r['nd'], 'total'=>(int)$r['total']];
}

$profs = compte_sexe($db, 'professeurs');
$staff = compte_sexe($db, 'staff', 'actif = TRUE');
$admins = compte_sexe($db, 'personnel_admin');
$etudiants = compte_sexe($db, 'etudiants');

// Par niveau
$par_niveau = $db->query("
    SELECT n.nom AS niveau,
           SUM(CASE WHEN e.sexe='M' THEN 1 ELSE 0 END) AS m,
           SUM(CASE WHEN e.sexe='F' THEN 1 ELSE 0 END) AS f,
           COUNT(e.id) AS total
    FROM niveaux n
    LEFT JOIN groupes g ON g.niveau_id = n.id
    LEFT JOIN etudiants e ON e.groupe_id = g.id
    GROUP BY n.id, n.nom ORDER BY n.nom")->fetchAll();

// Par groupe
$par_groupe = $db->query("
    SELECT g.nom AS groupe, IFNULL(n.nom,'Sans niveau') AS niveau,
           SUM(CASE WHEN e.sexe='M' THEN 1 ELSE 0 END) AS m,
           SUM(CASE WHEN e.sexe='F' THEN 1 ELSE 0 END) AS f,
           COUNT(e.id) AS total
    FROM groupes g
    LEFT JOIN niveaux n ON g.niveau_id = n.id
    LEFT JOIN etudiants e ON e.groupe_id = g.id
    GROUP BY g.id, g.nom, n.nom ORDER BY n.nom, g.nom")->fetchAll();

$titre_page = 'Statistiques';
$sous_titre = 'Répartition par sexe — personnel et étudiants';
include __DIR__ . '/../../includes/layout_header.php';

function carte_sexe(string $titre, array $c): string {
    ob_start(); ?>
    <div class="form-card">
        <h4 style="margin-top:0;"><?= e($titre) ?></h4>
        <div style="display:flex;gap:1rem;flex-wrap:wrap;">
            <div style="flex:1;text-align:center;background:#eff6ff;border-radius:10px;padding:.75rem;">
                <div style="font-size:1.5rem;font-weight:700;color:#2563eb;"><?= e($c['m']) ?></div>
                <div class="text-muted" style="font-size:.8rem;">Masculin</div>
            </div>
            <div style="flex:1;text-align:center;background:#fdf2f8;border-radius:10px;padding:.75rem;">
                <div style="font-size:1.5rem;font-weight:700;color:#db2777;"><?= e($c['f']) ?></div>
                <div class="text-muted" style="font-size:.8rem;">Féminin</div>
            </div>
            <div style="flex:1;text-align:center;background:#f9fafb;border-radius:10px;padding:.75rem;">
                <div style="font-size:1.5rem;font-weight:700;color:#6b7280;"><?= e($c['total']) ?></div>
                <div class="text-muted" style="font-size:.8rem;">Total<?= $c['nd']>0 ? ' ('.$c['nd'].' n.d.)' : '' ?></div>
            </div>
        </div>
    </div>
    <?php return ob_get_clean();
}
?>

<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1rem;margin-bottom:1.5rem;">
    <?= carte_sexe('Professeurs', $profs) ?>
    <?= carte_sexe('Staff', $staff) ?>
    <?= carte_sexe('Administrateurs', $admins) ?>
    <?= carte_sexe('Étudiants', $etudiants) ?>
</div>

<div class="table-container" style="margin-bottom:1.5rem;">
    <div class="table-header"><h3>Étudiants par niveau</h3></div>
    <div class="overflow-x">
        <table>
            <thead><tr><th>Niveau</th><th>Masculin</th><th>Féminin</th><th>Total</th></tr></thead>
            <tbody>
                <?php foreach ($par_niveau as $r): ?>
                <tr>
                    <td><strong><?= e($r['niveau']) ?></strong></td>
                    <td style="color:#2563eb;"><?= e((int)$r['m']) ?></td>
                    <td style="color:#db2777;"><?= e((int)$r['f']) ?></td>
                    <td><strong><?= e((int)$r['total']) ?></strong></td>
                </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>
</div>

<div class="table-container">
    <div class="table-header"><h3>Étudiants par groupe</h3></div>
    <div class="overflow-x">
        <table>
            <thead><tr><th>Niveau</th><th>Groupe</th><th>Masculin</th><th>Féminin</th><th>Total</th></tr></thead>
            <tbody>
                <?php foreach ($par_groupe as $r): ?>
                <tr>
                    <td><?= e($r['niveau']) ?></td>
                    <td><strong><?= e($r['groupe']) ?></strong></td>
                    <td style="color:#2563eb;"><?= e((int)$r['m']) ?></td>
                    <td style="color:#db2777;"><?= e((int)$r['f']) ?></td>
                    <td><strong><?= e((int)$r['total']) ?></strong></td>
                </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>
</div>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
