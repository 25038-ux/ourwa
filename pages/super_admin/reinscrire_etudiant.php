<?php
/**
 * Réinscrire un étudiant — recherche par téléphone du correspondant OU nom de l'étudiant.
 * Sélectionne un étudiant, choisit un nouveau groupe, et déclenche la réinscription.
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_staff_admin();
require_once __DIR__ . '/../../includes/parent_auth.php';

$db = getDB();
$message = '';
$type_message = '';
$reinscrit = null;
$mois_noms = [1=>'Janvier',2=>'Février',3=>'Mars',4=>'Avril',5=>'Mai',6=>'Juin',
              7=>'Juillet',8=>'Août',9=>'Septembre',10=>'Octobre',11=>'Novembre',12=>'Décembre'];

// --- Action : paiement (multi-moyens) après réinscription ---
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'payer') {
    exiger_csrf();
    $eid   = nettoyer_entier($_POST['etudiant_id'] ?? 0);
    $mois  = nettoyer_entier($_POST['mois'] ?? 0);
    $annee = (int) date('Y');
    if ($eid && $mois >= 1 && $mois <= 12) {
        $res = lire_lignes_paiement(true, 0);
        if (!$res['ok']) {
            $message = $res['message'];
            $type_message = 'error';
        } else {
            $recu = 'REC-' . date('Ymd') . '-' . $eid . '-' . $mois . $annee . '-' . random_int(1000, 9999);
            try {
                $db->beginTransaction();
                $db->prepare('INSERT INTO paiements (etudiant_id,mois,annee,montant,recu_numero) VALUES (:e,:m,:a,:mt,:r)')
                   ->execute([':e'=>$eid, ':m'=>$mois, ':a'=>$annee, ':mt'=>$res['total'], ':r'=>$recu]);
                $pid = (int) $db->lastInsertId();
                enregistrer_lignes_paiement('paiement', $pid, $res['lignes'], 'entrant');
                $db->commit();
                notifier_parent_de_etudiant($eid, 'info', 'Paiement enregistré',
                    "Paiement de {$mois_noms[$mois]} {$annee} enregistré. Reçu : {$recu}");
                header('Location: gestion_caisse.php?print_recu=' . $pid);
                exit;
            } catch (Throwable $e) {
                if ($db->inTransaction()) $db->rollBack();
                $message = 'Ce mois est déjà payé.';
                $type_message = 'error';
            }
        }
    }
}

// --- Action : réinscription ---
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'reinscrire') {
    exiger_csrf();
    $etudiant_id    = nettoyer_entier($_POST['etudiant_id'] ?? 0) ?? 0;
    $nouveau_groupe = nettoyer_entier($_POST['nouveau_groupe_id'] ?? 0) ?? 0;

    if ($etudiant_id && $nouveau_groupe) {
        try {
            $db->beginTransaction();
            $st = $db->prepare('SELECT groupe_id, nom, prenom FROM etudiants WHERE id = :e');
            $st->execute([':e' => $etudiant_id]);
            $info = $st->fetch();
            if (!$info) throw new Exception('Étudiant introuvable.');

            $ancien = (int) $info['groupe_id'];
            $annee  = date('Y') . '-' . (date('Y') + 1);

            $db->prepare('INSERT INTO reinscriptions (etudiant_id, ancien_groupe_id, nouveau_groupe_id, annee_scolaire) VALUES (:e,:a,:n,:an)')
               ->execute([':e'=>$etudiant_id, ':a'=>$ancien, ':n'=>$nouveau_groupe, ':an'=>$annee]);

            // Aligner les frais sur le tarif du nouveau niveau
            $tar = $db->prepare('SELECT nv.tarif_mensuel FROM groupes g JOIN niveaux nv ON g.niveau_id = nv.id WHERE g.id = :g');
            $tar->execute([':g' => $nouveau_groupe]);
            $tarif = $tar->fetchColumn();

            if ($tarif !== false) {
                $db->prepare('UPDATE etudiants SET groupe_id = :g, frais_mensuel = :f WHERE id = :e')
                   ->execute([':g'=>$nouveau_groupe, ':f'=>$tarif, ':e'=>$etudiant_id]);
            } else {
                $db->prepare('UPDATE etudiants SET groupe_id = :g WHERE id = :e')
                   ->execute([':g'=>$nouveau_groupe, ':e'=>$etudiant_id]);
            }

            notifier_parent_de_etudiant($etudiant_id, 'info', 'Réinscription',
                "{$info['prenom']} {$info['nom']} a été réinscrit(e) dans une nouvelle classe pour l'année {$annee}.");

            $db->commit();
            journaliser($_SESSION['utilisateur_id'], "Réinscription étudiant #{$etudiant_id} -> groupe #{$nouveau_groupe}");
            $message = "Étudiant réinscrit avec succès dans la nouvelle classe.";
            $type_message = 'success';
            // Récupérer les infos pour proposer un premier paiement (multi-moyens)
            $st = $db->prepare('SELECT id, prenom, nom, frais_mensuel FROM etudiants WHERE id = :e');
            $st->execute([':e' => $etudiant_id]);
            $reinscrit = $st->fetch();
            regenerer_csrf();
        } catch (Throwable $ex) {
            if ($db->inTransaction()) $db->rollBack();
            $message = 'Erreur : ' . $ex->getMessage();
            $type_message = 'error';
        }
    } else {
        $message = 'Veuillez sélectionner un étudiant et un nouveau groupe.';
        $type_message = 'error';
    }
}

// --- Recherche d'étudiants ---
$q = trim((string) ($_GET['q'] ?? ''));
$etudiants_trouves = [];
if ($q !== '') {
    $stmt = $db->prepare('
        SELECT e.id, e.nom, e.prenom, e.identifiant, e.rim, e.nni,
               e.nom_parent, e.telephone_parent,
               g.nom AS groupe, IFNULL(n.nom,"—") AS niveau
        FROM etudiants e
        JOIN groupes g ON e.groupe_id = g.id
        LEFT JOIN niveaux n ON g.niveau_id = n.id
        WHERE e.nom LIKE :q
           OR e.prenom LIKE :q
           OR CONCAT(e.prenom," ",e.nom) LIKE :q
           OR CONCAT(e.nom," ",e.prenom) LIKE :q
           OR e.nom_parent LIKE :q
           OR REPLACE(REPLACE(REPLACE(e.telephone_parent," ",""),"-",""),"+","") LIKE :qt
        ORDER BY e.nom, e.prenom
        LIMIT 50');
    $stmt->execute([
        ':q'  => '%' . $q . '%',
        ':qt' => '%' . preg_replace('/[^\d]/', '', $q) . '%',
    ]);
    $etudiants_trouves = $stmt->fetchAll();
}

// Tous les groupes (pour choisir la destination)
$tous_groupes = $db->query('
    SELECT g.id, g.nom, IFNULL(n.nom,"Sans niveau") AS niveau
    FROM groupes g LEFT JOIN niveaux n ON g.niveau_id = n.id
    ORDER BY n.nom, g.nom')->fetchAll();

$titre_page = 'Réinscrire un étudiant';
$sous_titre = 'Recherche par nom de l\'étudiant ou téléphone du correspondant';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
    <div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<?php if ($reinscrit): ?>
    <div class="form-card" style="margin-bottom:1.5rem;">
        <h3 style="margin-top:0;color:#10B981;">✓ Réinscription réussie</h3>
        <p><strong><?= e($reinscrit['prenom'].' '.$reinscrit['nom']) ?></strong> —
           nouveau frais mensuel : <strong><?= e(number_format((float)$reinscrit['frais_mensuel'],0,',',' ')) ?> MRU</strong></p>
        <h4>Confirmer un paiement (facultatif)</h4>
        <form method="POST">
            <?= csrf_field() ?>
            <input type="hidden" name="action" value="payer">
            <input type="hidden" name="etudiant_id" value="<?= (int)$reinscrit['id'] ?>">
            <div style="max-width:280px;margin-bottom:.5rem;">
                <label>Mois</label>
                <select name="mois" required>
                    <?php for ($m=1;$m<=12;$m++): ?>
                        <option value="<?= $m ?>" <?= $m==(int)date('n')?'selected':'' ?>><?= e($mois_noms[$m]) ?></option>
                    <?php endfor; ?>
                </select>
            </div>
            <?= widget_moyens_paiement('entrant', (float)$reinscrit['frais_mensuel'], 'reinscpay') ?>
            <div style="margin-top:1rem;display:flex;gap:.5rem;flex-wrap:wrap;">
                <button class="btn btn-primary">💳 Confirmer & imprimer le reçu</button>
                <a href="reinscrire_etudiant.php" class="btn btn-secondary">Terminer</a>
            </div>
        </form>
    </div>
    <?= widget_moyens_paiement_js() ?>
<?php endif; ?>

<div class="form-card" style="margin-bottom:1.5rem;">
    <h3>🔍 Rechercher un étudiant</h3>
    <form method="GET" style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:flex-end;">
        <div class="form-group" style="flex:1;min-width:280px;margin-bottom:0;">
            <label for="q">Nom de l'étudiant <strong>OU</strong> téléphone du correspondant</label>
            <input type="text" id="q" name="q" value="<?= e($q) ?>" placeholder="Ex : Ahmed, ou 22 12 34 56" autofocus>
        </div>
        <button class="btn btn-primary" style="width:auto;">Rechercher</button>
        <?php if ($q !== ''): ?>
            <a href="reinscrire_etudiant.php" class="btn btn-secondary">Réinitialiser</a>
        <?php endif; ?>
    </form>
</div>

<?php if ($q !== ''): ?>
    <?php if (empty($etudiants_trouves)): ?>
        <div class="alert alert-info">Aucun étudiant ne correspond à « <?= e($q) ?> ».</div>
    <?php else: ?>
        <div class="table-container">
            <div class="table-header">
                <h3>Résultats</h3>
                <span class="badge badge-primary"><?= count($etudiants_trouves) ?></span>
            </div>
            <div class="overflow-x">
                <table>
                    <thead>
                        <tr><th>Étudiant</th><th>Matricule</th><th>Classe actuelle</th><th>Correspondant</th><th>Action</th></tr>
                    </thead>
                    <tbody>
                        <?php foreach ($etudiants_trouves as $et): ?>
                        <tr>
                            <td><strong><?= e($et['prenom'] . ' ' . $et['nom']) ?></strong></td>
                            <td><?= e($et['identifiant']) ?></td>
                            <td><?= e($et['niveau'] . ' — ' . $et['groupe']) ?></td>
                            <td>
                                <?= e($et['nom_parent']) ?><br>
                                <small class="text-muted"><?= e($et['telephone_parent']) ?></small>
                            </td>
                            <td>
                                <button class="btn btn-sm btn-primary" type="button"
                                        onclick="ouvrirModale('m-<?= e($et['id']) ?>')">
                                    🔄 Réinscrire
                                </button>
                                <a href="<?= e(get_base_url()) ?>/pages/super_admin/recherche.php?q=<?= urlencode($et['identifiant']) ?>"
                                   class="btn btn-sm btn-secondary">Profil</a>
                            </td>
                        </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        </div>

        <?php foreach ($etudiants_trouves as $et): ?>
        <div class="modal-overlay" id="m-<?= e($et['id']) ?>">
            <div class="modal" style="max-width:520px;">
                <div class="modal-header">
                    <h3>Réinscrire <?= e($et['prenom'] . ' ' . $et['nom']) ?></h3>
                    <button class="modal-close" onclick="fermerModale('m-<?= e($et['id']) ?>')">&times;</button>
                </div>
                <form method="POST">
                    <?= champ_csrf() ?>
                    <input type="hidden" name="action" value="reinscrire">
                    <input type="hidden" name="etudiant_id" value="<?= e($et['id']) ?>">

                    <p class="text-muted" style="font-size:.88rem;margin-bottom:1rem;">
                        Classe actuelle : <strong><?= e($et['niveau'] . ' — ' . $et['groupe']) ?></strong>.<br>
                        Les frais s'aligneront automatiquement sur le tarif du nouveau niveau.
                    </p>

                    <div class="form-group">
                        <label>Nouveau groupe *</label>
                        <select name="nouveau_groupe_id" required>
                            <option value="">— Choisir —</option>
                            <?php foreach ($tous_groupes as $tg): ?>
                                <option value="<?= e($tg['id']) ?>"><?= e($tg['niveau'] . ' — ' . $tg['nom']) ?></option>
                            <?php endforeach; ?>
                        </select>
                    </div>

                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="fermerModale('m-<?= e($et['id']) ?>')">Annuler</button>
                        <button type="submit" class="btn btn-primary">🔄 Confirmer la réinscription</button>
                    </div>
                </form>
            </div>
        </div>
        <?php endforeach; ?>
    <?php endif; ?>
<?php else: ?>
    <div class="alert alert-info">
        Saisissez un nom d'étudiant ou un numéro de téléphone du correspondant pour commencer.
    </div>
<?php endif; ?>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
