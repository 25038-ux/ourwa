import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

/**
 * LA BASE REFUSE ELLE-MÊME D'EFFACER DES NOTES ET DES SALAIRES — migration 0025.
 *
 * ADR-0042 a bouché deux trous dans le SERVICE. ⚠ Mais un garde applicatif ne
 * protège que les chemins qu'on connaît : le prochain écran, le prochain import,
 * la prochaine tâche de nettoyage passeront à côté, et un `DELETE` lancé à la
 * main dans psql un soir de reprise n'en saura rien. Ces tests parlent donc à la
 * base directement, en contournant tout le code applicatif — c'est le seul
 * moyen de vérifier que la contrainte existe vraiment.
 *
 * ⚠ ET ILS TIENNENT LES DEUX CÔTÉS DE `NO ACTION` PLUTÔT QUE `RESTRICT` :
 * refuser « supprime cette assignation et perds ses notes », et continuer
 * d'autoriser « supprime cette école ». `RESTRICT`, vérifié immédiatement,
 * casserait le second — la contrainte se déclencherait avant que la cascade
 * voisine n'ait retiré les lignes qui la gênent.
 */

let owner: pg.Pool;

/** Une école entière, avec une note et un salaire du soir à protéger. */
async function ecole(slug: string) {
  const s = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ($1, $1, $2) RETURNING id`,
    [slug, slug.slice(0, 3).toUpperCase()],
  );
  const schoolId = s.rows[0]!.id;

  const y = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2025-2026', 2025, 'active') RETURNING id`,
    [schoolId],
  );
  const yearId = y.rows[0]!.id;

  const l = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order)
     VALUES ($1, '6eme', 3000, 'college', 10) RETURNING id`,
    [schoolId],
  );
  const g = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6A') RETURNING id`,
    [schoolId, l.rows[0]!.id],
  );
  const groupId = g.rows[0]!.id;

  const t = await owner.query<{ id: string }>(
    `INSERT INTO teachers (school_id, first_name, last_name, salary, hourly_rate)
     VALUES ($1, 'Prof', $2, 50000, 400) RETURNING id`,
    [schoolId, slug],
  );
  const sub = await owner.query<{ id: string }>(
    `INSERT INTO subjects (school_id, name, coefficient) VALUES ($1, 'Calcul', 2) RETURNING id`,
    [schoolId],
  );
  const teaching = await owner.query<{ id: string }>(
    `INSERT INTO teachings
       (school_id, academic_year_id, group_id, subject_id, teacher_id, hours_per_week)
     VALUES ($1, $2, $3, $4, $5, 4) RETURNING id`,
    [schoolId, yearId, groupId, sub.rows[0]!.id, t.rows[0]!.id],
  );
  const teachingId = teaching.rows[0]!.id;

  const st = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, $3, 'Eleve', $4) RETURNING id`,
    [schoolId, `RIM-${slug}`, `NID-${slug}`, slug],
  );
  await owner.query(
    `INSERT INTO grades
       (school_id, student_id, teaching_id, academic_year_id, term, kind, sequence_no, score)
     VALUES ($1, $2, $3, $4, 1, 'coursework', 1, 15.00)`,
    [schoolId, st.rows[0]!.id, teachingId, yearId],
  );

  // Le versant « cours du soir » : une assignation et un salaire déjà versé.
  const eg = await owner.query<{ id: string }>(
    `INSERT INTO evening_groups (school_id, name, monthly_rate) VALUES ($1, $2, 5000) RETURNING id`,
    [schoolId, `Soir ${slug}`],
  );
  const et = await owner.query<{ id: string }>(
    `INSERT INTO evening_teachings
       (school_id, evening_group_id, teacher_id, subject, pay_kind, fixed_salary)
     VALUES ($1, $2, $3, 'Anglais', 'fixed', 20000) RETURNING id`,
    [schoolId, eg.rows[0]!.id, t.rows[0]!.id],
  );
  const eveningTeachingId = et.rows[0]!.id;
  await owner.query(
    `INSERT INTO evening_teacher_payments
       (school_id, evening_teaching_id, calendar_month, calendar_year, amount)
     VALUES ($1, $2, 11, 2025, 20000)`,
    [schoolId, eveningTeachingId],
  );

  return { schoolId, teachingId, eveningTeachingId };
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
});

afterAll(async () => {
  await owner?.end();
});

describe('la contrainte, pas seulement le service', () => {
  it('⚠ la base refuse de supprimer une assignation qui porte des notes', async () => {
    const { teachingId } = await ecole('casc-notes');

    // ⚠ En SQL direct : c'est exactement ce que le garde applicatif ne voit pas.
    await expect(
      owner.query('DELETE FROM teachings WHERE id = $1', [teachingId]),
    ).rejects.toThrow(/grades|violates foreign key/i);

    const reste = await owner.query('SELECT 1 FROM grades WHERE teaching_id = $1', [teachingId]);
    expect(reste.rows).toHaveLength(1);
  });

  it('⚠ et de supprimer une assignation du soir déjà payée', async () => {
    const { eveningTeachingId } = await ecole('casc-paye');

    await expect(
      owner.query('DELETE FROM evening_teachings WHERE id = $1', [eveningTeachingId]),
    ).rejects.toThrow(/evening_teacher_payments|violates foreign key/i);

    const reste = await owner.query(
      'SELECT 1 FROM evening_teacher_payments WHERE evening_teaching_id = $1',
      [eveningTeachingId],
    );
    expect(reste.rows).toHaveLength(1);
  });

  it('⚠ MAIS supprimer une ÉCOLE reste possible — c’est pourquoi NO ACTION', async () => {
    /*
     * `RESTRICT` casserait ce cas : il est vérifié immédiatement, donc il
     * refuserait la disparition de l'enseignement avant que la cascade voisine
     * n'ait retiré les notes. `NO ACTION` vérifie en fin d'instruction, quand
     * tout est parti. Un tenant doit rester supprimable — c'est ainsi qu'une
     * branche fermée s'en va.
     */
    const { schoolId } = await ecole('casc-ecole');

    await expect(
      owner.query('DELETE FROM schools WHERE id = $1', [schoolId]),
    ).resolves.toBeTruthy();

    const restes = await owner.query(
      'SELECT count(*)::int AS n FROM grades WHERE school_id = $1',
      [schoolId],
    );
    expect(restes.rows[0]!.n).toBe(0);
  });

  it('une assignation SANS note se supprime toujours', async () => {
    // La contrainte protège ce qui pend dessous ; elle ne fige pas la grille.
    const { schoolId } = await ecole('casc-vide');
    // Une AUTRE matière : l'unicité de `teachings` porte sur
    // (année, professeur, groupe, matière), et on veut une assignation neuve.
    const sub = await owner.query<{ id: string }>(
      `INSERT INTO subjects (school_id, name, coefficient) VALUES ($1, 'Lecture', 1)
       RETURNING id`,
      [schoolId],
    );
    const grp = await owner.query<{ id: string }>(
      `SELECT id FROM groups WHERE school_id = $1 LIMIT 1`,
      [schoolId],
    );
    const yr = await owner.query<{ id: string }>(
      `SELECT id FROM academic_years WHERE school_id = $1 LIMIT 1`,
      [schoolId],
    );
    const tch = await owner.query<{ id: string }>(
      `SELECT id FROM teachers WHERE school_id = $1 LIMIT 1`,
      [schoolId],
    );
    const neuf = await owner.query<{ id: string }>(
      `INSERT INTO teachings
         (school_id, academic_year_id, group_id, subject_id, teacher_id, hours_per_week)
       VALUES ($1, $2, $3, $4, $5, 2) RETURNING id`,
      [schoolId, yr.rows[0]!.id, grp.rows[0]!.id, sub.rows[0]!.id, tch.rows[0]!.id],
    );

    await expect(
      owner.query('DELETE FROM teachings WHERE id = $1', [neuf.rows[0]!.id]),
    ).resolves.toBeTruthy();
  });
});
