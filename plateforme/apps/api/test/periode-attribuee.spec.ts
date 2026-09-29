import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AcademicYearService, type AcademicYear } from '../src/academic/academic-year.service.js';
import { ParentController } from '../src/parent/parent.controller.js';
import { runInTenant } from '../src/tenant/tenant.context.js';
import type { AuthenticatedRequest } from '../src/auth/permissions.guard.js';

/**
 * LES DATES QU'UNE ANNÉE POSSÈDE — constat du 23/09/2026 sur la démonstration.
 *
 * L'année active 2026-2027 « commence » en octobre. Une absence saisie le
 * 23/09/2026 a bien notifié la famille, puis l'onglet Absences est resté vide :
 * l'application bornait les absences et les remarques aux mois nominaux de
 * l'année (1er octobre → 30 juin), et septembre tombait avant. Même chose pour
 * les remarques, et pour le compteur d'absences de la carte de l'enfant.
 *
 * La règle : une année possède tout ce qui va du lendemain de la fin de la
 * précédente à la veille du début de la suivante — l'été et la rentrée sont à
 * l'année qui s'ouvre, et aucune date ne tombe entre deux années.
 *
 * ⚠ Écrit avant la correction (règle 15).
 */

let owner: pg.Pool;
let years: AcademicYearService;
let parent: ParentController;
let schoolId: string;
let y2526: AcademicYear;
let y2627: AcademicYear;
let guardianId: string;
let studentId: string;

const inTenant = <T>(fn: () => Promise<T>) => runInTenant({ schoolId, slug: 'periode' }, fn);
const req = (userId: string) =>
  ({ auth: { userId, schoolId, roles: ['parent'], permissions: [], impersonated: false } }) as
    unknown as AuthenticatedRequest;

async function annee(label: string, start: number, status: string): Promise<AcademicYear> {
  const { rows } = await owner.query<AcademicYear>(
    `INSERT INTO academic_years (school_id, label, start_year, start_month, end_month, status)
     VALUES ($1, $2, $3, 10, 6, $4)
     RETURNING id, label, start_year, start_month, end_month, status, closed_at`,
    [schoolId, label, start, status],
  );
  return rows[0]!;
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('periode', 'Periode', 'PER') RETURNING id`,
  );
  schoolId = school.rows[0]!.id;
  y2526 = await annee('2025-2026', 2025, 'closed');
  y2627 = await annee('2026-2027', 2026, 'active');

  const level = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle) VALUES ($1, '4eme', 20000, 'college') RETURNING id`,
    [schoolId],
  );
  const group = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '4eme A') RETURNING id`,
    [schoolId, level.rows[0]!.id],
  );
  const g = await owner.query<{ id: string }>(
    `INSERT INTO users (phone, password_hash, full_name) VALUES ('+22200009123', 'x', 'Famille Periode') RETURNING id`,
  );
  guardianId = g.rows[0]!.id;
  const s = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, 'RIM-PER', 'NID-PER', 'Ahmed', 'Periode') RETURNING id`,
    [schoolId, guardianId],
  );
  studentId = s.rows[0]!.id;
  await owner.query(
    `INSERT INTO enrollments (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee)
     VALUES ($1, $2, $3, $4, $5, 'enrolled', 20000)`,
    [schoolId, studentId, y2627.id, group.rows[0]!.id, level.rows[0]!.id],
  );
  // La rentrée : une absence de journée entière (sans cours) et une remarque,
  // toutes deux en septembre 2026, avant le « 1er octobre » de l'année.
  await owner.query(
    `INSERT INTO attendance (school_id, student_id, on_date, status) VALUES ($1, $2, '2026-09-23', 'absent')`,
    [schoolId, studentId],
  );
  await owner.query(
    `INSERT INTO remarks (school_id, student_id, author_name, body, severity, created_at)
     VALUES ($1, $2, 'Le professeur', 'Bavardage', 'info', '2026-09-23T10:00:00Z')`,
    [schoolId, studentId],
  );
  // Et une absence de l'année d'avant, qui ne doit PAS apparaître.
  await owner.query(
    `INSERT INTO attendance (school_id, student_id, on_date, status) VALUES ($1, $2, '2026-03-10', 'absent')`,
    [schoolId, studentId],
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  years = moduleRef.get(AcademicYearService);
  parent = moduleRef.get(ParentController);
});

afterAll(async () => {
  await owner?.end();
});

describe('periodeAttribuee', () => {
  it('donne à l’année qui s’ouvre l’été et la rentrée ; la dernière reste ouverte, la première commence à son été', async () => {
    expect(await inTenant(() => years.periodeAttribuee(y2627))).toEqual(['2026-07-01', 'infinity']);
    expect(await inTenant(() => years.periodeAttribuee(y2526))).toEqual(['2025-07-01', '2026-06-30']);
  });

  it('une suivante seulement créée (« future ») ne referme rien ; ouverte, elle referme', async () => {
    // L'école prépare 2027-2028 en juin et saisit encore sous 2026-2027 en
    // septembre : ces absences restent à l'année active (balayage du 23/09).
    const y2728 = await annee('2027-2028', 2027, 'future');
    expect(await inTenant(() => years.periodeAttribuee(y2627))).toEqual(['2026-07-01', 'infinity']);
    await owner.query(`UPDATE academic_years SET status = 'active' WHERE id = $1`, [y2728.id]);
    expect(await inTenant(() => years.periodeAttribuee(y2627))).toEqual(['2026-07-01', '2027-06-30']);
    expect(await inTenant(() => years.periodeAttribuee(y2728))).toEqual(['2027-07-01', 'infinity']);
    await owner.query('DELETE FROM academic_years WHERE id = $1', [y2728.id]);
  });
});

describe('l’espace parent à la rentrée', () => {
  it('montre l’absence et la remarque de septembre, pas celles de l’année passée', async () => {
    const enfants = await inTenant(() => parent.children(req(guardianId)));
    expect(enfants.children).toHaveLength(1);
    expect(enfants.children[0]!.absences).toBe(1);

    const fiche = (await inTenant(() => parent.attendance(studentId, req(guardianId)))) as { total: number; entries: { on_date: Date }[] };
    expect(fiche.total).toBe(1);
    expect(fiche.entries.map((e) => new Date(e.on_date).toISOString().slice(0, 10))).toEqual(['2026-09-23']);

    const famille = await inTenant(() => parent.familyAttendance(req(guardianId)));
    expect(famille.entries).toHaveLength(1);

    const remarques = await inTenant(() => parent.familyRemarks(req(guardianId)));
    expect(remarques.remarks).toHaveLength(1);
  });
});
