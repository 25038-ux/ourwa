<?php
/**
 * Fonctions de nettoyage et d'échappement des données
 * Protection contre les injections XSS — toute sortie HTML PASSE par e()
 */

/**
 * Échapper une chaîne pour l'affichage HTML.
 */
function e(?string $valeur): string {
    if ($valeur === null) return '';
    return htmlspecialchars($valeur, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

/**
 * Nettoyer une entrée utilisateur (texte libre).
 * NOTE: on n'utilise PAS stripslashes() — magic_quotes_gpc a été supprimé en PHP 5.4.
 */
function nettoyer(string $valeur): string {
    // Retirer caractères de contrôle invisibles + espaces de bord
    $valeur = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $valeur);
    return trim($valeur);
}

/**
 * Nettoyer et valider un entier.
 */
function nettoyer_entier($valeur): ?int {
    $valeur = filter_var($valeur, FILTER_VALIDATE_INT);
    return $valeur !== false ? $valeur : null;
}

/**
 * Nettoyer et valider un nombre décimal.
 */
function nettoyer_decimal($valeur): ?float {
    $valeur = filter_var($valeur, FILTER_VALIDATE_FLOAT);
    return $valeur !== false ? $valeur : null;
}

/**
 * Nettoyer un numéro de téléphone (chiffres, espaces, +, -, parenthèses).
 */
function nettoyer_telephone(string $telephone): string {
    return trim(preg_replace('/[^\d\s\+\-\(\)]/', '', $telephone));
}

/**
 * Valider la syntaxe d'un identifiant (email-like ou alphanumérique étendu).
 */
function valider_identifiant(string $identifiant): bool {
    $longueur_ok = strlen($identifiant) >= 3 && strlen($identifiant) <= 100;
    $caracteres_ok = (bool) preg_match('/^[a-zA-Z0-9._@\-]+$/', $identifiant);
    return $longueur_ok && $caracteres_ok;
}

/**
 * Évaluer la robustesse d'un mot de passe.
 * Renvoie un message d'erreur si insuffisant, '' sinon.
 */
function valider_mot_de_passe(string $mdp): string {
    $min = PASSWORD_MIN_LENGTH;
    if (strlen($mdp) < $min) {
        return "Le mot de passe doit contenir au moins {$min} caractères.";
    }
    $checks = 0;
    if (preg_match('/[a-z]/', $mdp)) $checks++;
    if (preg_match('/[A-Z]/', $mdp)) $checks++;
    if (preg_match('/\d/',    $mdp)) $checks++;
    if (preg_match('/[^a-zA-Z0-9]/', $mdp)) $checks++;
    if ($checks < 3) {
        return "Le mot de passe doit combiner au moins 3 types de caractères (minuscules, majuscules, chiffres, symboles).";
    }
    return '';
}
