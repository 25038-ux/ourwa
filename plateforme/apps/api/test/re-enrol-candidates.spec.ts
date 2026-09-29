import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { EnrollmentController } from '../src/academic/academic.controller.js';
import { DebtService } from '../src/finance/debt.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LA LISTE DES CANDIDATS — `reinscriptions.php`.
 *
 * ⚠ GROUPÉE PAR FAMILLE, LA DETTE UNE SEULE FOIS. Its own recorded bug: "une
 * famille de quatre enfants affichait quatre fois 8 000 MRU, et un comptable
 * pouvait croire qu'elle devait 32 000."
 *
 * ⚠ LES FAMILLES BLOQUÉES D'ABORD — "ce sont celles qui demandent une
 * decision".
 *
 * ⚠ ET LE DÉTAIL ADDITIONNE EXACTEMENT LE TOTAL affiché à côté du nom. Les deux
 * viennent de la même source pour que ce soit vrai par construction.
 */

let owner: pg.Pool;
let controller: EnrollmentController;
let debts: DebtService;

let schoolId: string;
let lastYear: string;
let groupA: string;
let groupB: string;
let ACTOR: string;

const CLERK = ['scolarite.reinscrire'];

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'candidats' }, fn);
}

/** A household with `n` children on last year's roll. */
async function household(
  tag: string,
  n: number,
  groupId: string,
): Promise<{ guardianId: string; studentIds: string[] }> {
  const g = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', $2) RETURNING id`,
    [`cand.${tag}@test`, `Famille ${tag}`],
  );
  const guardianId = g.rows[0]!.id;
  const studentIds: string[] = [];

  for (let i = 0; i < n; i += 1) {
    const s = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [schoolId, guardianId, `RIM-${tag}${i}`, `NID-${tag}${i}`, `Enfant${i}`, tag],
    );
    studentIds.push(s.rows[0]!.id);

    await owner.query(
      `INSERT INTO enrollments
         (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee, outcome)
       VALUES ($1, $2, $3, $4, (SELECT level_id FROM groups WHERE id = $4),
               'enrolled', 0, 'passed')`,
      [schoolId, s.rows[0]!.id, lastYear, groupId],
    );
  }
  return { guardianId, studentIds };
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('candidats', 'Candidats', 'CAN')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const ys = await owner.query<{ id: string; start_year: number }>(
    `INSERT INTO academic_years (school_id, label, start_year, status) VALUES
       ($1, '2024-2025', 2024, 'closed'), ($1, '2025-2026', 2025, 'active')
     RETURNING id, start_year`,
    [schoolId],
  );
  lastYear = ys.rows.find((r) => r.start_year === 2024)!.id;

  const level = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order)
     VALUES ($1, '6eme', 10000, 'college', 10) RETURNING id`,
    [schoolId],
  );
  const gs = await owner.query<{ id: string; name: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6eme A'), ($1, $2, '6eme B')
     RETURNING id, name`,
    [schoolId, level.rows[0]!.id],
  );
  groupA = gs.rows.find((r) => r.name === '6eme A')!.id;
  groupB = gs.rows.find((r) => r.name === '6eme B')!.id;

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('cand.admin@test', 'x', 'Direction') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  controller = moduleRef.get(EnrollmentController);
  debts = moduleRef.get(DebtService);
});

afterAll(async () => {
  await owner?.end();
});

describe('les candidats de l’année précédente', () => {
  it('⚠ une famille de quatre enfants annonce UNE dette, pas quatre', async () => {
    const { guardianId } = await household('quatre', 4, groupA);
    await inTenant(() =>
      debts.createMiscDebt(
        { debtorName: 'Famille quatre', guardianId, total: '8000.00', reason: 'Arriere' },
        ACTOR,
      ),
    );

    const page = await inTenant(() => controller.reEnrolCandidates());
    const fam = page.families.find((f) => f.guardianId === guardianId)!;

    expect(fam.children).toHaveLength(4);
    expect(fam.debt).toBe('8000.00');
    // La somme du détail EST le total affiché à côté du nom.
    const sum = fam.lines.reduce((n, l) => n + Number(l.amount), 0);
    expect(sum.toFixed(2)).toBe(fam.debt);
  });

  it('⚠ les familles bloquées d’abord', async () => {
    const clean = await household('ajour', 1, groupA);

    const page = await inTenant(() => controller.reEnrolCandidates());
    const blockedIdx = page.families.findIndex((f) => f.blocked);
    const cleanIdx = page.families.findIndex((f) => f.guardianId === clean.guardianId);

    expect(blockedIdx).toBeGreaterThanOrEqual(0);
    expect(blockedIdx).toBeLessThan(cleanIdx);
    expect(page.blockedCount).toBeGreaterThan(0);
  });

  it('une famille à jour n’est pas bloquée et ses enfants sont cochables', async () => {
    const { guardianId } = await household('ajour2', 2, groupA);
    const page = await inTenant(() => controller.reEnrolCandidates());
    const fam = page.families.find((f) => f.guardianId === guardianId)!;

    expect(fam.debt).toBe('0.00');
    expect(fam.blocked).toBe(false);
    expect(fam.children.every((c) => !c.blocked)).toBe(true);
  });

  it('une autorisation lève le blocage sans toucher à la dette', async () => {
    const { guardianId, studentIds } = await household('autor', 1, groupA);
    await inTenant(() =>
      debts.createMiscDebt({ debtorName: 'Famille autor', guardianId, total: '3000.00' }, ACTOR),
    );

    const before = await inTenant(() => controller.reEnrolCandidates());
    expect(before.families.find((f) => f.guardianId === guardianId)!.blocked).toBe(true);

    await inTenant(() =>
      controller.authoriseDespiteDebt(
        { studentId: studentIds[0]!, reason: 'Échéancier' },
        { auth: { userId: ACTOR, permissions: ['scolarite.niveaux'] } } as never,
      ),
    );

    const after = await inTenant(() => controller.reEnrolCandidates());
    const fam = after.families.find((f) => f.guardianId === guardianId)!;
    expect(fam.authorised).toBe(true);
    expect(fam.blocked).toBe(false);
    // ⚠ La dette est toujours là. Autoriser n'est pas remettre.
    expect(fam.debt).toBe('3000.00');
  });

  it('le filtre par classe d’origine ne rend que cette classe', async () => {
    const { guardianId } = await household('classeB', 1, groupB);

    const filtered = await inTenant(() => controller.reEnrolCandidates(undefined, groupB));
    expect(filtered.families.map((f) => f.guardianId)).toContain(guardianId);
    expect(
      filtered.families.every((f) => f.children.every((c) => c.fromGroup === '6eme B')),
    ).toBe(true);
  });

  it('un élève déjà réinscrit est marqué, pas proposé une seconde fois', async () => {
    const { studentIds } = await household('deja', 1, groupA);
    await inTenant(() =>
      controller.bulkReEnrol(
        { studentIds: [studentIds[0]!], groupId: groupA },
        { auth: { userId: ACTOR, permissions: CLERK } } as never,
      ),
    );

    const page = await inTenant(() => controller.reEnrolCandidates());
    const child = page.families
      .flatMap((f) => f.children)
      .find((c) => c.studentId === studentIds[0]);
    expect(child!.alreadyEnrolled).toBe(true);
    expect(child!.blocked).toBe(false);
  });
});
