<?php
/**
 * Gestion sécurisée des téléversements de fichiers (images & PDF).
 *
 * Stratégie de défense en profondeur :
 *   1. Vérification de la taille (anti-DoS)
 *   2. Vérification MIME via finfo (lit les octets réels du fichier)
 *   3. Vérification des "magic bytes" (signatures binaires)
 *   4. Whitelist d'extensions
 *   5. Nom de fichier généré aléatoirement (anti-écrasement, anti-path-traversal)
 *   6. Stockage hors document_root impossible ici (XAMPP),
 *      donc le dossier /uploads/ est protégé par .htaccess (php_flag engine off + FilesMatch deny)
 */

const UPLOAD_MAX_BYTES        = 5 * 1024 * 1024;          // 5 MB
const UPLOAD_DIR_EXERCICES    = __DIR__ . '/../uploads/exercices';
const UPLOAD_URL_EXERCICES    = '/uploads/exercices';

const UPLOAD_TYPES_AUTORISES = [
    'image/jpeg' => ['jpg', 'jpeg'],
    'image/png'  => ['png'],
    'image/webp' => ['webp'],
    'image/gif'  => ['gif'],
    'application/pdf' => ['pdf'],
];

// Magic bytes (premiers octets d'un fichier valide de ce type)
const UPLOAD_MAGIC_BYTES = [
    'image/jpeg' => ["\xFF\xD8\xFF"],
    'image/png'  => ["\x89PNG\r\n\x1A\n"],
    'image/gif'  => ['GIF87a', 'GIF89a'],
    'image/webp' => ['RIFF'],                  // suivi de "WEBP" en offset 8
    'application/pdf' => ['%PDF-'],
];

/**
 * Valide et déplace un fichier téléversé.
 *
 * @param array  $fichier  Entrée de $_FILES['xxx'] (un seul fichier)
 * @param string $dossier  Dossier de destination (absolu)
 * @return array{ok:bool, message:string, chemin?:string, url?:string, nom?:string, mime?:string, taille?:int}
 */
function valider_et_deplacer_upload(array $fichier, string $dossier = UPLOAD_DIR_EXERCICES): array
{
    // 1. Vérification de base
    if (!isset($fichier['error']) || is_array($fichier['error'])) {
        return ['ok' => false, 'message' => 'Paramètre de fichier invalide.'];
    }

    if ($fichier['error'] !== UPLOAD_ERR_OK) {
        $msg = match ($fichier['error']) {
            UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'Fichier trop volumineux (max ' . (UPLOAD_MAX_BYTES / 1024 / 1024) . ' MB).',
            UPLOAD_ERR_PARTIAL    => 'Le fichier n\'a été que partiellement téléversé.',
            UPLOAD_ERR_NO_FILE    => 'Aucun fichier reçu.',
            UPLOAD_ERR_NO_TMP_DIR => 'Dossier temporaire manquant sur le serveur.',
            UPLOAD_ERR_CANT_WRITE => 'Échec d\'écriture sur le disque.',
            default               => 'Erreur d\'upload inconnue.',
        };
        return ['ok' => false, 'message' => $msg];
    }

    // 2. Taille
    if ($fichier['size'] > UPLOAD_MAX_BYTES) {
        return ['ok' => false, 'message' => 'Fichier trop volumineux (max ' . (UPLOAD_MAX_BYTES / 1024 / 1024) . ' MB).'];
    }
    if ($fichier['size'] === 0) {
        return ['ok' => false, 'message' => 'Fichier vide.'];
    }

    // 3. MIME réel (lu depuis le contenu)
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime  = $finfo->file($fichier['tmp_name']);
    if ($mime === false || !isset(UPLOAD_TYPES_AUTORISES[$mime])) {
        return ['ok' => false, 'message' => 'Type de fichier non autorisé. Acceptés : JPG, PNG, WebP, GIF, PDF.'];
    }

    // 4. Extension
    $ext_originale = strtolower(pathinfo($fichier['name'], PATHINFO_EXTENSION));
    if (!in_array($ext_originale, UPLOAD_TYPES_AUTORISES[$mime], true)) {
        return ['ok' => false, 'message' => 'L\'extension du fichier ne correspond pas à son type réel.'];
    }

    // 5. Magic bytes (vérifier les premiers octets)
    $fp = fopen($fichier['tmp_name'], 'rb');
    if ($fp === false) {
        return ['ok' => false, 'message' => 'Impossible de lire le fichier.'];
    }
    $debut = fread($fp, 16);
    fclose($fp);
    $magic_ok = false;
    foreach (UPLOAD_MAGIC_BYTES[$mime] as $signature) {
        if (str_starts_with($debut, $signature)) {
            $magic_ok = true;
            break;
        }
    }
    if (!$magic_ok) {
        return ['ok' => false, 'message' => 'Le contenu du fichier ne correspond pas à un format valide.'];
    }
    // Cas spécial WebP : "RIFF" + 4 octets de taille + "WEBP"
    if ($mime === 'image/webp' && substr($debut, 8, 4) !== 'WEBP') {
        return ['ok' => false, 'message' => 'Fichier WebP invalide.'];
    }

    // 6. Préparer le dossier
    if (!is_dir($dossier)) {
        if (!mkdir($dossier, 0755, true) && !is_dir($dossier)) {
            return ['ok' => false, 'message' => 'Impossible de créer le dossier d\'upload.'];
        }
    }

    // 7. Nom aléatoire (anti-collision, anti-énumération, anti-path-traversal)
    $nom_securise = bin2hex(random_bytes(16)) . '.' . $ext_originale;
    $chemin_final = $dossier . '/' . $nom_securise;

    if (!move_uploaded_file($fichier['tmp_name'], $chemin_final)) {
        return ['ok' => false, 'message' => 'Échec du déplacement du fichier.'];
    }

    // 8. Permissions restrictives
    @chmod($chemin_final, 0644);

    return [
        'ok'      => true,
        'message' => 'Fichier accepté.',
        'chemin'  => $chemin_final,
        'url'     => UPLOAD_URL_EXERCICES . '/' . $nom_securise,
        'nom'     => preg_replace('/[^\w\s.-]/u', '', $fichier['name']),  // nom original sanitisé pour affichage
        'mime'    => $mime,
        'taille'  => (int) $fichier['size'],
    ];
}

/**
 * Renvoie une icône SVG selon le type MIME.
 */
function icone_fichier(string $mime): string
{
    if (str_starts_with($mime, 'image/')) {
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>';
    }
    if ($mime === 'application/pdf') {
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6M9 17h4"/></svg>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/></svg>';
}

/**
 * Formate une taille en octets en chaîne lisible.
 */
function formater_taille(int $octets): string
{
    if ($octets < 1024) return $octets . ' o';
    if ($octets < 1024 * 1024) return number_format($octets / 1024, 1, ',', ' ') . ' Ko';
    return number_format($octets / 1024 / 1024, 1, ',', ' ') . ' Mo';
}
