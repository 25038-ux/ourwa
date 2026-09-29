import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { DebtService } from '../src/finance/debt.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LES TROIS ÉCRANS DOIVENT ANNONCER LE MÊME CHIFFRE.
 *
 * ⚠ CE TEST EXISTE PARCE QU'ILS NE LE FAISAIENT PAS. Une famille voyait
 * « ✓ En règle (0 MRU) » sur sa fiche au guichet, « 6 500 MRU » aux Impayés, et
 * « Réinscription bloquée — 6 500 MRU » aux Réinscriptions. Trois écrans, deux
 * chiffres, et c'est celui qui décide si on peut encaisser qui disait zéro
 * (ADR-0043).
 *
 * Trois fonctions répondent à « combien doit cette famille » :
 *
 *   `forGuardian()`        la fiche du guichet, pour UNE année
 *   `detailAcrossYears()`  le contrôle de réinscription, TOUTES années
 *   `outstanding()`        la liste des Impayés
 *
 * Elles ne peuvent pas rendre le même nombre en toutes circonstances — la
 * première porte sur une année, la deuxième sur toute la scolarité. Ce qui doit
 * tenir, c'est que **sur une famille dont toute la dette est de l'année en
 * cours, les trois s'accordent**. C'est le cas ordinaire, et c'est celui où le
 * désaccord se paie comptant.
 *
 * El Ourwa énonce la règle pour lui-même : « le detail affiche vient de la MEME
 * source que le total », écrit après que son écran eut imprimé un total et une
 * ventilation qui ne s'additionnaient pas. La même exigence, entre écrans.
 */

let owner: pg.Pool;
let debts: DebtService;

let schoolId: string;
let yearId: string;
let startYear: number;
let levelId: string;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'accord' }, fn);
}

/**
 * Une famille, avec ce qu'on lui met sur le dos.
 *
 * Les quatre termes de la dette d'El Ourwa sont représentés : les mois (A), les
 * créances (B), les frais annuels (B bis) et la remise (C).
 */
async function famille(
  tag: string,
  opts: { mois?: number; creance?: string; fraisAnnuels?: boolean } = {},
): Promise<string> {
  const g = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', $2) RETURNING id`,
    [`accord.${tag}@test`, `Famille ${tag}`],
  );
  const guardianId = g.rows[0]!.id;

  const s = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5, 'Accord') RETURNING id`,
    [schoolId, guardianId, `RIM-AC-${tag}`, `NID-AC-${tag}`, tag],
  );
  const studentId = s.rows[0]!.id;

  const e = await owner.query<{ id: string }>(
    `INSERT INTO enrollments
       (school_id, student_id, academic_year_id, level_id, status, monthly_fee)
     VALUES ($1, $2, $3, $4, 'enrolled', 3000) RETURNING id`,
    [schoolId, studentId, yearId, levelId],
  );

  // Des mois ÉCHUS, sinon rien n'est encore dû et le cas ne prouve rien.
  for (let i = 0; i < (opts.mois ?? 0); i += 1) {
    await owner.query(
      `INSERT INTO enrollment_months
         (school_id, enrollment_id, month_order, calendar_month, calendar_year,
          month_label, amount_due)
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

  return guardianId;
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  startYear = 2025;

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('accord', 'Accord', 'ACC')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const y = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status, start_month, end_month)
     VALUES ($1, '2025-2026', $2, 'active', 9, 6) RETURNING id`,
    [schoolId, startYear],
  );
  yearId = y.rows[0]!.id;

  const l = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order)
     VALUES ($1, '6eme', 3000, 'college', 10) RETURNING id`,
    [schoolId],
  );
  levelId = l.rows[0]!.id;

  await owner.query(
    `INSERT INTO configuration (school_id, key, value) VALUES ($1, $2, '5000'), ($1, $3, '1500')`,
    [schoolId, `frais_inscription_${startYear}`, `frais_photocopie_${startYear}`],
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  debts = moduleRef.get(DebtService);
});

afterAll(async () => {
  await owner?.end();
});

/** Ce que les Impayés annoncent pour une famille, ou zéro si elle n'y figure pas. */
async function surImpayes(guardianId: string): Promise<string> {
  const lignes = await inTenant(() => debts.outstanding(yearId, startYear));
  return lignes.find((l) => l.guardianId === guardianId)?.total ?? '0.00';
}

describe('les trois calculs de dette s’accordent', () => {
  it('⚠ frais annuels seuls — le cas qui a fait mentir le guichet', async () => {
    const g = await famille('fraisseuls');

    const fiche = await inTenant(() => debts.forGuardian(g, yearId, startYear));
    const across = await inTenant(() => debts.detailAcrossYears(g));

    expect(fiche.total).toBe('6500.00');
    expect(across.total.toFixed(2)).toBe('6500.00');
    expect(await surImpayes(g)).toBe('6500.00');
  });

  it('mois échus + frais annuels', async () => {
    const g = await famille('mois', { mois: 2 });

    const fiche = await inTenant(() => debts.forGuardian(g, yearId, startYear));
    const across = await inTenant(() => debts.detailAcrossYears(g));

    // 2 × 3 000 de scolarité + 6 500 de frais.
    expect(fiche.total).toBe('12500.00');
    expect(across.total.toFixed(2)).toBe(fiche.total);
    expect(await surImpayes(g)).toBe(fiche.total);
  });

  it('⚠ une créance compte dans les trois', async () => {
    const g = await famille('creance', { mois: 1, creance: '2000.00' });

    const fiche = await inTenant(() => debts.forGuardian(g, yearId, startYear));
    const across = await inTenant(() => debts.detailAcrossYears(g));

    /*
     * ⚠ ET C'EST ICI QUE LES TROIS DIVERGENT LÉGITIMEMENT — le seul cas.
     * `forGuardian()` porte sur UNE année et ne connaît pas les créances, qui
     * n'ont pas d'année (issue 8). Les Impayés les rajoutent par-dessus, et
     * `detailAcrossYears()` les inclut. La fiche du guichet montre donc les
     * créances dans sa propre section, sans les additionner à son total annuel.
     *
     * Ce test fixe cette frontière pour qu'elle reste un choix, et non une
     * surprise : 3 000 + 6 500 pour l'année, 2 000 de créance en plus ailleurs.
     */
    expect(fiche.total).toBe('9500.00');
    expect(across.total.toFixed(2)).toBe('11500.00');
    expect(await surImpayes(g)).toBe('11500.00');
  });

  it('une famille à jour n’apparaît nulle part', async () => {
    // Aucun mois échu, et les frais annuels réglés.
    const g = await famille('ajour');
    await owner.query(
      `INSERT INTO family_fee_payments
         (school_id, guardian_id, academic_year_id, kind, amount, receipt_number)
       VALUES ($1, $2, $3, 'enrolment', 5000, 'ACC-T1'),
              ($1, $2, $3, 'photocopy', 1500, 'ACC-T2')`,
      [schoolId, g, yearId],
    );

    const fiche = await inTenant(() => debts.forGuardian(g, yearId, startYear));
    expect(fiche.total).toBe('0.00');
    expect((await inTenant(() => debts.detailAcrossYears(g))).total.toFixed(2)).toBe('0.00');
    expect(await surImpayes(g)).toBe('0.00');
  });

  it('⚠ le chemin groupé des Impayés (forGuardians) rend, famille par famille, exactement forGuardian', async () => {
    // Toutes les familles créées ci-dessus : frais seuls, mois échus, créance,
    // remise, à jour… Le chemin en quatre requêtes doit donner le MÊME objet
    // que le chemin historique — c'est la condition de son existence.
    const { rows } = await owner.query<{ id: string }>(
      `SELECT DISTINCT u.id FROM users u JOIN students s ON s.guardian_id = u.id WHERE s.school_id = $1`,
      [schoolId],
    );
    const ids = rows.map((r) => r.id);
    expect(ids.length).toBeGreaterThanOrEqual(4);
    const groupe = await inTenant(() => debts.forGuardians(ids, yearId, startYear));
    const divers = await inTenant(() => debts.miscDebtsRemainingFor(ids));
    for (const id of ids) {
      const seul = await inTenant(() => debts.forGuardian(id, yearId, startYear));
      expect(groupe.get(id)).toEqual(seul);
      const seulDivers = (await inTenant(() => debts.miscDebtsFor(id))).map((d) => d.remaining);
      expect((divers.get(id) ?? []).map((d) => d.remaining)).toEqual(seulDivers);
    }
  });
});
