import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { DebtService } from '../src/finance/debt.service.js';
import { ExpulsionsService } from '../src/discipline/expulsions.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LES IMPAYÉS DISENT LE MÊME CHIFFRE QUE LA FICHE — balayage du 22/09.
 *
 * Deux défauts confirmés contre `impayes.php` et `obtenir_dette_parent_detaillee()` :
 *   - « Toutes les années » ajoutait les créances à un total qui les contenait
 *     déjà : 10 000 d'arriéré → « TOTAL DÛ 20 000 » ;
 *   - une année : la remise était appliquée AVANT d'ajouter les créances, donc
 *     une remise accordée sur un arriéré disparaissait de la liste de relance
 *     alors que la fiche, la réinscription et l'application la comptaient.
 *
 * Et « Notifier les impayés » tenait un paiement ANNULÉ pour un mois soldé.
 *
 * ⚠ Écrits avant les corrections (règle 15) : ce sont des chiffres d'argent.
 */

let owner: pg.Pool;
let debts: DebtService;
let expulsions: ExpulsionsService;
let schoolId: string;
let yearId: string;
const START_YEAR = 2025;
let levelId: string;
let ACTOR: string;

const inTenant = <T>(fn: () => Promise<T>) => runInTenant({ schoolId, slug: 'coherence' }, fn);

async function famille(tag: string, opts: { mois?: number; creance?: string } = {}) {
  const g = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', $2) RETURNING id`,
    [`coherence.${tag}@test`, `Famille ${tag}`],
  );
  const guardianId = g.rows[0]!.id;
  const s = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5, 'Coherence') RETURNING id`,
    [schoolId, guardianId, `RIM-CO-${tag}`, `NID-CO-${tag}`, tag],
  );
  const studentId = s.rows[0]!.id;
  const e = await owner.query<{ id: string }>(
    `INSERT INTO enrollments (school_id, student_id, academic_year_id, level_id, status, monthly_fee)
     VALUES ($1, $2, $3, $4, 'enrolled', 3000) RETURNING id`,
    [schoolId, studentId, yearId, levelId],
  );
  for (let i = 0; i < (opts.mois ?? 0); i += 1) {
    await owner.query(
      `INSERT INTO enrollment_months
         (school_id, enrollment_id, month_order, calendar_month, calendar_year, month_label, amount_due)
       VALUES ($1, $2, $3, $4, 2025, $5, 3000)`,
      [schoolId, e.rows[0]!.id, i + 1, 9 + i, `Mois ${9 + i}`],
    );
  }
  if (opts.creance) {
    await owner.query(
      `INSERT INTO misc_debts (school_id, guardian_id, debtor_name, total, reason)
       VALUES ($1, $2, $3, $4, 'Arriéré')`,
      [schoolId, guardianId, `Famille ${tag}`, opts.creance],
    );
  }
  return { guardianId, studentId, enrollmentId: e.rows[0]!.id };
}

async function surImpayes(guardianId: string, annee: 'annee' | 'toutes') {
  const lignes = await inTenant(() =>
    annee === 'annee' ? debts.outstanding(yearId, START_YEAR) : debts.outstanding(null, null),
  );
  return lignes.find((l) => l.guardianId === guardianId) ?? null;
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('coherence', 'Coherence', 'COH') RETURNING id`,
  );
  schoolId = school.rows[0]!.id;
  const y = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status, start_month, end_month)
     VALUES ($1, '2025-2026', $2, 'active', 9, 6) RETURNING id`,
    [schoolId, START_YEAR],
  );
  yearId = y.rows[0]!.id;
  const l = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order) VALUES ($1, '6eme', 3000, 'college', 10) RETURNING id`,
    [schoolId],
  );
  levelId = l.rows[0]!.id;
  const a = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('coherence.actor@test', 'x', 'Direction') RETURNING id`,
  );
  ACTOR = a.rows[0]!.id;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  debts = moduleRef.get(DebtService);
  expulsions = moduleRef.get(ExpulsionsService);
});

afterAll(async () => {
  await owner?.end();
});

describe('Impayés « Toutes les années »', () => {
  it('compte chaque créance une fois : le total est celui de la fiche', async () => {
    const { guardianId } = await famille('toutes', { creance: '10000.00' });
    const fiche = await inTenant(() => debts.detailAcrossYears(guardianId));
    const ligne = await surImpayes(guardianId, 'toutes');
    expect(ligne).not.toBeNull();
    expect(ligne!.total).toBe(fiche.total.toFixed(2));
    expect(ligne!.total).toBe('10000.00');
    expect(ligne!.diverses).toBe('10000.00');
    expect(ligne!.scolarite).toBe('0.00');
  });
});

describe('Impayés d’une année, avec une remise sur un arriéré', () => {
  it('applique la remise après les créances, comme la fiche et la réinscription', async () => {
    const { guardianId } = await famille('remise', { creance: '10000.00' });
    await inTenant(() => debts.grantWriteOff({ guardianId, amount: '4000.00', reason: 'Accord' }, ACTOR));
    const fiche = await inTenant(() => debts.outstandingAcrossYears(guardianId));
    expect(fiche.toFixed(2)).toBe('6000.00');
    const ligne = await surImpayes(guardianId, 'annee');
    expect(ligne).not.toBeNull();
    expect(ligne!.total).toBe('6000.00');
  });

  it('« Annuler toute la dette » retire la famille de la liste, créances comprises', async () => {
    const { guardianId } = await famille('annulee', { mois: 2, creance: '5000.00' });
    await inTenant(() => debts.grantWriteOff({ guardianId, clearsAll: true, reason: 'Situation' }, ACTOR));
    expect((await inTenant(() => debts.outstandingAcrossYears(guardianId))).toFixed(2)).toBe('0.00');
    expect(await surImpayes(guardianId, 'annee')).toBeNull();
    expect(await surImpayes(guardianId, 'toutes')).toBeNull();
  });

  it('sans remise, des mois et une créance s’additionnent une fois', async () => {
    const { guardianId } = await famille('simple', { mois: 2, creance: '1000.00' });
    const ligne = await surImpayes(guardianId, 'annee');
    expect(ligne!.total).toBe('7000.00');
    expect(ligne!.scolarite).toBe('6000.00');
    expect(ligne!.diverses).toBe('1000.00');
  });
});

describe('Notifier les impayés', () => {
  it('rappelle une famille dont le paiement du mois a été annulé', async () => {
    const { guardianId, studentId } = await famille('annule', { mois: 1 });
    // L'original, puis sa contre-passation (ligne négative qui garde le mois).
    const p = await owner.query<{ id: string }>(
      `INSERT INTO payments (school_id, student_id, academic_year_id, calendar_month, calendar_year, amount, receipt_number, recorded_by)
       VALUES ($1, $2, $3, 9, 2025, 3000, 'COH-2025-00001', $4) RETURNING id`,
      [schoolId, studentId, yearId, ACTOR],
    );
    await owner.query(
      `INSERT INTO payments (school_id, student_id, academic_year_id, calendar_month, calendar_year, amount, receipt_number, recorded_by, reverses_id)
       VALUES ($1, $2, $3, 9, 2025, -3000, 'COH-2025-00002', $4, $5)`,
      [schoolId, studentId, yearId, ACTOR, p.rows[0]!.id],
    );
    const { guardianId: paye, studentId: elevePaye } = await famille('paye', { mois: 1 });
    await owner.query(
      `INSERT INTO payments (school_id, student_id, academic_year_id, calendar_month, calendar_year, amount, receipt_number, recorded_by)
       VALUES ($1, $2, $3, 9, 2025, 3000, 'COH-2025-00003', $4)`,
      [schoolId, elevePaye, yearId, ACTOR],
    );
    const notifies: string[] = [];
    const result = await inTenant(() =>
      debts.notifyUnpaid({ academicYearId: yearId, calendarMonth: 9, calendarYear: 2025 }, ACTOR, async (_tx, n) => {
        notifies.push(n.guardianId);
      }),
    );
    const { rows } = await owner.query<{ guardian_id: string }>(
      `SELECT DISTINCT guardian_id FROM messages WHERE school_id = $1`,
      [schoolId],
    );
    const touches = rows.map((r) => r.guardian_id);
    expect(touches).toContain(guardianId);
    expect(touches).not.toContain(paye);
    expect(notifies).toContain(guardianId);
    expect(notifies).not.toContain(paye);
    expect(result.sent).toBeGreaterThanOrEqual(1);
  });
});

describe('le registre des exclus', () => {
  it('bloque sur le NNI OU le RIM, comme inscrire_etudiant.php', async () => {
    await inTenant(() =>
      expulsions.expel({ nationalId: 'NNI-EXCLU-1', rim: 'RIM-EXCLU-1', firstName: 'A', lastName: 'B', reason: 'x' }, ACTOR),
    );
    expect(await inTenant(() => expulsions.blockFor('NNI-EXCLU-1', 'RIM-AUTRE'))).not.toBeNull();
    expect(await inTenant(() => expulsions.blockFor('NNI-AUTRE', 'RIM-EXCLU-1'))).not.toBeNull();
    expect(await inTenant(() => expulsions.blockFor('NNI-AUTRE', 'RIM-AUTRE'))).toBeNull();
    // Le registre lui-même compare la paire exacte.
    expect(await inTenant(() => expulsions.blockFor('NNI-EXCLU-1', 'RIM-AUTRE', { exact: true }))).toBeNull();
  });
});
