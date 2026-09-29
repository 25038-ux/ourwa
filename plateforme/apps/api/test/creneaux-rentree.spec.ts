import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PedagogyService } from '../src/pedagogy/pedagogy.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * « GÉRER L'ABSENCE » À LA RENTRÉE — démonstration, 23/09/2026 : « Pas
 * d'emploi du temps » sous une grille pleine.
 *
 * La grille d'un groupe est unique ; ses cases désignent les enseignements de
 * l'an dernier tant que les affectations ne sont pas refaites. La case est
 * retenue si la même matière est enseignée au groupe cette année, et c'est
 * l'enseignement de CETTE année que l'appel enregistre (sa règle : « sans
 * elle, on saisissait l'appel d'aujourd'hui sur des matières d'une année
 * passée »). Une matière que plus personne n'enseigne au groupe cette année
 * disparaît de la liste.
 */

let owner: pg.Pool;
let pedagogy: PedagogyService;
let schoolId: string;
let y2526: string;
let y2627: string;
let groupId: string;
let mathsNouveau: string;
let mathsAncien: string;

const inTenant = <T>(fn: () => Promise<T>) => runInTenant({ schoolId, slug: 'creneaux' }, fn);

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const q = async <T,>(sql: string, params: unknown[] = []) => (await owner.query<T & { id: string }>(sql, params)).rows[0]!;
  schoolId = (await q(`INSERT INTO schools (slug, name, receipt_prefix) VALUES ('creneaux', 'Creneaux', 'CRN') RETURNING id`)).id;
  y2526 = (
    await q(
      `INSERT INTO academic_years (school_id, label, start_year, start_month, end_month, status)
       VALUES ($1, '2025-2026', 2025, 10, 6, 'closed') RETURNING id`,
      [schoolId],
    )
  ).id;
  y2627 = (
    await q(
      `INSERT INTO academic_years (school_id, label, start_year, start_month, end_month, status)
       VALUES ($1, '2026-2027', 2026, 10, 6, 'active') RETURNING id`,
      [schoolId],
    )
  ).id;
  const levelId = (await q(`INSERT INTO levels (school_id, name, monthly_rate, cycle) VALUES ($1, '4eme', 20000, 'college') RETURNING id`, [schoolId])).id;
  groupId = (await q(`INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '4eme A') RETURNING id`, [schoolId, levelId])).id;
  const maths = (await q(`INSERT INTO subjects (school_id, level_id, name) VALUES ($1, $2, 'Maths') RETURNING id`, [schoolId, levelId])).id;
  const dessin = (await q(`INSERT INTO subjects (school_id, level_id, name) VALUES ($1, $2, 'Dessin') RETURNING id`, [schoolId, levelId])).id;
  const profA = (await q(`INSERT INTO teachers (school_id, first_name, last_name) VALUES ($1, 'Ancien', 'Prof') RETURNING id`, [schoolId])).id;
  const profB = (await q(`INSERT INTO teachers (school_id, first_name, last_name) VALUES ($1, 'Nouveau', 'Prof') RETURNING id`, [schoolId])).id;
  const teaching = async (year: string, teacher: string, subject: string) =>
    (
      await q(
        `INSERT INTO teachings (school_id, academic_year_id, teacher_id, group_id, subject_id, hours_per_week)
         VALUES ($1, $2, $3, $4, $5, 4) RETURNING id`,
        [schoolId, year, teacher, groupId, subject],
      )
    ).id;
  mathsAncien = await teaching(y2526, profA, maths);
  mathsNouveau = await teaching(y2627, profB, maths);
  const dessinAncien = await teaching(y2526, profA, dessin);
  // La grille de l'an dernier : maths le mercredi en 1re heure, dessin en 2e.
  await owner.query(
    `INSERT INTO timetable_slots (school_id, group_id, teaching_id, day_of_week, slot) VALUES ($1, $2, $3, 3, 1), ($1, $2, $4, 3, 2)`,
    [schoolId, groupId, mathsAncien, dessinAncien],
  );
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  pedagogy = moduleRef.get(PedagogyService);
});

afterAll(async () => {
  await owner?.end();
});

describe('les créneaux du jour à la rentrée', () => {
  it('retient la case et désigne l’enseignement de l’année ; oublie la matière que plus personne n’enseigne', async () => {
    const rows = await inTenant(() => pedagogy.creneauxDuJour(groupId, '2026-09-23', y2627)); // un mercredi
    expect(rows.map((r) => [r.creneau, r.matiere_nom, r.enseignement_id, r.prof_prenom])).toEqual([
      ['8h-9h45', 'Maths', mathsNouveau, 'Nouveau'],
    ]);
  });

  it('l’année de la grille elle-même voit ses deux cases, telles quelles', async () => {
    const rows = await inTenant(() => pedagogy.creneauxDuJour(groupId, '2026-03-11', y2526)); // un mercredi
    expect(rows.map((r) => [r.matiere_nom, r.enseignement_id])).toEqual([
      ['Maths', mathsAncien],
      ['Dessin', expect.any(String)],
    ]);
  });
});
