import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { SearchService } from '../src/search/search.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LES FICHES DE `recherche.php` — l'étudiant et le professeur.
 *
 * ⚠ SA RECHERCHE MÈNE QUELQUE PART, LA NÔTRE NE MENAIT NULLE PART. Sa colonne
 * « Action » ouvre `recherche.php?type=etudiant&profil_id=…` : une fiche avec
 * neuf renseignements, le relevé des notes, et le bouton d'expulsion. Chez nous
 * la recherche rendait une liste morte — quatre colonnes et aucun lien.
 *
 * ⚠ ET C'EST LA FORME LA PLUS DANGEREUSE QU'UNE LECTURE PUISSE PRENDRE : un
 * identifiant dans l'URL. Rien, dans « ouvre la fiche 7f3a… », ne dit de quelle
 * école vient ce 7f3a. RLS répond, mais c'est précisément ce qu'un test doit
 * vérifier plutôt que supposer — le pire défaut possible ici est celui qui
 * traverse les écoles (règle 15).
 */

let owner: pg.Pool;
let search: SearchService;

let ecoleA: string;
let ecoleB: string;
let eleveA: string;
let eleveB: string;
let profA: string;
let profB: string;

async function dansA<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId: ecoleA, slug: 'fiche-a' }, fn);
}
async function dansB<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId: ecoleB, slug: 'fiche-b' }, fn);
}

/**
 * Une école avec un élève, un professeur, et de quoi noter.
 *
 * ⚠ `users.phone` est unique GLOBALEMENT — un numéro identifie une personne, pas
 * un couple (personne, école) — donc chaque école reçoit les siens.
 */
async function monter(slug: string, prefix: string, tel: string, telProf: string) {
  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ($1, $1, $2) RETURNING id`,
    [slug, prefix],
  );
  const schoolId = school.rows[0]!.id;

  const year = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2025-2026', 2025, 'active') RETURNING id`,
    [schoolId],
  );
  const yearId = year.rows[0]!.id;

  const level = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order)
     VALUES ($1, '3 AF', 4200, 'fondamental', 3) RETURNING id`,
    [schoolId],
  );
  const levelId = level.rows[0]!.id;

  const group = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name)
     VALUES ($1, $2, '3 AF A') RETURNING id`,
    [schoolId, levelId],
  );
  const groupId = group.rows[0]!.id;

  const guardian = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name, phone)
     VALUES ($1, 'x', $2, $3) RETURNING id`,
    [`fiche.${slug}@test`, `Parent ${slug}`, tel],
  );
  const guardianId = guardian.rows[0]!.id;

  const student = await owner.query<{ id: string }>(
    `INSERT INTO students
       (school_id, guardian_id, rim, national_id, first_name, last_name, sex)
     VALUES ($1, $2, $3, $4, 'Aminata', 'Sow', 'F') RETURNING id`,
    [schoolId, guardianId, `RIM-F-${slug}`, `NID-F-${slug}`],
  );
  const studentId = student.rows[0]!.id;

  await owner.query(
    `INSERT INTO enrollments
       (school_id, student_id, academic_year_id, level_id, group_id, status, monthly_fee)
     VALUES ($1, $2, $3, $4, $5, 'enrolled', 4200)`,
    [schoolId, studentId, yearId, levelId, groupId],
  );

  const teacher = await owner.query<{ id: string }>(
    `INSERT INTO teachers (school_id, first_name, last_name, phone, salary, hourly_rate)
     VALUES ($1, 'Moussa', 'Ba', $2, 60000, 500) RETURNING id`,
    [schoolId, telProf],
  );
  const teacherId = teacher.rows[0]!.id;

  const subject = await owner.query<{ id: string }>(
    `INSERT INTO subjects (school_id, name, coefficient) VALUES ($1, 'Calcul', 2) RETURNING id`,
    [schoolId],
  );

  const teaching = await owner.query<{ id: string }>(
    `INSERT INTO teachings
       (school_id, academic_year_id, group_id, subject_id, teacher_id, hours_per_week)
     VALUES ($1, $2, $3, $4, $5, 4) RETURNING id`,
    [schoolId, yearId, groupId, subject.rows[0]!.id, teacherId],
  );

  await owner.query(
    `INSERT INTO grades
       (school_id, student_id, teaching_id, academic_year_id, term, kind, sequence_no, score)
     VALUES ($1, $2, $3, $4, 1, 'coursework', 1, 14.50),
            ($1, $2, $3, $4, 1, 'exam', 1, -1)`,
    [schoolId, studentId, teaching.rows[0]!.id, yearId],
  );

  return { schoolId, studentId, teacherId };
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const a = await monter('fiche-a', 'FIA', '22334455', '44556677');
  const b = await monter('fiche-b', 'FIB', '22334456', '44556678');
  ecoleA = a.schoolId;
  eleveA = a.studentId;
  profA = a.teacherId;
  ecoleB = b.schoolId;
  eleveB = b.studentId;
  profB = b.teacherId;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  search = moduleRef.get(SearchService);
});

afterAll(async () => {
  await owner?.end();
});

describe("la fiche d'un étudiant", () => {
  it('porte les neuf renseignements de sa grille', async () => {
    const fiche = await dansA(() => search.studentProfile(eleveA));
    expect(fiche).not.toBeNull();
    expect(fiche!.first_name).toBe('Aminata');
    expect(fiche!.level_name).toBe('3 AF');
    expect(fiche!.group_name).toBe('3 AF A');
    expect(fiche!.sex).toBe('F');
    expect(fiche!.guardian_name).toBe('Parent fiche-a');
    expect(fiche!.guardian_phone).toBe('22334455');
    expect(fiche!.national_id).toBe('NID-F-fiche-a');
    expect(fiche!.rim).toBe('RIM-F-fiche-a');
    // Le tarif de l'INSCRIPTION, pas celui du niveau : une remise se lit ici.
    expect(fiche!.monthly_fee).toBe('4200.00');
  });

  it('rend le relevé des notes, ordonné par trimestre puis matière', async () => {
    const notes = await dansA(() => search.studentGrades(eleveA));
    expect(notes).toHaveLength(2);
    expect(notes[0]!.subject).toBe('Calcul');
    expect(notes[0]!.term).toBe(1);
    expect(notes[0]!.teacher).toBe('Moussa Ba');
  });

  it("⚠ n'invente pas de moyenne à partir d'une absence", async () => {
    // `note_absent = -1` EST UN MARQUEUR. Sa page l'affiche tel quel, dans une
    // colonne « Note » qui ne calcule rien ; ce test dit que la valeur arrive
    // brute et reste identifiable, pour que l'écran puisse écrire « Absent ».
    const notes = await dansA(() => search.studentGrades(eleveA));
    const absent = notes.find((n) => n.kind === 'exam');
    expect(absent!.score).toBe('-1.00');
  });

  it('⚠ ne voit pas un élève de l’autre école, même avec son identifiant exact', async () => {
    expect(await dansA(() => search.studentProfile(eleveB))).toBeNull();
    expect(await dansB(() => search.studentProfile(eleveA))).toBeNull();
  });

  it("⚠ ne rend pas les notes d'un élève de l'autre école", async () => {
    expect(await dansA(() => search.studentGrades(eleveB))).toEqual([]);
  });
});

describe("la fiche d'un professeur", () => {
  it('porte ses six renseignements', async () => {
    const fiche = await dansA(() => search.teacherProfile(profA));
    expect(fiche).not.toBeNull();
    expect(fiche!.first_name).toBe('Moussa');
    expect(fiche!.phone).toBe('44556677');
    expect(fiche!.salary).toBe('60000.00');
    expect(fiche!.hourly_rate).toBe('500.00');
    // « Classes » et « Heures/mois » se comptent, ils ne sont pas stockés.
    expect(fiche!.classes).toBe(1);
    expect(fiche!.hours_per_month).toBe(16);
  });

  it('liste ses enseignements par niveau', async () => {
    const ens = await dansA(() => search.teacherTeachings(profA));
    expect(ens).toHaveLength(1);
    expect(ens[0]!.level_name).toBe('3 AF');
    expect(ens[0]!.group_name).toBe('3 AF A');
    expect(ens[0]!.subject_name).toBe('Calcul');
  });

  it("⚠ ne voit pas un professeur de l'autre école", async () => {
    expect(await dansA(() => search.teacherProfile(profB))).toBeNull();
    expect(await dansA(() => search.teacherTeachings(profB))).toEqual([]);
  });
});
