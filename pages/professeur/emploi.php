<?php
/**
 * Emploi du temps — Vue Professeur.
 * Affiche TOUTES les cases où ce professeur est l'enseignant assigné,
 * regroupées en grille 6 jours × 3 créneaux.
 * Lecture seule, indique le groupe et la matière.
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_role(['professeur']);

$db = getDB();
$user_id = (int) ($_SESSION['utilisateur_id'] ?? 0);

// Récupérer l'ID du professeur (table professeurs)
$st = $db->prepare('SELECT id, prenom, nom FROM professeurs WHERE utilisateur_id = :u');
$st->execute([':u' => $user_id]);
$prof = $st->fetch();

$JOURS    = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
$CRENEAUX = ['8h-9h45','10h-11h45','12h-14h'];
$grille = []; // grille[jour][creneau] = ['matiere'=>, 'groupe'=>, 'niveau'=>]

if ($prof) {
    $st = $db->prepare('
        SELECT edt.jour, edt.creneau,
               m.nom AS matiere, g.nom AS groupe, IFNULL(n.nom, "—") AS niveau
        FROM emplois_du_temps edt
        JOIN enseignements en ON edt.enseignement_id = en.id
        JOIN matieres m ON en.matiere_id = m.id
        JOIN groupes g ON edt.groupe_id = g.id
        LEFT JOIN niveaux n ON g.niveau_id = n.id
        WHERE en.professeur_id = :pid
        ORDER BY edt.jour, edt.creneau');
    $st->execute([':pid' => $prof['id']]);
    foreach ($st->fetchAll() as $r) {
        $grille[$r['jour']][$r['creneau']] = $r;
    }
}

$titre_page = 'Mon emploi du temps';
$sous_titre = $prof ? $prof['prenom'] . ' ' . $prof['nom'] : '';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if (empty($grille)): ?>
    <div class="alert alert-info">
        Aucun créneau ne vous est encore attribué dans l'emploi du temps.<br>
        L'administration le configurera depuis « Emploi du temps ».
    </div>
<?php else: ?>

<div class="table-container">
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
                        $c = $grille[$j][$cr] ?? null;
                    ?>
                    <td style="vertical-align:top;padding:.3rem;min-width:140px;height:90px;">
                        <?php if ($c): ?>
                            <div style="background:linear-gradient(135deg,#eef2ff,#e0e7ff);padding:.6rem;border-radius:8px;border-left:4px solid var(--primary);height:100%;">
                                <strong style="display:block;color:var(--primary);font-size:.92rem;"><?= e($c['matiere']) ?></strong>
                                <small style="color:var(--text-light);"><?= e($c['niveau']) ?></small>
                                <br><small style="color:var(--text);"><strong><?= e($c['groupe']) ?></strong></small>
                            </div>
                        <?php else: ?>
                            <div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:.85rem;background:#fafafa;border-radius:8px;">
                                —
                            </div>
                        <?php endif; ?>
                    </td>
                    <?php endforeach; ?>
                </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>
</div>

<p class="text-muted" style="font-size:.85rem;margin-top:1rem;text-align:center;">
    📅 Cet emploi du temps est défini par l'administration. Pour toute modification, contactez-la.
</p>

<?php endif; ?>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
