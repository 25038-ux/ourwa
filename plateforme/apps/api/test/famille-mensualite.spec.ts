import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { DebtService } from '../src/finance/debt.service.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LA MENSUALITÉ DE CHAQUE ENFANT SOUS LA FICHE DU CORRESPONDANT — El Mourad,
 * 0.7.9 : « a student exempted is still shown a fee in the little students
 * brief … i want that total mensuel to be affected by reductions and
 * exemptions and an exempted student to be shown as Gratuit ».
 *
 * Le mois de référence : le mois en cours, sinon le prochain mois de l'année,
 * sinon (année passée) le dernier. Une année passée ici (2019-2020) : juin 2020.
 */

let owner: pg.Pool;
let debts: DebtService;
let enrollments: EnrollmentService;
let schoolId: string;
let yearId: string;
let groupId: string;
let guardianId: string;
let ACTOR: string;
const ids: Record<string, string> = {};

const START_YEAR = 2019;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'mens' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  schoolId = (await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('mens', 'Mensualités', 'MEN') RETURNING id`,
  )).rows[0]!.id;
  yearId = (await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status) VALUES ($1, '2019-2020', $2, 'active') RETURNING id`,
    [schoolId, START_YEAR],
  )).rows[0]!.id;
  const level = (await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle) VALUES ($1, '5eme', 10000, 'college') RETURNING id`,
    [schoolId],
  )).rows[0]!.id;
  groupId = (await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '5eme A') RETURNING id`, [schoolId, level],
  )).rows[0]!.id;
  ACTOR = (await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('mens.caisse@test', 'x', 'Caisse') RETURNING id`,
  )).rows[0]!.id;
  guardianId = (await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('mens.parent@test', 'x', 'Parent') RETURNING id`,
  )).rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  debts = moduleRef.get(DebtService);
  enrollments = moduleRef.get(EnrollmentService);

  for (const prenom of ['Amal', 'Bakar', 'Cheikh', 'Dieynaba']) {
    ids[prenom] = (await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5, 'Mens') RETURNING id`,
      [schoolId, guardianId, `RIM-MEN-${prenom}`, `NID-MEN-${prenom}`, prenom],
    )).rows[0]!.id;
    await inTenant(() =>
      enrollments.enrol({ studentId: ids[prenom]!, academicYearId: yearId, groupId, entryDate: `${START_YEAR}-10-01` }, ACTOR, ['scolarite.niveaux']),
    );
  }
  // Bakar : une réduction de 2 500 sur le mois de référence (juin 2020).
  await owner.query(
    `INSERT INTO discounts (school_id, student_id, calendar_month, calendar_year, amount) VALUES ($1, $2, 6, 2020, 2500)`,
    [schoolId, ids.Bakar],
  );
  // Cheikh : exempté (total).
  await owner.query(`INSERT INTO exemptions (school_id, student_id, kind) VALUES ($1, $2, 'full')`, [schoolId, ids.Cheikh]);
  // Dieynaba : le mois de référence exempté seul.
  await owner.query(
    `INSERT INTO exemptions (school_id, student_id, kind, calendar_month, calendar_year) VALUES ($1, $2, 'monthly', 6, 2020)`,
    [schoolId, ids.Dieynaba],
  );
});

afterAll(async () => {
  await owner?.end();
});

describe('la mensualité de chaque enfant', () => {
  it('⚠ exempté : « Gratuit », 0 ; réduit : le tarif moins la réduction ; mois exempté : 0', async () => {
    const enfants = await inTenant(() => debts.childrenInSchool(guardianId, yearId));
    const par = Object.fromEntries(enfants.map((c) => [c.name.split(' ')[0], c]));
    expect(par.Amal).toMatchObject({ fee: '10000.00', fullFee: '10000.00', free: false, discount: '0.00' });
    expect(par.Bakar).toMatchObject({ fee: '7500.00', fullFee: '10000.00', free: false, discount: '2500.00' });
    expect(par.Cheikh).toMatchObject({ fee: '0.00', free: true, exempt: true });
    expect(par.Dieynaba).toMatchObject({ fee: '0.00', free: false, monthExempt: true });
    expect(par.Bakar!.refMonth).toEqual({ month: 6, year: 2020 });
  });

  it('⚠ le total mensuel de la famille les compte ainsi : 10 000 + 7 500 + 0 + 0', async () => {
    const enfants = await inTenant(() => debts.childrenInSchool(guardianId, yearId));
    const total = enfants.reduce((a, c) => a + Number(c.fee), 0);
    expect(total).toBe(17500);
    expect(enfants.filter((c) => c.free)).toHaveLength(1);
  });
});
