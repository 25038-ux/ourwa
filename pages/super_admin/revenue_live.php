<?php
/**
 * Finance — Revenue Live
 *  - Revenus du jour (par moyen + par source)
 *  - Sélecteur de jour
 *  - Statistiques par mois : entrées/sorties par moyen + solde (entrées - sorties)
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_finance_page();

$db = getDB();
$mois_noms = [1=>'Janvier',2=>'Février',3=>'Mars',4=>'Avril',5=>'Mai',6=>'Juin',
              7=>'Juillet',8=>'Août',9=>'Septembre',10=>'Octobre',11=>'Novembre',12=>'Décembre'];
$src_labels = [
    'paiement'      => 'Frais étudiants',
    'depense'       => 'Dépense',
    'salaire_prof'  => 'Salaire professeur',
    'salaire_staff' => 'Salaire staff',
    'dette'         => 'Remboursement dette',
    'cours_soir'    => 'Cours du soir',
];

$jour = $_GET['jour'] ?? date('Y-m-d');
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $jour)) $jour = date('Y-m-d');

$mois  = nettoyer_entier($_GET['mois'] ?? 0) ?? (int) date('n');
$annee = nettoyer_entier($_GET['annee'] ?? 0) ?? (int) date('Y');

// --- Revenus du jour, par moyen (entrant) ---
$st = $db->prepare("
    SELECT mp.nom AS moyen, COALESCE(SUM(pl.montant),0) AS total
    FROM paiement_lignes pl JOIN moyens_paiement mp ON pl.moyen_id = mp.id
    WHERE pl.sens='entrant' AND DATE(pl.date_creation) = :j
    GROUP BY mp.id, mp.nom ORDER BY total DESC");
$st->execute([':j' => $jour]);
$jour_par_moyen = $st->fetchAll();
$jour_total = array_sum(array_column($jour_par_moyen, 'total'));

// --- Revenus du jour, par source ---
$st = $db->prepare("
    SELECT pl.source_type, COALESCE(SUM(pl.montant),0) AS total
    FROM paiement_lignes pl
    WHERE pl.sens='entrant' AND DATE(pl.date_creation) = :j
    GROUP BY pl.source_type ORDER BY total DESC");
$st->execute([':j' => $jour]);
$jour_par_source = $st->fetchAll();

// --- Stats du mois : par moyen, entrant / sortant / solde ---
$st = $db->prepare("
    SELECT mp.nom AS moyen,
           COALESCE(SUM(CASE WHEN pl.sens='entrant' THEN pl.montant ELSE 0 END),0) AS entrant,
           COALESCE(SUM(CASE WHEN pl.sens='sortant' THEN pl.montant ELSE 0 END),0) AS sortant
    FROM moyens_paiement mp
    LEFT JOIN paiement_lignes pl ON pl.moyen_id = mp.id
        AND MONTH(pl.date_creation) = :m AND YEAR(pl.date_creation) = :a
    GROUP BY mp.id, mp.nom ORDER BY mp.nom");
$st->execute([':m' => $mois, ':a' => $annee]);
$mois_par_moyen = $st->fetchAll();

// Détail des sorties du mois vers salaires (profs + staff)
$st = $db->prepare("
    SELECT beneficiaire_type, COALESCE(SUM(montant),0) AS total
    FROM paiements_salaire WHERE mois=:m AND annee=:a GROUP BY beneficiaire_type");
$st->execute([':m'=>$mois, ':a'=>$annee]);
$salaires = ['professeur'=>0,'staff'=>0];
foreach ($st->fetchAll() as $r) { $salaires[$r['beneficiaire_type']] = (float)$r['total']; }

$titre_page = 'Revenue Live';
$sous_titre = 'Suivi des encaissements et soldes par moyen de paiement';
include __DIR__ . '/../../includes/layout_header.php';
?>

<!-- ===== Revenus du jour ===== -->
<form method="GET" class="form-card" style="margin-bottom:1rem;">
    <div style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap;">
        <div>
            <label>📅 Jour</label>
            <input type="date" name="jour" value="<?= e($jour) ?>" onchange="this.form.submit()">
        </div>
        <div style="flex:1;"></div>
        <div style="text-align:right;">
            <div class="text-muted" style="font-size:.85rem;">Total encaissé ce jour</div>
            <div style="font-size:1.6rem;font-weight:700;color:#10B981;"><?= e(number_format($jour_total,0,',',' ')) ?> MRU</div>
        </div>
    </div>
</form>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem;">
    <div class="form-card">
        <h3 style="margin-top:0;">Par moyen de paiement</h3>
        <?php if (!$jour_par_moyen): ?>
            <p class="text-muted">Aucun encaissement ce jour.</p>
        <?php else: foreach ($jour_par_moyen as $r): ?>
            <div style="display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid #f0f0f0;">
                <span><?= e($r['moyen']) ?></span>
                <strong><?= e(number_format((float)$r['total'],0,',',' ')) ?> MRU</strong>
            </div>
        <?php endforeach; endif; ?>
    </div>
    <div class="form-card">
        <h3 style="margin-top:0;">Par origine</h3>
        <?php if (!$jour_par_source): ?>
            <p class="text-muted">Aucun encaissement ce jour.</p>
        <?php else: foreach ($jour_par_source as $r): ?>
            <div style="display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid #f0f0f0;">
                <span><?= e($src_labels[$r['source_type']] ?? $r['source_type']) ?></span>
                <strong><?= e(number_format((float)$r['total'],0,',',' ')) ?> MRU</strong>
            </div>
        <?php endforeach; endif; ?>
    </div>
</div>

<!-- ===== Statistiques par mois ===== -->
<form method="GET" class="form-card" style="margin-bottom:1rem;">
    <input type="hidden" name="jour" value="<?= e($jour) ?>">
    <div style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap;">
        <h3 style="margin:0;flex:1;">Statistiques par mois</h3>
        <div><label>Mois</label>
            <select name="mois" onchange="this.form.submit()">
                <?php foreach ($mois_noms as $mn=>$ml): ?><option value="<?= $mn ?>" <?= $mois===$mn?'selected':'' ?>><?= e($ml) ?></option><?php endforeach; ?>
            </select>
        </div>
        <div><label>Année</label>
            <select name="annee" onchange="this.form.submit()">
                <?php $aa=(int)date('Y'); for($y=$aa-2;$y<=$aa+1;$y++): ?><option value="<?= $y ?>" <?= $annee===$y?'selected':'' ?>><?= $y ?></option><?php endfor; ?>
            </select>
        </div>
    </div>
</form>

<div class="table-container" style="margin-bottom:1.5rem;">
    <div class="table-header"><h3><?= e($mois_noms[$mois]) ?> <?= e($annee) ?> — par moyen</h3></div>
    <div class="overflow-x">
        <table>
            <thead><tr><th>Moyen</th><th>Encaissé (entrées)</th><th>Décaissé (sorties)</th><th>Solde</th></tr></thead>
            <tbody>
                <?php
                $tot_e=0;$tot_s=0;
                foreach ($mois_par_moyen as $r):
                    $e=(float)$r['entrant'];$s=(float)$r['sortant'];$solde=$e-$s;$tot_e+=$e;$tot_s+=$s;
                ?>
                <tr>
                    <td><strong><?= e($r['moyen']) ?></strong></td>
                    <td style="color:#10B981;"><?= e(number_format($e,0,',',' ')) ?> MRU</td>
                    <td style="color:#EF4444;"><?= e(number_format($s,0,',',' ')) ?> MRU</td>
                    <td><strong style="color:<?= $solde>=0?'#10B981':'#EF4444' ?>;"><?= e(number_format($solde,0,',',' ')) ?> MRU</strong></td>
                </tr>
                <?php endforeach; ?>
                <tr style="background:#f8f8f8;font-weight:700;">
                    <td>Total</td>
                    <td style="color:#10B981;"><?= e(number_format($tot_e,0,',',' ')) ?> MRU</td>
                    <td style="color:#EF4444;"><?= e(number_format($tot_s,0,',',' ')) ?> MRU</td>
                    <td><?= e(number_format($tot_e-$tot_s,0,',',' ')) ?> MRU</td>
                </tr>
            </tbody>
        </table>
    </div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
    <div class="form-card">
        <h4 style="margin-top:0;">Payé aux professeurs (<?= e($mois_noms[$mois]) ?>)</h4>
        <div style="font-size:1.4rem;font-weight:700;color:#EF4444;"><?= e(number_format($salaires['professeur'],0,',',' ')) ?> MRU</div>
    </div>
    <div class="form-card">
        <h4 style="margin-top:0;">Payé au staff (<?= e($mois_noms[$mois]) ?>)</h4>
        <div style="font-size:1.4rem;font-weight:700;color:#EF4444;"><?= e(number_format($salaires['staff'],0,',',' ')) ?> MRU</div>
    </div>
</div>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
