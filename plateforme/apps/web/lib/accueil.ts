/**
 * SON `url_tableau_bord($role)` — la première page de chaque rôle :
 * super_admin / admin → le tableau de bord ; professeur → le sien ;
 * collecteur_absence → « Gérer l'absence » ; secretaire → « Saisir les
 * notes » ; comptable → « Finance ». Il décide sur le rôle PRINCIPAL ; nous
 * n'en avons pas, donc le plus large des rôles portés l'emporte.
 */
export function accueilParRole(roles: string[], plateforme = false): string {
  if (plateforme && roles.length === 0) return '/platform';
  if (roles.includes('super_admin') || roles.includes('admin')) return '/';
  if (roles.includes('professeur')) return '/prof';
  if (roles.includes('comptable')) return '/finance';
  if (roles.includes('secretaire')) return '/notes';
  if (roles.includes('collecteur_absence')) return '/scolarite/absence';
  return '/';
}

/** Le cookie éphémère qui rend l'identifiant saisi à la page après un refus. */
export const COOKIE_IDENTIFIANT_SAISI = 'elourwa_identifiant_saisi';
