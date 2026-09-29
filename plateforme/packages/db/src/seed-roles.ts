/**
 * QUI PEUT QUOI — El Ourwa's `$legacy` table in `includes/permissions.php`.
 *
 * ⚠ IN ITS OWN MODULE SO THE SEED AND THE TEST CANNOT DISAGREE. The catalogue
 * of 24 permission names matched theirs exactly, which made this look settled —
 * and four of the six roles were carrying a different set of them.
 */
/**
 * The 24 real permissions (PROJECT.md §2.2), plus `derogations.gerer` — 25.
 *
 * ⚠ `derogations.gerer` WAS ADDED BY MIGRATION 0010 AND NEVER ADDED HERE, and
 * the seed TRUNCATEs `role_permissions` before re-inserting from this list. So
 * every `pnpm seed` deleted it: the Dérogations page — the direction's only way
 * to lift an exam-results block for a family — was closed to every role,
 * including the super administrateur, in every seeded environment. Caught by
 * `permission-names.spec.ts`, which reads this list and every
 * `@RequirePermission` in the source.
 *
 * Data, never hardcoded logic.
 */
export const ROLES = [
  { code: 'super_admin', label: 'Super administrateur', description: 'Accès total, y compris la finance et les comptes.', order: 1, perms: [
    'absences.consulter', 'absences.saisir', 'annees.gerer', 'comptes.parents',
    'comptes.professeurs', 'comptes.staff', 'demandes.traiter', 'exercices.envoyer',
    'finance.consulter', 'finance.depenser', 'finance.dette', 'finance.encaisser',
    'finance.rapport', 'finance.salaires', 'journal.consulter', 'messagerie.envoyer',
    'notes.consulter', 'notes.saisir', 'recherche.globale', 'scolarite.groupes',
    'scolarite.inscrire', 'scolarite.niveaux', 'scolarite.reinscrire',
    'statistiques.consulter', 'derogations.gerer'] },
  // ⚠ `notes.saisir` and `absences.saisir` were missing, and `comptes.staff`
  // was here and is not in its list: hiring is the super administrator's alone.
  { code: 'admin', label: 'Administrateur', description: "Administration générale de l'école.", order: 2, perms: [
    'absences.consulter', 'absences.saisir', 'annees.gerer', 'comptes.parents',
    'comptes.professeurs', 'demandes.traiter', 'exercices.envoyer', 'journal.consulter',
    'messagerie.envoyer', 'notes.consulter', 'notes.saisir', 'recherche.globale',
    'scolarite.groupes', 'scolarite.inscrire', 'scolarite.niveaux',
    'scolarite.reinscrire', 'statistiques.consulter',
    // ⚠ DIRECTION ONLY, as migration 0010 says: super_admin and admin, NOT the
    // accountant and NOT the secretary. When a debt is settled the door opens by
    // itself, so the till needs no power of derogation to do its job. A
    // derogation is an exception to school policy — a decision of the direction.
    'derogations.gerer'] },
  /**
   * ⚠ NO `finance.salaires`. It is the super administrator's alone, and we had
   * granted it — putting the payment of staff in the same hands that take the
   * money in. That is a separation the school drew and we had undrawn.
   *
   * `recherche.globale` and `demandes.traiter` were missing: an accountant who
   * cannot search cannot find the family standing at the counter.
   */
  { code: 'comptable', label: 'Comptable', description: 'Caisse, dépenses, dettes, rapports financiers.', order: 10, perms: [
    'demandes.traiter', 'finance.consulter', 'finance.depenser', 'finance.dette',
    'finance.encaisser', 'finance.rapport', 'recherche.globale',
    'scolarite.inscrire', 'scolarite.reinscrire'] },
  // ⚠ Four missing. Ours had a secretary who could enrol a child and then not
  // look them up, not open the family record, and not write to the family.
  { code: 'secretaire', label: 'Secrétaire', description: 'Inscriptions, réinscriptions, notes, scolarité.', order: 11, perms: [
    'comptes.parents', 'demandes.traiter', 'messagerie.envoyer', 'notes.consulter',
    'notes.saisir', 'recherche.globale', 'scolarite.inscrire',
    'scolarite.reinscrire'] },
  { code: 'collecteur_absence', label: "Collecteur d'absence", description: 'Saisie et suivi des absences.', order: 12, perms: [
    'absences.consulter', 'absences.saisir'] },
  // Teachers deliberately do NOT hold notes.saisir — El Ourwa v13 removed grade
  // entry from teachers (ADR-0005). One grant flips it back.
  { code: 'professeur', label: 'Professeur', description: 'Classes, notes et exercices de ses enseignements.', order: 20, perms: [
    'absences.consulter', 'exercices.envoyer', 'notes.consulter'] },
  { code: 'parent', label: 'Parent', order: 30, perms: [] },
] as const;
