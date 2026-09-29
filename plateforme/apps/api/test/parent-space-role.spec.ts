import { beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { ParentController } from '../src/parent/parent.controller.js';
import { PermissionsGuard } from '../src/auth/permissions.guard.js';

/**
 * ⚠ L'ESPACE PARENT EST RÉSERVÉ AUX PARENTS — et un rôle seul doit compter.
 *
 * Deux défauts, trouvés en vérifiant l'application au navigateur et non dans
 * un test :
 *
 *   1. `/parent/children` répondait 200 à un compte du personnel. Une liste
 *      vide, mais aussi l'année en cours et le nom du compte sous « correspondant ».
 *      Chez El Ourwa l'espace parent est une session à part (`parent_auth.php`).
 *
 *   2. La cause : le garde rendait `true` dès qu'aucune PERMISSION n'était
 *      exigée, AVANT de regarder le rôle. `@RequireRole('parent')` posé seul
 *      était donc inerte — et l'espace parent est précisément l'endroit où il
 *      n'y a pas de permission à nommer, puisqu'un parent a un rôle, pas des
 *      droits.
 */

let guard: PermissionsGuard;
let parent: ParentController;

const SCHOOL = '11111111-1111-7111-8111-111111111111';

function allows(handler: string, roles: string[], permissions: string[] = []): boolean {
  const ctx = {
    getHandler: () => (parent as unknown as Record<string, unknown>)[handler],
    getClass: () => parent.constructor,
    switchToHttp: () => ({
      getRequest: () => ({
        auth: { userId: 'u', schoolId: SCHOOL, roles, permissions, impersonated: false },
      }),
    }),
  } as never;
  try {
    return guard.canActivate(ctx);
  } catch {
    return false;
  }
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  guard = new PermissionsGuard(moduleRef.get(Reflector));
  parent = moduleRef.get(ParentController);
});

describe('un rôle exigé seul est appliqué', () => {
  for (const handler of ['children', 'notifications', 'balance', 'registerDevice'] as const) {
    it(`${handler} : un parent entre`, () => {
      expect(allows(handler, ['parent'])).toBe(true);
    });

    it(`⚠ ${handler} : le directeur est refusé, malgré toutes ses permissions`, () => {
      expect(
        allows(handler, ['super_admin'], ['finance.consulter', 'notes.consulter', 'comptes.parents']),
      ).toBe(false);
    });

    it(`⚠ ${handler} : un compte sans rôle est refusé`, () => {
      expect(allows(handler, [])).toBe(false);
    });
  }
});
