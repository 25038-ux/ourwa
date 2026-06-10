<?php
/**
 * Gestion de cours du soir
 *  - Groupes indépendants des niveaux (tarif propre)
 *  - Emploi du temps par groupe
 *  - Profs assignés (taux horaire -> payables via Paiement du personnel)
 *  - Inscrits : étudiants de l'école OU externes
 *  - Finance intégrée (paiements multi-moyens, entrant)
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_role(['super_admin', 'admin', 'comptable']);

$db = getDB();
$message = '';
$type_message = '';
$mois_noms = [1=>'Janvier',2=>'Février',3=>'Mars',4=>'Avril',5=>'Mai',6=>'Juin',
              7=>'Juillet',8=>'Août',9=>'Septembre',10=>'Octobre',11=>'Novembre',12=>'Décembre'];
$jours = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];

$embed = isset($_GET['embed']) ? '?embed=1' : '';
$embed_amp = isset($_GET['embed']) ? '&embed=1' : '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();
    $action = $_POST['action'] ?? '';

    if ($action === 'creer_groupe') {
        $nom = nettoyer($_POST['nom_groupe_cs'] ?? '');
        $tarif = nettoyer_decimal($_POST['tarif_mensuel'] ?? 0) ?? 0;
        $desc = nettoyer($_POST['description'] ?? '');
        if (mb_strlen($nom) >= 2 && $tarif >= 0) {
            $db->prepare('INSERT INTO cs_groupes (nom, tarif_mensuel, description) VALUES (:n,:t,:d)')
               ->execute([':n'=>$nom, ':t'=>$tarif, ':d'=>($desc ?: null)]);
            $message = "Groupe « {$nom} » créé."; $type_message = 'success';
        } else { $message = 'Données invalides.'; $type_message = 'error'; }
    }
    elseif ($action === 'inscrire_existant') {
        $gid = nettoyer_entier($_POST['cs_groupe_id'] ?? 0);
        $eid = nettoyer_entier($_POST['etudiant_id'] ?? 0);
        if ($gid && $eid) {
            $db->prepare('INSERT INTO cs_inscriptions (cs_groupe_id, etudiant_id) VALUES (:g,:e)')
               ->execute([':g'=>$gid, ':e'=>$eid]);
            $message = 'Étudiant (école) inscrit au cours du soir.'; $type_message = 'success';
        } else { $message = 'Sélection invalide.'; $type_message = 'error'; }
    }
    elseif ($action === 'inscrire_externe') {
        $gid = nettoyer_entier($_POST['cs_groupe_id'] ?? 0);
        $nom = nettoyer($_POST['externe_nom'] ?? '');
        $tel = nettoyer_telephone($_POST['externe_tel'] ?? '');
        $sexe = ($_POST['externe_sexe'] ?? '') === 'M' ? 'M' : (($_POST['externe_sexe'] ?? '') === 'F' ? 'F' : null);
        if ($gid && mb_strlen($nom) >= 2) {
            $db->prepare('INSERT INTO cs_inscriptions (cs_groupe_id, externe_nom, externe_tel, externe_sexe) VALUES (:g,:n,:t,:s)')
               ->execute([':g'=>$gid, ':n'=>$nom, ':t'=>($tel ?: null), ':s'=>$sexe]);
            $message = 'Élève externe inscrit.'; $type_message = 'success';
        } else { $message = 'Nom requis.'; $type_message = 'error'; }
    }
    elseif ($action === 'assigner_prof') {
        $gid = nettoyer_entier($_POST['cs_groupe_id'] ?? 0);
        $pid = nettoyer_entier($_POST['professeur_id'] ?? 0);
        $mat = nettoyer($_POST['matiere'] ?? '');
        $pph = nettoyer_decimal($_POST['prix_par_heure'] ?? 0) ?? 0;
        $hpm = nettoyer_entier($_POST['heures_par_mois'] ?? 0) ?? 0;
        if ($gid && $pid) {
            try {
                $db->prepare('INSERT INTO cs_enseignements (cs_groupe_id, professeur_id, matiere, prix_par_heure, heures_par_mois)
                              VALUES (:g,:p,:m,:pph,:hpm)')
                   ->execute([':g'=>$gid, ':p'=>$pid, ':m'=>($mat ?: null), ':pph'=>$pph, ':hpm'=>$hpm]);
                $message = 'Professeur assigné.'; $type_message = 'success';
            } catch (Throwable $e) { $message = 'Ce professeur est déjà assigné à ce groupe.'; $type_message = 'error'; }
        }
    }
    elseif ($action === 'ajouter_creneau') {
        $gid = nettoyer_entier($_POST['cs_groupe_id'] ?? 0);
        $jour = in_array($_POST['jour'] ?? '', $jours, true) ? $_POST['jour'] : null;
        $creneau = nettoyer($_POST['creneau'] ?? '');
        $mat = nettoyer($_POST['matiere'] ?? '');
        $pid = nettoyer_entier($_POST['professeur_id'] ?? 0);
        if ($gid && $jour && $creneau !== '') {
            $db->prepare('INSERT INTO cs_emploi (cs_groupe_id, jour, creneau, matiere, professeur_id) VALUES (:g,:j,:c,:m,:p)')
               ->execute([':g'=>$gid, ':j'=>$jour, ':c'=>$creneau, ':m'=>($mat ?: null), ':p'=>($pid ?: null)]);
            $message = 'Créneau ajouté.'; $type_message = 'success';
        } else { $message = 'Jour et créneau requis.'; $type_message = 'error'; }
    }
    elseif ($action === 'payer_cs') {
        $insc_id = nettoyer_entier($_POST['inscription_id'] ?? 0);
        $mois = nettoyer_entier($_POST['mois'] ?? 0);
        $annee = nettoyer_entier($_POST['annee'] ?? 0) ?? (int)date('Y');
        if ($insc_id && $mois >= 1 && $mois <= 12) {
            $res = lire_lignes_paiement(true, 0);
            if (!$res['ok']) { $message = $res['message']; $type_message = 'error'; }
            else {
                $recu = 'CS-' . date('Ymd') . '-' . $insc_id . '-' . $mois . $annee . '-' . random_int(1000,9999);
                try {
                    $db->beginTransaction();
                    $db->prepare('INSERT INTO cs_paiements (inscription_id, mois, annee, montant, recu_numero) VALUES (:i,:m,:a,:mt,:r)')
                       ->execute([':i'=>$insc_id, ':m'=>$mois, ':a'=>$annee, ':mt'=>$res['total'], ':r'=>$recu]);
                    $pid = (int) $db->lastInsertId();
                    enregistrer_lignes_paiement('cours_soir', $pid, $res['lignes'], 'entrant');
                    $db->commit();
                    $message = "Paiement cours du soir enregistré. Reçu : {$recu}"; $type_message = 'success';
                } catch (Throwable $e) {
                    if ($db->inTransaction()) $db->rollBack();
                    $message = 'Ce mois est déjà payé pour cet inscrit.'; $type_message = 'error';
                }
            }
        }
    }
}

// Vue : détail d'un groupe ?
$gid = nettoyer_entier($_GET['groupe_id'] ?? 0) ?? 0;
$groupe = null; $inscrits = []; $cs_profs = []; $emploi = [];
if ($gid) {
    $st = $db->prepare('SELECT * FROM cs_groupes WHERE id = :id'); $st->execute([':id'=>$gid]);
    $groupe = $st->fetch();
    if ($groupe) {
        $st = $db->prepare('
            SELECT i.id, i.etudiant_id, i.externe_nom, i.externe_tel,
                   CONCAT(e.prenom," ",e.nom) AS etu_nom, e.identifiant
            FROM cs_inscriptions i LEFT JOIN etudiants e ON i.etudiant_id = e.id
            WHERE i.cs_groupe_id = :g ORDER BY i.id');
        $st->execute([':g'=>$gid]);
        $inscrits = $st->fetchAll();
        $annee_courante = (int)date('Y');
        foreach ($inscrits as &$ins) {
            $st = $db->prepare('SELECT mois FROM cs_paiements WHERE inscription_id = :i AND annee = :a');
            $st->execute([':i'=>$ins['id'], ':a'=>$annee_courante]);
            $ins['mois_payes'] = array_map('intval', array_column($st->fetchAll(), 'mois'));
        }
        unset($ins);
        $st = $db->prepare('
            SELECT ce.*, CONCAT(p.prenom," ",p.nom) AS prof_nom
            FROM cs_enseignements ce JOIN professeurs p ON ce.professeur_id = p.id
            WHERE ce.cs_groupe_id = :g ORDER BY p.nom');
        $st->execute([':g'=>$gid]);
        $cs_profs = $st->fetchAll();
        $st = $db->prepare('
            SELECT ce.*, CONCAT(p.prenom," ",p.nom) AS prof_nom
            FROM cs_emploi ce LEFT JOIN professeurs p ON ce.professeur_id = p.id
            WHERE ce.cs_groupe_id = :g ORDER BY FIELD(ce.jour,"Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"), ce.creneau');
        $st->execute([':g'=>$gid]);
        $emploi = $st->fetchAll();
    }
}

$groupes = $db->query('SELECT g.*, (SELECT COUNT(*) FROM cs_inscriptions i WHERE i.cs_groupe_id=g.id) AS nb_inscrits FROM cs_groupes g ORDER BY g.actif DESC, g.nom')->fetchAll();
$tous_profs = $db->query('SELECT id, CONCAT(prenom," ",nom) AS nom FROM professeurs ORDER BY nom')->fetchAll();

$titre_page = 'Gestion de cours du soir';
$sous_titre = $groupe ? 'Groupe : ' . $groupe['nom'] : 'Groupes, emplois du temps, professeurs et finance';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
<div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<?php if ($groupe): ?>
    <a href="cours_du_soir.php<?= $embed ?>" class="btn btn-secondary" style="margin-bottom:1rem;">← Tous les groupes</a>
    <div class="form-card" style="margin-bottom:1.5rem;">
        <h3 style="margin-top:0;">🌙 <?= e($groupe['nom']) ?></h3>
        <p class="text-muted"><?= e(number_format((float)$groupe['tarif_mensuel'],0,',',' ')) ?> MRU/mois
            <?= $groupe['description'] ? '· '.e($groupe['description']) : '' ?></p>
    </div>

    <!-- INSCRITS + FINANCE -->
    <div class="table-container" style="margin-bottom:1.5rem;">
        <div class="table-header"><h3>Inscrits & paiements (<?= (int)date('Y') ?>)</h3><span class="badge badge-primary"><?= count($inscrits) ?></span></div>
        <div class="overflow-x">
            <table>
                <thead><tr><th>Inscrit</th><th>Type</th><th>Mois payés</th><th>Payer</th></tr></thead>
                <tbody>
                    <?php if (!$inscrits): ?>
                        <tr><td colspan="4" class="text-center text-muted" style="padding:1.5rem;">Aucun inscrit.</td></tr>
                    <?php else: foreach ($inscrits as $ins):
                        $nom = $ins['etudiant_id'] ? $ins['etu_nom'].' ('.$ins['identifiant'].')' : $ins['externe_nom'];
                        $estEcole = (bool)$ins['etudiant_id']; ?>
                        <tr>
                            <td><strong><?= e($nom) ?></strong></td>
                            <td><?= $estEcole ? '<span class="badge badge-success">École</span>' : '<span class="badge badge-primary">Externe</span>' ?></td>
                            <td>
                                <?php foreach ($mois_noms as $mn=>$ml):
                                    $p = in_array($mn, $ins['mois_payes'], true); ?>
                                    <span title="<?= e($ml) ?>" style="display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;border-radius:4px;font-size:.65rem;margin:1px;background:<?= $p?'#10B981':'#e5e7eb' ?>;color:<?= $p?'#fff':'#666' ?>;"><?= $mn ?></span>
                                <?php endforeach; ?>
                            </td>
                            <td>
                                <button type="button" class="btn btn-sm btn-primary" onclick="ouvrirCSPay(<?= (int)$ins['id'] ?>,'<?= e(addslashes($nom)) ?>',<?= (float)$groupe['tarif_mensuel'] ?>)">💳 Payer</button>
                            </td>
                        </tr>
                    <?php endforeach; endif; ?>
                </tbody>
            </table>
        </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem;">
        <!-- Inscrire école -->
        <div class="form-card">
            <h4 style="margin-top:0;">Inscrire un étudiant de l'école</h4>
            <form method="POST">
                <?= csrf_field() ?>
                <input type="hidden" name="action" value="inscrire_existant">
                <input type="hidden" name="cs_groupe_id" value="<?= (int)$gid ?>">
                <div class="form-group">
                    <label>Rechercher l'étudiant</label>
                    <input type="text" id="cs_etu_search" placeholder="Tapez un nom…" oninput="filtrerEtu()">
                    <select name="etudiant_id" id="cs_etu_select" required size="5" style="margin-top:.4rem;">
                    </select>
                </div>
                <button class="btn btn-primary">Inscrire</button>
            </form>
        </div>
        <!-- Inscrire externe -->
        <div class="form-card">
            <h4 style="margin-top:0;">Inscrire un élève externe</h4>
            <form method="POST">
                <?= csrf_field() ?>
                <input type="hidden" name="action" value="inscrire_externe">
                <input type="hidden" name="cs_groupe_id" value="<?= (int)$gid ?>">
                <div class="form-group"><label>Nom complet *</label><input type="text" name="externe_nom" required></div>
                <div class="form-group"><label>Téléphone</label><input type="text" name="externe_tel"></div>
                <div class="form-group"><label>Sexe</label>
                    <select name="externe_sexe"><option value="">—</option><option value="M">Masculin</option><option value="F">Féminin</option></select>
                </div>
                <button class="btn btn-primary">Inscrire</button>
            </form>
        </div>
    </div>

    <!-- PROFS -->
    <div class="table-container" style="margin-bottom:1.5rem;">
        <div class="table-header"><h3>Professeurs assignés</h3></div>
        <div class="overflow-x">
            <table>
                <thead><tr><th>Professeur</th><th>Matière</th><th>Taux horaire</th><th>Heures/mois</th><th>Gain mensuel</th></tr></thead>
                <tbody>
                    <?php if (!$cs_profs): ?>
                        <tr><td colspan="5" class="text-center text-muted">Aucun professeur assigné.</td></tr>
                    <?php else: foreach ($cs_profs as $cp):
                        $gain = (float)$cp['prix_par_heure'] * (int)$cp['heures_par_mois']; ?>
                        <tr>
                            <td><strong><?= e($cp['prof_nom']) ?></strong></td>
                            <td><?= e($cp['matiere'] ?: '—') ?></td>
                            <td><?= e(number_format((float)$cp['prix_par_heure'],0,',',' ')) ?> MRU</td>
                            <td><?= (int)$cp['heures_par_mois'] ?> h</td>
                            <td><strong><?= e(number_format($gain,0,',',' ')) ?> MRU</strong></td>
                        </tr>
                    <?php endforeach; endif; ?>
                </tbody>
            </table>
        </div>
        <div style="padding:1rem;border-top:1px solid var(--border);">
            <p class="text-muted" style="font-size:.82rem;margin-top:0;">Les gains des professeurs du cours du soir se règlent dans <strong>Finance → Paiement du personnel</strong> (catégorie Professeurs, motif « Cours du soir »).</p>
            <form method="POST" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end;">
                <?= csrf_field() ?>
                <input type="hidden" name="action" value="assigner_prof">
                <input type="hidden" name="cs_groupe_id" value="<?= (int)$gid ?>">
                <div><label>Professeur</label>
                    <select name="professeur_id" required>
                        <option value="">—</option>
                        <?php foreach ($tous_profs as $tp): ?><option value="<?= (int)$tp['id'] ?>"><?= e($tp['nom']) ?></option><?php endforeach; ?>
                    </select>
                </div>
                <div><label>Matière</label><input type="text" name="matiere" placeholder="Maths…"></div>
                <div><label>Taux/heure</label><input type="number" name="prix_par_heure" min="0" step="0.01" style="width:110px;"></div>
                <div><label>Heures/mois</label><input type="number" name="heures_par_mois" min="0" style="width:100px;"></div>
                <button class="btn btn-primary">Assigner</button>
            </form>
        </div>
    </div>

    <!-- EMPLOI DU TEMPS -->
    <div class="table-container">
        <div class="table-header"><h3>Emploi du temps</h3></div>
        <div class="overflow-x">
            <table>
                <thead><tr><th>Jour</th><th>Créneau</th><th>Matière</th><th>Professeur</th></tr></thead>
                <tbody>
                    <?php if (!$emploi): ?>
                        <tr><td colspan="4" class="text-center text-muted">Aucun créneau.</td></tr>
                    <?php else: foreach ($emploi as $cr): ?>
                        <tr>
                            <td><strong><?= e($cr['jour']) ?></strong></td>
                            <td><?= e($cr['creneau']) ?></td>
                            <td><?= e($cr['matiere'] ?: '—') ?></td>
                            <td><?= e($cr['prof_nom'] ?: '—') ?></td>
                        </tr>
                    <?php endforeach; endif; ?>
                </tbody>
            </table>
        </div>
        <div style="padding:1rem;border-top:1px solid var(--border);">
            <form method="POST" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end;">
                <?= csrf_field() ?>
                <input type="hidden" name="action" value="ajouter_creneau">
                <input type="hidden" name="cs_groupe_id" value="<?= (int)$gid ?>">
                <div><label>Jour</label>
                    <select name="jour" required><?php foreach ($jours as $j): ?><option value="<?= e($j) ?>"><?= e($j) ?></option><?php endforeach; ?></select>
                </div>
                <div><label>Créneau</label><input type="text" name="creneau" placeholder="18h-20h" required></div>
                <div><label>Matière</label><input type="text" name="matiere"></div>
                <div><label>Professeur</label>
                    <select name="professeur_id"><option value="">—</option><?php foreach ($tous_profs as $tp): ?><option value="<?= (int)$tp['id'] ?>"><?= e($tp['nom']) ?></option><?php endforeach; ?></select>
                </div>
                <button class="btn btn-primary">Ajouter</button>
            </form>
        </div>
    </div>

    <!-- Modale paiement CS -->
    <div id="modal_cspay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;align-items:center;justify-content:center;padding:1rem;">
        <div class="form-card" style="max-width:460px;width:100%;background:#fff;">
            <h3 style="margin-top:0;">Paiement cours du soir</h3>
            <p id="cspay_info" class="text-muted"></p>
            <form method="POST">
                <?= csrf_field() ?>
                <input type="hidden" name="action" value="payer_cs">
                <input type="hidden" name="inscription_id" id="cspay_insc">
                <input type="hidden" name="annee" value="<?= (int)date('Y') ?>">
                <div style="margin-bottom:.5rem;"><label>Mois</label>
                    <select name="mois" required><?php for($m=1;$m<=12;$m++): ?><option value="<?= $m ?>" <?= $m==(int)date('n')?'selected':'' ?>><?= e($mois_noms[$m]) ?></option><?php endfor; ?></select>
                </div>
                <?= widget_moyens_paiement('entrant', 0, 'cspay') ?>
                <div style="display:flex;gap:.5rem;margin-top:1rem;">
                    <button class="btn btn-primary">✓ Valider</button>
                    <button type="button" class="btn btn-secondary" onclick="document.getElementById('modal_cspay').style.display='none'">Annuler</button>
                </div>
            </form>
        </div>
    </div>

    <script>
    var CS_ETUDIANTS = <?= json_encode($db->query('SELECT id, CONCAT(prenom," ",nom," (",identifiant,")") AS label FROM etudiants ORDER BY nom')->fetchAll()) ?>;
    function filtrerEtu() {
        var q = document.getElementById('cs_etu_search').value.toLowerCase();
        var sel = document.getElementById('cs_etu_select'); sel.innerHTML='';
        CS_ETUDIANTS.filter(e=>e.label.toLowerCase().includes(q)).slice(0,50).forEach(function(e){
            var o=document.createElement('option'); o.value=e.id; o.textContent=e.label; sel.appendChild(o);
        });
    }
    function ouvrirCSPay(insc, nom, tarif) {
        document.getElementById('cspay_insc').value = insc;
        document.getElementById('cspay_info').textContent = nom + ' — ' + tarif.toLocaleString('fr-FR') + ' MRU/mois';
        var w = document.querySelector('#modal_cspay .mp-widget');
        if (w) { w.dataset.cible = tarif; var l = document.getElementById('cspay_lignes'); l.innerHTML=''; mpAjouter('cspay', undefined, tarif); }
        document.getElementById('modal_cspay').style.display='flex';
    }
    document.addEventListener('DOMContentLoaded', filtrerEtu);
    </script>
    <?= widget_moyens_paiement_js() ?>

<?php else: ?>
    <div class="form-card" style="margin-bottom:1.5rem;">
        <h3 style="margin-top:0;">➕ Nouveau groupe de cours du soir</h3>
        <form method="POST">
            <?= csrf_field() ?>
            <input type="hidden" name="action" value="creer_groupe">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                <div class="form-group"><label>Nom du groupe *</label><input type="text" name="nom_groupe_cs" required placeholder="ex: Renforcement Maths 3ème, دعم الرياضيات…"></div>
                <div class="form-group"><label>Tarif mensuel (MRU) *</label><input type="number" name="tarif_mensuel" min="0" step="0.01" required></div>
            </div>
            <div class="form-group"><label>Description</label><input type="text" name="description"></div>
            <button class="btn btn-primary">Créer le groupe</button>
        </form>
    </div>

    <div class="table-container">
        <div class="table-header"><h3>Groupes de cours du soir</h3><span class="badge badge-primary"><?= count($groupes) ?></span></div>
        <div class="overflow-x">
            <table>
                <thead><tr><th>Groupe</th><th>Tarif/mois</th><th>Inscrits</th><th></th></tr></thead>
                <tbody>
                    <?php if (!$groupes): ?>
                        <tr><td colspan="4" class="text-center text-muted" style="padding:2rem;">Aucun groupe. Créez-en un ci-dessus.</td></tr>
                    <?php else: foreach ($groupes as $g): ?>
                        <tr>
                            <td><strong><?= e($g['nom']) ?></strong><?= $g['description'] ? '<br><small class="text-muted">'.e($g['description']).'</small>' : '' ?></td>
                            <td><?= e(number_format((float)$g['tarif_mensuel'],0,',',' ')) ?> MRU</td>
                            <td><?= (int)$g['nb_inscrits'] ?></td>
                            <td><a href="cours_du_soir.php?groupe_id=<?= (int)$g['id'] ?><?= $embed_amp ?>" class="btn btn-sm btn-primary">Gérer →</a></td>
                        </tr>
                    <?php endforeach; endif; ?>
                </tbody>
            </table>
        </div>
    </div>
<?php endif; ?>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
