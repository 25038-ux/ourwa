import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { DebtService } from '../src/finance/debt.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * REMBOURSER UNE DETTE DIVERSE — `dette.php`, action `rembourser`.
 *
 * Chez lui, un remboursement est LU PAR LE WIDGET DES MOYENS
 * (`lire_lignes_paiement(true, 0)`) : le montant est la somme des lignes, et
 * elles sont écrites dans `paiement_lignes` (`enregistrer_lignes_paiement(
 * 'dette', $rid, …, 'entrant')`). Puis un numéro `REMB-Ymd-<dette>-<4 chiffres>`
 * et la redirection sur le reçu `?print_recu_remb=`.
 *
 * ⚠ SANS LIGNES DE MOYENS, L'ENCAISSEMENT N'EXISTE PAS POUR LA CAISSE. Le
 * rapport financier, le journal de caisse et le tableau de bord de la
 * plateforme lisent `tender_lines` ; un remboursement qui n'y écrit rien est de
 * l'argent entré que personne ne compte. Nous prenions un montant nu : la
 * dette baissait, la caisse ne montait pas.
 */

let owner: pg.Pool;
let debts: DebtService;
let schoolId: string;
let ACTOR: string;
let especes: string;
let bankily: string;

const inTenant = <T>(fn: () => Promise<T>) => runInTenant({ schoolId, slug: 'remb' }, fn);

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('remb', 'Remb', 'RMB') RETURNING id`,
  );
  schoolId = school.rows[0]!.id;
  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('remb.admin@test', 'x', 'Direction') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;
  especes = (
    await owner.query<{ id: string }>(
      `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Espèces') RETURNING id`,
      [schoolId],
    )
  ).rows[0]!.id;
  bankily = (
    await owner.query<{ id: string }>(
      `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Bankily') RETURNING id`,
      [schoolId],
    )
  ).rows[0]!.id;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  debts = moduleRef.get(DebtService);
});

afterAll(async () => {
  await owner?.end();
});

async function dette(total: string) {
  return inTenant(() =>
    debts.createMiscDebt(
      { debtorName: 'Sidi Ould Ahmed', phone: '22123456', total, reason: 'Livres avancés' },
      ACTOR,
    ),
  );
}

describe('rembourser — ses lignes de moyens, son reçu', () => {
  it('le montant est la somme des lignes, écrites dans la caisse en entrée', async () => {
    const d = await dette('5000.00');
    const r = await inTenant(() =>
      debts.repayMiscDebt(
        d.id,
        [
          { paymentMethodId: especes, amount: '1500.00' },
          { paymentMethodId: bankily, amount: '500.00' },
        ],
        ACTOR,
      ),
    );
    expect(r.remaining).toBe('3000.00');
    expect(r.numero).toMatch(/^REMB-\d{8}-[0-9a-f]{8}-\d{4}$/);

    const { rows } = await owner.query<{ source_type: string; direction: string; amount: string }>(
      `SELECT source_type, direction, amount::text FROM tender_lines
        WHERE source_id = $1 ORDER BY tender_lines.amount DESC`,
      [r.id],
    );
    expect(rows).toEqual([
      { source_type: 'dette', direction: 'in', amount: '1500.00' },
      { source_type: 'dette', direction: 'in', amount: '500.00' },
    ]);
  });

  it('⚠ refuse au-delà du reste dû, avec sa phrase', async () => {
    const d = await dette('2000.00');
    await expect(
      inTenant(() =>
        debts.repayMiscDebt(d.id, [{ paymentMethodId: especes, amount: '2500.00' }], ACTOR),
      ),
    ).rejects.toThrow('Le remboursement (2 500 MRU) dépasse le reste dû (2 000 MRU).');
  });

  it('refuse sans ligne de moyen', async () => {
    const d = await dette('2000.00');
    await expect(inTenant(() => debts.repayMiscDebt(d.id, [], ACTOR))).rejects.toThrow(
      'Veuillez indiquer au moins un moyen de paiement avec un montant.',
    );
  });

  it('le profil : cartes, historique du plus récent au plus ancien, moyens résumés', async () => {
    const d = await dette('4000.00');
    await inTenant(() =>
      debts.repayMiscDebt(d.id, [{ paymentMethodId: especes, amount: '1000.00' }], ACTOR),
    );
    await inTenant(() =>
      debts.repayMiscDebt(
        d.id,
        [
          { paymentMethodId: especes, amount: '2000.00' },
          { paymentMethodId: bankily, amount: '1000.00' },
        ],
        ACTOR,
      ),
    );
    const p = await inTenant(() => debts.miscDebtProfile(d.id));
    expect(p.debtor_name).toBe('Sidi Ould Ahmed');
    expect(p.total).toBe('4000.00');
    expect(p.repaid).toBe('4000.00');
    expect(p.remaining).toBe('0.00');
    expect(p.remboursements.map((r) => r.montant)).toEqual(['3000.00', '1000.00']);
    expect(p.remboursements[0]!.moyens).toBe('Espèces 2 000 + Bankily 1 000');
    expect(p.remboursements[1]!.moyens).toBe('Espèces 1 000');
  });

  it('la liste des débiteurs : les dettes SANS foyer, cherchées par nom ou téléphone, reste dû décroissant', async () => {
    const famille = (
      await owner.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, full_name) VALUES ('remb.famille@test', 'x', 'Famille') RETURNING id`,
      )
    ).rows[0]!.id;
    // Un arriéré de foyer (son `dettes_familles`) : jamais dans « Débiteurs ».
    await inTenant(() =>
      debts.createMiscDebt({ debtorName: 'Famille Remb', guardianId: famille, total: '99000.00' }, ACTOR),
    );
    const a = await inTenant(() =>
      debts.createMiscDebt({ debtorName: 'Fournisseur Alpha', phone: '33112233', total: '1000.00' }, ACTOR),
    );
    const b = await inTenant(() =>
      debts.createMiscDebt({ debtorName: 'Fournisseur Beta', phone: '44556677', total: '8000.00' }, ACTOR),
    );
    const tous = await inTenant(() => debts.debiteurs(''));
    expect(tous.map((d) => d.debtor_name)).not.toContain('Famille Remb');
    const ib = tous.findIndex((d) => d.id === b.id);
    const ia = tous.findIndex((d) => d.id === a.id);
    expect(ib).toBeGreaterThanOrEqual(0);
    expect(ib).toBeLessThan(ia);
    expect((await inTenant(() => debts.debiteurs('4455'))).map((d) => d.id)).toEqual([b.id]);
    expect((await inTenant(() => debts.debiteurs('alpha'))).map((d) => d.id)).toEqual([a.id]);
  });

  it("le reçu `print_recu_remb` : débiteur, motif, dette totale, reste dû après ce versement", async () => {
    const d = await dette('6000.00');
    const r = await inTenant(() =>
      debts.repayMiscDebt(d.id, [{ paymentMethodId: bankily, amount: '2500.00' }], ACTOR),
    );
    const recu = await inTenant(() => debts.miscDebtRepaymentReceipt(r.id));
    expect(recu).toMatchObject({
      id: r.id,
      dette_id: d.id,
      numero: r.numero,
      debiteur_nom: 'Sidi Ould Ahmed',
      debiteur_tel: '22123456',
      motif: 'Livres avancés',
      montant_total: '6000.00',
      reste_apres: '3500.00',
      moyens: [{ moyen: 'Bankily', montant: '2500.00' }],
      montant: '2500.00',
    });
    await expect(inTenant(() => debts.miscDebtRepaymentReceipt(d.id))).rejects.toThrow(
      'Reçu introuvable.',
    );
  });
});
