import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { AdmissionsService } from '../src/admissions/admissions.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { ExamAccessService } from '../src/exams/exam-access.service.js';
import { ParentController } from '../src/parent/parent.controller.js';
import { hashPassword } from '../src/auth/passwords.js';
import { runInTenant } from '../src/tenant/tenant.context.js';
import type { AuthenticatedRequest } from '../src/auth/permissions.guard.js';

/**
 * LE BALAYAGE DU 23/09 (SOIR) — les constats confirmés par trois relecteurs
 * indépendants, chacun écrit en test avant sa correction (règle 15).
 *
 *   1. Le bulletin retenu livrait la note par le « total » (total ÷ coefficient).
 *   2. Le fil de résultats ignorait un trimestre refermé par la direction
 *      quand la famille ne devait rien (son resultats.php pose la question
 *      trimestre par trimestre).
 *   3. L'admission et la création de compte ignoraient `user_phones` : un
 *      numéro supplémentaire d'une famille devenait le principal d'un autre
 *      compte.
 *   4. La connexion prenait `rows[0]` quand un identifiant désignait deux
 *      comptes.
 *   5. Chaque numéro supplémentaire avait son propre budget d'essais.
 */

let owner: pg.Pool;
let accounts: AccountsService;
let admissions: AdmissionsService;
let auth: AuthService;
let exams: ExamAccessService;
let parent: ParentController;
let schoolId: string;
let yearId: string;
let groupId: string;
let ACTOR: string;
let familleId: string;
let enfantId: string;
const PASSWORD = 'Famille#2026';
const CTX = { ip: '10.0.9.9', userAgent: 'vitest' };
const DIRECTION = ['scolarite.niveaux', 'scolarite.inscrire'];

const inTenant = <T>(fn: () => Promise<T>) => runInTenant({ schoolId, slug: 'balayage' }, fn);
const req = (userId: string) =>
  ({ auth: { userId, schoolId, roles: ['parent'], permissions: [], impersonated: false } }) as
    unknown as AuthenticatedRequest;

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  // Le module d'abord : son démarrage sème les rôles (le fichier seul, lancé en premier, n'en avait pas).
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const q = async <T,>(sql: string, params: unknown[] = []) => (await owner.query<T & { id: string }>(sql, params)).rows[0]!;
  schoolId = (await q(`INSERT INTO schools (slug, name, receipt_prefix) VALUES ('balayage', 'Balayage', 'BAL') RETURNING id`)).id;
  yearId = (
    await q(
      `INSERT INTO academic_years (school_id, label, start_year, start_month, end_month, status)
       VALUES ($1, '2026-2027', 2026, 10, 6, 'active') RETURNING id`,
      [schoolId],
    )
  ).id;
  const levelId = (await q(`INSERT INTO levels (school_id, name, monthly_rate, cycle) VALUES ($1, '4eme', 20000, 'college') RETURNING id`, [schoolId])).id;
  groupId = (await q(`INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '4eme A') RETURNING id`, [schoolId, levelId])).id;
  const subjectId = (
    await q(`INSERT INTO subjects (school_id, level_id, name, coefficient) VALUES ($1, $2, 'Maths', 3) RETURNING id`, [schoolId, levelId])
  ).id;
  const teacherId = (await q(`INSERT INTO teachers (school_id, first_name, last_name) VALUES ($1, 'P', 'T') RETURNING id`, [schoolId])).id;
  const teachingId = (
    await q(
      `INSERT INTO teachings (school_id, academic_year_id, teacher_id, group_id, subject_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [schoolId, yearId, teacherId, groupId, subjectId],
    )
  ).id;
  ACTOR = (await q(`INSERT INTO users (email, password_hash, full_name) VALUES ('balayage.actor@test', 'x', 'Direction') RETURNING id`)).id;
  const hash = await hashPassword(PASSWORD);
  familleId = (await q(`INSERT INTO users (phone, password_hash, full_name) VALUES ('22550011', $1, 'Famille Balayage') RETURNING id`, [hash])).id;
  // Le rôle peut manquer si ce fichier tourne le premier : on le pose (idempotent).
  await owner.query("INSERT INTO roles (code, label, is_system) VALUES ('parent', 'Parent', true) ON CONFLICT (code) DO NOTHING");
  const role = await q(`SELECT id FROM roles WHERE code = 'parent'`);
  await owner.query('INSERT INTO user_school_roles (user_id, school_id, role_id) VALUES ($1, $2, $3)', [familleId, schoolId, role.id]);
  enfantId = (
    await q(
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, 'RIM-BAL', 'NID-BAL', 'Ahmed', 'Balayage') RETURNING id`,
      [schoolId, familleId],
    )
  ).id;
  await owner.query(
    `INSERT INTO enrollments (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee, is_free)
     VALUES ($1, $2, $3, $4, $5, 'enrolled', 0, true)`,
    [schoolId, enfantId, yearId, groupId, levelId],
  );
  // Devoirs 12 et 14, examen 10 : moyenne 11,20, total 33,60 (coefficient 3).
  for (const [kind, seq, score] of [
    ['coursework', 1, 12],
    ['coursework', 2, 14],
    ['exam', 1, 10],
  ] as const) {
    await owner.query(
      `INSERT INTO grades (school_id, student_id, teaching_id, academic_year_id, term, kind, sequence_no, score)
       VALUES ($1, $2, $3, $4, 1, $5, $6, $7)`,
      [schoolId, enfantId, teachingId, yearId, kind, seq, score],
    );
  }
  accounts = moduleRef.get(AccountsService);
  admissions = moduleRef.get(AdmissionsService);
  auth = moduleRef.get(AuthService);
  exams = moduleRef.get(ExamAccessService);
  parent = moduleRef.get(ParentController);
});

afterAll(async () => {
  await owner?.end();
});

describe('les examens retenus', () => {
  it('ne livrent plus la note par le total : le fil ET le bulletin, un trimestre refermé sans dette', async () => {
    // La famille ne doit rien (inscription gratuite) : tout est visible…
    const avant = (await inTenant(() => parent.reportCard(req(familleId), enfantId, '1'))) as {
      withheld: boolean;
      subjects: { total: string | null }[];
    };
    expect(avant.withheld).toBe(false);
    expect(avant.subjects[0]!.total).toBe('33.60');

    // … jusqu'à ce que la direction referme le trimestre 1.
    await inTenant(() =>
      exams.closeTerm({ guardianId: familleId, academicYearId: yearId, term: 1, reason: 'Contrôle' }, ACTOR),
    );

    const carte = (await inTenant(() => parent.reportCard(req(familleId), enfantId, '1'))) as {
      withheld: boolean;
      subjects: { mark: string | null; exam: string | null; total: string | null }[];
    };
    expect(carte.withheld).toBe(true);
    for (const s of carte.subjects) {
      expect(s.mark).toBeNull();
      expect(s.exam).toBeNull();
      expect(s.total).toBeNull();
    }

    const fil = await inTenant(() => parent.familyGrades(req(familleId)));
    expect(fil.examsWithheld).toBe(true);
    expect(fil.grades.filter((g) => g.kind === 'exam')).toHaveLength(0);
    expect(fil.grades.filter((g) => g.kind === 'coursework')).toHaveLength(2);
  });

  it('un trimestre demandé mal formé ne fait pas planter la route', async () => {
    const r = await inTenant(() => parent.grades(req(familleId), enfantId, 'abc'));
    expect((r as { term: number }).term).toBe(1);
  });
});

describe('un numéro n’appartient qu’à un compte — aussi à l’admission et à la création', () => {
  it('l’admission rattache l’enfant à la famille dont c’est le numéro supplémentaire', async () => {
    await inTenant(() => accounts.ajouterTelephone(familleId, { phone: '33 66 77 88', label: 'Mère' }, ACTOR));
    const r = await inTenant(() =>
      admissions.admit(
        {
          firstName: 'Mariem',
          lastName: 'Balayage',
          rim: 'RIM-BAL-2',
          nationalId: 'NID-BAL-2',
          newGuardian: { fullName: 'La mère', phone: '+222 33667788', initialPassword: 'Ecole-2026' },
          academicYearId: yearId,
          groupId,
        },
        ACTOR,
        DIRECTION,
      ),
    );
    expect(r.guardianId).toBe(familleId);
    const { rows } = await owner.query('SELECT 1 FROM users WHERE phone = $1', ['33667788']);
    expect(rows).toHaveLength(0);
  });

  it('la création d’un compte refuse le numéro supplémentaire d’une famille', async () => {
    await expect(
      inTenant(() =>
        accounts.create({ role: 'secretaire', firstName: 'Agent', lastName: 'Test', phone: '33667788', username: 'agent.balayage' } as never, ACTOR),
      ),
    ).rejects.toThrow('déjà un compte');
  });
});

describe('la connexion', () => {
  it('n’ouvre aucun compte quand un identifiant en désigne deux', async () => {
    // Un état que plus aucun chemin ne produit : posé à la main.
    const hash = await hashPassword(PASSWORD);
    const autre = await owner.query<{ id: string }>(
      `INSERT INTO users (phone, password_hash, full_name) VALUES ('44990011', $1, 'Autre famille') RETURNING id`,
      [hash],
    );
    await owner.query(`INSERT INTO user_phones (user_id, phone) VALUES ($1, '44990011')`, [familleId]).catch(async () => {
      // Le numéro existe déjà comme principal : l'unique de user_phones ne le voit pas, l'insertion passe.
    });
    await expect(auth.login('44990011', PASSWORD, null, CTX, true)).rejects.toThrow('incorrect');
    await owner.query(`DELETE FROM user_phones WHERE phone = '44990011'`);
    await owner.query('DELETE FROM users WHERE id = $1', [autre.rows[0]!.id]);
  });

  it('un numéro supplémentaire partage le verrou du numéro principal', async () => {
    const cle = await (auth as unknown as { seauDuCompte(c: string): Promise<string> }).seauDuCompte('33667788');
    expect(cle).toBe('22550011');
    const inconnu = await (auth as unknown as { seauDuCompte(c: string): Promise<string> }).seauDuCompte('45454545');
    expect(inconnu).toBe('45454545');
  });
});
