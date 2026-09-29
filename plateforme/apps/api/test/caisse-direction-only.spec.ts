import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../src/auth/permissions.guard.js';

/**
 * CE QUI RELÈVE DE LA DIRECTION, PAS DE LA CAISSE.
 *
 * `gestion_caisse.php` l'énonce en tête de fichier, et c'est la seule règle
 * d'autorisation qu'El Ourwa prend la peine d'expliquer :
 *
 *   « Qui peut TOUCHER À LA DETTE : fixer un barème de frais, exempter une
 *     famille, retirer une exemption. Ces gestes changent ce que l'école
 *     réclame ; ils relèvent de l'administration, pas de la caisse. »
 *
 *   `$peut_administrer_frais = a_role('super_admin') || a_role('admin')`
 *
 * ⚠ ET IL LE FAIT PAR RÔLE, PAS PAR PERMISSION. `finance.dette` existe dans son
 * catalogue et il l'accorde bien au comptable — mais **la chaîne n'est vérifiée
 * nulle part** dans tout v16 : `grep -rn 'finance.dette'` ne trouve que sa
 * déclaration et sa distribution. Ce qui garde réellement ces gestes est le
 * rôle, doublé d'un refus nominatif du comptable action par action.
 *
 * ⚠ NOUS AVIONS RECOPIÉ LA DISTRIBUTION SANS L'APPLICATION. Nos grants sont
 * exacts (`role-grants.spec.ts` les tient), et nous nous en servions comme
 * garde : le comptable, qui détient `finance.dette`, pouvait donc exempter une
 * famille, baisser un tarif, accorder une remise et **annuler un paiement qu'il
 * venait d'encaisser**. C'est précisément la séparation que l'école a tracée.
 *
 * Ce fichier lit les décorateurs dans la source plutôt que d'appeler les routes :
 * ce qui dérive, c'est un décorateur oublié sur une route ajoutée plus tard, et
 * un test HTTP ne le verrait que pour les routes auxquelles on aurait pensé.
 */

const ici = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(ici, '..', 'src', p), 'utf8');

/**
 * Les routes qu'El Ourwa refuse au comptable, avec l'action qui le prouve.
 *
 * Chacune a été relue dans `gestion_caisse.php`, `cours_du_soir.php` ou
 * `dette.php` : soit elle porte `&& $peut_administrer_frais`, soit elle ouvre
 * sur `if (est_comptable()) { refus }`.
 */
const DIRECTION_SEULE: { fichier: string; route: string; sienne: string }[] = [
  // gestion_caisse.php — `if (est_comptable())` ou `&& $peut_administrer_frais`
  { fichier: 'finance/finance.controller.ts', route: "@Post('payments/:id/reverse')", sienne: 'annuler_paiement' },
  { fichier: 'finance/finance.controller.ts', route: "@Post('concessions/exemptions')", sienne: 'exemption_totale / exemption_mensuelle' },
  { fichier: 'finance/finance.controller.ts', route: "@Delete('concessions/exemptions/:id')", sienne: 'retirer_exemption' },
  { fichier: 'finance/finance.controller.ts', route: "@Post('concessions/monthly-fee')", sienne: 'modifier_frais_admin' },
  { fichier: 'finance/finance.controller.ts', route: "@Post('concessions/restore-month')", sienne: 'annuler_exemption_auto' },
  { fichier: 'finance/finance.controller.ts', route: "@Post('concessions/re-exempt-month')", sienne: 'retablir_exemption_auto' },
  { fichier: 'finance/finance.controller.ts', route: "@Post('concessions/discounts')", sienne: 'appliquer_reduction' },
  { fichier: 'finance/finance.controller.ts', route: "@Delete('concessions/discounts/:studentId/:year/:month')", sienne: 'retirer_reduction' },
  { fichier: 'finance/finance.controller.ts', route: "@Post('write-offs')", sienne: 'remise_dette' },
  { fichier: 'finance/finance.controller.ts', route: "@Post('write-offs/:id/revoke')", sienne: 'annuler_remise' },
  { fichier: 'finance/finance.controller.ts', route: "@Post('annual-fees/scale')", sienne: 'configurer_frais_annuels' },
  { fichier: 'finance/finance.controller.ts', route: "@Post('annual-fees/:guardianId/exempt')", sienne: 'exempter_frais_annuel' },
  { fichier: 'finance/finance.controller.ts', route: "@Post('annual-fees/:guardianId/remove-exemption')", sienne: 'retirer_exemption_frais_annuel' },
  { fichier: 'finance/finance.controller.ts', route: "@Post('misc-debts')", sienne: 'creer — le comptable dépose une demande' },
  { fichier: 'finance/finance.controller.ts', route: "@Post()", sienne: 'ajouter_moyen' },
  { fichier: 'finance/finance.controller.ts', route: "@Post(':id/toggle')", sienne: 'basculer_moyen' },
  // depenses.php — « La suppression d'une dépense est réservée à l'administration. »
  { fichier: 'finance/finance.controller.ts', route: "@Post(':id/reverse')", sienne: 'supprimer une dépense' },
  // cours_du_soir.php — `if (est_comptable())`
  { fichier: 'evening/evening.controller.ts', route: "@Post('discounts')", sienne: 'appliquer_reduction_cs' },
  { fichier: 'evening/evening.controller.ts', route: "@Delete('discounts/:enrolmentId/:year/:month')", sienne: 'retirer_reduction_cs' },
  // La facturation « services » (Jinan, ADR-0073, spec §4) — pas d'El Ourwa, la
  // même règle : ce qui change ce que l'école réclame relève de la direction.
  { fichier: 'finance/facturation.controller.ts', route: "@Post('finance/student-services/:id/stop')", sienne: 'arrêter un service (Jinan)' },
  { fichier: 'finance/facturation.controller.ts', route: "@Post('finance/student-services/:id/exempt')", sienne: 'exempter un service / lever l’exemption (Jinan)' },
  { fichier: 'finance/facturation.controller.ts', route: "@Post('finance/concessions/study-mode')", sienne: 'changer de mode d’étude (Jinan)' },
  { fichier: 'finance/facturation.controller.ts', route: "@Post('finance/tarifs/services')", sienne: 'prix des services, page « Frais » (Jinan)' },
  { fichier: 'finance/facturation.controller.ts', route: "@Patch('levels/:id/tarifs')", sienne: 'tarifs par mode et frais d’inscription d’un niveau (Jinan)' },
  // Son `annuler_paiement`, pour le grand livre des services (§5) : la même main.
  { fichier: 'finance/facturation.controller.ts', route: "@Post('finance/service-payments/:id/reverse')", sienne: 'annuler un paiement de service (Jinan)' },
];

/** Les décorateurs attachés à une route, jusqu'à la signature du handler. */
function decorateurs(fichier: string, route: string): string {
  const s = src(fichier);
  const i = s.indexOf(route);
  if (i < 0) throw new Error(`Route introuvable : ${route} dans ${fichier}`);
  // Du décorateur de route jusqu'à la ligne qui ouvre le handler.
  const suite = s.slice(i, i + 600);
  const fin = suite.search(/\n\s{2}(?:async )?[a-zA-Z]+\s*\(/);
  return fin > 0 ? suite.slice(0, fin) : suite;
}

describe('la caisse ne décide pas de ce que l’école réclame', () => {
  for (const { fichier, route, sienne } of DIRECTION_SEULE) {
    it(`⚠ ${route} est réservée à la direction — son « ${sienne} »`, () => {
      const d = decorateurs(fichier, route);
      expect(d, `${route} devrait porter @RequireRole('super_admin', 'admin')`).toMatch(
        /@RequireRole\(\s*'super_admin',\s*'admin'\s*\)/,
      );
    });
  }

  it('⚠ le garde exige le rôle EN PLUS de la permission, jamais à la place', () => {
    // La permission seule laisserait passer le comptable, qui détient
    // `finance.dette` — c'est bien ainsi qu'El Ourwa la distribue. C'est la
    // conjonction qui porte la règle.
    const guard = new PermissionsGuard(new Reflector());
    const contexte = (permissions: string[], roles: string[]) =>
      ({
        getHandler: () => 'h',
        getClass: () => 'c',
        switchToHttp: () => ({
          getRequest: () => ({ auth: { userId: 'u', schoolId: 's', roles, permissions, impersonated: false } }),
        }),
      }) as never;

    const reflect = (perm: string[], role: string[] | undefined) => {
      guard['reflector'] = {
        getAllAndOverride: (cle: symbol | string) =>
          String(cle).includes('role') ? role : perm,
      } as never;
    };

    // Le comptable : la permission passe, le rôle refuse.
    reflect(['finance.dette'], ['super_admin', 'admin']);
    expect(() => guard.canActivate(contexte(['finance.dette'], ['comptable']))).toThrow();

    // Le super administrateur : les deux passent.
    expect(() =>
      guard.canActivate(contexte(['finance.dette'], ['super_admin'])),
    ).not.toThrow();
  });
});

describe('mais la caisse garde son métier', () => {
  /**
   * ⚠ CE QUE LE COMPTABLE DOIT CONTINUER À FAIRE. Resserrer trop est aussi un
   * défaut : encaisser, rembourser une créance et lire les fiches sont son
   * travail quotidien, et El Ourwa ne les lui refuse nulle part.
   */
  const CAISSE: { fichier: string; route: string }[] = [
    { fichier: 'finance/finance.controller.ts', route: "@Post('payments')" },
    { fichier: 'finance/finance.controller.ts', route: "@Post('collection')" },
    { fichier: 'finance/finance.controller.ts', route: "@Post('collection/global')" },
    { fichier: 'finance/finance.controller.ts', route: "@Post('misc-debts/:id/repay')" },
    { fichier: 'finance/finance.controller.ts', route: "@Get('debt/:guardianId')" },
    { fichier: 'finance/finance.controller.ts', route: "@Get('outstanding')" },
    { fichier: 'finance/finance.controller.ts', route: "@Get('concessions/:studentId')" },
    { fichier: 'finance/finance.controller.ts', route: "@Get('write-offs/:guardianId')" },
    // Jinan : souscrire un service depuis la fiche est le métier de la caisse (§4).
    { fichier: 'finance/facturation.controller.ts', route: "@Post('finance/students/:studentId/services')" },
    { fichier: 'finance/facturation.controller.ts', route: "@Get('finance/tarifs')" },
  ];

  /**
   * ⚠ ET IL PAIE LE PERSONNEL. `paiement_staff.php` et `dette.php` sont gardées
   * par `require_finance_page()`, qui admet le comptable, et AUCUNE de leurs
   * actions ne le refuse : ni `payer_salaire`, ni `retirer_admin`, ni
   * `creer_pret`, ni `rembourser`. `finance.salaires` n'y est pas plus vérifiée
   * que `finance.dette` — elle est déclarée, distribuée, jamais lue.
   *
   * Nous l'appliquions réellement, et le comptable ne la détient pas : il ne
   * pouvait donc ni payer un salaire ni enregistrer un retrait. Le contrôleur
   * accepte désormais `finance.consulter` en second, que le comptable détient —
   * exactement l'ensemble qu'`est_admin_complet()` laisse passer.
   */
  it('⚠ le comptable atteint la paie, comme sur ses deux pages', () => {
    const s = readFileSync(join(ici, '..', 'src', 'payroll/payroll.controller.ts'), 'utf8');
    expect(s).toMatch(/@RequirePermission\(\s*'finance\.salaires',\s*'finance\.consulter'\s*\)/);
  });

  for (const { fichier, route } of CAISSE) {
    it(`${route} reste ouverte à la caisse`, () => {
      expect(decorateurs(fichier, route)).not.toMatch(/@RequireRole\(/);
    });
  }
});
