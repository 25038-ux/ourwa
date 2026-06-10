<?php
/**
 * Inscrire un étudiant + rattachement à un correspondant (parent).
 *
 *  - Recherche d'un parent existant (nom / téléphone) OU création d'un compte parent.
 *  - L'admin choisit le mot de passe initial du parent (changé ensuite par le parent).
 *  - Après inscription : possibilité de confirmer le 1er paiement et d'imprimer le reçu.
 *
 *  Toute donnée saisie est validée et insérée via requêtes préparées.
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_staff_admin();
require_once __DIR__ . '/../../includes/parent_auth.php';

$db = getDB();
$message = '';
$type_message = '';
$etudiant_cree = null;

$mois_noms = [1=>'Janvier',2=>'Février',3=>'Mars',4=>'Avril',5=>'Mai',6=>'Juin',
              7=>'Juillet',8=>'Août',9=>'Septembre',10=>'Octobre',11=>'Novembre',12=>'Décembre'];

// Niveaux + groupes pour le formulaire
$niveaux = $db->query('SELECT id, nom, tarif_mensuel FROM niveaux ORDER BY id')->fetchAll();
$groupes = $db->query('
    SELECT g.id, g.nom, g.niveau_id, g.capacite,
           (SELECT COUNT(*) FROM etudiants e WHERE e.groupe_id = g.id) AS effectif
    FROM groupes g ORDER BY g.nom')->fetchAll();

// Recherche AJAX-like de parent (rendu serveur simple via GET)
$recherche_parent = trim((string) ($_GET['rp'] ?? ''));
$parents_trouves = [];
if ($recherche_parent !== '') {
    $stmt = $db->prepare('
        SELECT id, nom_complet, telephone
        FROM parents
        WHERE nom_complet LIKE :q
           OR REPLACE(REPLACE(REPLACE(telephone," ",""),"-",""),"+","") LIKE :qt
        ORDER BY nom_complet LIMIT 20');
    $stmt->execute([
        ':q'  => '%' . $recherche_parent . '%',
        ':qt' => '%' . preg_replace('/[^\d]/', '', $recherche_parent) . '%',
    ]);
    $parents_trouves = $stmt->fetchAll();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'inscrire') {
    exiger_csrf();

    $nom        = nettoyer($_POST['nom'] ?? '');
    $prenom     = nettoyer($_POST['prenom'] ?? '');
    $sexe       = ($_POST['sexe'] ?? '') === 'M' ? 'M' : (($_POST['sexe'] ?? '') === 'F' ? 'F' : null);
    $rim        = nettoyer($_POST['rim'] ?? '');
    $nni        = nettoyer($_POST['nni'] ?? '');
    $date_naissance = nettoyer($_POST['date_naissance'] ?? '');
    $lieu_naissance = nettoyer($_POST['lieu_naissance'] ?? '');
    $groupe_id  = nettoyer_entier($_POST['groupe_id'] ?? 0);
    $frais      = nettoyer_decimal($_POST['frais_mensuel'] ?? 0) ?? 0;

    $mode_parent = $_POST['mode_parent'] ?? 'existant';
    $parent_id   = nettoyer_entier($_POST['parent_id'] ?? 0);

    // Validation étudiant
    $erreurs = [];
    if (mb_strlen($nom) < 2)     $erreurs[] = 'Nom invalide.';
    if (mb_strlen($prenom) < 2)  $erreurs[] = 'Prénom invalide.';
    if ($rim === '')             $erreurs[] = 'Le RIM est obligatoire.';
    if ($nni === '')             $erreurs[] = 'Le NNI est obligatoire.';
    if (!$groupe_id)             $erreurs[] = 'Veuillez choisir un groupe.';

    // Unicité RIM / NNI
    if ($rim !== '' && $nni !== '') {
        $st = $db->prepare('SELECT COUNT(*) FROM etudiants WHERE rim = :r OR nni = :n');
        $st->execute([':r' => $rim, ':n' => $nni]);
        if ((int) $st->fetchColumn() > 0) {
            $erreurs[] = 'Un étudiant avec ce RIM ou ce NNI existe déjà.';
        }
        // Vérifier qu'il n'est pas EXPULSÉ
        $st = $db->prepare('SELECT id FROM expulsions WHERE nni = :n AND rim = :r LIMIT 1');
        $st->execute([':n' => $nni, ':r' => $rim]);
        if ($st->fetchColumn()) {
            $erreurs[] = 'Inscription refusée : ce NNI et RIM appartiennent à un étudiant expulsé. Voir « Liste des expelled » pour débloquer.';
        }
    }

    // Résolution / création du parent
    $parent_final_id = 0;
    $parent_mdp_clair = '';
    if (empty($erreurs)) {
        if ($mode_parent === 'nouveau') {
            $p_nom = nettoyer($_POST['p_nom'] ?? '');
            $p_tel = nettoyer($_POST['p_tel'] ?? '');
            $p_mdp = (string) ($_POST['p_mdp'] ?? '');
            $p_email = nettoyer($_POST['p_email'] ?? '');
            $res = creer_compte_parent($p_nom, $p_tel, $p_mdp, $p_email ?: null);
            if (!$res['succes']) {
                $erreurs[] = $res['message'];
            } else {
                $parent_final_id = $res['parent_id'];
                $parent_mdp_clair = $p_mdp;
            }
        } else {
            if (!$parent_id) {
                $erreurs[] = 'Veuillez sélectionner un correspondant existant.';
            } else {
                $st = $db->prepare('SELECT id FROM parents WHERE id = :id');
                $st->execute([':id' => $parent_id]);
                if (!$st->fetchColumn()) {
                    $erreurs[] = 'Correspondant introuvable.';
                } else {
                    $parent_final_id = $parent_id;
                }
            }
        }
    }

    if (empty($erreurs)) {
        // Infos parent (pour les colonnes dénormalisées de etudiants)
        $st = $db->prepare('SELECT nom_complet, telephone FROM parents WHERE id = :id');
        $st->execute([':id' => $parent_final_id]);
        $pinfo = $st->fetch();

        // Matricule auto
        $matricule = 'ET' . date('y') . str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT);

        try {
            $db->prepare('
                INSERT INTO etudiants
                    (rim, nni, identifiant, nom, prenom, sexe, date_naissance, lieu_naissance,
                     parent_id, nom_parent, telephone_parent, frais_mensuel, groupe_id)
                VALUES
                    (:rim,:nni,:idf,:nom,:pre,:sexe,:dn,:ln,:pid,:pnom,:ptel,:frais,:gid)')
               ->execute([
                   ':rim'=>$rim, ':nni'=>$nni, ':idf'=>$matricule,
                   ':nom'=>$nom, ':pre'=>$prenom, ':sexe'=>$sexe,
                   ':dn'=>($date_naissance ?: null), ':ln'=>($lieu_naissance ?: null),
                   ':pid'=>$parent_final_id,
                   ':pnom'=>$pinfo['nom_complet'], ':ptel'=>$pinfo['telephone'],
                   ':frais'=>$frais, ':gid'=>$groupe_id,
               ]);
            $eid = (int) $db->lastInsertId();

            notifier_parent($parent_final_id, 'info', 'Nouvelle inscription',
                "{$prenom} {$nom} a été inscrit(e) avec succès. Matricule : {$matricule}", $eid);

            $st = $db->prepare('
                SELECT e.*, g.nom AS groupe_nom, IFNULL(n.nom,"—") AS niveau_nom
                FROM etudiants e JOIN groupes g ON e.groupe_id=g.id
                LEFT JOIN niveaux n ON g.niveau_id=n.id WHERE e.id=:id');
            $st->execute([':id' => $eid]);
            $etudiant_cree = $st->fetch();
            $etudiant_cree['parent_mdp_clair'] = $parent_mdp_clair;

            $message = "Étudiant inscrit avec succès ! Matricule : {$matricule}";
            $type_message = 'success';
        } catch (Throwable $e) {
            $message = 'Erreur lors de l\'inscription : ' . $e->getMessage();
            $type_message = 'error';
        }
    } else {
        $message = implode(' ', $erreurs);
        $type_message = 'error';
    }
}

// Confirmation de paiement depuis l'écran post-inscription
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

$titre_page = 'Inscrire un étudiant';
$sous_titre = 'Nouvel étudiant + rattachement à un correspondant';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
<div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<?php if ($etudiant_cree): ?>
    <!-- Écran post-inscription : reçu / paiement -->
    <div class="form-card" style="margin-bottom:1.5rem;">
        <h3 style="margin-top:0;color:#10B981;">✓ Inscription réussie</h3>
        <p><strong><?= e($etudiant_cree['prenom'].' '.$etudiant_cree['nom']) ?></strong>
           — <?= e($etudiant_cree['niveau_nom']) ?> / <?= e($etudiant_cree['groupe_nom']) ?>
           · Matricule : <strong><?= e($etudiant_cree['identifiant']) ?></strong></p>
        <?php if (!empty($etudiant_cree['parent_mdp_clair'])): ?>
        <div class="alert alert-info" style="margin-top:1rem;">
            🔑 Compte parent créé. Identifiant (téléphone) : <strong><?= e($etudiant_cree['telephone_parent']) ?></strong> —
            Mot de passe initial : <strong><?= e($etudiant_cree['parent_mdp_clair']) ?></strong>.
            Communiquez-le au parent ; il devra le changer à la première connexion.
        </div>
        <?php endif; ?>

        <h4>Confirmer le premier paiement</h4>
        <form method="POST">
            <?= csrf_field() ?>
            <input type="hidden" name="action" value="payer">
            <input type="hidden" name="etudiant_id" value="<?= e($etudiant_cree['id']) ?>">
            <div style="max-width:280px;margin-bottom:.5rem;">
                <label>Mois</label>
                <select name="mois" required>
                    <?php for ($m=1;$m<=12;$m++): ?>
                        <option value="<?= $m ?>" <?= $m==(int)date('n')?'selected':'' ?>><?= e($mois_noms[$m]) ?></option>
                    <?php endfor; ?>
                </select>
            </div>
            <?= widget_moyens_paiement('entrant', (float)$etudiant_cree['frais_mensuel'], 'inscpay') ?>
            <div style="margin-top:1rem;display:flex;gap:.5rem;flex-wrap:wrap;">
                <button class="btn btn-primary">💳 Confirmer & imprimer le reçu</button>
                <a href="inscrire_etudiant.php" class="btn btn-secondary">Inscrire un autre</a>
            </div>
        </form>
    </div>
    <?= widget_moyens_paiement_js() ?>

<?php else: ?>
    <form method="POST" class="form-card">
        <?= csrf_field() ?>
        <input type="hidden" name="action" value="inscrire">

        <h3 style="margin-top:0;">🎓 Informations de l'étudiant</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
            <div class="form-group"><label>Prénom *</label><input type="text" name="prenom" required></div>
            <div class="form-group"><label>Nom *</label><input type="text" name="nom" required></div>
            <div class="form-group"><label>RIM * (unique)</label><input type="text" name="rim" required></div>
            <div class="form-group"><label>NNI * (unique)</label><input type="text" name="nni" required></div>
            <div class="form-group">
                <label>Sexe</label>
                <select name="sexe">
                    <option value="">— Choisir —</option>
                    <option value="M">Masculin</option>
                    <option value="F">Féminin</option>
                </select>
            </div>
            <div class="form-group"><label>Date de naissance</label><input type="date" name="date_naissance"></div>
            <div class="form-group"><label>Lieu de naissance</label><input type="text" name="lieu_naissance"></div>
            <div class="form-group">
                <label>Groupe *</label>
                <select name="groupe_id" id="groupe_id" required onchange="majFrais()">
                    <option value="">— Choisir —</option>
                    <?php foreach ($groupes as $g):
                        $niv = null;
                        foreach ($niveaux as $n) { if ($n['id']==$g['niveau_id']) { $niv=$n; break; } }
                    ?>
                        <option value="<?= e($g['id']) ?>" data-tarif="<?= e($niv['tarif_mensuel'] ?? 0) ?>">
                            <?= e(($niv['nom'] ?? 'Sans niveau').' — '.$g['nom']) ?>
                            (<?= e($g['effectif']) ?>/<?= e($g['capacite']) ?>)
                        </option>
                    <?php endforeach; ?>
                </select>
            </div>
            <div class="form-group"><label>Frais mensuel (MRU)</label><input type="number" step="0.01" name="frais_mensuel" id="frais_mensuel" value="0"></div>
        </div>

        <hr style="margin:1.5rem 0;border:none;border-top:1px solid #eee;">
        <h3>👨‍👩‍👧 Correspondant (parent)</h3>
        <div style="display:flex;gap:1rem;margin-bottom:1rem;">
            <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;">
                <input type="radio" name="mode_parent" value="existant" checked onchange="toggleParent()"> Parent existant
            </label>
            <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;">
                <input type="radio" name="mode_parent" value="nouveau" onchange="toggleParent()"> Nouveau parent
            </label>
        </div>

        <div id="bloc-existant">
            <div class="form-group">
                <label>Rechercher un correspondant</label>
                <div style="display:flex;gap:.5rem;">
                    <input type="text" id="rp_input" placeholder="Nom ou téléphone"
                           value="<?= e($recherche_parent) ?>" style="flex:1;">
                    <button type="button" class="btn btn-secondary" onclick="rechercherParent()">Chercher</button>
                </div>
            </div>
            <div class="form-group">
                <label>Correspondant *</label>
                <select name="parent_id" id="parent_select">
                    <option value="">— Sélectionner —</option>
                    <?php foreach ($parents_trouves as $p): ?>
                        <option value="<?= e($p['id']) ?>"><?= e($p['nom_complet'].' — '.$p['telephone']) ?></option>
                    <?php endforeach; ?>
                </select>
                <?php if ($recherche_parent !== '' && !$parents_trouves): ?>
                    <small style="color:#EF4444;">Aucun parent trouvé. Créez un nouveau parent.</small>
                <?php endif; ?>
            </div>
        </div>

        <div id="bloc-nouveau" style="display:none;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                <div class="form-group"><label>Nom complet du parent *</label><input type="text" name="p_nom"></div>
                <div class="form-group"><label>Téléphone * (identifiant de connexion)</label><input type="text" name="p_tel"></div>
                <div class="form-group"><label>Email (optionnel)</label><input type="email" name="p_email"></div>
                <div class="form-group"><label>Mot de passe initial *</label><input type="text" name="p_mdp" placeholder="≥ 8 car., 3 types"></div>
            </div>
            <small style="color:var(--text-muted);">Le parent pourra changer ce mot de passe lui-même après connexion.</small>
        </div>

        <div style="margin-top:1.5rem;">
            <button class="btn btn-primary">✓ Inscrire l'étudiant</button>
        </div>
    </form>

    <script>
    function toggleParent() {
        const mode = document.querySelector('input[name="mode_parent"]:checked').value;
        document.getElementById('bloc-existant').style.display = (mode === 'existant') ? 'block' : 'none';
        document.getElementById('bloc-nouveau').style.display  = (mode === 'nouveau')  ? 'block' : 'none';
    }
    function rechercherParent() {
        const q = document.getElementById('rp_input').value;
        const u = new URL(window.location.href);
        u.searchParams.set('rp', q);
        window.location.href = u.toString();
    }
    function majFrais() {
        const opt = document.getElementById('groupe_id').selectedOptions[0];
        if (opt && opt.dataset.tarif) document.getElementById('frais_mensuel').value = opt.dataset.tarif;
    }
    document.getElementById('rp_input')?.addEventListener('keydown', e => { if (e.key==='Enter'){ e.preventDefault(); rechercherParent(); }});
    </script>
<?php endif; ?>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
