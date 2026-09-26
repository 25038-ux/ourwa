<?php
require_once __DIR__ . '/auth.php';

/* ---------- Affichage ---------- */

function e($texte): string
{
    return htmlspecialchars((string) $texte, ENT_QUOTES, 'UTF-8');
}

const ETATS = [
    'en_service'    => 'En service',
    'en_panne'      => 'En panne',
    'en_reparation' => 'En réparation',
    'reforme'       => 'Réformé',
];

const TYPES_MOUVEMENT = [
    'entree'      => 'Entrée en inventaire',
    'affectation' => 'Affectation',
    'transfert'   => 'Transfert',
    'etat'        => "Changement d'état",
];

function libelle_etat(?string $etat): string
{
    return ETATS[$etat] ?? '—';
}

/** Pastille d'état utilisée dans les tableaux. */
function badge_etat(string $etat): string
{
    return '<span class="etat etat--' . e($etat) . '">' . e(libelle_etat($etat)) . '</span>';
}

/** Numéro d'inventaire affiché comme une petite étiquette. */
function etiquette(string $numero): string
{
    return '<span class="tag-inv">' . e($numero) . '</span>';
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
              'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

// On évite l'extension intl qui n'est pas toujours activée chez les hébergeurs gratuits
function date_fr(?string $date, bool $avec_heure = false): string
{
    if (!$date) return '—';
    $t = strtotime($date);
    $txt = date('j', $t) . ' ' . MOIS[date('n', $t) - 1] . ' ' . date('Y', $t);
    if ($avec_heure) $txt .= ' à ' . date('H\hi', $t);
    return $txt;
}

function date_courte(?string $date): string
{
    return $date ? date('d/m/Y', strtotime($date)) : '—';
}

function aujourdhui_fr(): string
{
    return ucfirst(JOURS[date('w')]) . ' ' . date('j') . ' ' . MOIS[date('n') - 1] . ' ' . date('Y');
}

/** "il y a 3 jours", "hier"... pour les listes récentes. */
function il_y_a(string $date): string
{
    $jours = (int) floor((strtotime(date('Y-m-d')) - strtotime(date('Y-m-d', strtotime($date)))) / 86400);
    if ($jours <= 0) return "aujourd'hui, " . date('H\hi', strtotime($date));
    if ($jours === 1) return 'hier';
    if ($jours < 30) return "il y a $jours jours";
    if ($jours < 365) return 'il y a ' . round($jours / 30) . ' mois';
    return date_courte($date);
}

function initiales(string $nom): string
{
    $mots = preg_split('/\s+/', trim($nom));
    $i = mb_substr($mots[0], 0, 1);
    if (count($mots) > 1) $i .= mb_substr(end($mots), 0, 1);
    return mb_strtoupper($i);
}

/* ---------- Formulaires & navigation ---------- */

function csrf_jeton(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
    }
    return $_SESSION['csrf'];
}

function champ_csrf(): string
{
    return '<input type="hidden" name="csrf" value="' . csrf_jeton() . '">';
}

function verifier_csrf(): void
{
    if (!hash_equals(csrf_jeton(), $_POST['csrf'] ?? '')) {
        http_response_code(400);
        exit('Formulaire expiré, veuillez recharger la page.');
    }
}

function flash(string $message, string $type = 'ok'): void
{
    $_SESSION['flash'][] = ['msg' => $message, 'type' => $type];
}

function rediriger(string $url): void
{
    header('Location: ' . $url);
    exit;
}

function est_post(): bool
{
    return $_SERVER['REQUEST_METHOD'] === 'POST';
}

/** Récupère un champ texte POST nettoyé (null si vide). */
function post(string $cle): ?string
{
    $v = trim((string) ($_POST[$cle] ?? ''));
    return $v === '' ? null : $v;
}

/** Garde les paramètres GET actuels en modifiant certains (liens de pagination/tri). */
function url_avec(array $modifs): string
{
    $q = array_merge($_GET, $modifs);
    $q = array_filter($q, fn($v) => $v !== null && $v !== '');
    return '?' . http_build_query($q);
}

function pagination(int $total, int $page, int $par_page = PAR_PAGE): string
{
    $nb = (int) ceil($total / $par_page);
    if ($nb <= 1) return '';

    $html = '<nav class="pagination" aria-label="Pages">';
    if ($page > 1) $html .= '<a href="' . e(url_avec(['page' => $page - 1])) . '">&larr; Précédent</a>';
    $html .= '<span class="pagination__info">Page ' . $page . ' sur ' . $nb . '</span>';
    if ($page < $nb) $html .= '<a href="' . e(url_avec(['page' => $page + 1])) . '">Suivant &rarr;</a>';
    return $html . '</nav>';
}

/* ---------- Métier ---------- */

/** Ajoute une ligne dans l'historique des mouvements. */
function journaliser(int $materiel_id, string $type, array $d = []): void
{
    requete(
        'INSERT INTO mouvements (materiel_id, type, direction_depart_id, direction_arrivee_id,
                                 etat_avant, etat_apres, observation, utilisateur_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
            $materiel_id, $type,
            $d['depart'] ?? null, $d['arrivee'] ?? null,
            $d['etat_avant'] ?? null, $d['etat_apres'] ?? null,
            $d['observation'] ?? null,
            utilisateur()['id'] ?? null,
        ]
    );
}

function liste_directions(): array
{
    return requete('SELECT id, code, nom FROM directions ORDER BY nom')->fetchAll();
}

function liste_categories(): array
{
    return requete('SELECT id, nom, prefixe FROM categories ORDER BY nom')->fetchAll();
}

/**
 * L'utilisateur peut-il agir sur un matériel de cette direction ?
 * L'admin peut tout faire, un responsable seulement dans sa direction.
 */
function peut_gerer(?int $direction_id): bool
{
    if (est_admin()) return true;
    return $direction_id !== null && $direction_id === ma_direction();
}

/** Nombre de transferts qui attendent une action de l'utilisateur connecté. */
function transferts_a_traiter(): int
{
    if (est_admin()) {
        return (int) valeur("SELECT COUNT(*) FROM transferts WHERE statut = 'en_attente'");
    }
    $d = ma_direction();
    if (!$d) return 0;
    return (int) valeur(
        "SELECT COUNT(*) FROM transferts
          WHERE statut = 'en_attente'
            AND ((direction_depart_id = ? AND valide_depart_par IS NULL)
              OR (direction_arrivee_id = ? AND valide_arrivee_par IS NULL))",
        [$d, $d]
    );
}

/* ---------- Icônes (SVG en ligne, trait de 1.6px) ---------- */

function icone(string $nom, int $taille = 18): string
{
    $chemins = [
        'tableau'    => '<path d="M3 13h7V3H3zM14 21h7V11h-7zM3 21h7v-4H3zM14 7h7V3h-7z"/>',
        'boite'      => '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
        'fleches'    => '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>',
        'horloge'    => '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
        'batiment'   => '<path d="M4 21V5l8-2v18M12 8h8v13M8 9h.01M8 13h.01M8 17h.01M16 12h.01M16 16h.01M2.5 21h19"/>',
        'etiquette'  => '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
        'personnes'  => '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.3 6-5.3s5.4 1.9 6 5.3M16 5.2a3 3 0 0 1 0 5.6M18 14.9c1.6.7 2.7 2.4 3 5.1"/>',
        'sortie'     => '<path d="M14 4h5v16h-5M10 16l4-4-4-4M14 12H4"/>',
        'plus'       => '<path d="M12 5v14M5 12h14"/>',
        'recherche'  => '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
        'crayon'     => '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
        'poubelle'   => '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
        'coche'      => '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
        'croix'      => '<path d="M6 6l12 12M18 6 6 18"/>',
        'cle'        => '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
        'imprimer'   => '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>',
        'menu'       => '<path d="M4 7h16M4 12h16M4 17h16"/>',
        'alerte'     => '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
        'retour'     => '<path d="M10 6 4 12l6 6M4 12h16"/>',
    ];
    $p = $chemins[$nom] ?? '';
    return '<svg class="ico" width="' . $taille . '" height="' . $taille . '" viewBox="0 0 24 24" fill="none" '
         . 'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
         . $p . '</svg>';
}

/* ---------- Historique ---------- */

// Requête de base réutilisée par le tableau de bord, la fiche et l'historique
const SQL_MOUVEMENTS = "
    SELECT mv.*, m.numero_inventaire, m.designation,
           dd.code AS dep_code, dd.nom AS dep_nom,
           da.code AS arr_code, da.nom AS arr_nom,
           u.nom_complet AS auteur
      FROM mouvements mv
      JOIN materiels m        ON m.id  = mv.materiel_id
      LEFT JOIN directions dd ON dd.id = mv.direction_depart_id
      LEFT JOIN directions da ON da.id = mv.direction_arrivee_id
      LEFT JOIN utilisateurs u ON u.id = mv.utilisateur_id";

/** Résumé lisible d'un mouvement, ex. « DAF → DSI ». Renvoie du HTML échappé. */
function resume_mouvement(array $mv): string
{
    switch ($mv['type']) {
        case 'entree':
            return 'Entrée en inventaire' . ($mv['arr_nom'] ? ' — ' . e($mv['arr_nom']) : ' — magasin central');
        case 'affectation':
            return 'Affecté à <strong>' . e($mv['arr_nom'] ?? '?') . '</strong>';
        case 'transfert':
            return '<strong>' . e($mv['dep_code'] ?? '?') . '</strong> <span class="fleche">→</span> <strong>'
                 . e($mv['arr_code'] ?? '?') . '</strong>';
        case 'etat':
            return e(libelle_etat($mv['etat_avant'])) . ' <span class="fleche">→</span> ' . badge_etat($mv['etat_apres']);
    }
    return '';
}
