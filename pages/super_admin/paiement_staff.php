<?php
/**
 * Finance — Paiement du personnel (Staff & Professeurs)
 * Choix staff/profs -> liste + ce qu'ils gagnent -> confirmer paiement (multi-moyens, sortant).
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_finance_page();

$db = getDB();
$message = '';
$type_message = '';
$mois_noms = [1=>'Janvier',2=>'Février',3=>'Mars',4=>'Avril',5=>'Mai',6=>'Juin',
              7=>'Juillet',8=>'Août',9=>'Septembre',10=>'Octobre',11=>'Novembre',12=>'Décembre'];

$type = ($_GET['type'] ?? 'staff') === 'profs' ? 'profs' : 'staff';
$mois  = nettoyer_entier($_GET['mois'] ?? null) ?? (int) date('n');
$annee = nettoyer_entier($_GET['annee'] ?? null) ?? (int) date('Y');

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'payer_salaire') {
    exiger_csrf();
    $btype = ($_POST['beneficiaire_type'] ?? '') === 'professeur' ? 'professeur' : 'staff';
    $bid   = nettoyer_entier($_POST['beneficiaire_id'] ?? 0);
    $pmois = nettoyer_entier($_POST['mois'] ?? 0);
    $pannee= nettoyer_entier($_POST['annee'] ?? 0);
    $motif = nettoyer($_POST['motif'] ?? 'Salaire');

    if ($bid && $pmois >= 1 && $pmois <= 12 && $pannee >= 2020) {
        $res = lire_lignes_paiement(true, 0);
        if (!$res['ok']) {
            $message = $res['message'];
            $type_message = 'error';
        } else {
            try {
                $db->beginTransaction();
                $db->prepare('INSERT INTO paiements_salaire (beneficiaire_type, beneficiaire_id, montant, mois, annee, motif, paye_par)
                              VALUES (:bt,:bi,:mt,:m,:a,:mo,:u)')
                   ->execute([':bt'=>$btype, ':bi'=>$bid, ':mt'=>$res['total'], ':m'=>$pmois, ':a'=>$pannee,
                              ':mo'=>$motif, ':u'=>($_SESSION['utilisateur_id'] ?? null)]);
                $sid = (int) $db->lastInsertId();
                $src = $btype === 'professeur' ? 'salaire_prof' : 'salaire_staff';
                enregistrer_lignes_paiement($src, $sid, $res['lignes'], 'sortant');
                $db->commit();
                $message = "Paiement enregistré : " . number_format($res['total'],0,',',' ') . " MRU.";
                $type_message = 'success';
            } catch (Throwable $e) {
                if ($db->inTransaction()) $db->rollBack();
                $message = "Erreur lors de l'enregistrement du paiement.";
                $type_message = 'error';
            }
        }
    } else {
        $message = 'Données invalides.';
        $type_message = 'error';
    }
}

// Charger la liste selon le type
$lignes = [];
if ($type === 'staff') {
    $lignes = $db->query('SELECT id, CONCAT(prenom," ",nom) AS nom_complet, fonction, salaire AS gain FROM staff WHERE actif = TRUE ORDER BY nom')->fetchAll();
    $benef_type = 'staff';
} else {
    $lignes = $db->query('SELECT id, CONCAT(prenom," ",nom) AS nom_complet, "Professeur" AS fonction, salaire AS gain, prix_par_heure, heures_par_mois FROM professeurs ORDER BY nom')->fetchAll();
    $benef_type = 'professeur';
}

// Paiements déjà effectués pour la période
$deja = [];
$st = $db->prepare('SELECT beneficiaire_id, SUM(montant) AS total FROM paiements_salaire
                    WHERE beneficiaire_type = :bt AND mois = :m AND annee = :a GROUP BY beneficiaire_id');
$st->execute([':bt'=>$benef_type, ':m'=>$mois, ':a'=>$annee]);
foreach ($st->fetchAll() as $r) { $deja[(int)$r['beneficiaire_id']] = (float) $r['total']; }

$titre_page = 'Paiement du personnel';
$sous_titre = 'Régler les salaires du staff et des professeurs (multi-moyens)';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
<div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<form method="GET" class="form-card" style="margin-bottom:1.5rem;">
    <div style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap;">
        <div style="min-width:160px;">
            <label>Catégorie</label>
            <select name="type" onchange="this.form.submit()">
                <option value="staff" <?= $type==='staff'?'selected':'' ?>>Staff</option>
                <option value="profs" <?= $type==='profs'?'selected':'' ?>>Professeurs</option>
            </select>
        </div>
        <div style="min-width:140px;">
            <label>Mois</label>
            <select name="mois" onchange="this.form.submit()">
                <?php foreach ($mois_noms as $mn=>$ml): ?>
                    <option value="<?= $mn ?>" <?= $mois===$mn?'selected':'' ?>><?= e($ml) ?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <div style="min-width:110px;">
            <label>Année</label>
            <select name="annee" onchange="this.form.submit()">
                <?php $aa=(int)date('Y'); for($y=$aa-2;$y<=$aa+1;$y++): ?>
                    <option value="<?= $y ?>" <?= $annee===$y?'selected':'' ?>><?= $y ?></option>
                <?php endfor; ?>
            </select>
        </div>
    </div>
</form>

<div class="table-container">
    <div class="table-header">
        <h3><?= $type==='staff'?'Staff':'Professeurs' ?> — <?= e($mois_noms[$mois]) ?> <?= e($annee) ?></h3>
        <span class="badge badge-primary"><?= count($lignes) ?></span>
    </div>
    <div class="overflow-x">
        <table>
            <thead><tr>
                <th>Nom</th><th>Fonction</th>
                <?php if ($type==='profs'): ?><th>Taux horaire</th><th>Heures/mois</th><?php endif; ?>
                <th>Salaire mensuel</th><th>Déjà payé (mois)</th><th>Action</th>
            </tr></thead>
            <tbody>
                <?php if (!$lignes): ?>
                    <tr><td colspan="7" class="text-center text-muted" style="padding:2rem;">Aucune personne dans cette catégorie.</td></tr>
                <?php else: foreach ($lignes as $p):
                    $paye = $deja[(int)$p['id']] ?? 0; ?>
                <tr>
                    <td><strong><?= e($p['nom_complet']) ?></strong></td>
                    <td><?= e($p['fonction']) ?></td>
                    <?php if ($type==='profs'): ?>
                        <td><?= e(number_format((float)($p['prix_par_heure'] ?? 0),0,',',' ')) ?> MRU</td>
                        <td><?= e((int)($p['heures_par_mois'] ?? 0)) ?> h</td>
                    <?php endif; ?>
                    <td><?= e(number_format((float)$p['gain'],0,',',' ')) ?> MRU</td>
                    <td><?= $paye>0 ? '<span style="color:#10B981;">'.e(number_format($paye,0,',',' ')).' MRU</span>' : '<span class="text-muted">—</span>' ?></td>
                    <td>
                        <button type="button" class="btn btn-sm btn-primary"
                            onclick="ouvrirPay('<?= $benef_type ?>', <?= (int)$p['id'] ?>, '<?= e(addslashes($p['nom_complet'])) ?>', <?= (float)$p['gain'] ?>)">
                            💵 Payer
                        </button>
                    </td>
                </tr>
                <?php endforeach; endif; ?>
            </tbody>
        </table>
    </div>
</div>

<div id="modal_pay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;align-items:center;justify-content:center;padding:1rem;">
    <div class="form-card" style="max-width:480px;width:100%;background:#fff;">
        <h3 style="margin-top:0;">Payer un salaire</h3>
        <p id="pay_info" class="text-muted"></p>
        <form method="POST">
            <?= csrf_field() ?>
            <input type="hidden" name="action" value="payer_salaire">
            <input type="hidden" name="beneficiaire_type" id="pay_btype">
            <input type="hidden" name="beneficiaire_id" id="pay_bid">
            <input type="hidden" name="mois" value="<?= (int)$mois ?>">
            <input type="hidden" name="annee" value="<?= (int)$annee ?>">
            <div style="margin-bottom:.5rem;">
                <label>Motif</label>
                <input type="text" name="motif" value="Salaire" placeholder="Salaire, prime, cours du soir…">
            </div>
            <?= widget_moyens_paiement('sortant', 0, 'paystaff') ?>
            <div style="display:flex;gap:.5rem;margin-top:1rem;">
                <button class="btn btn-primary">✓ Confirmer le paiement</button>
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('modal_pay').style.display='none'">Annuler</button>
            </div>
        </form>
    </div>
</div>

<script>
function ouvrirPay(btype, bid, nom, gain) {
    document.getElementById('pay_btype').value = btype;
    document.getElementById('pay_bid').value = bid;
    document.getElementById('pay_info').textContent = nom + ' — salaire de référence : ' + gain.toLocaleString('fr-FR') + ' MRU';
    var w = document.querySelector('#modal_pay .mp-widget');
    if (w) { w.dataset.cible = gain; var l = document.getElementById('paystaff_lignes'); l.innerHTML=''; mpAjouter('paystaff', undefined, gain); }
    document.getElementById('modal_pay').style.display = 'flex';
}
</script>
<?= widget_moyens_paiement_js() ?>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
