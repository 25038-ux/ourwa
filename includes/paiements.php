<?php
/**
 * paiements.php — Helpers partagés pour les moyens de paiement et les exemptions.
 *
 * Centralise :
 *   - lecture des moyens de paiement actifs
 *   - rendu du widget « Ajouter un moyen de paiement » (réutilisable partout)
 *   - lecture/validation des lignes de paiement envoyées par le widget
 *   - persistance des lignes dans paiement_lignes (référence polymorphe)
 *   - helpers d'exemption (totale / mensuelle)
 *
 * Toutes les requêtes sont préparées. Sécurité identique au reste du projet.
 */

require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/sanitize.php';

/**
 * Liste des moyens de paiement actifs (id => nom).
 */
function moyens_paiement_actifs(): array {
    static $cache = null;
    if ($cache !== null) return $cache;
    $db = getDB();
    $rows = $db->query('SELECT id, nom FROM moyens_paiement WHERE actif = TRUE ORDER BY nom')->fetchAll();
    $cache = [];
    foreach ($rows as $r) {
        $cache[(int) $r['id']] = $r['nom'];
    }
    return $cache;
}

/**
 * Y a-t-il au moins un moyen de paiement configuré et actif ?
 */
function moyens_paiement_existe(): bool {
    return count(moyens_paiement_actifs()) > 0;
}

/**
 * Rendu du widget « moyens de paiement » réutilisable.
 *
 * Génère :
 *   - un bouton « + Ajouter un moyen de paiement »
 *   - des lignes dynamiques : <select moyen> + <input number montant>
 *   - un total live
 *
 * Les champs envoyés sont des tableaux : moyen_id[] et moyen_montant[].
 *
 * @param string $sens 'entrant' (on reçoit) ou 'sortant' (on paie)
 * @param float  $montant_attendu  montant cible affiché (0 = libre)
 * @param string $id_prefixe  préfixe DOM unique si plusieurs widgets sur une page
 */
function widget_moyens_paiement(string $sens = 'entrant', float $montant_attendu = 0, string $id_prefixe = 'mp'): string {
    $moyens = moyens_paiement_actifs();
    $pid = preg_replace('/[^a-zA-Z0-9_]/', '', $id_prefixe);

    if (!$moyens) {
        return '<div class="alert alert-warning" style="margin:.5rem 0;">'
             . 'Aucun moyen de paiement configuré. Ajoutez-en un depuis l\'en-tête de « Gestion de Caisse » avant d\'enregistrer un paiement.'
             . '</div>';
    }

    // Options du select (réutilisées par le JS)
    $options = '<option value="">— Moyen —</option>';
    foreach ($moyens as $id => $nom) {
        $options .= '<option value="' . (int) $id . '">' . e($nom) . '</option>';
    }

    $cible = $montant_attendu > 0
        ? number_format($montant_attendu, 0, ',', ' ')
        : '';

    ob_start();
    ?>
    <div class="mp-widget" data-prefix="<?= e($pid) ?>" data-cible="<?= e((string) $montant_attendu) ?>" style="margin:.5rem 0;">
        <label style="font-weight:600;display:block;margin-bottom:.4rem;">
            Moyen(s) de paiement <?= $sens === 'sortant' ? '(sortie)' : '' ?>
            <?php if ($cible !== ''): ?>
                <span class="text-muted" style="font-weight:400;">— à régler : <?= e($cible) ?> MRU</span>
            <?php endif; ?>
        </label>
        <div id="<?= e($pid) ?>_lignes" class="mp-lignes"></div>
        <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;margin-top:.4rem;">
            <button type="button" class="btn btn-sm btn-secondary" onclick="mpAjouter('<?= e($pid) ?>')">
                + Ajouter un moyen de paiement
            </button>
            <span class="mp-total" style="font-weight:600;">
                Total : <span id="<?= e($pid) ?>_total">0</span> MRU
            </span>
        </div>
        <template id="<?= e($pid) ?>_tpl">
            <div class="mp-ligne" style="display:flex;gap:.5rem;align-items:center;margin-bottom:.4rem;">
                <select name="moyen_id[]" class="mp-moyen" required onchange="mpRecalc('<?= e($pid) ?>')" style="flex:1;min-width:140px;">
                    <?= $options ?>
                </select>
                <input type="number" name="moyen_montant[]" class="mp-montant" min="0" step="0.01"
                       placeholder="Montant" required oninput="mpRecalc('<?= e($pid) ?>')"
                       style="width:140px;">
                <button type="button" class="btn btn-sm btn-danger mp-remove" onclick="mpRetirer(this,'<?= e($pid) ?>')" style="padding:.25rem .5rem;">✕</button>
            </div>
        </template>
    </div>
    <?php
    return ob_get_clean();
}

/**
 * JS partagé du widget — à inclure UNE FOIS par page (avant </body>).
 */
function widget_moyens_paiement_js(): string {
    return <<<'JS'
<script>
function mpAjouter(prefix, moyenId, montant) {
    const tpl = document.getElementById(prefix + '_tpl');
    const cont = document.getElementById(prefix + '_lignes');
    if (!tpl || !cont) return;
    const node = tpl.content.cloneNode(true);
    cont.appendChild(node);
    const ligne = cont.lastElementChild;
    if (moyenId !== undefined && ligne) ligne.querySelector('.mp-moyen').value = moyenId;
    if (montant !== undefined && ligne) ligne.querySelector('.mp-montant').value = montant;
    mpRecalc(prefix);
}
function mpRetirer(btn, prefix) {
    const ligne = btn.closest('.mp-ligne');
    if (ligne) ligne.remove();
    mpRecalc(prefix);
}
function mpRecalc(prefix) {
    const cont = document.getElementById(prefix + '_lignes');
    if (!cont) return;
    let total = 0;
    cont.querySelectorAll('.mp-montant').forEach(i => { total += parseFloat(i.value) || 0; });
    const out = document.getElementById(prefix + '_total');
    if (out) {
        out.textContent = total.toLocaleString('fr-FR');
        const w = cont.closest('.mp-widget');
        const cible = w ? parseFloat(w.dataset.cible) || 0 : 0;
        out.style.color = (cible > 0 && Math.abs(total - cible) < 0.01) ? '#10B981' : '';
    }
}
// Auto-ajoute une première ligne pré-remplie pour chaque widget au chargement.
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.mp-widget').forEach(w => {
        const prefix = w.dataset.prefix;
        const cible = parseFloat(w.dataset.cible) || 0;
        if (document.getElementById(prefix + '_lignes').children.length === 0) {
            mpAjouter(prefix, undefined, cible > 0 ? cible : undefined);
        }
    });
});
</script>
JS;
}

/**
 * Lit et valide les lignes de paiement envoyées par le widget.
 * Renvoie ['ok'=>bool, 'lignes'=>[['moyen_id'=>int,'montant'=>float],...], 'total'=>float, 'message'=>string].
 *
 * @param bool  $exiger_au_moins_un  true => au moins une ligne valide requise
 * @param float $montant_attendu     si > 0, le total doit correspondre (tolérance 0.01)
 */
function lire_lignes_paiement(bool $exiger_au_moins_un = true, float $montant_attendu = 0): array {
    $ids      = $_POST['moyen_id'] ?? [];
    $montants = $_POST['moyen_montant'] ?? [];
    if (!is_array($ids) || !is_array($montants)) {
        $ids = []; $montants = [];
    }

    $moyens_valides = moyens_paiement_actifs();
    $lignes = [];
    $total = 0.0;

    foreach ($ids as $i => $rawId) {
        $mid = nettoyer_entier($rawId);
        $mt  = nettoyer_decimal($montants[$i] ?? 0);
        if ($mid === null || !isset($moyens_valides[$mid])) continue;
        if ($mt === null || $mt <= 0) continue;
        $lignes[] = ['moyen_id' => $mid, 'montant' => round($mt, 2)];
        $total += $mt;
    }
    $total = round($total, 2);

    if ($exiger_au_moins_un && count($lignes) === 0) {
        return ['ok' => false, 'lignes' => [], 'total' => 0,
                'message' => 'Veuillez indiquer au moins un moyen de paiement avec un montant.'];
    }
    if ($montant_attendu > 0 && abs($total - $montant_attendu) > 0.01) {
        return ['ok' => false, 'lignes' => $lignes, 'total' => $total,
                'message' => 'La somme des moyens de paiement (' . number_format($total, 0, ',', ' ')
                           . ' MRU) doit égaler le montant dû (' . number_format($montant_attendu, 0, ',', ' ') . ' MRU).'];
    }

    return ['ok' => true, 'lignes' => $lignes, 'total' => $total, 'message' => ''];
}

/**
 * Enregistre les lignes de paiement pour une source donnée.
 * Utiliser DANS une transaction côté appelant si nécessaire.
 */
function enregistrer_lignes_paiement(string $source_type, int $source_id, array $lignes, string $sens = 'entrant'): void {
    if (!$lignes) return;
    $db = getDB();
    $stmt = $db->prepare(
        'INSERT INTO paiement_lignes (source_type, source_id, moyen_id, montant, sens)
         VALUES (:st, :sid, :mid, :mt, :sens)'
    );
    foreach ($lignes as $l) {
        $stmt->execute([
            ':st'   => $source_type,
            ':sid'  => $source_id,
            ':mid'  => (int) $l['moyen_id'],
            ':mt'   => (float) $l['montant'],
            ':sens' => $sens,
        ]);
    }
}

/**
 * Récupère les lignes de paiement d'une source (pour affichage / reçu).
 */
function lignes_paiement_de(string $source_type, int $source_id): array {
    $db = getDB();
    $stmt = $db->prepare(
        'SELECT pl.montant, pl.sens, mp.nom AS moyen
         FROM paiement_lignes pl
         JOIN moyens_paiement mp ON pl.moyen_id = mp.id
         WHERE pl.source_type = :st AND pl.source_id = :sid
         ORDER BY pl.id'
    );
    $stmt->execute([':st' => $source_type, ':sid' => $source_id]);
    return $stmt->fetchAll();
}

/**
 * Résumé texte des moyens d'une source : « Espèces 350 + Bankily 50 ».
 */
function resume_moyens(string $source_type, int $source_id): string {
    $lignes = lignes_paiement_de($source_type, $source_id);
    if (!$lignes) return '—';
    $parts = [];
    foreach ($lignes as $l) {
        $parts[] = $l['moyen'] . ' ' . number_format((float) $l['montant'], 0, ',', ' ');
    }
    return implode(' + ', $parts);
}

// ============================================================================
//  EXEMPTIONS
// ============================================================================

/**
 * L'étudiant a-t-il une exemption TOTALE ?
 */
function exemption_totale(int $etudiant_id): bool {
    $db = getDB();
    $stmt = $db->prepare("SELECT 1 FROM exemptions WHERE etudiant_id = :e AND type = 'totale' LIMIT 1");
    $stmt->execute([':e' => $etudiant_id]);
    return (bool) $stmt->fetchColumn();
}

/**
 * Liste des mois exemptés pour une année donnée : [mois => motif].
 */
function exemptions_mensuelles(int $etudiant_id, int $annee): array {
    $db = getDB();
    $stmt = $db->prepare(
        "SELECT mois, motif FROM exemptions
         WHERE etudiant_id = :e AND type = 'mensuelle' AND annee = :a"
    );
    $stmt->execute([':e' => $etudiant_id, ':a' => $annee]);
    $out = [];
    foreach ($stmt->fetchAll() as $r) {
        $out[(int) $r['mois']] = $r['motif'];
    }
    return $out;
}

/**
 * Un mois précis est-il exempté (totale OU mensuelle) ?
 */
function mois_exempte(int $etudiant_id, int $mois, int $annee): bool {
    if (exemption_totale($etudiant_id)) return true;
    return array_key_exists($mois, exemptions_mensuelles($etudiant_id, $annee));
}
