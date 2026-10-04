import { describe, expect, it } from 'vitest';
import { ROLES } from '@elourwa/db/seed-roles';

/**
 * QUI PEUT QUOI — `includes/permissions.php`, its `$legacy` table.
 *
 * ⚠ THE CATALOGUE MATCHED AND THE GRANTS DID NOT. All 24 permission names are
 * identical to theirs, which made it look settled; four of the six roles were
 * carrying a different set of them.
 *
 * These are authorisation decisions, so they are asserted rather than eyeballed.
 * A grant that drifts is not a cosmetic difference: it is somebody able to do
 * something the school did not decide they could.
 */

/**
 * El Ourwa's `$legacy`, transcribed — **plus its later migrations**.
 *
 * ⚠ `$legacy` IS NOT THE WHOLE LIST. It is the catalogue as of v13; v15 adds a
 * twenty-fifth permission by migration, not by editing that array:
 * `MIGRATION_v15_parent_scope.sql` grants `derogations.gerer` to super_admin and
 * admin, with its reason written out — "Ni comptable, ni secretaire : lorsqu'une
 * dette est soldee la porte s'ouvre d'elle-meme … Une derogation est une
 * exception a la politique de l'ecole — une decision de direction, pas de
 * caisse."
 *
 * Transcribing only `$legacy` made this table disagree with the running system.
 * When adding a permission, check the migrations as well as the array.
 */
const THEIRS: Record<string, string[]> = {
  admin: [
    'scolarite.inscrire', 'scolarite.reinscrire', 'scolarite.groupes', 'scolarite.niveaux',
    'notes.saisir', 'notes.consulter', 'absences.saisir', 'absences.consulter',
    'comptes.parents', 'comptes.professeurs', 'annees.gerer', 'messagerie.envoyer',
    'exercices.envoyer', 'demandes.traiter', 'statistiques.consulter',
    'recherche.globale', 'journal.consulter', 'derogations.gerer',
    // Pas chez El Ourwa : les documents signés de Jinan (0048, ADR-0080).
    'documents.gerer',
  ],
  comptable: [
    'finance.consulter', 'finance.encaisser', 'finance.depenser', 'finance.dette',
    'finance.rapport', 'scolarite.inscrire', 'scolarite.reinscrire',
    'demandes.traiter', 'recherche.globale',
  ],
  secretaire: [
    'scolarite.inscrire', 'scolarite.reinscrire', 'notes.saisir', 'notes.consulter',
    'comptes.parents', 'messagerie.envoyer', 'recherche.globale', 'demandes.traiter',
    'documents.gerer', // 0048, ADR-0080 — le dossier d'inscription signé
  ],
  collecteur_absence: ['absences.saisir', 'absences.consulter'],
};

const ours = (code: string): string[] =>
  [...(ROLES.find((r) => r.code === code)?.perms ?? [])].sort();

describe('the grants match El Ourwa role for role', () => {
  for (const [role, expected] of Object.entries(THEIRS)) {
    it(`${role} holds exactly its permissions`, () => {
      expect(ours(role)).toEqual([...expected].sort());
    });
  }
});

describe('the ones worth naming', () => {
  it('⚠ the accountant does NOT pay salaries', () => {
    // `finance.salaires` is super_admin's alone. We had granted it to the
    // accountant, which puts paying the staff in the same hands that take the
    // money in — the separation the school drew, undrawn.
    expect(ours('comptable')).not.toContain('finance.salaires');
    expect(ours('super_admin')).toContain('finance.salaires');
  });

  it('⚠ the accountant CAN search and handle requests', () => {
    // Both were missing. An accountant who cannot search cannot find the family
    // standing at the counter.
    expect(ours('comptable')).toContain('recherche.globale');
    expect(ours('comptable')).toContain('demandes.traiter');
  });

  it('⚠ the secretary can reach parents, message them and search', () => {
    // Ours had a secretary who could enrol a child and then not look them up,
    // not open the family record, and not write to them.
    for (const p of [
      'comptes.parents',
      'messagerie.envoyer',
      'recherche.globale',
      'demandes.traiter',
    ]) {
      expect(ours('secretaire')).toContain(p);
    }
  });

  it('⚠ the administrator enters marks and absences', () => {
    expect(ours('admin')).toContain('notes.saisir');
    expect(ours('admin')).toContain('absences.saisir');
  });

  it('⚠ a derogation is the direction’s, and the seed used to delete it', () => {
    // `derogations.gerer` was added by our migration 0010 and never added to
    // `seed-roles.ts` — and the seed TRUNCATEs `role_permissions` before
    // re-inserting from that list. Every `pnpm seed` therefore deleted it, and
    // the Dérogations page was closed to EVERY role, super administrateur
    // included, in every seeded environment.
    expect(ours('super_admin')).toContain('derogations.gerer');
    expect(ours('admin')).toContain('derogations.gerer');
    // Not the till's: when a debt is settled the door opens by itself.
    expect(ours('comptable')).not.toContain('derogations.gerer');
    expect(ours('secretaire')).not.toContain('derogations.gerer');
  });

  it('⚠ only the super administrator adds staff', () => {
    // `comptes.staff` is not in its admin list. Hiring is the direction's.
    expect(ours('admin')).not.toContain('comptes.staff');
    expect(ours('super_admin')).toContain('comptes.staff');
  });

  it('⚠ a teacher still does NOT enter grades — ADR-0005 stands', () => {
    // Its table grants `notes.saisir` to professeur, but `professeur/
    // saisir_notes.php` performs no write in v16: the permission is vestigial.
    // Granting it here would hand teachers a capability the reference does not
    // actually offer, which is "more", not "the same".
    expect(ours('professeur')).not.toContain('notes.saisir');
    expect(ours('professeur')).toContain('notes.consulter');
  });

  it('the super administrator holds the whole catalogue', () => {
    const everything = new Set(ROLES.flatMap((r) => r.perms as readonly string[]));
    for (const p of everything) {
      if (p === 'derogations.gerer') continue; // ours, added with the feature
      expect(ours('super_admin')).toContain(p);
    }
  });

  it('⚠ les documents signés : la direction et le secrétariat, ni la caisse ni le professeur', () => {
    for (const r of ['super_admin', 'admin', 'secretaire']) expect(ours(r)).toContain('documents.gerer');
    for (const r of ['comptable', 'professeur', 'collecteur_absence', 'parent']) expect(ours(r)).not.toContain('documents.gerer');
  });

  it('a parent holds none', () => {
    expect(ours('parent')).toEqual([]);
  });
});

/**
 * ⚠ A PERMISSION IS NOT ALWAYS THE RULE, AND CORRECTING THE GRANTS PROVED IT.
 *
 * `demandes.traiter` is granted to the accountant in El Ourwa's `$legacy` table
 * — it lets them REACH the requests page and raise one. Deciding is gated
 * separately, on the role: `$is_admin = in_array($role, ['super_admin',
 * 'admin'])`. Its own header says the split in words.
 *
 * We had gated the decision on the permission alone. Matching the grants to its
 * table therefore handed the accountant the power to approve their OWN expense
 * requests — a separation of duties the school drew, and one that a change
 * otherwise correct would have quietly removed.
 */
describe('raising a request and deciding one are different rights', () => {
  it('⚠ the accountant holds demandes.traiter — and must', () => {
    // Without it they cannot reach the page they exist to use.
    expect(ours('comptable')).toContain('demandes.traiter');
  });

  it('⚠ but holding it is not what permits a decision', async () => {
    // Read off the endpoint itself. Asserting a local array would only restate
    // the thing being tested — this fails if somebody removes the role gate.
    const { RequestsController } = await import('../src/comms/comms.controller.js');
    const { ROLE_KEY, PERMISSION_KEY } = await import('../src/auth/permissions.guard.js');
    const decide = RequestsController.prototype.decide;

    const roles = Reflect.getMetadata(ROLE_KEY, decide) as string[] | undefined;
    const perms = Reflect.getMetadata(PERMISSION_KEY, decide) as string[] | undefined;

    expect(perms).toContain('demandes.traiter');
    expect(roles).toEqual(['super_admin', 'admin']);
    expect(roles).not.toContain('comptable');
  });

  it('the secretary holds it too, and equally cannot decide', () => {
    expect(ours('secretaire')).toContain('demandes.traiter');
  });
});

describe('réinitialiser un mot de passe', () => {
  /**
   * ⚠ AU SUPER ADMINISTRATEUR SEUL, ET C'EST UNE DÉCISION DU PROPRIÉTAIRE
   * (2026-09-04), plus stricte que les deux états qui l'ont précédée.
   *
   * Avant : trois permissions — `comptes.staff`, `comptes.professeurs`,
   * `comptes.parents` — que le secrétariat et la comptabilité détiennent ; et à
   * côté, un libre-service « Mot de passe oublié ? » qui n'exigeait personne du
   * tout et postait un lien à qui saisissait un identifiant.
   *
   * Plus strict qu'El Ourwa aussi, qui ouvre `reinitialiser_mdp.php` à
   * `require_staff_admin()` — super_admin OU admin.
   *
   * Lu sur l'endpoint plutôt que sur une liste écrite ici : ce test tombe si
   * quelqu'un retire le garde, ce qu'une constante locale ne ferait pas.
   */
  it('⚠ un secrétaire détient la permission et ne peut toujours pas', async () => {
    const { AccountsController } = await import('../src/accounts/accounts.controller.js');
    const { ROLE_KEY, PERMISSION_KEY } = await import('../src/auth/permissions.guard.js');
    const reset = AccountsController.prototype.reset;

    const roles = Reflect.getMetadata(ROLE_KEY, reset) as string[] | undefined;
    const perms = Reflect.getMetadata(PERMISSION_KEY, reset) as string[] | undefined;

    // La permission est bien détenue par d'autres…
    expect(ours('secretaire')).toContain('comptes.parents');
    expect(perms).toContain('comptes.parents');
    // …et le rôle referme la porte derrière elle.
    expect(roles).toEqual(['super_admin']);
  });

  it('⚠ il n’existe plus aucune route publique de réinitialisation', async () => {
    // Le libre-service est parti avec son service. Une route qui reviendrait
    // sans être remarquée rouvrirait exactement ce que cette décision ferme.
    const { AuthController } = await import('../src/auth/auth.controller.js');
    const methods = Object.getOwnPropertyNames(AuthController.prototype);
    expect(methods).not.toContain('forgot');
    expect(methods).not.toContain('reset');
  });
});
