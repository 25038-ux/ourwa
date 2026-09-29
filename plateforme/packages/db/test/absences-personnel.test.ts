import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { withTenant, type Queryable } from '../src/client.js';

/**
 * LES ABSENCES DU PERSONNEL — CE QUE LA BASE GARANTIT D'ELLE-MÊME (0043).
 *
 * ADR-0074. Le service vérifie tout cela aussi (l'emploi du temps, les
 * horaires) ; ces tests tiennent ce qui reste vrai quand un script ou un
 * `psql` passe à côté du code :
 *
 *   - une absence désigne UNE personne de la bonne population, avec un créneau
 *     (professeur) ou des heures (agent) ;
 *   - une séance, une période ne se manquent qu'une fois ;
 *   - des horaires dans le bon ordre ;
 *   - l'isolation : une autre école ne lit rien et ne peut rien désigner.
 *
 * Écrites sous `app_user`, dans `withTenant` : l'isolation joue pour de vrai.
 */

let owner: pg.Pool;
let app: pg.Pool;
let ecoleA: string;
let ecoleB: string;
let prof: string;
let agent: string;
let groupe: string;

const A = <T>(fn: (tx: Queryable) => Promise<T>) => withTenant(ecoleA, fn, app);
const B = <T>(fn: (tx: Queryable) => Promise<T>) => withTenant(ecoleB, fn, app);

async function one<T>(tx: Queryable, sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await tx.query(sql, params);
  return rows[0] as T;
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  app = new pg.Pool({ connectionString: process.env.DATABASE_APP_URL });
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES
       ('abs-a', 'Absences A', 'ABA'), ('abs-b', 'Absences B', 'ABB')
     RETURNING id`,
  );
  ecoleA = rows[0]!.id;
  ecoleB = rows[1]!.id;
  await A(async (tx) => {
    prof = (await one<{ id: string }>(
      tx,
      `INSERT INTO teachers (school_id, first_name, last_name) VALUES ($1, 'Ahmed', 'Prof') RETURNING id`,
      [ecoleA],
    )).id;
    agent = (await one<{ id: string }>(
      tx,
      `INSERT INTO staff (school_id, first_name, last_name, role_title) VALUES ($1, 'Mariem', 'Agent', 'Surveillante') RETURNING id`,
      [ecoleA],
    )).id;
    const niveau = (await one<{ id: string }>(
      tx,
      `INSERT INTO levels (school_id, name, monthly_rate) VALUES ($1, '6ème', 1000) RETURNING id`,
      [ecoleA],
    )).id;
    groupe = (await one<{ id: string }>(
      tx,
      `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6ème A') RETURNING id`,
      [ecoleA, niveau],
    )).id;
  });
});

afterAll(async () => {
  await owner?.query('DELETE FROM schools WHERE id = ANY($1)', [[ecoleA, ecoleB]]);
  await app?.end();
  await owner?.end();
});

const seance = (tx: Queryable, date: string, slot: number | null, g: string | null = groupe) =>
  tx.query(
    `INSERT INTO personnel_absences (school_id, person_kind, teacher_id, absence_date, slot, group_id, minutes, label)
     VALUES ($1, 'teacher', $2, $3, $4, $5, 105, '6ème A — Mathématiques')`,
    [ecoleA, prof, date, slot, g],
  );

const periode = (tx: Queryable, date: string, debut: string | null, fin: string | null) =>
  tx.query(
    `INSERT INTO personnel_absences (school_id, person_kind, staff_id, absence_date, starts_at, ends_at, minutes, label)
     VALUES ($1, 'staff', $2, $3, $4, $5, 60, 'Surveillante')`,
    [ecoleA, agent, date, debut, fin],
  );

describe('les horaires des agents', () => {
  it('se posent jour par jour, dans le bon ordre', async () => {
    await A((tx) =>
      tx.query(
        `INSERT INTO staff_work_hours (school_id, staff_id, day_of_week, starts_at, ends_at)
         VALUES ($1, $2, 1, '07:30', '14:30')`,
        [ecoleA, agent],
      ),
    );
    await expect(
      A((tx) =>
        tx.query(
          `INSERT INTO staff_work_hours (school_id, staff_id, day_of_week, starts_at, ends_at)
           VALUES ($1, $2, 2, '14:30', '07:30')`,
          [ecoleA, agent],
        ),
      ),
    ).rejects.toThrow(/staff_work_hours_ordre/);
  });

  it('partent avec la fiche de l’agent', async () => {
    const autre = await A(async (tx) => {
      const s = await one<{ id: string }>(
        tx,
        `INSERT INTO staff (school_id, first_name, last_name, role_title) VALUES ($1, 'X', 'Y', 'Gardien') RETURNING id`,
        [ecoleA],
      );
      await tx.query(
        `INSERT INTO staff_work_hours (school_id, staff_id, day_of_week, starts_at, ends_at) VALUES ($1, $2, 3, '07:00', '17:00')`,
        [ecoleA, s.id],
      );
      await tx.query('DELETE FROM staff WHERE id = $1', [s.id]);
      return s.id;
    });
    const r = await owner.query('SELECT count(*)::int AS n FROM staff_work_hours WHERE staff_id = $1', [autre]);
    expect(r.rows[0]!.n).toBe(0);
  });
});

describe('une absence désigne une personne, de la bonne façon', () => {
  it('professeur : un créneau est exigé', async () => {
    await expect(A((tx) => seance(tx, '2026-10-05', null))).rejects.toThrow(/personnel_absences_personne/);
    await A((tx) => seance(tx, '2026-10-05', 1));
  });

  it('agent : des heures sont exigées, dans le bon ordre', async () => {
    await expect(A((tx) => periode(tx, '2026-10-05', null, null))).rejects.toThrow(/personnel_absences_personne/);
    await expect(A((tx) => periode(tx, '2026-10-05', '14:00', '08:00'))).rejects.toThrow(/personnel_absences_heures/);
    await A((tx) => periode(tx, '2026-10-05', '07:30', '14:30'));
  });

  it('jamais les deux populations à la fois', async () => {
    await expect(
      A((tx) =>
        tx.query(
          `INSERT INTO personnel_absences (school_id, person_kind, teacher_id, staff_id, absence_date, slot, label)
           VALUES ($1, 'teacher', $2, $3, '2026-10-06', 2, 'x')`,
          [ecoleA, prof, agent],
        ),
      ),
    ).rejects.toThrow(/personnel_absences_personne/);
  });

  it('une séance ne se manque qu’une fois, une période non plus', async () => {
    await expect(A((tx) => seance(tx, '2026-10-05', 1))).rejects.toThrow(/personnel_absences_seance_uq/);
    await expect(A((tx) => periode(tx, '2026-10-05', '07:30', '14:30'))).rejects.toThrow(/personnel_absences_periode_uq/);
    // Le même créneau un autre jour, une autre séance : permis.
    await A((tx) => seance(tx, '2026-10-06', 1));
  });

  it('la classe supprimée, l’absence reste avec son libellé', async () => {
    await A(async (tx) => {
      const g = await one<{ id: string }>(
        tx,
        `INSERT INTO groups (school_id, level_id, name) SELECT school_id, level_id, '6ème Z' FROM groups WHERE id = $1 RETURNING id`,
        [groupe],
      );
      await seance(tx, '2026-10-07', 3, g.id);
      await tx.query('DELETE FROM groups WHERE id = $1', [g.id]);
    });
    const r = await owner.query<{ group_id: string | null; label: string }>(
      `SELECT group_id, label FROM personnel_absences WHERE teacher_id = $1 AND absence_date = '2026-10-07'`,
      [prof],
    );
    expect(r.rows).toEqual([{ group_id: null, label: '6ème A — Mathématiques' }]);
  });
});

describe('isolation (règles 1 et 5)', () => {
  it('une autre école ne voit ni les horaires ni les absences', async () => {
    const n = await B(async (tx) => ({
      horaires: (await one<{ n: number }>(tx, 'SELECT count(*)::int AS n FROM staff_work_hours')).n,
      absences: (await one<{ n: number }>(tx, 'SELECT count(*)::int AS n FROM personnel_absences')).n,
    }));
    expect(n).toEqual({ horaires: 0, absences: 0 });
    const a = await A(async (tx) => (await one<{ n: number }>(tx, 'SELECT count(*)::int AS n FROM personnel_absences')).n);
    expect(a).toBeGreaterThan(0);
  });

  it('⚠ une autre école ne peut pas déclarer absent un professeur de A, même en connaissant son id', async () => {
    await expect(
      B((tx) =>
        tx.query(
          `INSERT INTO personnel_absences (school_id, person_kind, teacher_id, absence_date, slot, label)
           VALUES ($1, 'teacher', $2, '2026-10-08', 1, 'x')`,
          [ecoleB, prof],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
    // …ni écrire sous le nom de A.
    await expect(
      B((tx) =>
        tx.query(
          `INSERT INTO personnel_absences (school_id, person_kind, teacher_id, absence_date, slot, label)
           VALUES ($1, 'teacher', $2, '2026-10-08', 1, 'x')`,
          [ecoleA, prof],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
