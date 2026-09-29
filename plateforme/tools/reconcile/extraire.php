<?php
/**
 * EL OURWA CALCULE SES PROPRES BULLETINS, ET LES ÉCRIT EN JSON.
 *
 * ⚠ On appelle SON code — `bulletin_donnees()` de `includes/bulletin.php` — sur
 * SA base. Transcrire son arithmétique dans le vérificateur reviendrait à tester
 * ma transcription ; ici c'est bien lui qui produit les nombres.
 *
 * Sortie : une ligne JSON par (élève, trimestre), avec la moyenne de chaque
 * matière et la moyenne générale, en CHAÎNES — jamais en flottants (règle 25).
 *
 * Lecture seule de bout en bout (règle 22).
 */

// Le bootstrap veut une session et un utilisateur ; en CLI il n'y en a pas.
if (session_status() === PHP_SESSION_NONE) {
    @session_start();
}
$_SESSION['utilisateur_id'] = 1;
$_SESSION['role'] = 'super_admin';
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
$_SERVER['HTTP_USER_AGENT'] = 'reconcile-cli';
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['SCRIPT_NAME'] = '/cli';

/**
 * ⚠ IL VIT ICI, PAS DANS `reference/`. El Ourwa est en lecture seule pour
 * toujours (règle 22) — y déposer un script, même inoffensif, entame la règle.
 * Le chemin remonte donc jusqu'à sa copie de référence sans rien y écrire.
 */
$racine = __DIR__ . '/../../reference/v16/src';
require_once $racine . '/includes/bootstrap.php';
require_once $racine . '/includes/bulletin.php';
require_once $racine . '/includes/bulletin_admission.php';

$db = getDB();

// L'année à réconcilier : celle qui porte des notes.
$annee = (int) ($argv[1] ?? 0);
if (!$annee) {
    // ⚠ `annee_notes` est l'ANNÉE CIVILE de début (`annees_scolaires.annee_debut`),
    // pas l'`annee_id`. Le passer en id rend des bulletins vides sans erreur :
    // `etudiant_inscriptions.annee` porte la même convention.
    $annee = (int) $db->query(
        'SELECT a.annee_debut FROM notes n JOIN annees_scolaires a ON a.id = n.annee_id
          GROUP BY a.annee_debut ORDER BY COUNT(*) DESC LIMIT 1'
    )->fetchColumn();
}

$limite = (int) ($argv[2] ?? 0);

// Tout élève ayant au moins une note sur cette année.
$sql = 'SELECT DISTINCT n.etudiant_id FROM notes n
          JOIN annees_scolaires a ON a.id = n.annee_id
         WHERE a.annee_debut = :a ORDER BY n.etudiant_id';
if ($limite > 0) $sql .= ' LIMIT ' . $limite;
$st = $db->prepare($sql);
$st->execute([':a' => $annee]);
$eleves = $st->fetchAll(PDO::FETCH_COLUMN);

fwrite(STDERR, "annee=$annee eleves=" . count($eleves) . "\n");

foreach ($eleves as $eid) {
    for ($t = 1; $t <= 3; $t++) {
        bulletin_memo_vider();
        $d = @bulletin_donnees($db, (int) $eid, $t, $annee);
        if (!$d) continue;
        extract($d);

        $matieres = [];
        foreach (($bulletin_rows ?? []) as $r) {
            $matieres[] = [
                'matiere'  => $r['matiere_nom'],
                'coef'     => (string) $r['coefficient'],
                'note_sur' => (string) $r['note_sur'],
                'devoirs'  => array_map(static fn($v) => number_format((float) $v, 2, '.', ''),
                                        $r['devoirs'] ?? []),
                'examen'   => $r['examen'] === null
                                ? null : number_format((float) $r['examen'], 2, '.', ''),
                'moyenne'  => $r['moyenne'] === null
                                ? null : number_format((float) $r['moyenne'], 2, '.', ''),
            ];
        }

        echo json_encode([
            'eleve'     => (int) $eid,
            'trimestre' => $t,
            'fondamental' => !empty($est_fondamental),
            'formule'   => [
                'd' => number_format((float) ($F_bul['d'] ?? 2), 2, '.', ''),
                'e' => number_format((float) ($F_bul['e'] ?? 3), 2, '.', ''),
                'q' => number_format((float) ($F_bul['q'] ?? 5), 2, '.', ''),
            ],
            'matieres'  => $matieres,
            'moyenne_generale' => isset($moyenne_generale) && $moyenne_generale !== null
                ? number_format((float) $moyenne_generale, 2, '.', '') : null,
            'fond_pts'  => isset($fond_pts) ? number_format((float) $fond_pts, 2, '.', '') : null,
            'fond_sur'  => isset($fond_sur) ? number_format((float) $fond_sur, 2, '.', '') : null,
        ], JSON_UNESCAPED_UNICODE), "\n";
    }
}
