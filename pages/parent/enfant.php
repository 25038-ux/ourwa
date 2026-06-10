<?php
/**
 * Profil détaillé d'un enfant côté parent.
 * Sections : infos générales, absences, remarques, emploi du temps, bulletin par trimestre.
 */
require_once __DIR__ . '/../../includes/bootstrap.php';
require_once __DIR__ . '/../../includes/parent_auth.php';
require_parent();

$pid = (int) $_SESSION['parent_id'];
$db  = getDB();
$eid = nettoyer_entier($_GET['id'] ?? 0) ?? 0;

// Vérifier que l'enfant appartient bien à ce parent
$st = $db->prepare('
    SELECT e.*, g.nom AS groupe, g.niveau_id, IFNULL(n.nom,"—") AS niveau, IFNULL(n.tarif_mensuel,0) AS tarif
    FROM etudiants e
    JOIN groupes g ON e.groupe_id = g.id
    LEFT JOIN niveaux n ON g.niveau_id = n.id
    WHERE e.id = :e AND e.parent_id = :p');
$st->execute([':e' => $eid, ':p' => $pid]);
$enfant = $st->fetch();

if (!$enfant) {
    header('Location: tableau_bord.php');
    exit;
}

$gid = (int) $enfant['groupe_id'];

// Matricule dans la CLASSE = position ordonnée par nom, prénom dans le groupe
$st = $db->prepare('
    SELECT COUNT(*) FROM etudiants
    WHERE groupe_id = :g
      AND (
            nom < :nom
         OR (nom = :nom AND prenom < :prenom)
         OR (nom = :nom AND prenom = :prenom AND id <= :id)
      )');
$st->execute([
    ':g' => $gid,
    ':nom' => $enfant['nom'],
    ':prenom' => $enfant['prenom'],
    ':id' => $enfant['id'],
]);
$matricule_classe = (int) $st->fetchColumn();

// Absences
$st = $db->prepare('SELECT COUNT(*) FROM absences WHERE etudiant_id = :e AND statut IN ("absent","retard")');
$st->execute([':e' => $eid]);
$total_abs = (int) $st->fetchColumn();

$st = $db->prepare('
    SELECT a.date_absence, a.statut, a.remarque AS motif, m.nom AS matiere
    FROM absences a
    LEFT JOIN enseignements en ON a.enseignement_id = en.id
    LEFT JOIN matieres m ON en.matiere_id = m.id
    WHERE a.etudiant_id = :e
    ORDER BY a.date_absence DESC LIMIT 50');
$st->execute([':e' => $eid]);
$absences = $st->fetchAll();

// Remarques (le schéma n'a pas enseignement_id ni professeur_id ; on a auteur_nom)
$st = $db->prepare('
    SELECT contenu, date_creation, auteur_nom, gravite
    FROM remarques
    WHERE etudiant_id = :e
    ORDER BY date_creation DESC LIMIT 30');
$st->execute([':e' => $eid]);
$remarques = $st->fetchAll();

// Trimestre choisi (bulletin)
$trim_choisi = (int) ($_GET['trim'] ?? 0); // 0 = tous

// Notes pour bulletin
$sql = '
    SELECT m.nom AS matiere, m.coefficient, no.valeur, no.type_note, no.trimestre
    FROM notes no
    JOIN enseignements en ON no.enseignement_id = en.id
    JOIN matieres m ON en.matiere_id = m.id
    WHERE no.etudiant_id = :e';
$params = [':e' => $eid];
if ($trim_choisi >= 1 && $trim_choisi <= 3) {
    $sql .= ' AND no.trimestre = :t';
    $params[':t'] = $trim_choisi;
}
$sql .= ' ORDER BY no.trimestre, m.nom';
$st = $db->prepare($sql);
$st->execute($params);
$notes_raw = $st->fetchAll();

// Calcul moyenne par matière
$bulletin = [];
foreach ($notes_raw as $n) {
    $key = $n['matiere'];
    if (!isset($bulletin[$key])) {
        $bulletin[$key] = ['coef' => (float)$n['coefficient'], 'notes' => [], 'moy' => null];
    }
    $bulletin[$key]['notes'][] = ['v' => (float)$n['valeur'], 't' => $n['type_note'], 'tr' => (int)$n['trimestre']];
}
$mg_num = 0; $mg_den = 0;
foreach ($bulletin as $m => &$b) {
    if (count($b['notes']) > 0) {
        $b['moy'] = array_sum(array_column($b['notes'], 'v')) / count($b['notes']);
        $mg_num += $b['moy'] * $b['coef'];
        $mg_den += $b['coef'];
    }
}
unset($b);
$moy_gen = $mg_den > 0 ? $mg_num / $mg_den : null;

// Emploi du temps de la classe
$JOURS    = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
$CRENEAUX = ['8h-9h45','10h-11h45','12h-14h'];
$grille = [];
$st = $db->prepare('
    SELECT edt.jour, edt.creneau,
           m.nom AS matiere, p.prenom AS prof_prenom, p.nom AS prof_nom
    FROM emplois_du_temps edt
    JOIN enseignements en ON edt.enseignement_id = en.id
    JOIN matieres m ON en.matiere_id = m.id
    JOIN professeurs p ON en.professeur_id = p.id
    WHERE edt.groupe_id = :g');
$st->execute([':g' => $gid]);
foreach ($st->fetchAll() as $r) {
    $grille[$r['jour']][$r['creneau']] = $r;
}

$titre_page = $enfant['prenom'] . ' ' . $enfant['nom'];
require __DIR__ . '/../../includes/parent_layout_header.php';
?>

<a href="tableau_bord.php" style="display:inline-block;margin-bottom:1rem;color:var(--ocean-700);text-decoration:none;font-weight:600;">
    ← <?= e(t('accueil')) ?>
</a>

<div class="g-card" style="margin-bottom:1rem;">
    <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap;">
        <div class="child-avatar-lg" style="width:64px;height:64px;font-size:1.6rem;">
            <?= e(mb_strtoupper(mb_substr($enfant['prenom'], 0, 1))) ?>
        </div>
        <div style="flex:1;min-width:200px;">
            <h2 style="margin:0;color:var(--ocean-800);"><?= e($enfant['prenom'] . ' ' . $enfant['nom']) ?></h2>
            <p style="margin:.25rem 0 0;color:var(--ink-600);"><?= e($enfant['niveau']) ?> · <?= e($enfant['groupe']) ?></p>
            <p style="margin:.25rem 0 0;color:var(--ink-500);font-size:.85rem;">
                <?= e(t('matricule')) ?> : <code>N°<?= e($matricule_classe) ?></code>
            </p>
        </div>
        <div style="text-align:center;">
            <div style="font-size:2.4rem;font-weight:800;color:<?= $total_abs > 5 ? '#dc2626' : '#0e7490' ?>;line-height:1;"><?= e($total_abs) ?></div>
            <div style="font-size:.78rem;color:var(--ink-500);font-weight:600;text-transform:uppercase;letter-spacing:.5px;"><?= e(t('totalabsences')) ?></div>
        </div>
        <div style="text-align:center;">
            <div style="font-size:2.4rem;font-weight:800;color:<?= ($moy_gen !== null && $moy_gen < 10) ? '#dc2626' : '#0e7490' ?>;line-height:1;">
                <?= $moy_gen !== null ? number_format($moy_gen, 2, ',', '') : '—' ?>
            </div>
            <div style="font-size:.78rem;color:var(--ink-500);font-weight:600;text-transform:uppercase;letter-spacing:.5px;"><?= e(t('moyenne')) ?></div>
        </div>
    </div>
</div>

<!-- Onglets -->
<div style="display:flex;gap:.5rem;margin-bottom:1rem;flex-wrap:wrap;">
    <button class="tab-btn active" data-tab="bulletin" onclick="ouvrirTab(this,'tab-bulletin')">📊 <?= e(t('bulletin')) ?></button>
    <button class="tab-btn" data-tab="absences" onclick="ouvrirTab(this,'tab-absences')">📅 <?= e(t('absences')) ?></button>
    <button class="tab-btn" data-tab="remarques" onclick="ouvrirTab(this,'tab-remarques')">💬 <?= e(t('remarques')) ?></button>
    <button class="tab-btn" data-tab="edt" onclick="ouvrirTab(this,'tab-edt')">🗓️ <?= e(t('emploi_du_temps')) ?></button>
</div>

<style>
.tab-btn { padding:.55rem 1rem;border:2px solid var(--ocean-200,#a5f3fc);background:#fff;border-radius:24px;font-weight:600;color:var(--ocean-700);cursor:pointer;transition:.2s;}
.tab-btn.active { background:var(--ocean-700,#0e7490);color:#fff;border-color:var(--ocean-700,#0e7490);}
.tab-pane { display:none; }
.tab-pane.active { display:block; animation: fadeInPane .25s; }
@keyframes fadeInPane { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
</style>

<!-- Bulletin -->
<div id="tab-bulletin" class="tab-pane active">
    <div class="g-card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem;margin-bottom:1rem;">
            <h3 style="margin:0;">📊 <?= e(t('bulletin')) ?></h3>
            <form method="GET" style="display:flex;gap:.5rem;align-items:center;">
                <input type="hidden" name="id" value="<?= e($eid) ?>">
                <label style="font-size:.88rem;color:var(--ink-600);font-weight:600;"><?= e(t('choisir_trimestre')) ?> :</label>
                <select name="trim" onchange="this.form.submit()" style="padding:.4rem .75rem;border-radius:8px;border:1px solid var(--ocean-300,#67e8f9);background:#fff;">
                    <option value="0" <?= $trim_choisi===0?'selected':'' ?>><?= e(t('tous_trimestres')) ?></option>
                    <option value="1" <?= $trim_choisi===1?'selected':'' ?>><?= e(t('trimestre_1')) ?></option>
                    <option value="2" <?= $trim_choisi===2?'selected':'' ?>><?= e(t('trimestre_2')) ?></option>
                    <option value="3" <?= $trim_choisi===3?'selected':'' ?>><?= e(t('trimestre_3')) ?></option>
                </select>
            </form>
        </div>

        <?php if (empty($bulletin)): ?>
            <div style="text-align:center;padding:1.5rem;color:var(--ink-500);"><?= e(t('aucun_resultat')) ?></div>
        <?php else: ?>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;">
                    <thead>
                        <tr style="background:var(--ocean-50,#ecfeff);">
                            <th style="padding:.6rem .8rem;text-align:start;border-bottom:2px solid var(--ocean-200,#a5f3fc);"><?= e(t('matiere')) ?></th>
                            <th style="padding:.6rem .8rem;text-align:center;border-bottom:2px solid var(--ocean-200,#a5f3fc);">Coef</th>
                            <th style="padding:.6rem .8rem;text-align:center;border-bottom:2px solid var(--ocean-200,#a5f3fc);"><?= e(t('note')) ?>s</th>
                            <th style="padding:.6rem .8rem;text-align:center;border-bottom:2px solid var(--ocean-200,#a5f3fc);"><?= e(t('moyenne')) ?></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($bulletin as $matiere => $b): ?>
                        <tr style="border-bottom:1px solid #e5e7eb;">
                            <td style="padding:.6rem .8rem;font-weight:600;"><?= e($matiere) ?></td>
                            <td style="padding:.6rem .8rem;text-align:center;"><?= e($b['coef']) ?></td>
                            <td style="padding:.6rem .8rem;text-align:center;font-size:.85rem;color:var(--ink-600);">
                                <?php foreach ($b['notes'] as $n): ?>
                                    <span style="display:inline-block;margin:1px 3px;padding:2px 8px;border-radius:8px;background:#f3f4f6;">
                                        <?= e(number_format($n['v'], 2, ',', '')) ?>
                                    </span>
                                <?php endforeach; ?>
                            </td>
                            <td style="padding:.6rem .8rem;text-align:center;font-weight:700;color:<?= $b['moy'] !== null && $b['moy'] < 10 ? '#dc2626' : '#0e7490' ?>;font-size:1.05rem;">
                                <?= $b['moy'] !== null ? number_format($b['moy'], 2, ',', '') : '—' ?>
                            </td>
                        </tr>
                        <?php endforeach; ?>
                    </tbody>
                    <?php if ($moy_gen !== null): ?>
                    <tfoot>
                        <tr style="background:var(--ocean-50,#ecfeff);">
                            <td colspan="3" style="padding:.7rem .8rem;font-weight:700;text-align:end;"><?= e(t('moyenne')) ?> Générale :</td>
                            <td style="padding:.7rem .8rem;text-align:center;font-size:1.3rem;font-weight:800;color:<?= $moy_gen < 10 ? '#dc2626' : '#0e7490' ?>;">
                                <?= number_format($moy_gen, 2, ',', '') ?>/20
                            </td>
                        </tr>
                    </tfoot>
                    <?php endif; ?>
                </table>
            </div>
        <?php endif; ?>
    </div>
</div>

<!-- Absences -->
<div id="tab-absences" class="tab-pane">
    <div class="g-card">
        <h3 style="margin-top:0;">📅 <?= e(t('historique_absences')) ?></h3>
        <?php if (empty($absences)): ?>
            <p style="text-align:center;color:var(--ink-500);"><?= e(t('aucune_absence')) ?></p>
        <?php else: ?>
            <ul style="list-style:none;padding:0;margin:0;">
                <?php foreach ($absences as $a): ?>
                <li style="display:flex;gap:.75rem;padding:.6rem 0;border-bottom:1px solid #e5e7eb;">
                    <div style="background:<?= $a['statut']==='retard' ? '#fef3c7' : '#fee2e2' ?>;color:<?= $a['statut']==='retard' ? '#92400e' : '#991b1b' ?>;padding:.25rem .6rem;border-radius:8px;font-size:.78rem;font-weight:700;text-transform:uppercase;height:fit-content;">
                        <?= e($a['statut']) ?>
                    </div>
                    <div style="flex:1;">
                        <div style="font-weight:600;"><?= e(date('d/m/Y', strtotime($a['date_absence']))) ?> <?php if ($a['matiere']): ?>· <?= e($a['matiere']) ?><?php endif; ?></div>
                        <?php if ($a['motif']): ?>
                        <div style="font-size:.85rem;color:var(--ink-600);"><?= e($a['motif']) ?></div>
                        <?php endif; ?>
                    </div>
                </li>
                <?php endforeach; ?>
            </ul>
        <?php endif; ?>
    </div>
</div>

<!-- Remarques -->
<div id="tab-remarques" class="tab-pane">
    <div class="g-card">
        <h3 style="margin-top:0;">💬 <?= e(t('liste_remarques')) ?></h3>
        <?php if (empty($remarques)): ?>
            <p style="text-align:center;color:var(--ink-500);"><?= e(t('aucune_remarque')) ?></p>
        <?php else: ?>
            <?php foreach ($remarques as $r):
                $grav = $r['gravite'] ?? 'info';
                $coul = match($grav) {
                    'positif' => '#10b981',
                    'avertissement' => '#f59e0b',
                    'grave'   => '#dc2626',
                    default   => '#06b6d4',
                };
            ?>
            <div style="border-inline-start:4px solid <?= $coul ?>;background:#f0fdfa;padding:.75rem 1rem;border-radius:0 8px 8px 0;margin-bottom:.6rem;">
                <p style="margin:0 0 .35rem;"><?= nl2br(e($r['contenu'])) ?></p>
                <small style="color:var(--ink-500);">
                    <?php if (!empty($r['auteur_nom'])): ?><?= e($r['auteur_nom']) ?> · <?php endif; ?>
                    <?= e(date('d/m/Y', strtotime($r['date_creation']))) ?>
                </small>
            </div>
            <?php endforeach; ?>
        <?php endif; ?>
    </div>
</div>

<!-- Emploi du temps -->
<div id="tab-edt" class="tab-pane">
    <div class="g-card">
        <h3 style="margin-top:0;">🗓️ <?= e(t('emploi_du_temps')) ?></h3>
        <?php if (empty($grille)): ?>
            <p style="text-align:center;color:var(--ink-500);"><?= e(t('aucun_resultat')) ?></p>
        <?php else: ?>
        <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;min-width:600px;">
                <thead>
                    <tr>
                        <th style="background:#f3f4f6;padding:.5rem;">⏰</th>
                        <?php foreach ($JOURS as $j):
                            $jcle = strtolower($j); ?>
                            <th style="background:var(--ocean-700,#0e7490);color:#fff;padding:.5rem;font-size:.85rem;">
                                <?= e(function_exists('t') ? t($jcle) : $j) ?>
                            </th>
                        <?php endforeach; ?>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($CRENEAUX as $cr): ?>
                    <tr>
                        <th style="background:#f3f4f6;padding:.5rem;font-size:.78rem;white-space:nowrap;"><?= e($cr) ?></th>
                        <?php foreach ($JOURS as $j):
                            $c = $grille[$j][$cr] ?? null; ?>
                        <td style="padding:.25rem;vertical-align:top;min-width:110px;">
                            <?php if ($c): ?>
                                <div style="background:linear-gradient(135deg,#ecfeff,#cffafe);padding:.5rem;border-radius:6px;border-inline-start:3px solid var(--ocean-600,#0891b2);font-size:.8rem;">
                                    <strong style="color:var(--ocean-800,#155e75);"><?= e($c['matiere']) ?></strong><br>
                                    <small style="color:var(--ink-500);"><?= e($c['prof_prenom'].' '.$c['prof_nom']) ?></small>
                                </div>
                            <?php else: ?>
                                <div style="height:60px;background:#fafafa;border-radius:6px;"></div>
                            <?php endif; ?>
                        </td>
                        <?php endforeach; ?>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>
        <?php endif; ?>
    </div>
</div>

<script>
function ouvrirTab(btn, idCible) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(idCible).classList.add('active');
}
</script>

<?php require __DIR__ . '/../../includes/parent_layout_footer.php'; ?>
