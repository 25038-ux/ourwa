/**
 * QUI OUVRE LES PAGES DE NOTES DU SITE — ses gardes, rôle pour rôle (10/10/2026).
 *
 * Les pages `/notes/bulletin/[id]`, `/notes/bulletins/[groupe]` et
 * `/scolarite/notes` n'appelaient que `requireSession()` : un professeur les
 * ouvrait en tapant l'adresse et lisait les bulletins de toute l'école. Chez
 * lui la garde est un RÔLE, pas une permission — et `notes.consulter` ne peut
 * pas la remplacer, puisque le professeur la porte pour ses propres feuilles.
 *
 *   notes_etudiants.php, bulletins_classe.php : `require_staff_admin()`
 *                                               = `require_role(['super_admin', 'admin'])`
 *   saisir_notes.php : `require_role(['super_admin', 'admin', 'secretaire'])`
 *
 * `require_role()` compare à TOUS les rôles du compte (`array_intersect`) : un
 * seul rôle admis suffit. Ces fonctions doublent la garde de l'API, elles ne la
 * remplacent pas. Fichier sans dépendance : il se vérifie seul, hors de Next.
 */

interface PorteurDeRoles {
  roles: string[];
}

function porteUnDe(user: PorteurDeRoles | undefined, admis: readonly string[]): boolean {
  if (!user) return false;
  return user.roles.some((r) => admis.includes(r));
}

/** Son `require_staff_admin()` : « Notes & bulletins », le bulletin d'un élève, ceux d'une classe. */
export function peutVoirLesBulletins(user: PorteurDeRoles | undefined): boolean {
  return porteUnDe(user, ['super_admin', 'admin']);
}

/** Son `require_role(['super_admin', 'admin', 'secretaire'])` : « Saisir les notes » de toute l'école. */
export function peutSaisirLesNotesDeLEcole(user: PorteurDeRoles | undefined): boolean {
  return porteUnDe(user, ['super_admin', 'admin', 'secretaire']);
}
