<?php
require_once __DIR__ . '/config.php';

/**
 * Connexion PDO unique pour toute la requête.
 */
function db(): PDO
{
    static $pdo = null;

    if ($pdo === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);
        } catch (PDOException $e) {
            http_response_code(500);
            $detail = MODE_DEBUG ? '<pre>' . htmlspecialchars($e->getMessage()) . '</pre>' : '';
            exit('<p style="font:16px sans-serif;padding:2rem">Connexion à la base impossible. '
               . 'Vérifiez les paramètres dans <code>includes/config.php</code>.</p>' . $detail);
        }
    }
    return $pdo;
}

/** Raccourci : exécute une requête préparée et renvoie le statement. */
function requete(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st;
}

function ligne(string $sql, array $params = []): ?array
{
    $r = requete($sql, $params)->fetch();
    return $r === false ? null : $r;
}

function valeur(string $sql, array $params = [])
{
    return requete($sql, $params)->fetchColumn();
}
