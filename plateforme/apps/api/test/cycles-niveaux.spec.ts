import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { ReferenceService } from '../src/academic/reference.service.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LES NIVEAUX CLASSÉS PAR CYCLE — demande du propriétaire de Jinan (30/09/2026) :
 * Maternelle, Fondamentale, Collège, Lycée, dans cet ordre, un intertitre
 * entre chacun. Migrations 0045 (le cycle « maternelle ») et 0046 (les
 * niveaux déjà créés sur le site de Jinan).
 */

let owner: pg.Pool;
let reference: ReferenceService;
let enrollments: EnrollmentService;
let schoolId: string;
let ACTOR: string;

function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'cycles' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const s = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('cycles', 'Cycles', 'CYC') RETURNING id`,
  );
  schoolId = s.rows[0]!.id;
  const a = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('cycles.dir@test', 'x', 'Direction') RETURNING id`,
  );
  ACTOR = a.rows[0]!.id;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  reference = moduleRef.get(ReferenceService);
  enrollments = moduleRef.get(EnrollmentService);
});

afterAll(async () => {
  await owner?.query(`DELETE FROM schools WHERE slug = 'jinan' AND name = 'Jinan (essai 0046)'`);
  await owner?.end();
});

describe('le cycle « maternelle »', () => {
  const ids: Record<string, string> = {};

  it('se crée comme les autres', async () => {
    for (const [name, cycle, sortOrder] of [
      ['1AS', 'college', 1],
      ['GS', 'maternelle', 2],
      ['TPS', 'maternelle', 1],
      ['Divers', 'autre', 0],
      ['5AS', 'lycee', 1],
      ['6AF', 'fondamental', 1],
    ] as const) {
      const l = (await inTenant(() => reference.createLevel({ name, monthlyRate: '0', cycle, sortOrder }))) as { id: string; cycle: string };
      expect(l.cycle).toBe(cycle);
      ids[name] = l.id;
    }
  });

  it('⚠ les listes suivent la scolarité : maternelle, fondamentale, collège, lycée, puis « autre »', async () => {
    const levels = (await inTenant(() => reference.levels())) as { name: string; cycle: string }[];
    expect(levels.map((l) => l.name)).toEqual(['TPS', 'GS', '6AF', '1AS', '5AS', 'Divers']);
  });

  it('reclasser un niveau : son cycle et son rang, journalisés', async () => {
    const r = await inTenant(() => reference.setLevelClassification(ids['Divers']!, 'maternelle', 3, ACTOR));
    expect(r).toEqual({ cycle: 'maternelle', sortOrder: 3 });
    const levels = (await inTenant(() => reference.levels())) as { name: string }[];
    expect(levels.map((l) => l.name)).toEqual(['TPS', 'GS', 'Divers', '6AF', '1AS', '5AS']);
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log WHERE entity_id = $1 AND action = 'level_classification_changed'`,
      [ids['Divers']],
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('refuse un cycle inconnu et un rang hors bornes, en français', async () => {
    await expect(inTenant(() => reference.setLevelClassification(ids['GS']!, 'primaire', 1, ACTOR))).rejects.toThrow(/Cycle inconnu/);
    await expect(inTenant(() => reference.setLevelClassification(ids['GS']!, 'maternelle', -1, ACTOR))).rejects.toThrow(/rang/);
  });

  it('⚠ de la maternelle à la fondamentale, c’est monter : réservé à la direction pour un ajourné', async () => {
    const year = await owner.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, label, start_year, status) VALUES ($1, '2024-2025', 2024, 'closed') RETURNING id`,
      [schoolId],
    );
    const group = await owner.query<{ id: string }>(
      `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, 'GS A') RETURNING id`,
      [schoolId, ids['GS']],
    );
    const eleve = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, first_name, last_name) VALUES ($1, 'Petit', 'Ajourné') RETURNING id`,
      [schoolId],
    );
    await owner.query(
      `INSERT INTO enrollments (school_id, student_id, academic_year_id, group_id, level_id, status, outcome)
       VALUES ($1, $2, $3, $4, $5, 'archived', 'held_back')`,
      [schoolId, eleve.rows[0]!.id, year.rows[0]!.id, group.rows[0]!.id, ids['GS']],
    );
    const refus = await inTenant(() =>
      enrollments.refuseProgression(eleve.rows[0]!.id, { start_year: 2025 } as never, ids['6AF']!, []),
    );
    expect(refus).toMatch(/réservé à la direction/);
    // Redoubler la GS : permis.
    expect(
      await inTenant(() => enrollments.refuseProgression(eleve.rows[0]!.id, { start_year: 2025 } as never, ids['GS']!, [])),
    ).toBeNull();
  });
});

describe('0046 — les niveaux de Jinan', () => {
  it('classe les niveaux de l’école « jinan » dans l’ordre demandé, et elle seule', async () => {
    const j = await owner.query<{ id: string }>(
      `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('jinan', 'Jinan (essai 0046)', 'JNT') RETURNING id`,
    );
    const jinanId = j.rows[0]!.id;
    // Créés comme sur le site : tous « autre », rang 0 ; des espaces et des
    // minuscules en plus, et un niveau que la demande ne nomme pas.
    const noms = ['7AS', '1 AS', 'tps', 'PS', 'SM', 'GS', 'PGS', 'PGS B', '6AF', '2AS', '3AS', '4AS', '5AS', '6AS', 'CP'];
    for (const n of noms) {
      await owner.query(`INSERT INTO levels (school_id, name, monthly_rate) VALUES ($1, $2, 0)`, [jinanId, n]);
    }
    // Une autre école aux mêmes noms : intouchée.
    await owner.query(`INSERT INTO levels (school_id, name, monthly_rate) VALUES ($1, 'PS', 0)`, [schoolId]);

    const sql = readFileSync(
      fileURLToPath(new URL('../../../packages/db/migrations/0046_jinan_niveaux_par_cycle.sql', import.meta.url)),
      'utf8',
    );
    await owner.query(sql);

    const { rows } = await owner.query<{ name: string; cycle: string; sort_order: number }>(
      `SELECT l.name, l.cycle::text AS cycle, l.sort_order FROM levels l WHERE l.school_id = $1 ORDER BY l.cycle, l.sort_order, l.name`,
      [jinanId],
    );
    expect(rows.map((r) => `${r.cycle}:${r.sort_order}:${r.name}`)).toEqual([
      'maternelle:1:tps',
      'maternelle:2:PS',
      'maternelle:3:SM',
      'maternelle:4:GS',
      'maternelle:5:PGS',
      'maternelle:6:PGS B',
      'fondamental:1:6AF',
      'college:1:1 AS',
      'college:2:2AS',
      'college:3:3AS',
      'college:4:4AS',
      'lycee:1:5AS',
      'lycee:2:6AS',
      'lycee:3:7AS',
      'autre:0:CP',
    ]);
    const autre = await owner.query<{ cycle: string; sort_order: number }>(
      `SELECT cycle::text, sort_order FROM levels WHERE school_id = $1 AND name = 'PS'`,
      [schoolId],
    );
    expect(autre.rows[0]).toEqual({ cycle: 'autre', sort_order: 0 });
  });
});
