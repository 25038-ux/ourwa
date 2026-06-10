<?php
/**
 * Gestion de Caisse — vue par CORRESPONDANT (parent).
 *
 * Parcours :
 *   1. Gestion des moyens de paiement (sous l'en-tête)
 *   2. Liste des parents (recherche par nom OU téléphone)
 *   3. Clic sur un parent -> ses enfants + profil de paiement de chacun
 *   4. Confirmer un paiement (ventilé sur 1..N moyens) / imprimer un reçu
 *   5. Exempter un enfant (totale / mensuelle)
 *   6. Notifier les impayés du mois
 *
 * Accès strictement réservé aux comptes à pouvoir financier complet.
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_once __DIR__ . '/../../includes/parent_auth.php';
require_finance_page();

$db = getDB();
$message = '';
$type_message = '';

$mois_noms = [1=>'Janvier',2=>'Février',3=>'Mars',4=>'Avril',5=>'Mai',6=>'Juin',
              7=>'Juillet',8=>'Août',9=>'Septembre',10=>'Octobre',11=>'Novembre',12=>'Décembre'];

// ============================================================================
//  ACTIONS POST
// ============================================================================
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    exiger_csrf();
    $action = $_POST['action'] ?? '';

    // ---- Moyens de paiement : ajout / activation ----
    if ($action === 'ajouter_moyen') {
        $nom = nettoyer($_POST['moyen_nom'] ?? '');
        if (mb_strlen($nom) >= 2) {
            try {
                $db->prepare('INSERT INTO moyens_paiement (nom) VALUES (:n)')->execute([':n' => $nom]);
                $message = "Moyen de paiement « {$nom} » ajouté.";
                $type_message = 'success';
            } catch (Throwable $e) {
                $message = 'Ce moyen de paiement existe déjà.';
                $type_message = 'error';
            }
        } else {
            $message = 'Nom de moyen de paiement invalide.';
            $type_message = 'error';
        }
    }
    elseif ($action === 'basculer_moyen') {
        $mid = nettoyer_entier($_POST['moyen_id'] ?? 0);
        if ($mid) {
            $db->prepare('UPDATE moyens_paiement SET actif = NOT actif WHERE id = :id')->execute([':id' => $mid]);
            $message = 'Moyen de paiement mis à jour.';
            $type_message = 'success';
        }
    }

    // ---- Confirmer un paiement (multi-moyens) ----
    elseif ($action === 'confirmer_paiement') {
        $etudiant_id = nettoyer_entier($_POST['etudiant_id'] ?? 0);
        $mois  = nettoyer_entier($_POST['mois'] ?? 0);
        $annee = nettoyer_entier($_POST['annee'] ?? 0);

        if ($etudiant_id && $mois >= 1 && $mois <= 12 && $annee >= 2020 && $annee <= 2100) {
            if (mois_exempte($etudiant_id, $mois, $annee)) {
                $message = 'Ce mois est exempté pour cet étudiant : aucun paiement requis.';
                $type_message = 'error';
            } else {
                // Montant attendu = frais de l'étudiant
                $st = $db->prepare('SELECT frais_mensuel, prenom, nom FROM etudiants WHERE id = :e');
                $st->execute([':e' => $etudiant_id]);
                $et = $st->fetch();
                $montant_attendu = (float) ($et['frais_mensuel'] ?? 0);

                $res = lire_lignes_paiement(true, $montant_attendu);
                if (!$res['ok']) {
                    $message = $res['message'];
                    $type_message = 'error';
                } else {
                    $recu = 'REC-' . date('Ymd') . '-' . $etudiant_id . '-' . $mois . $annee . '-' . random_int(1000, 9999);
                    try {
                        $db->beginTransaction();
                        $db->prepare('INSERT INTO paiements (etudiant_id, mois, annee, montant, recu_numero) VALUES (:e,:m,:a,:mt,:r)')
                           ->execute([':e'=>$etudiant_id, ':m'=>$mois, ':a'=>$annee, ':mt'=>$res['total'], ':r'=>$recu]);
                        $pid = (int) $db->lastInsertId();
                        enregistrer_lignes_paiement('paiement', $pid, $res['lignes'], 'entrant');
                        $db->commit();

                        if ($et) {
                            notifier_parent_de_etudiant(
                                $etudiant_id, 'info', 'Paiement enregistré',
                                "Le paiement de {$et['prenom']} {$et['nom']} pour {$mois_noms[$mois]} {$annee} a été enregistré. Reçu : {$recu}"
                            );
                        }
                        $message = "Paiement confirmé ! Reçu : {$recu}";
                        $type_message = 'success';
                    } catch (Throwable $e) {
                        if ($db->inTransaction()) $db->rollBack();
                        $message = 'Ce mois est déjà payé pour cet étudiant.';
                        $type_message = 'error';
                    }
                }
            }
        } else {
            $message = 'Données de paiement invalides.';
            $type_message = 'error';
        }
    }
    elseif ($action === 'annuler_paiement') {
        $paiement_id = nettoyer_entier($_POST['paiement_id'] ?? 0);
        if ($paiement_id) {
            try {
                $db->beginTransaction();
                $db->prepare("DELETE FROM paiement_lignes WHERE source_type='paiement' AND source_id=:id")->execute([':id'=>$paiement_id]);
                $db->prepare('DELETE FROM paiements WHERE id = :id')->execute([':id' => $paiement_id]);
                $db->commit();
                $message = 'Paiement annulé.';
                $type_message = 'success';
            } catch (Throwable $e) {
                if ($db->inTransaction()) $db->rollBack();
                $message = 'Impossible d\'annuler ce paiement.';
                $type_message = 'error';
            }
        }
    }

    // ---- Exemptions ----
    elseif ($action === 'exemption_totale') {
        $etudiant_id = nettoyer_entier($_POST['etudiant_id'] ?? 0);
        $motif = nettoyer($_POST['motif'] ?? '');
        if ($etudiant_id) {
            try {
                $db->prepare("INSERT INTO exemptions (etudiant_id, type, motif, cree_par) VALUES (:e,'totale',:mo,:u)")
                   ->execute([':e'=>$etudiant_id, ':mo'=>($motif ?: null), ':u'=>($_SESSION['utilisateur_id'] ?? null)]);
                $message = 'Exemption totale appliquée.';
                $type_message = 'success';
            } catch (Throwable $e) {
                $message = 'Cet étudiant a déjà une exemption totale.';
                $type_message = 'error';
            }
        }
    }
    elseif ($action === 'exemption_mensuelle') {
        $etudiant_id = nettoyer_entier($_POST['etudiant_id'] ?? 0);
        $mois  = nettoyer_entier($_POST['mois'] ?? 0);
        $annee = nettoyer_entier($_POST['annee'] ?? 0) ?? (int) date('Y');
        $motif = nettoyer($_POST['motif'] ?? '');
        if ($etudiant_id && $mois >= 1 && $mois <= 12) {
            try {
                $db->prepare("INSERT INTO exemptions (etudiant_id, type, mois, annee, motif, cree_par) VALUES (:e,'mensuelle',:m,:a,:mo,:u)")
                   ->execute([':e'=>$etudiant_id, ':m'=>$mois, ':a'=>$annee, ':mo'=>($motif ?: null), ':u'=>($_SESSION['utilisateur_id'] ?? null)]);
                $message = "Exemption appliquée pour {$mois_noms[$mois]} {$annee}.";
                $type_message = 'success';
            } catch (Throwable $e) {
                $message = 'Ce mois est déjà exempté (ou déjà payé).';
                $type_message = 'error';
            }
        }
    }
    elseif ($action === 'retirer_exemption') {
        $exemption_id = nettoyer_entier($_POST['exemption_id'] ?? 0);
        if ($exemption_id) {
            $db->prepare('DELETE FROM exemptions WHERE id = :id')->execute([':id' => $exemption_id]);
            $message = 'Exemption retirée.';
            $type_message = 'success';
        }
    }

    // ---- Notifier les impayés du mois ----
    elseif ($action === 'notifier_impayes') {
        $mois  = nettoyer_entier($_POST['mois'] ?? 0) ?? (int) date('n');
        $annee = nettoyer_entier($_POST['annee'] ?? 0) ?? (int) date('Y');
        $envoyes = 0;
        if ($mois >= 1 && $mois <= 12) {
            // Étudiants non payés, non exemptés (totale ou mensuelle), avec parent.
            $sql = "
                SELECT e.id, e.prenom, e.nom, e.parent_id
                FROM etudiants e
                WHERE e.parent_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM paiements p WHERE p.etudiant_id=e.id AND p.mois=:m AND p.annee=:a)
                  AND NOT EXISTS (SELECT 1 FROM exemptions x WHERE x.etudiant_id=e.id AND x.type='totale')
                  AND NOT EXISTS (SELECT 1 FROM exemptions x WHERE x.etudiant_id=e.id AND x.type='mensuelle' AND x.mois=:m2 AND x.annee=:a2)";
            $stmt = $db->prepare($sql);
            $stmt->execute([':m'=>$mois, ':a'=>$annee, ':m2'=>$mois, ':a2'=>$annee]);
            foreach ($stmt->fetchAll() as $row) {
                if (function_exists('notifier_parent')) {
                    notifier_parent(
                        (int) $row['parent_id'], 'info', 'Rappel de paiement',
                        "Le paiement de {$row['prenom']} {$row['nom']} pour {$mois_noms[$mois]} {$annee} n'a pas encore été enregistré. Merci de régulariser.",
                        (int) $row['id']
                    );
                    $envoyes++;
                }
            }
            $message = "Notification envoyée à {$envoyes} correspondant(s) pour les impayés de {$mois_noms[$mois]} {$annee}.";
            $type_message = 'success';
        }
    }
}

// ============================================================================
//  IMPRESSION D'UN REÇU
// ============================================================================
$print_recu = nettoyer_entier($_GET['print_recu'] ?? 0) ?? 0;
$recu_data = null;
$recu_lignes = [];
if ($print_recu) {
    $stmt = $db->prepare('
        SELECT p.*, e.nom, e.prenom, e.identifiant, e.nom_parent, e.telephone_parent, e.parent_id,
               g.nom AS groupe_nom, IFNULL(n.nom, "—") AS niveau_nom
        FROM paiements p
        JOIN etudiants e ON p.etudiant_id = e.id
        JOIN groupes g ON e.groupe_id = g.id
        LEFT JOIN niveaux n ON g.niveau_id = n.id
        WHERE p.id = :id');
    $stmt->execute([':id' => $print_recu]);
    $recu_data = $stmt->fetch();
    if ($recu_data) {
        $recu_lignes = lignes_paiement_de('paiement', $print_recu);
    }
}

// ============================================================================
//  NAVIGATION : liste des parents OU détail d'un parent
// ============================================================================
$recherche  = trim((string) ($_GET['q'] ?? ''));
$parent_id  = nettoyer_entier($_GET['parent_id'] ?? 0) ?? 0;

$parents = [];
$parent_courant = null;
$enfants = [];
$annee_courante = (int) date('Y');

if ($parent_id) {
    $stmt = $db->prepare('SELECT * FROM parents WHERE id = :id');
    $stmt->execute([':id' => $parent_id]);
    $parent_courant = $stmt->fetch();

    if ($parent_courant) {
        $stmt = $db->prepare('
            SELECT e.*, g.nom AS groupe_nom, IFNULL(n.nom,"—") AS niveau_nom
            FROM etudiants e
            JOIN groupes g ON e.groupe_id = g.id
            LEFT JOIN niveaux n ON g.niveau_id = n.id
            WHERE e.parent_id = :p
            ORDER BY e.nom, e.prenom');
        $stmt->execute([':p' => $parent_id]);
        $enfants = $stmt->fetchAll();

        foreach ($enfants as &$enf) {
            $st = $db->prepare('SELECT id, mois, annee, montant, recu_numero FROM paiements WHERE etudiant_id = :e AND annee = :a ORDER BY mois');
            $st->execute([':e' => $enf['id'], ':a' => $annee_courante]);
            $enf['paiements'] = [];
            foreach ($st->fetchAll() as $pay) {
                $enf['paiements'][(int) $pay['mois']] = $pay;
            }
            $enf['exempt_totale'] = exemption_totale((int) $enf['id']);
            $enf['exempt_mois']   = exemptions_mensuelles((int) $enf['id'], $annee_courante);
            // ids des exemptions pour pouvoir les retirer
            $st = $db->prepare("SELECT id, type, mois FROM exemptions WHERE etudiant_id = :e AND (type='totale' OR (type='mensuelle' AND annee=:a))");
            $st->execute([':e' => $enf['id'], ':a' => $annee_courante]);
            $enf['exempt_ids'] = ['totale' => null, 'mois' => []];
            foreach ($st->fetchAll() as $x) {
                if ($x['type'] === 'totale') $enf['exempt_ids']['totale'] = (int) $x['id'];
                else $enf['exempt_ids']['mois'][(int) $x['mois']] = (int) $x['id'];
            }
        }
        unset($enf);
    }
} else {
    $filtre_mois  = nettoyer_entier($_GET['impaye_mois'] ?? 0) ?? 0;
    $filtre_annee = nettoyer_entier($_GET['impaye_annee'] ?? 0) ?? 0;
    $filtre_actif = ($filtre_mois >= 1 && $filtre_mois <= 12 && $filtre_annee >= 2020);

    if ($filtre_actif) {
        $sql = '
            SELECT p.id, p.nom_complet, p.telephone, p.actif,
                   COUNT(DISTINCT e.id) AS nb_enfants,
                   COALESCE(SUM(e.frais_mensuel),0) AS frais_total,
                   SUM(CASE WHEN pay.id IS NULL
                             AND NOT EXISTS (SELECT 1 FROM exemptions x WHERE x.etudiant_id=e.id AND x.type="totale")
                             AND NOT EXISTS (SELECT 1 FROM exemptions x WHERE x.etudiant_id=e.id AND x.type="mensuelle" AND x.mois=:m3 AND x.annee=:a3)
                        THEN 1 ELSE 0 END) AS nb_impayes
            FROM parents p
            JOIN etudiants e ON e.parent_id = p.id
            LEFT JOIN paiements pay
              ON pay.etudiant_id = e.id AND pay.mois = :m AND pay.annee = :a';
        $params = [':m' => $filtre_mois, ':a' => $filtre_annee, ':m3' => $filtre_mois, ':a3' => $filtre_annee];
        if ($recherche !== '') {
            $sql .= ' WHERE (p.nom_complet LIKE :q
                          OR REPLACE(REPLACE(REPLACE(p.telephone," ",""),"-",""),"+","") LIKE :qt)';
            $params[':q']  = '%' . $recherche . '%';
            $params[':qt'] = '%' . preg_replace('/[^\d]/', '', $recherche) . '%';
        }
        $sql .= ' GROUP BY p.id, p.nom_complet, p.telephone, p.actif
                  HAVING nb_impayes > 0
                  ORDER BY p.nom_complet';
    } else {
        $sql = '
            SELECT p.id, p.nom_complet, p.telephone, p.actif,
                   COUNT(e.id) AS nb_enfants,
                   COALESCE(SUM(e.frais_mensuel),0) AS frais_total,
                   0 AS nb_impayes
            FROM parents p
            LEFT JOIN etudiants e ON e.parent_id = p.id';
        $params = [];
        if ($recherche !== '') {
            $sql .= ' WHERE p.nom_complet LIKE :q
                       OR REPLACE(REPLACE(REPLACE(p.telephone," ",""),"-",""),"+","") LIKE :qt';
            $params[':q']  = '%' . $recherche . '%';
            $params[':qt'] = '%' . preg_replace('/[^\d]/', '', $recherche) . '%';
        }
        $sql .= ' GROUP BY p.id, p.nom_complet, p.telephone, p.actif ORDER BY p.nom_complet';
    }
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $parents = $stmt->fetchAll();
}

// Liste des moyens (pour le panneau de gestion)
$tous_moyens = $db->query('SELECT id, nom, actif FROM moyens_paiement ORDER BY nom')->fetchAll();

$titre_page = 'Gestion de Caisse';
$sous_titre = $parent_courant
    ? 'Profil de paiement — ' . $parent_courant['nom_complet']
    : 'Recherche et suivi des paiements par correspondant';
include __DIR__ . '/../../includes/layout_header.php';
?>

<?php if ($message): ?>
<div class="alert alert-<?= e($type_message) ?>"><?= e($message) ?></div>
<?php endif; ?>

<?php if ($print_recu && $recu_data): ?>
    <div class="no-print" style="margin-bottom:1rem;display:flex;gap:.5rem;">
        <button onclick="window.print()" class="btn btn-primary">🖨️ Imprimer le reçu</button>
        <a href="gestion_caisse.php?parent_id=<?= e((int)$recu_data['parent_id']) ?>" class="btn btn-secondary">← Retour</a>
    </div>
    <div id="recu" style="max-width:600px;margin:0 auto;padding:2rem;border:1px solid #ddd;background:#fff;">
        <div style="text-align:center;border-bottom:2px solid #6366F1;padding-bottom:1rem;margin-bottom:1rem;">
            <h2 style="margin:0;color:#6366F1;">El OURWA</h2>
            <p style="margin:.25rem 0;font-weight:600;">REÇU DE PAIEMENT</p>
            <p style="font-size:.8rem;color:#888;">N° <?= e($recu_data['recu_numero']) ?></p>
        </div>
        <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:.5rem;font-weight:600;width:45%;">Étudiant :</td><td style="padding:.5rem;"><?= e($recu_data['prenom'].' '.$recu_data['nom']) ?></td></tr>
            <tr style="background:#f8f8f8;"><td style="padding:.5rem;font-weight:600;">Matricule :</td><td style="padding:.5rem;"><?= e($recu_data['identifiant']) ?></td></tr>
            <tr><td style="padding:.5rem;font-weight:600;">Niveau / Groupe :</td><td style="padding:.5rem;"><?= e($recu_data['niveau_nom']) ?> — <?= e($recu_data['groupe_nom']) ?></td></tr>
            <tr style="background:#f8f8f8;"><td style="padding:.5rem;font-weight:600;">Correspondant :</td><td style="padding:.5rem;"><?= e($recu_data['nom_parent']) ?> (<?= e($recu_data['telephone_parent']) ?>)</td></tr>
            <tr><td style="padding:.5rem;font-weight:600;">Période :</td><td style="padding:.5rem;"><?= e($mois_noms[(int)$recu_data['mois']]) ?> <?= e($recu_data['annee']) ?></td></tr>
            <?php if ($recu_lignes): ?>
            <tr style="background:#f8f8f8;"><td style="padding:.5rem;font-weight:600;vertical-align:top;">Moyen(s) :</td><td style="padding:.5rem;">
                <?php foreach ($recu_lignes as $l): ?>
                    <?= e($l['moyen']) ?> : <?= e(number_format((float)$l['montant'],0,',',' ')) ?> MRU<br>
                <?php endforeach; ?>
            </td></tr>
            <?php endif; ?>
            <tr style="background:#eef2ff;"><td style="padding:.75rem .5rem;font-weight:700;">Montant payé :</td><td style="padding:.75rem .5rem;font-weight:700;font-size:1.1rem;"><?= e(number_format((float)$recu_data['montant'],0,',',' ')) ?> MRU</td></tr>
            <tr><td style="padding:.5rem;font-weight:600;">Date :</td><td style="padding:.5rem;"><?= e(date('d/m/Y H:i', strtotime($recu_data['date_paiement']))) ?></td></tr>
        </table>
        <p style="text-align:center;margin-top:2rem;font-size:.8rem;color:#888;">Merci de votre confiance — El OURWA</p>
    </div>

<?php elseif ($parent_courant): ?>
    <a href="gestion_caisse.php" class="btn btn-secondary" style="margin-bottom:1rem;">← Tous les correspondants</a>
    <div class="form-card" style="margin-bottom:1.5rem;">
        <h3 style="margin-top:0;">👤 <?= e($parent_courant['nom_complet']) ?></h3>
        <p class="text-muted" style="margin:.25rem 0;">
            📞 <?= e($parent_courant['telephone']) ?>
            &nbsp;·&nbsp; <?= count($enfants) ?> enfant(s) ·
            Total mensuel : <strong><?= e(number_format(array_sum(array_column($enfants,'frais_mensuel')),0,',',' ')) ?> MRU</strong>
        </p>
    </div>
    <?php if (!$enfants): ?>
        <div class="alert alert-info">Ce correspondant n'a aucun enfant inscrit.</div>
    <?php else: ?>
        <?php foreach ($enfants as $enf): ?>
        <div class="form-card" style="margin-bottom:1.5rem;">
            <h4 style="margin-top:0;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
                🎓 <?= e($enf['prenom'].' '.$enf['nom']) ?>
                <span class="text-muted" style="font-weight:400;font-size:.9rem;">
                    — <?= e($enf['niveau_nom']) ?> / <?= e($enf['groupe_nom']) ?>
                    · <?= e($enf['identifiant']) ?>
                    · <?= e(number_format((float)$enf['frais_mensuel'],0,',',' ')) ?> MRU/mois
                </span>
                <?php if ($enf['exempt_totale']): ?>
                    <span class="badge" style="background:#fef3c7;color:#92400e;">Exempté (total)</span>
                <?php endif; ?>
            </h4>

            <!-- Bouton Exemption du frais -->
            <div style="margin:.5rem 0;">
                <button type="button" class="btn btn-sm btn-secondary" onclick="toggleExempt(<?= (int)$enf['id'] ?>)">
                    💸 Exemption du frais
                </button>
                <div id="exempt_<?= (int)$enf['id'] ?>" style="display:none;margin-top:.6rem;padding:.75rem;border:1px dashed #d1d5db;border-radius:8px;background:#fafafa;">
                    <?php if ($enf['exempt_totale']): ?>
                        <p style="margin:.25rem 0;">Cet étudiant bénéficie d'une <strong>exemption totale</strong>.</p>
                        <form method="POST" style="display:inline;" onsubmit="return confirm('Retirer l\'exemption totale ?');">
                            <?= csrf_field() ?>
                            <input type="hidden" name="action" value="retirer_exemption">
                            <input type="hidden" name="exemption_id" value="<?= (int)$enf['exempt_ids']['totale'] ?>">
                            <button class="btn btn-sm btn-danger">Retirer l'exemption totale</button>
                        </form>
                    <?php else: ?>
                        <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
                            <!-- Exemption totale -->
                            <form method="POST" onsubmit="return confirm('Appliquer une exemption TOTALE ? L\'étudiant n\'aura plus à payer.');" style="display:flex;gap:.4rem;align-items:center;">
                                <?= csrf_field() ?>
                                <input type="hidden" name="action" value="exemption_totale">
                                <input type="hidden" name="etudiant_id" value="<?= (int)$enf['id'] ?>">
                                <input type="text" name="motif" placeholder="Motif (optionnel)" style="width:160px;">
                                <button class="btn btn-sm btn-primary">Exemption totale</button>
                            </form>
                            <!-- Exemption d'un mois -->
                            <form method="POST" style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;">
                                <?= csrf_field() ?>
                                <input type="hidden" name="action" value="exemption_mensuelle">
                                <input type="hidden" name="etudiant_id" value="<?= (int)$enf['id'] ?>">
                                <input type="hidden" name="annee" value="<?= $annee_courante ?>">
                                <select name="mois" required>
                                    <option value="">— Mois —</option>
                                    <?php foreach ($mois_noms as $mn => $ml): ?>
                                        <option value="<?= $mn ?>"><?= e($ml) ?></option>
                                    <?php endforeach; ?>
                                </select>
                                <input type="text" name="motif" placeholder="Motif (optionnel)" style="width:140px;">
                                <button class="btn btn-sm btn-primary">Exemption d'un mois</button>
                            </form>
                        </div>
                    <?php endif; ?>
                </div>
            </div>

            <?php if ($enf['exempt_totale']): ?>
                <div class="alert alert-info" style="margin:.5rem 0;">
                    Profil exempté — aucun paiement mensuel requis.
                </div>
            <?php else: ?>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.5rem;margin-top:1rem;">
                <?php for ($m = 1; $m <= 12; $m++):
                    $paye = $enf['paiements'][$m] ?? null;
                    $exempte_mois = array_key_exists($m, $enf['exempt_mois']);
                ?>
                    <div style="border:1px solid <?= $paye ? '#10B981' : ($exempte_mois ? '#f59e0b' : '#e5e7eb') ?>;border-radius:8px;padding:.6rem;background:<?= $paye ? '#ecfdf5' : ($exempte_mois ? '#fffbeb' : '#fafafa') ?>;">
                        <div style="font-weight:600;font-size:.85rem;"><?= e($mois_noms[$m]) ?></div>
                        <?php if ($paye): ?>
                            <div style="color:#10B981;font-size:.78rem;margin:.25rem 0;">✓ Payé</div>
                            <div style="display:flex;gap:.25rem;">
                                <a href="gestion_caisse.php?print_recu=<?= e($paye['id']) ?>" class="btn btn-sm btn-secondary" style="font-size:.7rem;padding:.2rem .4rem;">Reçu</a>
                                <form method="POST" style="display:inline;" onsubmit="return confirm('Annuler ce paiement ?');">
                                    <?= csrf_field() ?>
                                    <input type="hidden" name="action" value="annuler_paiement">
                                    <input type="hidden" name="paiement_id" value="<?= e($paye['id']) ?>">
                                    <button class="btn btn-sm btn-danger" style="font-size:.7rem;padding:.2rem .4rem;">✕</button>
                                </form>
                            </div>
                        <?php elseif ($exempte_mois): ?>
                            <div style="color:#b45309;font-size:.78rem;margin:.25rem 0;">Exempté</div>
                            <form method="POST" style="display:inline;" onsubmit="return confirm('Retirer l\'exemption de ce mois ?');">
                                <?= csrf_field() ?>
                                <input type="hidden" name="action" value="retirer_exemption">
                                <input type="hidden" name="exemption_id" value="<?= (int)($enf['exempt_ids']['mois'][$m] ?? 0) ?>">
                                <button class="btn btn-sm btn-secondary" style="font-size:.7rem;padding:.2rem .4rem;">Annuler exempt.</button>
                            </form>
                        <?php else: ?>
                            <button type="button" class="btn btn-sm btn-primary" style="font-size:.72rem;padding:.25rem .5rem;width:100%;margin-top:.25rem;"
                                onclick="ouvrirPaiement(<?= (int)$enf['id'] ?>, <?= $m ?>, '<?= e($mois_noms[$m]) ?>', <?= (float)$enf['frais_mensuel'] ?>, '<?= e($enf['prenom'].' '.$enf['nom']) ?>')">
                                Confirmer
                            </button>
                        <?php endif; ?>
                    </div>
                <?php endfor; ?>
            </div>
            <?php endif; ?>
        </div>
        <?php endforeach; ?>

        <!-- Modale de paiement multi-moyens -->
        <div id="modal_paiement" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;align-items:center;justify-content:center;padding:1rem;">
            <div class="form-card" style="max-width:480px;width:100%;background:#fff;">
                <h3 style="margin-top:0;">Confirmer le paiement</h3>
                <p id="modal_info" class="text-muted"></p>
                <form method="POST" id="form_paiement">
                    <?= csrf_field() ?>
                    <input type="hidden" name="action" value="confirmer_paiement">
                    <input type="hidden" name="etudiant_id" id="mp_etudiant_id">
                    <input type="hidden" name="mois" id="mp_mois">
                    <input type="hidden" name="annee" value="<?= $annee_courante ?>">
                    <?= widget_moyens_paiement('entrant', 0, 'caisse') ?>
                    <div style="display:flex;gap:.5rem;margin-top:1rem;">
                        <button class="btn btn-primary">✓ Valider le paiement</button>
                        <button type="button" class="btn btn-secondary" onclick="fermerPaiement()">Annuler</button>
                    </div>
                </form>
            </div>
        </div>
    <?php endif; ?>

<?php else: ?>
    <!-- ===== Panneau : moyens de paiement ===== -->
    <div class="form-card" style="margin-bottom:1.5rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem;">
            <h3 style="margin:0;">💳 Moyens de paiement</h3>
            <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('panneau_moyens').style.display = (document.getElementById('panneau_moyens').style.display==='none'?'block':'none')">
                Gérer
            </button>
        </div>
        <div id="panneau_moyens" style="display:none;margin-top:1rem;">
            <form method="POST" style="display:flex;gap:.5rem;align-items:flex-end;flex-wrap:wrap;margin-bottom:1rem;">
                <?= csrf_field() ?>
                <input type="hidden" name="action" value="ajouter_moyen">
                <div style="flex:1;min-width:200px;">
                    <label>Nouveau moyen (ex : Bankily, Masrvi, …)</label>
                    <input type="text" name="moyen_nom" placeholder="Nom du moyen de paiement" required>
                </div>
                <button class="btn btn-primary">+ Ajouter</button>
            </form>
            <?php if ($tous_moyens): ?>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
                <?php foreach ($tous_moyens as $mo): ?>
                    <div style="display:flex;align-items:center;gap:.4rem;border:1px solid <?= $mo['actif'] ? '#10B981' : '#e5e7eb' ?>;border-radius:20px;padding:.25rem .75rem;background:<?= $mo['actif'] ? '#ecfdf5' : '#f9fafb' ?>;">
                        <span style="font-weight:600;font-size:.85rem;<?= $mo['actif'] ? '' : 'color:#9ca3af;text-decoration:line-through;' ?>"><?= e($mo['nom']) ?></span>
                        <form method="POST" style="display:inline;">
                            <?= csrf_field() ?>
                            <input type="hidden" name="action" value="basculer_moyen">
                            <input type="hidden" name="moyen_id" value="<?= (int)$mo['id'] ?>">
                            <button class="btn btn-sm btn-secondary" style="font-size:.65rem;padding:.1rem .4rem;"><?= $mo['actif'] ? 'Désactiver' : 'Activer' ?></button>
                        </form>
                    </div>
                <?php endforeach; ?>
            </div>
            <?php else: ?>
                <p class="text-muted">Aucun moyen de paiement. Ajoutez-en au moins un.</p>
            <?php endif; ?>
        </div>
    </div>

    <form method="GET" class="form-card" style="margin-bottom:1.5rem;">
        <div style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap;">
            <div style="flex:1;min-width:220px;">
                <label for="q">🔍 Rechercher (nom ou téléphone)</label>
                <input type="text" id="q" name="q" value="<?= e($recherche) ?>" placeholder="Ex : Mohamed, ou 22 12 34 56">
            </div>
            <div style="min-width:130px;">
                <label for="impaye_mois">📅 Mois impayé</label>
                <select name="impaye_mois" id="impaye_mois">
                    <option value="">— Aucun —</option>
                    <?php foreach ($mois_noms as $mn => $ml): ?>
                        <option value="<?= $mn ?>" <?= (int)($_GET['impaye_mois'] ?? 0)===$mn?'selected':'' ?>><?= e($ml) ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
            <div style="min-width:110px;">
                <label for="impaye_annee">Année</label>
                <select name="impaye_annee" id="impaye_annee">
                    <option value="">—</option>
                    <?php $aa = (int)date('Y'); for($y=$aa-2;$y<=$aa+1;$y++): ?>
                        <option value="<?= $y ?>" <?= (int)($_GET['impaye_annee'] ?? $aa)===$y?'selected':'' ?>><?= $y ?></option>
                    <?php endfor; ?>
                </select>
            </div>
            <button class="btn btn-primary" style="width:auto;">Filtrer</button>
            <?php if ($recherche !== '' || !empty($_GET['impaye_mois'])): ?>
                <a href="gestion_caisse.php" class="btn btn-secondary">Réinitialiser</a>
            <?php endif; ?>
        </div>
        <?php
            $fm = nettoyer_entier($_GET['impaye_mois'] ?? 0) ?? 0;
            $fa = nettoyer_entier($_GET['impaye_annee'] ?? 0) ?? 0;
            if ($fm >= 1 && $fm <= 12 && $fa >= 2020):
        ?>
        <div style="margin-top:.75rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
            <p style="margin:0;color:var(--text-light);font-size:.88rem;">
                🎯 Filtre actif : correspondants avec au moins un enfant <strong>impayé</strong>
                pour <strong><?= e($mois_noms[$fm]) ?> <?= e($fa) ?></strong>.
            </p>
            <form method="POST" onsubmit="return confirm('Envoyer une notification à tous les parents impayés de ce mois (hors exemptés) ?');">
                <?= csrf_field() ?>
                <input type="hidden" name="action" value="notifier_impayes">
                <input type="hidden" name="mois" value="<?= (int)$fm ?>">
                <input type="hidden" name="annee" value="<?= (int)$fa ?>">
                <button class="btn btn-sm btn-primary">🔔 Notifier les impayés</button>
            </form>
        </div>
        <?php endif; ?>
    </form>
    <?php if (!$parents): ?>
        <div class="alert alert-info">
            <?php if ($recherche !== '' || (!empty($_GET['impaye_mois']) && !empty($_GET['impaye_annee']))): ?>
                Aucun correspondant ne correspond aux critères.
            <?php else: ?>
                Aucun correspondant enregistré. Utilisez « Inscrire un étudiant » pour en créer.
            <?php endif; ?>
        </div>
    <?php else: ?>
        <div class="table-responsive">
            <table class="data-table">
                <thead><tr>
                    <th>Correspondant</th><th>Téléphone</th><th>Enfants</th>
                    <th>Total mensuel</th>
                    <?php if ($fm): ?><th>Impayés</th><?php endif; ?>
                    <th>Statut</th><th></th>
                </tr></thead>
                <tbody>
                    <?php foreach ($parents as $p): ?>
                    <tr>
                        <td><strong><?= e($p['nom_complet']) ?></strong></td>
                        <td><?= e($p['telephone']) ?></td>
                        <td><?= e($p['nb_enfants']) ?></td>
                        <td><?= e(number_format((float)$p['frais_total'],0,',',' ')) ?> MRU</td>
                        <?php if ($fm): ?>
                            <td><span class="badge badge-danger"><?= e($p['nb_impayes']) ?></span></td>
                        <?php endif; ?>
                        <td><?= $p['actif'] ? '<span style="color:#10B981;">● Actif</span>' : '<span style="color:#EF4444;">● Inactif</span>' ?></td>
                        <td><a href="gestion_caisse.php?parent_id=<?= e($p['id']) ?>" class="btn btn-sm btn-primary">Voir le profil →</a></td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    <?php endif; ?>
<?php endif; ?>

<style>
@media print { .no-print, .sidebar, .topbar, .page-header { display:none !important; } #recu { border:none !important; } }
</style>

<script>
function toggleExempt(id) {
    const el = document.getElementById('exempt_' + id);
    if (el) el.style.display = (el.style.display === 'none' || !el.style.display) ? 'block' : 'none';
}
function ouvrirPaiement(eid, mois, moisNom, frais, nom) {
    document.getElementById('mp_etudiant_id').value = eid;
    document.getElementById('mp_mois').value = mois;
    document.getElementById('modal_info').textContent = nom + ' — ' + moisNom + ' · ' + frais.toLocaleString('fr-FR') + ' MRU';
    // Réinitialise le widget avec le montant cible
    const w = document.querySelector('#modal_paiement .mp-widget');
    if (w) {
        w.dataset.cible = frais;
        const lignes = document.getElementById('caisse_lignes');
        lignes.innerHTML = '';
        mpAjouter('caisse', undefined, frais);
    }
    document.getElementById('modal_paiement').style.display = 'flex';
}
function fermerPaiement() {
    document.getElementById('modal_paiement').style.display = 'none';
}
</script>
<?= widget_moyens_paiement_js() ?>

<?php include __DIR__ . '/../../includes/layout_footer.php'; ?>
