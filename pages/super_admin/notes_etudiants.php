<?php
/**
 * Super Admin — Bulletin de Notes (Bilingue FR+AR)
 * Formule : Moy_matière = (avg(devoirs) × 0.4) + (examen × 0.6)
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_staff_admin();

$db = getDB();

$groupes = $db->query('SELECT g.*, n.nom AS niveau_nom FROM groupes g LEFT JOIN niveaux n ON g.niveau_id = n.id ORDER BY n.nom, g.nom')->fetchAll();

$groupe_id   = nettoyer_entier($_GET['groupe_id']   ?? 0) ?? 0;
$trimestre   = max(1, min(3, nettoyer_entier($_GET['trimestre'] ?? 1) ?? 1));
$etudiant_id = nettoyer_entier($_GET['etudiant_id'] ?? 0) ?? 0;

/**
 * Calcule la moyenne d'une matière selon la formule :
 * Moy = (avg_devoirs × 0.4) + (examen × 0.6)
 */
function calc_moy_matiere(?float $avg_devoirs, ?float $examen): ?float {
    if ($avg_devoirs !== null && $examen !== null) return ($avg_devoirs * 0.4) + ($examen * 0.6);
    if ($avg_devoirs !== null) return $avg_devoirs;
    if ($examen !== null) return $examen;
    return null;
}

function calculer_moyennes_groupe(PDO $db, int $groupe_id, int $trimestre): array {
    // All devoirs per student per matière
    $sql = '
        SELECT e.id AS etudiant_id, m.id AS matiere_id, m.coefficient,
               n.type_note, n.valeur
        FROM etudiants e
        JOIN enseignements en ON en.groupe_id = e.groupe_id
        JOIN matieres m ON en.matiere_id = m.id
        LEFT JOIN notes n ON n.enseignement_id = en.id AND n.etudiant_id = e.id AND n.trimestre = :tri
        WHERE e.groupe_id = :gid
        ORDER BY e.id, m.id, n.type_note, n.numero_devoir
    ';
    $stmt = $db->prepare($sql);
    $stmt->execute([':tri' => $trimestre, ':gid' => $groupe_id]);

    $data = []; // [etudiant_id][matiere_id] = ['coef'=>, 'devoirs'=>[], 'examen'=>null]
    foreach ($stmt->fetchAll() as $r) {
        $eid = (int)$r['etudiant_id']; $mid = (int)$r['matiere_id'];
        if (!isset($data[$eid][$mid])) $data[$eid][$mid] = ['coef' => (int)$r['coefficient'], 'devoirs' => [], 'examen' => null];
        if ($r['valeur'] !== null) {
            if ($r['type_note'] === 'devoir') $data[$eid][$mid]['devoirs'][] = (float)$r['valeur'];
            elseif ($r['type_note'] === 'examen') $data[$eid][$mid]['examen'] = (float)$r['valeur'];
        }
    }

    $moyennes = [];
    foreach ($data as $eid => $matieres) {
        $sc = 0.0; $st = 0;
        foreach ($matieres as $mid => $d) {
            $avg_dev = count($d['devoirs']) > 0 ? array_sum($d['devoirs']) / count($d['devoirs']) : null;
            $moy = calc_moy_matiere($avg_dev, $d['examen']);
            if ($moy !== null) { $sc += $moy * $d['coef']; $st += $d['coef']; }
        }
        $moyennes[$eid] = $st > 0 ? $sc / $st : null;
    }
    return $moyennes;
}

function appreciation_pour(float $m): string {
    if ($m >= 16) return 'Très Bien';
    if ($m >= 14) return 'Bien';
    if ($m >= 12) return 'Assez Bien';
    if ($m >= 10) return 'Passable';
    return 'Insuffisant';
}

// ============================================================================
//  MODE BULLETIN INDIVIDUEL
// ============================================================================
if ($etudiant_id) {
    $stmt = $db->prepare('SELECT e.*, g.nom AS groupe_nom, g.id AS gid, n.nom AS niveau_nom FROM etudiants e JOIN groupes g ON e.groupe_id = g.id LEFT JOIN niveaux n ON g.niveau_id = n.id WHERE e.id = :id');
    $stmt->execute([':id' => $etudiant_id]);
    $etudiant = $stmt->fetch();
    if (!$etudiant) { http_response_code(404); die('Étudiant introuvable.'); }

    // Matières avec toutes leurs notes
    $stmt = $db->prepare('
        SELECT m.id AS matiere_id, m.nom AS matiere_nom, m.coefficient,
               n.type_note, n.valeur, n.numero_devoir
        FROM enseignements en
        JOIN matieres m ON en.matiere_id = m.id
        LEFT JOIN notes n ON n.enseignement_id = en.id AND n.etudiant_id = :eid AND n.trimestre = :tri
        WHERE en.groupe_id = :gid
        ORDER BY m.coefficient DESC, m.nom, n.type_note, n.numero_devoir
    ');
    $stmt->execute([':eid' => $etudiant_id, ':gid' => $etudiant['gid'], ':tri' => $trimestre]);

    $matieres_raw = [];
    foreach ($stmt->fetchAll() as $r) {
        $mid = (int)$r['matiere_id'];
        if (!isset($matieres_raw[$mid])) {
            $matieres_raw[$mid] = ['matiere_nom' => $r['matiere_nom'], 'coefficient' => (int)$r['coefficient'], 'devoirs' => [], 'examen' => null];
        }
        if ($r['valeur'] !== null) {
            if ($r['type_note'] === 'devoir') $matieres_raw[$mid]['devoirs'][] = (float)$r['valeur'];
            elseif ($r['type_note'] === 'examen') $matieres_raw[$mid]['examen'] = (float)$r['valeur'];
        }
    }

    $bulletin_rows = [];
    $somme_coeff_moy = 0.0; $somme_coeffs = 0; $total_credits = 0;
    foreach ($matieres_raw as $mid => $mn) {
        $avg_dev = count($mn['devoirs']) > 0 ? array_sum($mn['devoirs']) / count($mn['devoirs']) : null;
        $moy = calc_moy_matiere($avg_dev, $mn['examen']);
        $mn['avg_devoirs'] = $avg_dev;
        $mn['moyenne'] = $moy;
        $total_credits += $mn['coefficient'];
        if ($moy !== null) { $somme_coeff_moy += $moy * $mn['coefficient']; $somme_coeffs += $mn['coefficient']; }
        $bulletin_rows[] = $mn;
    }
    $moyenne_generale = $somme_coeffs > 0 ? $somme_coeff_moy / $somme_coeffs : null;

    // Rang
    $moyennes_grp = calculer_moyennes_groupe($db, (int)$etudiant['gid'], $trimestre);
    $valides = array_filter($moyennes_grp, fn($x) => $x !== null);
    arsort($valides);
    $rang_pos = array_search($etudiant_id, array_keys($valides));
    $rang = $rang_pos === false ? null : ($rang_pos + 1);
    $total_eleves = count($moyennes_grp);

    $appreciation = $moyenne_generale !== null ? appreciation_pour($moyenne_generale) : 'Non évalué';
}

$titre_page = 'Bulletin de Notes';
$sous_titre = 'بطاقة الأعداد — Relevé officiel';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($etudiant_id && isset($etudiant)): ?>
<!-- ============================================================
     BULLETIN INDIVIDUEL — Style Officiel Bilingue FR+AR
     ============================================================ -->
<div class="no-print" style="display:flex;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap;">
    <a href="notes_etudiants.php?groupe_id=<?= e($etudiant['gid']) ?>&trimestre=<?= e($trimestre) ?>" class="btn btn-secondary">← Retour à la liste</a>
    <button onclick="window.print()" class="btn btn-primary">🖨 Imprimer le bulletin</button>
</div>

<div class="bulletin-off" id="bulletin">

    <!-- ===== EN-TÊTE OFFICIEL TRICOLONNE ===== -->
    <div class="bul-header">
        <!-- Colonne gauche (Français) -->
        <div class="bul-hcol bul-hcol-fr">
            <p class="bul-republic">République Islamique de Mauritanie</p>
            <p class="bul-honor">Honneur – Fraternité – Justice</p>
            <p class="bul-ministry">Ministère de l'Éducation Nationale</p>
        </div>
        <!-- Centre : logo El OURWA -->
        <div class="bul-hcol bul-hcol-center">
            <div class="bul-logo-wrap">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="52" height="52" style="color:#1a6b3c;">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342"/>
                </svg>
                <span class="bul-logo-name">El OURWA</span>
            </div>
        </div>
        <!-- Colonne droite (Arabe) -->
        <div class="bul-hcol bul-hcol-ar" dir="rtl">
            <p class="bul-republic">الجمهورية الإسلامية الموريتانية</p>
            <p class="bul-honor">شرف – إخاء – عدل</p>
            <p class="bul-ministry">وزارة التربية الوطنية</p>
        </div>
    </div>

    <!-- ===== TITRE BULLETIN ===== -->
    <div class="bul-title-band">
        <span class="bul-title-ar" dir="rtl">بطاقة الأعداد</span>
        <span class="bul-title-sep">—</span>
        <span class="bul-title-fr">BULLETIN DE NOTES</span>
        <span class="bul-title-sep">—</span>
        <span class="bul-title-ar" dir="rtl">بطاقة الأعداد</span>
    </div>

    <!-- ===== INFO ÉTUDIANT ===== -->
    <div class="bul-info-grid">
        <div class="bul-info-row">
            <span class="bul-lbl-ar" dir="rtl">السنة الدراسية</span>
            <span class="bul-sep">|</span>
            <span class="bul-lbl-fr">Année Scolaire</span>
            <span class="bul-val"><?= e(date('Y') - 1) ?> – <?= e(date('Y')) ?></span>
        </div>
        <div class="bul-info-row">
            <span class="bul-lbl-ar" dir="rtl">الاسم</span>
            <span class="bul-sep">|</span>
            <span class="bul-lbl-fr">Nom et Prénom</span>
            <span class="bul-val"><strong><?= e($etudiant['prenom'] . ' ' . $etudiant['nom']) ?></strong></span>
        </div>
        <div class="bul-info-row">
            <span class="bul-lbl-ar" dir="rtl">رقم التسجيل</span>
            <span class="bul-sep">|</span>
            <span class="bul-lbl-fr">Matricule</span>
            <span class="bul-val"><?= e($etudiant['identifiant']) ?></span>
        </div>
        <div class="bul-info-row">
            <span class="bul-lbl-ar" dir="rtl">القسم</span>
            <span class="bul-sep">|</span>
            <span class="bul-lbl-fr">Classe</span>
            <span class="bul-val"><strong><?= e(($etudiant['niveau_nom'] ?? '') . ' — ' . $etudiant['groupe_nom']) ?></strong></span>
        </div>
        <div class="bul-info-row">
            <span class="bul-lbl-ar" dir="rtl">الفصل</span>
            <span class="bul-sep">|</span>
            <span class="bul-lbl-fr">Trimestre</span>
            <span class="bul-val"><?= e($trimestre) ?><sup><?= $trimestre == 1 ? 'er' : 'e' ?></sup></span>
        </div>
        <div class="bul-info-row">
            <span class="bul-lbl-ar" dir="rtl">ولي الأمر</span>
            <span class="bul-sep">|</span>
            <span class="bul-lbl-fr">Parent / Tuteur</span>
            <span class="bul-val"><?= e($etudiant['nom_parent']) ?></span>
        </div>
    </div>

    <!-- ===== TABLEAU DES NOTES ===== -->
    <table class="bul-table">
        <thead>
            <tr class="bul-thead-ar" dir="rtl">
                <th>المواد</th>
                <th>متوسط الفروض<br><small>× 0.4</small></th>
                <th>الامتحان<br><small>× 0.6</small></th>
                <th>المعدل</th>
                <th>المعامل</th>
                <th>المجموع</th>
            </tr>
            <tr class="bul-thead-fr">
                <th>Matière</th>
                <th>Moy. Devoirs<br><small>× 0.4</small></th>
                <th>Examen<br><small>× 0.6</small></th>
                <th>Moyenne</th>
                <th>Coeff.</th>
                <th>Total</th>
            </tr>
        </thead>
        <tbody>
            <?php foreach ($bulletin_rows as $i => $row):
                $moy  = $row['moyenne'];
                $coef = $row['coefficient'];
                $total_mat = $moy !== null ? $moy * $coef : null;
                $cls_moy = $moy !== null ? ($moy >= 10 ? 'bul-pass' : 'bul-fail') : '';
            ?>
            <tr class="<?= $i % 2 === 0 ? 'bul-row-odd' : 'bul-row-even' ?>">
                <td class="bul-td-subject"><?= e($row['matiere_nom']) ?></td>
                <td><?= $row['avg_devoirs'] !== null ? number_format($row['avg_devoirs'], 2) : '—' ?></td>
                <td><?= $row['examen'] !== null ? number_format($row['examen'], 2) : '—' ?></td>
                <td class="bul-td-moy <?= $cls_moy ?>"><?= $moy !== null ? number_format($moy, 2) : '—' ?></td>
                <td><?= e($coef) ?></td>
                <td class="bul-td-total"><?= $total_mat !== null ? number_format($total_mat, 2) : '—' ?></td>
            </tr>
            <?php endforeach; ?>
        </tbody>
        <tfoot>
            <tr class="bul-tfoot">
                <td colspan="4" class="bul-tfoot-label">
                    <span dir="rtl">المعدل العام</span> | Moyenne Générale
                </td>
                <td><?= e($somme_coeffs) ?></td>
                <td class="bul-tfoot-avg <?= $moyenne_generale !== null && $moyenne_generale >= 10 ? 'bul-pass' : 'bul-fail' ?>">
                    <strong><?= $moyenne_generale !== null ? number_format($moyenne_generale, 2) : 'N/A' ?></strong>
                </td>
            </tr>
        </tfoot>
    </table>

    <!-- ===== PIED DE PAGE TRICOLONNE ===== -->
    <div class="bul-footer-grid">
        <!-- Col gauche : résultats -->
        <div class="bul-foot-col">
            <p class="bul-foot-title">Résultats / النتائج</p>
            <div class="bul-result-row">
                <span class="bul-lbl-fr">Moyenne Générale :</span>
                <strong><?= $moyenne_generale !== null ? number_format($moyenne_generale, 2) . ' / 20' : 'N/A' ?></strong>
            </div>
            <div class="bul-result-row">
                <span class="bul-lbl-fr">Rang :</span>
                <strong><?= $rang !== null ? $rang . 'er / ' . $total_eleves : '—' ?></strong>
            </div>
            <div class="bul-result-row">
                <span class="bul-lbl-fr">Appréciation :</span>
                <strong class="<?= $moyenne_generale !== null && $moyenne_generale >= 10 ? 'bul-pass' : 'bul-fail' ?>"><?= e($appreciation) ?></strong>
            </div>
            <div class="bul-result-row" style="margin-top:.5rem;">
                <span class="bul-lbl-ar" dir="rtl">الترتيب :</span>
                <strong><?= $rang !== null ? $rang . ' / ' . $total_eleves : '—' ?></strong>
            </div>
            <p style="margin-top:.75rem;font-size:.72rem;color:#555;">
                Le <?= e(date_fr()) ?>
            </p>
        </div>

        <!-- Col centre : signature directeur -->
        <div class="bul-foot-col bul-foot-center">
            <p class="bul-foot-title">
                <span dir="rtl">توقيع مدير المدرسة وختمها</span><br>
                Signature et cachet du Directeur
            </p>
            <div class="bul-sig-area"></div>
        </div>

        <!-- Col droite : observations + signature parent -->
        <div class="bul-foot-col" dir="rtl" style="text-align:right;">
            <p class="bul-foot-title">ملاحظات المدير — Observations du Directeur</p>
            <div class="bul-obs-area"></div>
            <p class="bul-foot-title" style="margin-top:1rem;">
                توقيع الولي / Signature du Parent
            </p>
            <div class="bul-sig-area"></div>
        </div>
    </div>

    <div class="bul-warning">
        ⚠ هذه الوثيقة لا تصلح بدون توقيع — CE DOCUMENT N'EST PAS VALABLE SANS SIGNATURE ⚠
    </div>
</div>

<?php elseif ($groupe_id): ?>
<!-- ===== LISTE ÉTUDIANTS ===== -->
<?php
$stmt = $db->prepare('SELECT * FROM etudiants WHERE groupe_id = :gid ORDER BY nom, prenom');
$stmt->execute([':gid' => $groupe_id]);
$etudiants_list = $stmt->fetchAll();
$moyennes_grp = calculer_moyennes_groupe($db, $groupe_id, $trimestre);
$avec_moy = [];
foreach ($etudiants_list as $et) { $et['moyenne'] = $moyennes_grp[(int)$et['id']] ?? null; $avec_moy[] = $et; }
usort($avec_moy, fn($a,$b) => $b['moyenne'] <=> $a['moyenne']);
?>
<div style="margin-bottom:1rem;">
    <a href="notes_etudiants.php" class="btn btn-secondary">← Changer de groupe</a>
</div>
<div class="table-container">
    <div class="table-header">
        <h3>Résultats — Trimestre <?= e($trimestre) ?></h3>
        <span class="badge badge-primary"><?= count($avec_moy) ?> étudiants</span>
    </div>
    <div class="overflow-x">
        <table>
            <thead><tr><th>Rang</th><th>Identifiant</th><th>Nom complet</th><th>Moyenne</th><th>Appréciation</th><th>Bulletin</th></tr></thead>
            <tbody>
                <?php foreach ($avec_moy as $i => $et):
                    $moy = $et['moyenne'];
                    $appr = $moy === null ? 'Non évalué' : appreciation_pour($moy);
                ?>
                <tr>
                    <td><strong><?= $i + 1 ?></strong></td>
                    <td><?= e($et['identifiant']) ?></td>
                    <td><strong><?= e($et['prenom'] . ' ' . $et['nom']) ?></strong></td>
                    <td><span class="badge <?= $moy !== null && $moy >= 10 ? 'badge-success' : 'badge-danger' ?>"><?= $moy !== null ? number_format($moy, 2) . '/20' : 'N/A' ?></span></td>
                    <td><?= e($appr) ?></td>
                    <td><a href="notes_etudiants.php?etudiant_id=<?= e($et['id']) ?>&trimestre=<?= e($trimestre) ?>" class="btn btn-sm btn-primary">Voir bulletin</a></td>
                </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>
</div>

<?php else: ?>
<!-- ===== SÉLECTION ===== -->
<div class="form-card" style="max-width:100%;">
    <h3>Sélectionner un groupe et un trimestre</h3>
    <form method="GET">
        <div class="form-row">
            <div class="form-group">
                <label for="groupe_id">Groupe *</label>
                <select id="groupe_id" name="groupe_id" required>
                    <option value="">— Sélectionner —</option>
                    <?php foreach ($groupes as $g): ?>
                        <option value="<?= e($g['id']) ?>"><?= e(($g['niveau_nom'] ?? '') . ' — ' . $g['nom']) ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
            <div class="form-group">
                <label for="trimestre">Trimestre *</label>
                <select id="trimestre" name="trimestre" required>
                    <option value="1">1er trimestre</option>
                    <option value="2">2e trimestre</option>
                    <option value="3">3e trimestre</option>
                </select>
            </div>
        </div>
        <button type="submit" class="btn btn-primary" style="width:auto;">Afficher les résultats</button>
    </form>
</div>
<?php endif; ?>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
