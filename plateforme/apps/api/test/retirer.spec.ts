import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { ReferenceService } from '../src/academic/reference.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * RETIRER QUELQU'UN — les deux « Supprimer » qui n'existaient pas chez nous.
 *
 * `gestion_groupes.php` porte, sur chaque ligne d'élève, un bouton
 * « Supprimer » ; `gerer_professeurs.php` en porte un par professeur. Aucun des
 * deux n'avait d'équivalent ici : un élève inscrit dans le mauvais groupe y
 * restait, et un professeur créé par erreur restait dans la liste pour toujours.
 *
 * ⚠ MAIS SON « SUPPRIMER » D'ÉLÈVE DÉTRUIT L'ARGENT, et nous ne copions pas
 * cela. Sa confirmation le dit sans détour : « Supprimer cet étudiant ? Ses
 * notes et paiements seront aussi supprimés. » — et son code fait bien trois
 * DELETE : `notes`, `paiements`, `etudiants`.
 *
 * La règle 7 l'interdit : les écritures financières sont append-only, une
 * correction est une écriture inverse. Un reçu remis à une famille ne peut pas
 * cesser d'avoir existé parce qu'on s'est trompé de classe. On rend donc le
 * GESTE (l'élève quitte la liste) sans la DESTRUCTION : l'inscription passe à
 * `cancelled`, que toutes les requêtes excluent déjà.
 *
 * ⚠ ET LE PROFESSEUR N'A BESOIN D'AUCUNE GARDE ÉCRITE : le schéma la porte.
 * `teachings → teachers` est en CASCADE, mais `grades → teachings` est en
 * NO ACTION depuis la migration 0025 (ADR-0042). Un professeur dont une classe
 * porte des notes ne peut donc pas être supprimé — la base refuse, et l'opérateur
 * reçoit un refus honnête au lieu d'une perte silencieuse.
 */

let owner: pg.Pool;
let enrollments: EnrollmentService;
let reference: ReferenceService;

let schoolId: string;
let yearId: string;
let groupId: string;
let subjectId: string;

/** L'auteur réel : le journal d'audit exige un utilisateur qui existe. */
let ACTOR: string;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'retirer' }, fn);
}

async function eleve(tag: string): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, $2, 'E', $3) RETURNING id`,
    [schoolId, `RIM-RET-${tag}`, tag],
  );
  const studentId = rows[0]!.id;
  await inTenant(() =>
    enrollments.enrol(
      { studentId, academicYearId: yearId, groupId },
      ACTOR,
      ['scolarite.inscrire'],
      ['super_admin'],
    ),
  );
  return studentId;
}

async function prof(tag: string): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO teachers (school_id, first_name, last_name, employment, salary)
     VALUES ($1, 'P', $2, 'permanent', 1000) RETURNING id`,
    [schoolId, tag],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('retirer', 'Retirer', 'RET')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const y = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, start_month, end_month, status)
     VALUES ($1, '2025-2026', 2025, 10, 6, 'active') RETURNING id`,
    [schoolId],
  );
  yearId = y.rows[0]!.id;

  const l = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order)
     VALUES ($1, '6eme', 3000, 'college', 10) RETURNING id`,
    [schoolId],
  );
  const g = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6A') RETURNING id`,
    [schoolId, l.rows[0]!.id],
  );
  groupId = g.rows[0]!.id;

  const sub = await owner.query<{ id: string }>(
    `INSERT INTO subjects (school_id, name, coefficient) VALUES ($1, 'Calcul', 2) RETURNING id`,
    [schoolId],
  );
  subjectId = sub.rows[0]!.id;

  const a = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('retirer.acteur@test', 'x', 'Acteur') RETURNING id`,
  );
  ACTOR = a.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  enrollments = moduleRef.get(EnrollmentService);
  reference = moduleRef.get(ReferenceService);
});

afterAll(async () => {
  await owner?.end();
});

describe('retirer un élève de sa classe', () => {
  it('il quitte la liste du groupe', async () => {
    const studentId = await eleve('sort');
    const avant = await inTenant(() => reference.rosterForGroup(groupId));
    expect(avant.some((e) => e.id === studentId)).toBe(true);

    await inTenant(() => enrollments.cancelEnrolment(studentId, yearId, ACTOR));

    const apres = await inTenant(() => reference.rosterForGroup(groupId));
    expect(apres.some((e) => e.id === studentId)).toBe(false);
  });

  it('⚠ mais ses paiements survivent — nous ne copions pas SA suppression', async () => {
    const studentId = await eleve('argent');
    // Un versement encaissé, avec son reçu.
    await owner.query(
      `INSERT INTO payments
         (school_id, student_id, academic_year_id, calendar_month, calendar_year,
          amount, receipt_number)
       VALUES ($1, $2, $3, 10, 2025, 3000, 'RET-000001')`,
      [schoolId, studentId, yearId],
    );

    await inTenant(() => enrollments.cancelEnrolment(studentId, yearId, ACTOR));

    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM payments WHERE student_id = $1`,
      [studentId],
    );
    // Son code ferait `DELETE FROM paiements`. Le nôtre ne peut pas : règle 7.
    expect(rows[0]!.n).toBe('1');

    // Et l'élève lui-même reste : c'est l'inscription qui est annulée.
    const { rows: e } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM students WHERE id = $1`,
      [studentId],
    );
    expect(e[0]!.n).toBe('1');
  });

  it('⚠ le geste est tracé — qui a retiré qui, et quand', async () => {
    const studentId = await eleve('trace');
    await inTenant(() => enrollments.cancelEnrolment(studentId, yearId, ACTOR));
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log
        WHERE school_id = $1 AND action = 'enrollment_cancelled'`,
      [schoolId],
    );
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
  });
});

describe('retirer un professeur', () => {
  it('un professeur sans rien derrière lui s’en va', async () => {
    const teacherId = await prof('libre');
    await inTenant(() => reference.deleteTeacher(teacherId, ACTOR));
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM teachers WHERE id = $1`,
      [teacherId],
    );
    expect(rows[0]!.n).toBe('0');
  });

  it('⚠ un professeur dont une classe porte des NOTES ne peut pas partir', async () => {
    // C'est la garde du schéma, pas une règle écrite ici : `teachings → teachers`
    // est en CASCADE, mais `grades → teachings` est en NO ACTION (migration
    // 0025). Supprimer le professeur emporterait l'enseignement, que les notes
    // retiennent — la base refuse l'ensemble.
    const teacherId = await prof('note');
    const t = await owner.query<{ id: string }>(
      `INSERT INTO teachings
         (school_id, academic_year_id, group_id, subject_id, teacher_id, hours_per_week)
       VALUES ($1, $2, $3, $4, $5, 4) RETURNING id`,
      [schoolId, yearId, groupId, subjectId, teacherId],
    );
    const studentId = await eleve('noté');
    await owner.query(
      `INSERT INTO grades
         (school_id, student_id, teaching_id, academic_year_id, term, kind, sequence_no, score)
       VALUES ($1, $2, $3, $4, 1, 'coursework', 1, 12)`,
      [schoolId, studentId, t.rows[0]!.id, yearId],
    );

    await expect(inTenant(() => reference.deleteTeacher(teacherId, ACTOR))).rejects.toThrow();

    // Et il est toujours là : le refus n'a rien laissé à moitié fait.
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM teachers WHERE id = $1`,
      [teacherId],
    );
    expect(rows[0]!.n).toBe('1');
  });
});
