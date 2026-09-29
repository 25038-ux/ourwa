import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ROLES } from '@elourwa/db/seed-roles';
import { PermissionsGuard } from '../src/auth/permissions.guard.js';
import { PaymentMethodsController } from '../src/finance/finance.controller.js';

/**
 * QUI LIT LA LISTE DES MOYENS DE PAIEMENT — décision du propriétaire,
 * 2026-09-29 : « secretaries can read the list ».
 *
 * La fenêtre d'encaissement qui suit une inscription ou une réinscription
 * (`POST /finance/caisse/encaissement`, ouverte à `scolarite.inscrire` et
 * `scolarite.reinscrire`) a besoin de la liste des moyens pour proposer
 * « Espèces », « Bankily »… Sans `finance.*`, la secrétaire lisait « aucun moyen
 * de paiement configuré » et ne pouvait rien encaisser à l'inscription, dans
 * toutes les écoles.
 *
 * Lire, seulement : ajouter ou désactiver un moyen reste à la direction.
 * Le vrai garde, sur les vraies métadonnées de la route, avec les vraies
 * permissions de chaque rôle (`seed-roles.ts`).
 */

const guard = new PermissionsGuard(new Reflector());

function peut(role: string, methode: 'list' | 'add' | 'toggle'): boolean {
  const def = ROLES.find((r) => r.code === role);
  if (!def) throw new Error(`Rôle inconnu : ${role}`);
  const contexte = {
    getHandler: () => PaymentMethodsController.prototype[methode],
    getClass: () => PaymentMethodsController,
    switchToHttp: () => ({
      getRequest: () => ({
        auth: { userId: 'u', schoolId: 's', roles: [role], permissions: [...def.perms], impersonated: false },
      }),
    }),
  } as never;
  try {
    return guard.canActivate(contexte);
  } catch {
    return false;
  }
}

describe('la liste des moyens de paiement', () => {
  it('⚠ la secrétaire la lit — elle encaisse à l’inscription et à la réinscription', () => {
    expect(peut('secretaire', 'list')).toBe(true);
  });

  // L'administrateur n'a aucun `finance.*`, mais il inscrit et réinscrit :
  // même raison que la secrétaire.
  it('la caisse et la direction la lisent', () => {
    expect(peut('comptable', 'list')).toBe(true);
    expect(peut('super_admin', 'list')).toBe(true);
    expect(peut('admin', 'list')).toBe(true);
  });

  it('ceux qui n’encaissent jamais ne la lisent pas', () => {
    expect(peut('professeur', 'list')).toBe(false);
    expect(peut('collecteur_absence', 'list')).toBe(false);
    expect(peut('parent', 'list')).toBe(false);
  });

  it('⚠ lire n’est pas gérer : ni la secrétaire ni le comptable n’ajoutent ou ne désactivent un moyen', () => {
    for (const role of ['secretaire', 'comptable']) {
      expect(peut(role, 'add'), `${role} ajoute`).toBe(false);
      expect(peut(role, 'toggle'), `${role} désactive`).toBe(false);
    }
    expect(peut('super_admin', 'add')).toBe(true);
  });
});
