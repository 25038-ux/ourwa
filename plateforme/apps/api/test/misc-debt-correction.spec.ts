import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { DebtService } from '../src/finance/debt.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * CORRIGER ET ANNULER UNE CRÉANCE — `reinscriptions.php`, actions
 * `dette_modifier` and `dette_annuler`, and the term of the debt sum they act on.
 *
 * ⚠ TWO SEPARATE FACTS, AND THE SECOND IS THE SERIOUS ONE.
 *
 * 1. A correction moves the REMAINDER and never the claim. El Ourwa: "On
 *    conserve total (montant d'origine) et on ne touche qu'au solde : la trace
 *    de ce qui avait ete reclame reste lisible." Cancelling is the same
 *    operation at zero — "la ligne est conservee […] Supprimer la ligne
 *    detruirait la trace comptable de ce qui avait ete reclame a la famille."
 *
 * 2. ⚠ outstandingAcrossYears() — THE GATE — DOES NOT COUNT CRÉANCES AT ALL.
 *    Its own doc comment quotes El Ourwa's rule, "mois échus non réglés,
 *    reliquats de factures de TOUTES les années", and then sums only the months.
 *    A family whose entire arrears sit in `misc_debts` walks through the
 *    re-enrolment gate as if they owed nothing, and the exam ratchet hands them
 *    the term. El Ourwa's `dette_du_parent()` is
 *    `obtenir_dette_parent_detaillee()['total_dette']`: section A (months)
 *    + section B (`dettes_familles.solde`) + section B bis (annual fees)
 *    − section C (remises). Three of the four terms were present.
 *
 * Money, and a gate on money. The tests come first.
 */

let owner: pg.Pool;
let debts: DebtService;

let schoolId: string;
let yearId: string;
let ACTOR: string;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'creance' }, fn);
}

/** A family with a child enrolled and NOTHING owed on the months. */
async function cleanFamily(tag: string): Promise<{ guardianId: string; studentId: string }> {
  const g = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', $2) RETURNING id`,
    [`creance.${tag}@test`, `Famille ${tag}`],
  );
  const guardianId = g.rows[0]!.id;

  const s = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5, 'Creance') RETURNING id`,
    [schoolId, guardianId, `RIM-C-${tag}`, `NID-C-${tag}`, tag],
  );
  const studentId = s.rows[0]!.id;

  // Enrolled, but with no billable month at all — so the tuition term is zero
  // and whatever the gate reports has come from somewhere else.
  await owner.query(
    `INSERT INTO enrollments
       (school_id, student_id, academic_year_id, level_id, status, monthly_fee)
     VALUES ($1, $2, $3, (SELECT id FROM levels WHERE school_id = $1 LIMIT 1), 'enrolled', 0)`,
    [schoolId, studentId, yearId],
  );

  return { guardianId, studentId };
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('creance', 'Creance', 'CRE')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const y = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2025-2026', 2025, 'active') RETURNING id`,
    [schoolId],
  );
  yearId = y.rows[0]!.id;

  await owner.query(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order)
     VALUES ($1, '6eme', 10000, 'college', 10)`,
    [schoolId],
  );

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('creance.admin@test', 'x', 'Direction') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  debts = moduleRef.get(DebtService);
});

afterAll(async () => {
  await owner?.end();
});

describe('une créance est une dette', () => {
  it('⚠ compte dans la dette qui bloque la réinscription', async () => {
    const { guardianId } = await cleanFamily('gate');

    const before = await inTenant(() => debts.outstandingAcrossYears(guardianId));
    expect(before.toFixed(2)).toBe('0.00');

    await inTenant(() =>
      debts.createMiscDebt(
        { debtorName: 'Famille gate', guardianId, total: '5000.00', reason: 'Arriere 2024' },
        ACTOR,
      ),
    );

    const after = await inTenant(() => debts.outstandingAcrossYears(guardianId));
    expect(after.toFixed(2)).toBe('5000.00');
  });

  it("un remboursement partiel réduit la dette d'autant", async () => {
    const { guardianId } = await cleanFamily('repay');
    const created = await inTenant(() =>
      debts.createMiscDebt({ debtorName: 'Famille repay', guardianId, total: '5000.00' }, ACTOR),
    );
    const especes = (
      await owner.query<{ id: string }>(
        `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Especes') RETURNING id`,
        [schoolId],
      )
    ).rows[0]!.id;
    await inTenant(() =>
      debts.repayMiscDebt(created.id, [{ paymentMethodId: especes, amount: '2000.00' }], ACTOR),
    );

    const owed = await inTenant(() => debts.outstandingAcrossYears(guardianId));
    expect(owed.toFixed(2)).toBe('3000.00');
  });
});

describe('la remise de la direction — section C', () => {
  it('⚠ « Annuler toute la dette » débloque vraiment la famille', async () => {
    // Le bouton dit « Dette annulée : la famille peut réinscrire ». Une remise
    // totale s'enregistre avec montant 0 et le drapeau `clears_all` : sommer les
    // montants ne retirait donc rien, et la famille restait bloquée.
    const { guardianId } = await cleanFamily('remise');
    await inTenant(() =>
      debts.createMiscDebt({ debtorName: 'Famille remise', guardianId, total: '9000.00' }, ACTOR),
    );
    expect((await inTenant(() => debts.outstandingAcrossYears(guardianId))).toFixed(2)).toBe(
      '9000.00',
    );

    await inTenant(() =>
      debts.grantWriteOff({ guardianId, clearsAll: true, reason: 'Situation familiale' }, ACTOR),
    );

    const owed = await inTenant(() => debts.outstandingAcrossYears(guardianId));
    expect(owed.toFixed(2)).toBe('0.00');
  });

  it('une remise partielle retire son montant, pas plus', async () => {
    const { guardianId } = await cleanFamily('partielle');
    await inTenant(() =>
      debts.createMiscDebt({ debtorName: 'Famille part', guardianId, total: '9000.00' }, ACTOR),
    );
    await inTenant(() =>
      debts.grantWriteOff({ guardianId, amount: '4000.00', reason: 'Accord' }, ACTOR),
    );

    const owed = await inTenant(() => debts.outstandingAcrossYears(guardianId));
    expect(owed.toFixed(2)).toBe('5000.00');
  });
});

describe('corriger une créance — dette_modifier', () => {
  it('déplace le restant dû et laisse le montant réclamé intact', async () => {
    const { guardianId } = await cleanFamily('corr');
    const created = await inTenant(() =>
      debts.createMiscDebt({ debtorName: 'Famille corr', guardianId, total: '8000.00' }, ACTOR),
    );

    await inTenant(() => debts.correctMiscDebt(created.id, '3000', 'Erreur de saisie', ACTOR));

    const { rows } = await owner.query<{
      total: string;
      corrected_balance: string;
      reason: string;
    }>(
      `SELECT total::text, corrected_balance::text, correction_reason AS reason
         FROM misc_debts WHERE id = $1`,
      [created.id],
    );
    // ⚠ Ce qui avait été réclamé ne bouge pas.
    expect(rows[0]!.total).toBe('8000.00');
    expect(rows[0]!.corrected_balance).toBe('3000.00');
    expect(rows[0]!.reason).toBe('Erreur de saisie');

    const owed = await inTenant(() => debts.outstandingAcrossYears(guardianId));
    expect(owed.toFixed(2)).toBe('3000.00');
  });

  it('⚠ refuse de gonfler la créance au-delà de ce qui a été réclamé', async () => {
    const { guardianId } = await cleanFamily('gonfle');
    const created = await inTenant(() =>
      debts.createMiscDebt({ debtorName: 'Famille gonfle', guardianId, total: '1000.00' }, ACTOR),
    );
    await expect(
      inTenant(() => debts.correctMiscDebt(created.id, '4000', 'Ajout', ACTOR)),
    ).rejects.toThrow(/nouvelle créance|dépasser/i);
  });

  it("refuse un montant qui n'est pas un nombre positif", async () => {
    const { guardianId } = await cleanFamily('nan');
    const created = await inTenant(() =>
      debts.createMiscDebt({ debtorName: 'Famille nan', guardianId, total: '1000.00' }, ACTOR),
    );
    for (const bad of ['-100', 'abc', '10,50', '']) {
      await expect(
        inTenant(() => debts.correctMiscDebt(created.id, bad, 'x', ACTOR)),
      ).rejects.toThrow(/positif|montant/i);
    }
  });
});

describe('annuler une créance — dette_annuler', () => {
  it('⚠ garde la ligne : la trace de ce qui avait été réclamé survit', async () => {
    const { guardianId } = await cleanFamily('annul');
    const created = await inTenant(() =>
      debts.createMiscDebt(
        { debtorName: 'Famille annul', guardianId, total: '6000.00', reason: 'Report' },
        ACTOR,
      ),
    );

    await inTenant(() => debts.cancelMiscDebt(created.id, 'Decision direction', ACTOR));

    const { rows } = await owner.query<{
      n: string;
      total: string;
      bal: string;
      reason: string;
    }>(
      `SELECT count(*)::text AS n, max(total)::text AS total,
              max(corrected_balance)::text AS bal, max(correction_reason) AS reason
         FROM misc_debts WHERE id = $1`,
      [created.id],
    );
    expect(rows[0]!.n).toBe('1');
    expect(rows[0]!.total).toBe('6000.00');
    expect(rows[0]!.bal).toBe('0.00');
    expect(rows[0]!.reason).toBe('Decision direction');

    const owed = await inTenant(() => debts.outstandingAcrossYears(guardianId));
    expect(owed.toFixed(2)).toBe('0.00');
  });

  it('disparaît des créances ouvertes mais reste consultable', async () => {
    const { guardianId } = await cleanFamily('liste');
    const created = await inTenant(() =>
      debts.createMiscDebt({ debtorName: 'Famille liste', guardianId, total: '2000.00' }, ACTOR),
    );
    await inTenant(() => debts.cancelMiscDebt(created.id, 'Annulee', ACTOR));

    const open = await inTenant(() => debts.miscDebtsFor(guardianId));
    expect(open.find((d) => d.id === created.id)).toBeUndefined();

    const all = await inTenant(() => debts.allMiscDebts(true));
    expect(all.find((d: { id: string }) => d.id === created.id)).toBeTruthy();
  });
});

/**
 * L'ANNÉE ET LA NATURE D'UNE CRÉANCE — migration 0026, issue 8 tranchée.
 *
 * Le repli « Gérer les créances » de `reinscriptions.php` a SEPT colonnes :
 * Année · Élève · Type · Réclamé · Restant dû · Note · Actions. La nôtre en
 * avait six — il manquait l'ANNÉE, sur l'écran dont tout le propos est « les
 * arriérés de TOUTES les années », et son « Type » était remplacé par notre
 * texte libre `reason`, qui n'est pas la même chose.
 */
describe('une créance dit son année et sa nature', () => {
  it("porte l'année qu'on lui donne, et sa nature par défaut", async () => {
    const { guardianId } = await cleanFamily('annee');
    await inTenant(() =>
      debts.createMiscDebt(
        { debtorName: 'Famille annee', guardianId, total: '3000.00', startYear: 2024 },
        ACTOR,
      ),
    );

    const [ligne] = await inTenant(() => debts.miscDebtsFor(guardianId));
    expect(ligne!.start_year).toBe(2024);
    // Son défaut : une créance est un arriéré tant qu'on ne dit pas autre chose.
    expect(ligne!.kind).toBe('arriere');
    expect(ligne!.invoice_source).toBeNull();
  });

  it('une facture non soldée porte son numéro', async () => {
    const { guardianId } = await cleanFamily('facture');
    await inTenant(() =>
      debts.createMiscDebt(
        {
          debtorName: 'Famille facture',
          guardianId,
          total: '4000.00',
          startYear: 2023,
          kind: 'facture',
          invoiceSource: 12,
        },
        ACTOR,
      ),
    );

    const [ligne] = await inTenant(() => debts.miscDebtsFor(guardianId));
    expect(ligne!.kind).toBe('facture');
    expect(ligne!.invoice_source).toBe(12);
  });

  it('⚠ sans année, elle reste NULL — on n’en invente pas', async () => {
    // La déduire de `created_at` serait faux dans le cas qui compte : un
    // arriéré de 2024-2025 saisi en septembre 2026 se lirait 2026.
    const { guardianId } = await cleanFamily('sansannee');
    await inTenant(() =>
      debts.createMiscDebt(
        { debtorName: 'Famille sansannee', guardianId, total: '1000.00' },
        ACTOR,
      ),
    );

    const [ligne] = await inTenant(() => debts.miscDebtsFor(guardianId));
    expect(ligne!.start_year).toBeNull();
  });

  it('refuse une année qui n’en est pas une', async () => {
    // Le champ est un `smallint` sans clé étrangère — exprès, pour accepter les
    // reprises — donc rien d'autre ne vérifie qu'il est plausible.
    const { guardianId } = await cleanFamily('annulle');
    await expect(
      inTenant(() =>
        debts.createMiscDebt(
          { debtorName: 'X', guardianId, total: '100.00', startYear: 1200 },
          ACTOR,
        ),
      ),
    ).rejects.toThrow(/année/i);
  });

  it('les plus récentes d’abord, celles sans année en dernier', async () => {
    const { guardianId } = await cleanFamily('tri');
    await inTenant(() =>
      debts.createMiscDebt({ debtorName: 'A', guardianId, total: '100.00' }, ACTOR),
    );
    await inTenant(() =>
      debts.createMiscDebt(
        { debtorName: 'B', guardianId, total: '100.00', startYear: 2022 },
        ACTOR,
      ),
    );
    await inTenant(() =>
      debts.createMiscDebt(
        { debtorName: 'C', guardianId, total: '100.00', startYear: 2025 },
        ACTOR,
      ),
    );

    const lignes = await inTenant(() => debts.miscDebtsFor(guardianId));
    expect(lignes.map((l) => l.start_year)).toEqual([2025, 2022, null]);
  });
});
