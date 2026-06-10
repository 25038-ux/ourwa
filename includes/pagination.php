<?php
/**
 * Helper de pagination pour les listes admin.
 *
 *   $pg = paginer($_GET['page'] ?? 1, $total, 25);
 *   // $pg = ['page' => 1, 'pages' => 4, 'limit' => 25, 'offset' => 0, 'total' => 87]
 *
 *   afficher_pagination($pg, $_GET);  // génère les liens « ‹ 1 2 3 › »
 */

function paginer($page, int $total, int $par_page = 25): array {
    $page = max(1, (int) $page);
    $pages = max(1, (int) ceil($total / max(1, $par_page)));
    if ($page > $pages) $page = $pages;
    return [
        'page'   => $page,
        'pages'  => $pages,
        'limit'  => $par_page,
        'offset' => ($page - 1) * $par_page,
        'total'  => $total,
    ];
}

function afficher_pagination(array $pg, array $params = []): void {
    if ($pg['pages'] <= 1) return;
    $params_base = $params;
    unset($params_base['page']);

    $lien = function(int $p) use ($params_base) {
        $params_base['page'] = $p;
        return '?' . http_build_query($params_base);
    };

    $cur = (int) $pg['page'];
    $max = (int) $pg['pages'];

    echo '<nav class="pagination" style="display:flex;gap:.3rem;justify-content:center;margin:1.5rem 0;flex-wrap:wrap;">';

    // Précédent
    if ($cur > 1) {
        echo '<a href="' . e($lien($cur - 1)) . '" class="btn btn-sm btn-secondary">‹ Précédent</a>';
    }

    // Pages (fenêtre glissante)
    $start = max(1, $cur - 2);
    $end   = min($max, $cur + 2);
    if ($start > 1) {
        echo '<a href="' . e($lien(1)) . '" class="btn btn-sm btn-secondary">1</a>';
        if ($start > 2) echo '<span style="padding:.4rem;">…</span>';
    }
    for ($i = $start; $i <= $end; $i++) {
        if ($i === $cur) {
            echo '<span class="btn btn-sm btn-primary" style="pointer-events:none;">' . $i . '</span>';
        } else {
            echo '<a href="' . e($lien($i)) . '" class="btn btn-sm btn-secondary">' . $i . '</a>';
        }
    }
    if ($end < $max) {
        if ($end < $max - 1) echo '<span style="padding:.4rem;">…</span>';
        echo '<a href="' . e($lien($max)) . '" class="btn btn-sm btn-secondary">' . $max . '</a>';
    }

    // Suivant
    if ($cur < $max) {
        echo '<a href="' . e($lien($cur + 1)) . '" class="btn btn-sm btn-secondary">Suivant ›</a>';
    }
    echo '<span style="margin:.4rem .75rem;color:var(--text-muted);font-size:.85rem;">';
    echo e($pg['total']) . ' résultats';
    echo '</span>';
    echo '</nav>';
}
