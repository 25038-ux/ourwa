import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

/**
 * ⚠ « ON DELETE SET NULL » SUR UNE CLÉ COMPOSITE VIDE TOUTES SES COLONNES —
 * `school_id` COMPRIS.
 *
 * Nos clés étrangères sont composites pour qu'une référence d'un tenant vers un
 * autre soit structurellement impossible (règle 5) : `(school_id, level_id)`
 * plutôt que `(level_id)`. Mais l'action `SET NULL` par défaut porte sur la clé
 * ENTIÈRE, et `school_id` est `NOT NULL` partout. Huit contraintes étaient donc
 * inapplicables, sans que rien ne le dise avant le jour de la suppression :
 *
 *     DELETE FROM levels WHERE id = …
 *     ERROR: null value in column "school_id" of relation "groups"
 *            violates not-null constraint
 *
 * « Supprimer le niveau » ne détachait pas les classes : il échouait, avec une
 * erreur brute de la base, exactement dans le cas où l'on veut le supprimer.
 *
 * Ce test tient les huit. Il ne vérifie pas la forme de la contrainte mais son
 * EFFET : la suppression passe, la colonne référencée tombe à NULL, et
 * `school_id` reste.
 */

let owner: pg.Pool;
let schoolId: string;

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const s = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('fkset', 'FK Set', 'FKS')
     RETURNING id`,
  );
  schoolId = s.rows[0]!.id;
});

afterAll(async () => {
  await owner?.end();
});

describe('la forme des contraintes', () => {
  it('⚠ aucune clé composite ne vide encore school_id', async () => {
    // `confdelsetcols` nomme les colonnes que SET NULL doit vider. Vide = toute
    // la clé, et c'est le défaut qui casse.
    const { rows } = await owner.query<{ child: string; def: string }>(
      `SELECT c.conrelid::regclass::text AS child, pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
        WHERE c.contype = 'f'
          AND c.confdeltype = 'n'
          AND array_length(c.conkey, 1) > 1
          AND (c.confdelsetcols IS NULL OR array_length(c.confdelsetcols, 1) IS NULL)`,
    );
    expect(rows.map((r) => `${r.child}: ${r.def}`)).toEqual([]);
  });
});

describe('supprimer le parent détache l’enfant, sans le tuer', () => {
  it('un niveau supprimé laisse ses classes, sans niveau', async () => {
    const lv = await owner.query<{ id: string }>(
      `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order)
       VALUES ($1, 'Niveau FK', 0, 'college', 1) RETURNING id`,
      [schoolId],
    );
    const g = await owner.query<{ id: string }>(
      `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, 'Classe FK')
       RETURNING id`,
      [schoolId, lv.rows[0]!.id],
    );

    await expect(
      owner.query('DELETE FROM levels WHERE id = $1', [lv.rows[0]!.id]),
    ).resolves.toBeDefined();

    const { rows } = await owner.query<{ level_id: string | null; school_id: string }>(
      'SELECT level_id, school_id FROM groups WHERE id = $1',
      [g.rows[0]!.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.level_id).toBeNull();
    // ⚠ Et l'école est toujours là. C'est tout l'objet du correctif.
    expect(rows[0]!.school_id).toBe(schoolId);
  });

  it('une classe supprimée laisse ses inscriptions, sans classe', async () => {
    const y = await owner.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, label, start_year, status)
       VALUES ($1, '2030-2031', 2030, 'future') RETURNING id`,
      [schoolId],
    );
    const lv = await owner.query<{ id: string }>(
      `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order)
       VALUES ($1, 'Niveau FK2', 0, 'college', 2) RETURNING id`,
      [schoolId],
    );
    const g = await owner.query<{ id: string }>(
      `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, 'Classe FK2')
       RETURNING id`,
      [schoolId, lv.rows[0]!.id],
    );
    const st = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
       VALUES ($1, 'RIM-FK', 'NID-FK', 'Enfant', 'FK') RETURNING id`,
      [schoolId],
    );
    const en = await owner.query<{ id: string }>(
      `INSERT INTO enrollments
         (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee)
       VALUES ($1, $2, $3, $4, $5, 'enrolled', 0) RETURNING id`,
      [schoolId, st.rows[0]!.id, y.rows[0]!.id, g.rows[0]!.id, lv.rows[0]!.id],
    );

    await expect(
      owner.query('DELETE FROM groups WHERE id = $1', [g.rows[0]!.id]),
    ).resolves.toBeDefined();

    const { rows } = await owner.query<{ group_id: string | null; school_id: string }>(
      'SELECT group_id, school_id FROM enrollments WHERE id = $1',
      [en.rows[0]!.id],
    );
    expect(rows[0]!.group_id).toBeNull();
    expect(rows[0]!.school_id).toBe(schoolId);
  });

  it('⚠ un élève supprimé ne fait pas disparaître la créance de sa famille', async () => {
    // La dette appartient au correspondant ; le lien vers l'enfant ne dit que
    // d'où elle vient. La perdre effacerait de l'argent réclamé.
    const guardian = await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('fkset.parent@test', 'x', 'Famille FK') RETURNING id`,
    );
    const st = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, 'RIM-FK3', 'NID-FK3', 'Enfant', 'Creance') RETURNING id`,
      [schoolId, guardian.rows[0]!.id],
    );
    const d = await owner.query<{ id: string }>(
      `INSERT INTO misc_debts (school_id, guardian_id, student_id, debtor_name, total, repaid)
       VALUES ($1, $2, $3, 'Famille FK', 7000, 0) RETURNING id`,
      [schoolId, guardian.rows[0]!.id, st.rows[0]!.id],
    );

    await expect(
      owner.query('DELETE FROM students WHERE id = $1', [st.rows[0]!.id]),
    ).resolves.toBeDefined();

    const { rows } = await owner.query<{
      student_id: string | null;
      total: string;
      guardian_id: string;
    }>('SELECT student_id, total::text, guardian_id FROM misc_debts WHERE id = $1', [d.rows[0]!.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.student_id).toBeNull();
    expect(rows[0]!.total).toBe('7000.00');
    expect(rows[0]!.guardian_id).toBe(guardian.rows[0]!.id);
  });

  it('une remise survit à l’année sur laquelle elle portait', async () => {
    const guardian = await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('fkset.remise@test', 'x', 'Famille Remise') RETURNING id`,
    );
    const y = await owner.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, label, start_year, status)
       VALUES ($1, '2031-2032', 2031, 'future') RETURNING id`,
      [schoolId],
    );
    const w = await owner.query<{ id: string }>(
      `INSERT INTO debt_write_offs
         (school_id, guardian_id, academic_year_id, amount, clears_all, reason)
       VALUES ($1, $2, $3, 1000, false, 'Test FK') RETURNING id`,
      [schoolId, guardian.rows[0]!.id, y.rows[0]!.id],
    );

    await expect(
      owner.query('DELETE FROM academic_years WHERE id = $1', [y.rows[0]!.id]),
    ).resolves.toBeDefined();

    const { rows } = await owner.query<{ academic_year_id: string | null; amount: string }>(
      'SELECT academic_year_id, amount::text FROM debt_write_offs WHERE id = $1',
      [w.rows[0]!.id],
    );
    expect(rows[0]!.academic_year_id).toBeNull();
    expect(rows[0]!.amount).toBe('1000.00');
  });
});
