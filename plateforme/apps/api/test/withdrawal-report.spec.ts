import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PayrollService } from '../src/payroll/payroll.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LE RAPPORT DES RETRAITS — `administrateurs.php`, ses lignes 143-173 et 350-394.
 *
 * Trois faits que sa page publie et que la nôtre n'avait pas :
 *
 *   1. « Moyens de paiement » par retrait. Sa requête lit `paiement_lignes`
 *      pour `source_type = 'admin_retrait'` et concatène « Espèces : 40 000 ·
 *      Bankily : 10 000 ». Notre colonne affichait un tiret CODÉ EN DUR — une
 *      colonne qui ment plutôt qu'une colonne qui manque, ce qui est pire :
 *      elle se lit comme « aucun moyen enregistré ».
 *
 *   2. Le total de la période, dans un `<tfoot>` : « TOTAL DE LA PÉRIODE ».
 *
 *   3. « Répartition par administrateur » — qui a pris combien, du plus gros au
 *      plus petit (`arsort`). C'est la question qu'on pose à cet écran : le
 *      plafond est mensuel et par personne, donc un rapport annuel sans
 *      ventilation ne se rapproche d'aucun plafond.
 *
 * De l'argent sorti de la caisse. Le test d'abord (règle 15).
 */

let owner: pg.Pool;
let payroll: PayrollService;

let schoolId: string;
let ACTOR: string;
let ESPECES: string;
let BANKILY: string;
let ADAMA: string;
let BINTA: string;

const ANNEE = 2031;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'retraits' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('retraits', 'Retraits', 'RET')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('retraits.admin@test', 'x', 'La Direction') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const methods = await owner.query<{ id: string; name: string }>(
    `INSERT INTO payment_methods (school_id, name)
     VALUES ($1, 'Espèces'), ($1, 'Bankily') RETURNING id, name`,
    [schoolId],
  );
  ESPECES = methods.rows.find((m) => m.name === 'Espèces')!.id;
  BANKILY = methods.rows.find((m) => m.name === 'Bankily')!.id;

  const holders = await owner.query<{ id: string; full_name: string }>(
    `INSERT INTO fund_holders (school_id, full_name, monthly_limit)
     VALUES ($1, 'Adama', 500000), ($1, 'Binta', 500000) RETURNING id, full_name`,
    [schoolId],
  );
  ADAMA = holders.rows.find((h) => h.full_name === 'Adama')!.id;
  BINTA = holders.rows.find((h) => h.full_name === 'Binta')!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  payroll = moduleRef.get(PayrollService);
});

afterAll(async () => {
  await owner?.end();
});

describe('le rapport des retraits', () => {
  it('⚠ nomme les moyens de paiement au lieu du tiret codé en dur', async () => {
    await inTenant(() =>
      payroll.withdraw(
        {
          fundHolderId: ADAMA,
          calendarMonth: 3,
          calendarYear: ANNEE,
          reason: 'Achat de fournitures',
          tender: [
            { paymentMethodId: ESPECES, amount: '40000.00' },
            { paymentMethodId: BANKILY, amount: '10000.00' },
          ],
        },
        ACTOR,
      ),
    );

    const rapport = await inTenant(() =>
      payroll.withdrawalReport({ kind: 'mois', month: 3, year: ANNEE }),
    );

    expect(rapport.rows).toHaveLength(1);
    // Dans l'ordre où ils ont été posés — `id` est un uuid v7, donc chronologique.
    expect(rapport.rows[0]!.tender).toEqual([
      { method: 'Espèces', amount: '40000.00' },
      { method: 'Bankily', amount: '10000.00' },
    ]);
  });

  it('un retrait à un seul moyen rend une liste à une ligne', async () => {
    // `lire_lignes_paiement(true, 0)` exige au moins une ligne : un retrait
    // sans ventilation n'existe plus. Le tiret du rapport reste une décision
    // d'affichage, pour les lignes reprises d'avant le grand livre.
    await inTenant(() =>
      payroll.withdraw(
        {
          fundHolderId: BINTA,
          calendarMonth: 4,
          calendarYear: ANNEE,
          tender: [{ paymentMethodId: ESPECES, amount: '3000.00' }],
        },
        ACTOR,
      ),
    );

    const rapport = await inTenant(() =>
      payroll.withdrawalReport({ kind: 'mois', month: 4, year: ANNEE }),
    );
    expect(rapport.rows[0]!.tender).toEqual([{ method: 'Espèces', amount: '3000.00' }]);
  });

  it('le total de la période est une chaîne, jamais un nombre JS', async () => {
    const rapport = await inTenant(() =>
      payroll.withdrawalReport({ kind: 'annee', year: ANNEE }),
    );
    expect(typeof rapport.total).toBe('string');
    expect(rapport.total).toBe('53000.00');
  });

  it('⚠ ventile par administrateur, du plus gros au plus petit', async () => {
    const rapport = await inTenant(() =>
      payroll.withdrawalReport({ kind: 'annee', year: ANNEE }),
    );

    expect(rapport.byHolder).toEqual([
      { holder: 'Adama', total: '50000.00' },
      { holder: 'Binta', total: '3000.00' },
    ]);
  });

  it('deux retraits du même administrateur se cumulent en une ligne', async () => {
    await inTenant(() =>
      payroll.withdraw(
        {
          fundHolderId: BINTA,
          calendarMonth: 5,
          calendarYear: ANNEE,
          tender: [{ paymentMethodId: ESPECES, amount: '2000.00' }],
        },
        ACTOR,
      ),
    );

    const rapport = await inTenant(() =>
      payroll.withdrawalReport({ kind: 'annee', year: ANNEE }),
    );
    expect(rapport.byHolder).toEqual([
      { holder: 'Adama', total: '50000.00' },
      { holder: 'Binta', total: '5000.00' },
    ]);
    expect(rapport.total).toBe('55000.00');
  });

  it('une période vide rend un total à zéro et aucune ventilation', async () => {
    const rapport = await inTenant(() =>
      payroll.withdrawalReport({ kind: 'annee', year: ANNEE + 5 }),
    );
    expect(rapport.rows).toHaveLength(0);
    expect(rapport.total).toBe('0.00');
    expect(rapport.byHolder).toEqual([]);
  });
});
