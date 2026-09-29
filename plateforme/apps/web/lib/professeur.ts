/**
 * `nom_professeur_affichable()` — `includes/referentiels.php`.
 *
 * La reprise a rattaché toutes les affectations importées à un enseignant
 * fictif « Enseignant (Historique) » : aucun nom de professeur n'existait dans
 * l'ancien logiciel. L'afficher n'apprend rien et laisse croire à un vrai
 * enseignant ; on renvoie une chaîne vide, et l'appelant n'affiche rien.
 */
export function nomProfesseurAffichable(prenom: string | null | undefined, nom: string | null | undefined): string {
  const complet = `${prenom ?? ''} ${nom ?? ''}`.trim();
  const plat = complet.replace(/[^a-zA-Zà-üÀ-Ü]/gu, '').toLowerCase();
  if (plat === '' || plat.includes('historique')) return '';
  return complet;
}
