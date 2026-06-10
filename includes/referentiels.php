<?php
/**
 * Référentiels en cache (niveaux, groupes, matières...).
 * TTL généreux puisque ces données changent rarement.
 * Invalidation : appeler invalider_referentiels() après chaque INSERT/UPDATE/DELETE.
 */
require_once __DIR__ . '/cache.php';

const REF_TTL = 600; // 10 min

function ref_niveaux(): array {
    return cache_remember('ref:niveaux', REF_TTL, function() {
        return getDB()->query('SELECT id, nom, tarif_mensuel FROM niveaux ORDER BY nom')
                      ->fetchAll(PDO::FETCH_ASSOC);
    });
}

function ref_groupes(): array {
    return cache_remember('ref:groupes', REF_TTL, function() {
        return getDB()->query('
            SELECT g.id, g.nom, g.niveau_id, g.capacite, IFNULL(n.nom,"—") AS niveau
            FROM groupes g
            LEFT JOIN niveaux n ON g.niveau_id = n.id
            ORDER BY n.nom, g.nom')
            ->fetchAll(PDO::FETCH_ASSOC);
    });
}

function ref_groupes_par_niveau(): array {
    return cache_remember('ref:groupes_par_niveau', REF_TTL, function() {
        $g = ref_groupes();
        $out = [];
        foreach ($g as $row) {
            $out[(int)$row['niveau_id']][] = ['id' => (int)$row['id'], 'nom' => $row['nom']];
        }
        return $out;
    });
}

function ref_matieres(): array {
    return cache_remember('ref:matieres', REF_TTL, function() {
        return getDB()->query('SELECT id, nom, coefficient FROM matieres ORDER BY nom')
                      ->fetchAll(PDO::FETCH_ASSOC);
    });
}

/**
 * À appeler à chaque modification structurelle (création/édition d'un niveau,
 * groupe, matière). Sans coût notable.
 */
function invalider_referentiels(): void {
    cache_forget_prefix('ref:');
}
