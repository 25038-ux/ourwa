<?php
/**
 * Finance — Dettes
 *  - Prêter X mois de service à une personne (étudiant existant ou tiers)
 *  - Suivi des remboursements (multi-moyens, entrant)
 *  - Liste des débiteurs + profil de dette
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_finance_page();

$db = getDB();
$message = '';
$type_message = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();
    $action = $_POST['action'] ?? '';

    if ($action === 'creer_dette') {
        $nom    = nettoyer($_POST['debiteur_nom'] ?? '');
        $tel    = nettoyer_telephone($_POST['telephone'] ?? '');
        $nbmois = nettoyer_entier($_POST['nb_mois'] ?? 0) ?? 0;
        $montant= nettoyer_decimal($_POST['montant_total'] ?? 0) ?? 0;
        $motif  = nettoyer($_POST['motif'] ?? '');
        $eid    = nettoyer_entier($_POST['etudiant_id'] ?? 0);
        if (mb_strlen($nom) >= 2 && $nbmois >= 1 && $montant > 0) {
            $db->prepare('INSERT INTO dettes (etudiant_id, debiteur_nom, telephone, nb_mois, montant_total, motif, cree_par)
                          VALUES (:e,:n,:t,:nm,:mt,:mo,:u)')
               ->execute([':e'=>($eid ?: null), ':n'=>$nom, ':t'=>($tel ?: null), ':nm'=>$nbmois,
                          ':mt'=>$montant, ':mo'=>($motif ?: null), ':u'=>($_SESSION['utilisateur_id'] ?? null)]);
            $message = 'Dette enregistrée.';
            $type_message = 'success';
        } else {
            $message = 'Données de dette invalides (nom, nombre de mois ≥ 1, montant > 0).';
            $type_message = 'error';
        }
    }
    elseif ($action === 'rembourser') {
        $dette_id = nettoyer_entier($_POST['dette_id'] ?? 0);
        if ($dette_id) {
            $st = $db->prepare('SELECT montant_total, montant_rembourse FROM dettes WHERE id = :id');
            $st->execute([':id'=>$dette_id]);
            $d = $st->fetch();
            $reste = $d ? ((float)$d['montant_total'] - (float)$d['montant_rembourse']) : 0;
            $res = lire_lignes_paiement(true, 0);
            if (!$d) {
                $message = 'Dette introuvable.'; $type_message = 'error';
            } elseif (!$res['ok']) {
                $message = $res['message']; $type_message = 'error';
            } elseif ($res['total'] > $reste + 0.01) {
                $message = 'Le remboursement (' . number_format($res['total'],0,',',' ') . ' MRU) dépasse le reste dû (' . number_format($reste,0,',',' ') . ' MRU).';
                $type_message = 'error';
            } else {
                try {
                    $db->beginTransaction();
                    $db->prepare('INSERT INTO dette_remboursements (dette_id, montant) VALUES (:d,:m)')
                       ->execute([':d'=>$dette_id, ':m'=>$res['total']]);
                    $rid = (int) $db->lastInsertId();
                    enregistrer_lignes_paiement('dette', $rid, $res['lignes'], 'entrant');
                    $db->prepare('UPDATE dettes SET montant_rembourse = montant_rembourse + :m WHERE id = :id')
                       ->execute([':m'=>$res['total'], ':id'=>$dette_id]);
                    $db->commit();
                    $message = 'Remboursement enregistré : ' . number_format($res['total'],0,',',' ') . ' MRU.';
                    $type_message = 'success';
                } catch (Throwable $e) {
                    if ($db->inTransaction()) $db->rollBack();
                    $message = 'Erreur lors du remboursement.'; $type_message = 'error';
                }
            }
        }
    }
}

// Profil d'une dette ?
$dette_id = nettoyer_entier($_GET['dette_id'] ?? 0) ?? 0;
$dette = null; $remboursements = [];
if ($dette_id) {
    $st = $db->prepare('SELECT * FROM dettes WHERE id = :id');
    $st->execute([':id'=>$dette_id]);
    $dette = $st->fetch();
    if ($dette) {
        $st = $db->prepare('SELECT * FROM dette_remboursements WHERE dette_id = :id ORDER BY date_remb DESC');
        $st->execute([':id'=>$dette_id]);
        $remboursements = $st->fetchAll();
    }
}

// Liste des débiteurs
$q = trim((string)($_GET['q'] ?? ''));
$sql = 'SELECT id, debiteur_nom, telephone, nb_mois, montant_total, montant_rembourse,
               (montant_total - montant_rembourse) AS reste
        FROM dettes';
$params = [];
if ($q !== '') { $sql .= ' WHERE debiteur_nom LIKE :q OR telephone LIKE :q'; $params[':q'] = '%'.$q.'%'; }
$sql .= ' ORDER BY (montant_total - montant_rembourse) DESC, debiteur_nom';
$st = $db->prepare($sql); $st->execute($params);
$dettes = $st->fetchAll();

$titre_page = 'Dettes';
$sous_titre = 'Prêts de service et suivi des remboursements';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
<div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<?php if ($dette): ?>
    <a href="dette.php" class="btn btn-secondary" style="margin-bottom:1rem;">← Toutes les dettes</a>
    <?php $reste = (float)$dette['montant_total'] - (float)$dette['montant_rembourse']; ?>
    <div class="form-card" style="margin-bottom:1.5rem;">
        <h3 style="margin-top:0;">📋 <?= e($dette['debiteur_nom']) ?></h3>
        <p class="text-muted"><?= e($dette['telephone'] ?: '—') ?> · <?= (int)$dette['nb_mois'] ?> mois prêtés
            <?= $dette['motif'] ? '· '.e($dette['motif']) : '' ?></p>
        <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-top:.5rem;">
            <div style="flex:1;text-align:center;background:#f9fafb;border-radius:10px;padding:.75rem;">
                <div style="font-size:1.3rem;font-weight:700;"><?= e(number_format((float)$dette['montant_total'],0,',',' ')) ?></div>
                <div class="text-muted" style="font-size:.8rem;">Dette totale (MRU)</div>
            </div>
            <div style="flex:1;text-align:center;background:#ecfdf5;border-radius:10px;padding:.75rem;">
                <div style="font-size:1.3rem;font-weight:700;color:#10B981;"><?= e(number_format((float)$dette['montant_rembourse'],0,',',' ')) ?></div>
                <div class="text-muted" style="font-size:.8rem;">Remboursé</div>
            </div>
            <div style="flex:1;text-align:center;background:#fef2f2;border-radius:10px;padding:.75rem;">
                <div style="font-size:1.3rem;font-weight:700;color:#EF4444;"><?= e(number_format($reste,0,',',' ')) ?></div>
                <div class="text-muted" style="font-size:.8rem;">Reste dû</div>
            </div>
        </div>
    </div>

    <?php if ($reste > 0.01): ?>
    <div class="form-card" style="margin-bottom:1.5rem;">
        <h4 style="margin-top:0;">💵 Enregistrer un remboursement</h4>
        <form method="POST">
            <?= csrf_field() ?>
            <input type="hidden" name="action" value="rembourser">
            <input type="hidden" name="dette_id" value="<?= (int)$dette['id'] ?>">
            <?= widget_moyens_paiement('entrant', 0, 'detpay') ?>
            <button class="btn btn-primary" style="margin-top:.75rem;">Confirmer le remboursement</button>
        </form>
    </div>
    <?php else: ?>
        <div class="alert alert-success" style="margin-bottom:1.5rem;">✓ Dette entièrement remboursée.</div>
    <?php endif; ?>

    <div class="table-container">
        <div class="table-header"><h3>Historique des remboursements</h3></div>
        <div class="overflow-x">
            <table>
                <thead><tr><th>Date</th><th>Montant</th><th>Moyen(s)</th></tr></thead>
                <tbody>
                    <?php if (!$remboursements): ?>
                        <tr><td colspan="3" class="text-center text-muted">Aucun remboursement.</td></tr>
                    <?php else: foreach ($remboursements as $r): ?>
                        <tr>
                            <td><?= e(date('d/m/Y H:i', strtotime($r['date_remb']))) ?></td>
                            <td><strong style="color:#10B981;"><?= e(number_format((float)$r['montant'],0,',',' ')) ?> MRU</strong></td>
                            <td><?= e(resume_moyens('dette', (int)$r['id'])) ?></td>
                        </tr>
                    <?php endforeach; endif; ?>
                </tbody>
            </table>
        </div>
    </div>
    <?= widget_moyens_paiement_js() ?>

<?php else: ?>
    <div class="form-card" style="margin-bottom:1.5rem;">
        <h3 style="margin-top:0;">➕ Nouvelle dette</h3>
        <form method="POST">
            <?= csrf_field() ?>
            <input type="hidden" name="action" value="creer_dette">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                <div class="form-group"><label>Nom du débiteur *</label><input type="text" name="debiteur_nom" required></div>
                <div class="form-group"><label>Téléphone</label><input type="text" name="telephone"></div>
                <div class="form-group"><label>Nombre de mois prêtés *</label><input type="number" name="nb_mois" min="1" value="1" required></div>
                <div class="form-group"><label>Montant total (MRU) *</label><input type="number" name="montant_total" min="1" step="0.01" required></div>
            </div>
            <div class="form-group"><label>Motif (optionnel)</label><input type="text" name="motif"></div>
            <button class="btn btn-primary">Enregistrer la dette</button>
        </form>
    </div>

    <form method="GET" class="form-card" style="margin-bottom:1rem;">
        <div style="display:flex;gap:.5rem;align-items:flex-end;">
            <div style="flex:1;"><label>🔍 Rechercher un débiteur</label><input type="text" name="q" value="<?= e($q) ?>" placeholder="Nom ou téléphone"></div>
            <button class="btn btn-primary">Chercher</button>
            <?php if ($q!==''): ?><a href="dette.php" class="btn btn-secondary">Réinitialiser</a><?php endif; ?>
        </div>
    </form>

    <div class="table-container">
        <div class="table-header"><h3>Débiteurs</h3><span class="badge badge-primary"><?= count($dettes) ?></span></div>
        <div class="overflow-x">
            <table>
                <thead><tr><th>Débiteur</th><th>Tél</th><th>Mois</th><th>Total</th><th>Remboursé</th><th>Reste</th><th></th></tr></thead>
                <tbody>
                    <?php if (!$dettes): ?>
                        <tr><td colspan="7" class="text-center text-muted" style="padding:2rem;">Aucune dette enregistrée.</td></tr>
                    <?php else: foreach ($dettes as $d):
                        $reste=(float)$d['reste']; ?>
                        <tr>
                            <td><strong><?= e($d['debiteur_nom']) ?></strong></td>
                            <td><?= e($d['telephone'] ?: '—') ?></td>
                            <td><?= (int)$d['nb_mois'] ?></td>
                            <td><?= e(number_format((float)$d['montant_total'],0,',',' ')) ?></td>
                            <td style="color:#10B981;"><?= e(number_format((float)$d['montant_rembourse'],0,',',' ')) ?></td>
                            <td><strong style="color:<?= $reste>0.01?'#EF4444':'#10B981' ?>;"><?= e(number_format($reste,0,',',' ')) ?></strong></td>
                            <td><a href="dette.php?dette_id=<?= (int)$d['id'] ?>" class="btn btn-sm btn-primary">Profil →</a></td>
                        </tr>
                    <?php endforeach; endif; ?>
                </tbody>
            </table>
        </div>
    </div>
<?php endif; ?>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
