<?php
/**
 * Professeur — Tableau de bord
 * Shows: assigned Niveaux + Matières per Niveau, hours, salary
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_role('professeur');

$db = getDB();

$stmt = $db->prepare('SELECT * FROM professeurs WHERE utilisateur_id = :u');
$stmt->execute([':u' => $_SESSION['utilisateur_id']]);
$professeur = $stmt->fetch();

if (!$professeur) {
    die('Erreur : profil professeur introuvable.');
}

$stmt = $db->prepare('
    SELECT e.id, e.heures_par_semaine,
           g.nom AS groupe_nom,
           n.nom AS niveau_nom,
           m.nom AS matiere_nom,
           COUNT(DISTINCT et.id) AS nb_etudiants,
           COUNT(DISTINCT no.id) AS nb_notes
    FROM enseignements e
    JOIN groupes g     ON e.groupe_id = g.id
    LEFT JOIN niveaux n ON g.niveau_id = n.id
    JOIN matieres m    ON e.matiere_id = m.id
    LEFT JOIN etudiants et ON et.groupe_id = g.id
    LEFT JOIN notes no     ON no.enseignement_id = e.id
    WHERE e.professeur_id = :p
    GROUP BY e.id, e.heures_par_semaine, g.nom, n.nom, m.nom
    ORDER BY n.nom, g.nom, m.nom
');
$stmt->execute([':p' => $professeur['id']]);
$mes_enseignements = $stmt->fetchAll();

// Group by Niveau for display
$par_niveau = [];
foreach ($mes_enseignements as $ens) {
    $niv = $ens['niveau_nom'] ?? 'Sans niveau';
    $par_niveau[$niv][] = $ens;
}

// Calculs
$total_h_sem = 0.0;
foreach ($mes_enseignements as $ens) {
    $total_h_sem += (float) $ens['heures_par_semaine'];
}
$tarif = (float) $professeur['prix_par_heure'];
$heures_mois = $total_h_sem * 4;
$salaire = $heures_mois * $tarif;

$titre_page = 'Tableau de bord';
$sous_titre = 'Bienvenue, ' . e($professeur['prenom'] . ' ' . $professeur['nom']);
include __DIR__ . '/../../includes/layout_header.php';
?>

<!-- KPIs -->
<div class="kpi-grid">
    <div class="kpi-card">
        <div class="kpi-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347"/></svg>
        </div>
        <p class="kpi-label">Mes classes</p>
        <p class="kpi-value"><?= e($professeur['nb_classes']) ?></p>
    </div>
    <div class="kpi-card">
        <div class="kpi-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        </div>
        <p class="kpi-label">Heures / semaine</p>
        <p class="kpi-value"><?= e(number_format($total_h_sem, 1, ',', ' ')) ?>h</p>
        <p class="kpi-detail">soit <?= e(number_format($heures_mois, 0, ',', ' ')) ?>h / mois</p>
    </div>
    <div class="kpi-card">
        <div class="kpi-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        </div>
        <p class="kpi-label">Tarif horaire</p>
        <p class="kpi-value"><?= e(number_format($tarif, 0, ',', ' ')) ?></p>
        <p class="kpi-detail">MRU / heure</p>
    </div>
    <div class="kpi-card kpi-success">
        <div class="kpi-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z"/></svg>
        </div>
        <p class="kpi-label">Salaire mensuel</p>
        <p class="kpi-value" style="color:var(--success);"><?= e(number_format($salaire, 0, ',', ' ')) ?></p>
        <p class="kpi-detail">MRU</p>
    </div>
</div>

<!-- Salary detail -->
<div class="form-card" style="max-width:100%;">
    <h3>Détail de mon salaire mensuel</h3>
    <p style="font-size:1.05rem;color:var(--text);line-height:1.8;">
        <strong><?= e(number_format($total_h_sem, 1, ',', ' ')) ?> h/semaine</strong>
        × <strong>4 semaines</strong>
        × <strong><?= e(number_format($tarif, 0, ',', ' ')) ?> MRU/h</strong>
        =
        <span style="color:var(--success);font-weight:800;font-size:1.3rem;">
            <?= e(number_format($salaire, 0, ',', ' ')) ?> MRU
        </span>
    </p>
    <?php if ($tarif == 0): ?>
        <div class="alert alert-info" style="margin-top:.75rem;font-size:.85rem;">
            Votre tarif horaire n'a pas encore été défini par l'administration.
        </div>
    <?php endif; ?>
</div>

<!-- Enseignements grouped by Niveau -->
<?php foreach ($par_niveau as $niveau_nom => $enseignements_niv): ?>
<div class="table-container" style="margin-bottom:1.5rem;">
    <div class="table-header">
        <h3>📚 <?= e($niveau_nom) ?></h3>
        <span class="badge badge-primary"><?= count($enseignements_niv) ?> matière(s)</span>
    </div>
    <div class="overflow-x">
        <table>
            <thead>
                <tr>
                    <th>Groupe</th>
                    <th>Matière</th>
                    <th>Heures / sem</th>
                    <th>Étudiants</th>
                    <th>Notes saisies</th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ($enseignements_niv as $ens): ?>
                <tr>
                    <td><strong><?= e($ens['groupe_nom']) ?></strong></td>
                    <td><?= e($ens['matiere_nom']) ?></td>
                    <td><strong><?= e(number_format((float) $ens['heures_par_semaine'], 1, ',', ' ')) ?></strong> h</td>
                    <td><?= e($ens['nb_etudiants']) ?></td>
                    <td><span class="badge badge-success"><?= e($ens['nb_notes']) ?></span></td>
                </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>
</div>
<?php endforeach; ?>

<?php if (empty($mes_enseignements)): ?>
<div class="empty-state">
    <p>Aucun enseignement assigné pour le moment.</p>
</div>
<?php endif; ?>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
