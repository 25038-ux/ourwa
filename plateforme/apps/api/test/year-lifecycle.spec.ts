import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AcademicYearService } from '../src/academic/academic-year.service.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LE CYCLE D'UNE ANNÉE — `annees_scolaires.php` : « Rendre active » et
 * « Clôturer », avec ses règles.
 *
 * Le propriétaire a signalé « clôturer ne marche pas » (18/09) : côté site, le
 * message se perdait (la ligne se re-rendait sans le formulaire qui le
 * portait) ; côté API, rien ne le disait. Ce fichier fixe ce que l'API DOIT
 * faire, pour que la prochaine régression ait un nom :
 *
 *   - activer une année « à venir » : elle devient la seule active, l'ancienne
 *     active repasse « à venir » (son `UPDATE … SET statut='future' WHERE
 *     statut='active'`) ;
 *   - activer une année clôturée : refusé (son `refus_annee_close_id`) ;
 *   - clôturer l'année active : ses inscriptions passent « archivées », la
 *     suivante existe et est active (créée si besoin, avec la même période),
 *     il n'y a jamais deux années actives ;
 *   - clôturer deux fois : refusé (« déjà clôturée ») ;
 *   - une inscription archivée ne compte plus dans l'année suivante.
 */

let owner: pg.Pool;
let years: AcademicYearService;
let enrollments: EnrollmentService;
let schoolId: string;
let y2019: string;
let y2020: string;
let y2016: string;
let groupId: string;
let ACTOR: string;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'cycleannee' }, fn);
}

async function actives(): Promise<string[]> {
  const { rows } = await owner.query<{ label: string }>(
    `SELECT label FROM academic_years WHERE school_id = $1 AND status = 'active' ORDER BY label`,
    [schoolId],
  );
  return rows.map((r) => r.label);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('cycleannee', 'Cycle', 'CYC') RETURNING id`,
  );
  schoolId = school.rows[0]!.id;
  const ys = await owner.query<{ id: string; start_year: number }>(
    `INSERT INTO academic_years (school_id, label, start_year, start_month, end_month, status)
     VALUES ($1, '2019-2020', 2019, 10, 6, 'active'),
            ($1, '2020-2021', 2020, 10, 6, 'future'),
            ($1, '2016-2017', 2016, 10, 6, 'closed')
     RETURNING id, start_year`,
    [schoolId],
  );
  y2019 = ys.rows.find((r) => r.start_year === 2019)!.id;
  y2020 = ys.rows.find((r) => r.start_year === 2020)!.id;
  y2016 = ys.rows.find((r) => r.start_year === 2016)!.id;
  const level = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle) VALUES ($1, '6eme', 1000, 'college') RETURNING id`,
    [schoolId],
  );
  const group = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6eme A') RETURNING id`,
    [schoolId, level.rows[0]!.id],
  );
  groupId = group.rows[0]!.id;
  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('cycleannee.admin@test', 'x', 'Direction') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  years = moduleRef.get(AcademicYearService);
  enrollments = moduleRef.get(EnrollmentService);

  // Deux élèves inscrits dans l'année active.
  for (const tag of ['A', 'B']) {
    const s = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, $3, $4, 'Cycle') RETURNING id`,
      [schoolId, `RIM-CY-${tag}`, `NID-CY-${tag}`, tag],
    );
    await inTenant(() =>
      enrollments.enrol(
        { studentId: s.rows[0]!.id, academicYearId: y2019, groupId, entryDate: '2019-10-01' },
        ACTOR,
        ['scolarite.niveaux'],
      ),
    );
  }
});

afterAll(async () => {
  await owner?.end();
});

describe('rendre active', () => {
  it('refuse une année clôturée, avec sa phrase', async () => {
    await expect(inTenant(() => years.activate(y2016, ACTOR))).rejects.toThrow(/clôturée/);
    expect(await actives()).toEqual(['2019-2020']);
  });

  /**
   * DÉCISION DU PROPRIÉTAIRE (18/09) : « activer une nouvelle année passait
   * l'ancienne en À venir » — faux. Une année ANTÉRIEURE à l'année active est
   * de l'histoire : elle se clôture (inscriptions archivées, date de clôture) ;
   * seule une année POSTÉRIEURE reste « à venir ». Rendre active une année
   * ultérieure, c'est donc clôturer l'année en cours ; revenir sur une année
   * antérieure encore ouverte ne clôture rien (l'ultérieure redevient « à venir »).
   */
  it('rendre active l’année suivante clôture l’année en cours (archivée), et une seule reste active', async () => {
    const r = await inTenant(() => years.activate(y2020, ACTOR));
    expect(r.status).toBe('active');
    expect(await actives()).toEqual(['2020-2021']);
    const { rows } = await owner.query<{ status: string; closed_at: string | null }>(
      'SELECT status, closed_at::text FROM academic_years WHERE id = $1',
      [y2019],
    );
    expect(rows[0]!.status).toBe('closed');
    expect(rows[0]!.closed_at).not.toBeNull();
    const { rows: ins } = await owner.query<{ status: string; n: string }>(
      `SELECT status, count(*)::text AS n FROM enrollments WHERE academic_year_id = $1 GROUP BY status`,
      [y2019],
    );
    expect(ins).toEqual([{ status: 'archived', n: '2' }]);
    // l'année close ne se rouvre pas d'un clic
    await expect(inTenant(() => years.activate(y2019, ACTOR))).rejects.toThrow(/clôturée/);
  });

  it('revenir sur une année antérieure encore ouverte ne clôture rien : l’ultérieure redevient « à venir »', async () => {
    const y2021 = (await owner.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, label, start_year, start_month, end_month, status)
       VALUES ($1, '2021-2022', 2021, 10, 6, 'future') RETURNING id`,
      [schoolId],
    )).rows[0]!.id;
    // 2020 active → activer 2021 clôture 2020 ; puis créer 2022 « à venir », l'activer, revenir sur 2021
    await inTenant(() => years.activate(y2021, ACTOR));
    const y2022 = (await owner.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, label, start_year, start_month, end_month, status)
       VALUES ($1, '2022-2023', 2022, 10, 6, 'future') RETURNING id`,
      [schoolId],
    )).rows[0]!.id;
    await inTenant(() => years.activate(y2022, ACTOR));
    expect(await actives()).toEqual(['2022-2023']);
    // 2021 est maintenant close (antérieure) — on ne peut pas y revenir ; mais
    // 2023 « à venir » activée par erreur puis retour sur 2022 : 2023 redevient à venir.
    const y2023 = (await owner.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, label, start_year, start_month, end_month, status)
       VALUES ($1, '2023-2024', 2023, 10, 6, 'future') RETURNING id`,
      [schoolId],
    )).rows[0]!.id;
    await owner.query(`UPDATE academic_years SET status = 'future' WHERE id = $1`, [y2022]);
    await owner.query(`UPDATE academic_years SET status = 'active' WHERE id = $1`, [y2023]);
    await inTenant(() => years.activate(y2022, ACTOR));
    expect(await actives()).toEqual(['2022-2023']);
    const { rows } = await owner.query<{ status: string }>('SELECT status FROM academic_years WHERE id = $1', [y2023]);
    expect(rows[0]!.status).toBe('future');
    // remise en place pour la suite du fichier : 2019 close, 2020 close, 2021 close ; on rouvre 2019/2020 à la main
    await owner.query(`UPDATE academic_years SET status = 'future', closed_at = NULL WHERE id IN ($1, $2, $3, $4)`, [y2019, y2020, y2021, y2022]);
    await owner.query(`UPDATE enrollments SET status = 'enrolled' WHERE academic_year_id = $1`, [y2019]);
    await owner.query(`UPDATE academic_years SET status = 'active' WHERE id = $1`, [y2019]);
    await owner.query(`DELETE FROM academic_years WHERE id IN ($1, $2)`, [y2023, y2021]);
    await owner.query(`DELETE FROM academic_years WHERE id = $1`, [y2022]);
    expect(await actives()).toEqual(['2019-2020']);
  });
});

describe('clôturer', () => {
  it('archive les inscriptions, clôture l’année, et l’année suivante devient la seule active', async () => {
    const r = await inTenant(() => years.close(y2019, ACTOR));
    expect(r.archived).toBe(2);
    expect(r.next.label).toBe('2020-2021');
    expect(r.next.status).toBe('active');
    expect(await actives()).toEqual(['2020-2021']);
    const { rows } = await owner.query<{ status: string; n: string }>(
      `SELECT status, count(*)::text AS n FROM enrollments WHERE academic_year_id = $1 GROUP BY status`,
      [y2019],
    );
    expect(rows).toEqual([{ status: 'archived', n: '2' }]);
    const closed = await owner.query<{ status: string; closed_at: string | null }>(
      'SELECT status, closed_at::text FROM academic_years WHERE id = $1',
      [y2019],
    );
    expect(closed.rows[0]!.status).toBe('closed');
    expect(closed.rows[0]!.closed_at).not.toBeNull();
  });

  it('refuse une seconde clôture', async () => {
    await expect(inTenant(() => years.close(y2019, ACTOR))).rejects.toThrow(/déjà clôturée/);
  });

  it('⚠ refuse de clôturer une année qui n’est pas l’année en cours — sinon deux actives', async () => {
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, label, start_year, status, start_month, end_month)
       VALUES ($1, '2030-2031', 2030, 'future', 10, 6) RETURNING id`,
      [schoolId],
    );
    await expect(inTenant(() => years.close(rows[0]!.id, ACTOR))).rejects.toThrow(/pas l.année en cours/);
    expect(await actives()).toEqual(['2020-2021']);
    await owner.query('DELETE FROM academic_years WHERE id = $1', [rows[0]!.id]);
  });

  it('crée l’année suivante, avec la même période, quand elle n’existe pas', async () => {
    const r = await inTenant(() => years.close(y2020, ACTOR));
    expect(r.next.label).toBe('2021-2022');
    expect(r.next.start_month).toBe(10);
    expect(r.next.end_month).toBe(6);
    expect(await actives()).toEqual(['2021-2022']);
  });

  it('l’année nouvelle n’a aucune inscription tant que les réinscriptions ne sont pas faites', async () => {
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM enrollments e JOIN academic_years y ON y.id = e.academic_year_id
        WHERE y.school_id = $1 AND y.status = 'active' AND e.status <> 'cancelled'`,
      [schoolId],
    );
    expect(rows[0]!.n).toBe('0');
  });
});
