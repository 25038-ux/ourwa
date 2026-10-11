import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ROLES } from '@elourwa/db/seed-roles';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { hashPassword } from '../src/auth/passwords.js';

/**
 * LES BULLETINS, LE CLASSEMENT ET LA FORMULE SONT À LA DIRECTION — revue de
 * sécurité du 2026-10-10, écrit AVANT le correctif (règle 15).
 *
 * ⚠ TOUT PROFESSEUR LISAIT LES NOTES DE TOUTE L'ÉCOLE. Les routes de lecture de
 * `/grades` n'étaient gardées que par `notes.consulter`, que le rôle professeur
 * détient : il suffisait de changer l'identifiant dans l'adresse pour recevoir
 * les bulletins d'une classe qu'on n'enseigne pas. Les routes `/teacher`, elles,
 * passent toutes par `assertOwnTeaching` — la garde existait, pas ici.
 *
 * LA RÈGLE EST CELLE D'EL OURWA, portée telle quelle :
 *   - `notes_etudiants.php` et `bulletins_classe.php` (bulletin d'un élève,
 *     bulletins d'une classe, classement, formule, années) s'ouvrent par
 *     `require_staff_admin()` : super_admin OU admin, rien d'autre. Les rôles se
 *     cumulent (`mes_roles()`) : un agent admin + secrétaire entre.
 *   - `saisir_notes.php` (la feuille de notes, lue et saisie) s'ouvre par
 *     `require_role(['super_admin', 'admin', 'secretaire'])`.
 *   - le professeur n'atteint aucune des deux : ses notes passent par
 *     `/teacher/sheet/:id`, pour SES enseignements seulement (décision du
 *     propriétaire, 2026-09-17).
 *   - la comptable n'a ni l'une ni l'autre.
 */

let app: NestFastifyApplication;
let owner: pg.Pool;

const SLUG = 'nds-nour';
const PASSWORD = 'Direction2026';
const jetons: Record<string, string> = {};
/** Les droits ajoutés par CETTE suite, retirés à la fin : la table des rôles est commune aux suites. */
const droitsAjoutes: { role_id: string; permission: string }[] = [];

let schoolId: string;
let niveauId: string;
let groupeMien: string;
let groupeAutre: string;
let teachingMien: string;
let teachingAutre: string;
let eleveMien: string;
let eleveAutre: string;

const entetes = (cle: string) => ({ authorization: `Bearer ${jetons[cle]}`, 'x-school-slug': SLUG });
const lire = (cle: string, url: string) => app.inject({ method: 'GET', url, headers: entetes(cle) });

/** Les cinq lectures de `notes_etudiants.php` / `bulletins_classe.php`, pour un groupe et un élève donnés. */
const lecturesDirection = (groupe: string, eleve: string): [string, string][] => [
  ['la formule du niveau', `/grades/formulas/${niveauId}`],
  ['le bulletin d’un élève', `/grades/report-card/${eleve}?term=1`],
  ['le classement du groupe', `/grades/classement/${groupe}?base=1&annee=2025`],
  ['les années qui portent des notes', '/grades/annees-avec-notes'],
  ['les bulletins de la classe', `/grades/class/${groupe}?term=1`],
];

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const q = async (sql: string, params: unknown[] = []) =>
    (await owner.query<{ id: string }>(sql, params)).rows[0]!.id;

  schoolId = await q(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ($1, 'École Nour (notes direction)', 'NDS') RETURNING id`,
    [SLUG],
  );
  const yearId = await q(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2025-2026', 2025, 'active') RETURNING id`,
    [schoolId],
  );
  niveauId = await q(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order)
     VALUES ($1, '6eme', 3000, 'college', 10) RETURNING id`,
    [schoolId],
  );
  const matiere = await q(
    `INSERT INTO subjects (school_id, name, coefficient) VALUES ($1, 'Calcul', 2) RETURNING id`,
    [schoolId],
  );
  groupeMien = await q(
    `INSERT INTO groups (school_id, level_id, name, capacity) VALUES ($1, $2, '6A', 30) RETURNING id`,
    [schoolId, niveauId],
  );
  groupeAutre = await q(
    `INSERT INTO groups (school_id, level_id, name, capacity) VALUES ($1, $2, '6B', 30) RETURNING id`,
    [schoolId, niveauId],
  );

  // Les rôles du catalogue, avec LEURS droits (seed-roles.ts) : la garde lit le
  // code du rôle, un rôle inventé pour la suite ne prouverait rien.
  for (const code of ['super_admin', 'admin', 'secretaire', 'comptable', 'professeur'] as const) {
    const role = ROLES.find((r) => r.code === code)!;
    await owner.query(
      `INSERT INTO roles (code, label, is_system, sort_order) VALUES ($1, $2, true, $3)
       ON CONFLICT (code) DO NOTHING`,
      [role.code, role.label, role.order],
    );
    for (const permission of role.perms) {
      const { rows } = await owner.query<{ role_id: string; permission: string }>(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT r.id, $2 FROM roles r WHERE r.code = $1
         ON CONFLICT DO NOTHING RETURNING role_id, permission`,
        [code, permission],
      );
      droitsAjoutes.push(...rows);
    }
  }

  const hash = await hashPassword(PASSWORD);
  const compte = async (cle: string, roles: string[]) => {
    const id = await q(
      'INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id',
      [`nds.${cle}@test`, hash, `Compte ${cle}`],
    );
    for (const code of roles) {
      await owner.query(
        `INSERT INTO user_school_roles (user_id, school_id, role_id)
         SELECT $1, $2, r.id FROM roles r WHERE r.code = $3`,
        [id, schoolId, code],
      );
    }
    return id;
  };
  await compte('super_admin', ['super_admin']);
  await compte('admin', ['admin']);
  await compte('secretaire', ['secretaire']);
  await compte('comptable', ['comptable']);
  // Le cumul d'El Ourwa : un agent qui porte les DEUX rôles.
  await compte('admin_secretaire', ['admin', 'secretaire']);
  const profMien = await compte('prof_mien', ['professeur']);
  const profAutre = await compte('prof_autre', ['professeur']);

  // Deux professeurs, chacun SON groupe.
  for (const [userId, nom, groupe] of [
    [profMien, 'Mien', groupeMien],
    [profAutre, 'Autre', groupeAutre],
  ] as const) {
    const teacherId = await q(
      `INSERT INTO teachers (school_id, user_id, first_name, last_name, employment, salary)
       VALUES ($1, $2, 'Prof', $3, 'permanent', 1000) RETURNING id`,
      [schoolId, userId, nom],
    );
    const ens = await q(
      `INSERT INTO teachings (school_id, academic_year_id, group_id, subject_id, teacher_id, hours_per_week)
       VALUES ($1, $2, $3, $4, $5, 4) RETURNING id`,
      [schoolId, yearId, groupe, matiere, teacherId],
    );
    if (nom === 'Mien') teachingMien = ens;
    else teachingAutre = ens;
  }

  for (const [rim, groupe] of [
    ['NDS-1', groupeMien],
    ['NDS-2', groupeAutre],
  ] as const) {
    const eleve = await q(
      `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, $2, 'Élève', $2) RETURNING id`,
      [schoolId, rim],
    );
    await owner.query(
      `INSERT INTO enrollments (school_id, student_id, group_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, 'enrolled')`,
      [schoolId, eleve, groupe, yearId],
    );
    if (groupe === groupeMien) eleveMien = eleve;
    else eleveAutre = eleve;
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const auth = moduleRef.get(AuthService);
  for (const cle of ['super_admin', 'admin', 'secretaire', 'comptable', 'admin_secretaire', 'prof_mien', 'prof_autre']) {
    jetons[cle] = (
      await auth.login(`nds.${cle}@test`, PASSWORD, SLUG, { ip: '10.0.0.71', userAgent: 'vitest' })
    ).accessToken;
  }

  // Une note dans chaque groupe, saisie par la direction : les bulletins ont
  // quelque chose à montrer, et la fuite — s'il y en a une — porte des notes.
  for (const [teaching, eleve] of [
    [teachingMien, eleveMien],
    [teachingAutre, eleveAutre],
  ] as const) {
    const r = await app.inject({
      method: 'POST',
      url: `/grades/sheet/${teaching}`,
      headers: entetes('admin'),
      payload: { term: 1, eleves: [{ studentId: eleve, devoirs: ['12'], examen: '14' }] },
    });
    expect(r.statusCode, r.body).toBeLessThan(300);
  }
});

afterAll(async () => {
  for (const d of droitsAjoutes) {
    await owner.query('DELETE FROM role_permissions WHERE role_id = $1 AND permission = $2', [
      d.role_id,
      d.permission,
    ]);
  }
  await app?.close();
  await owner?.end();
});

describe('le professeur ne lit les notes que par /teacher, et que pour SES enseignements', () => {
  it('⚠ est refusé sur chaque lecture de /grades pour une classe qui n’est pas la sienne', async () => {
    for (const [quoi, url] of lecturesDirection(groupeAutre, eleveAutre)) {
      const r = await lire('prof_mien', url);
      expect(r.statusCode, `${quoi} — ${url}`).toBe(403);
    }
    const feuille = await lire('prof_mien', `/grades/sheet/${teachingAutre}?term=1`);
    expect(feuille.statusCode, 'la feuille de notes d’un collègue').toBe(403);
  });

  it('⚠ et sur sa PROPRE classe aussi : ces pages ne sont pas les siennes dans El Ourwa', async () => {
    for (const [quoi, url] of lecturesDirection(groupeMien, eleveMien)) {
      const r = await lire('prof_mien', url);
      expect(r.statusCode, `${quoi} — ${url}`).toBe(403);
    }
    const feuille = await lire('prof_mien', `/grades/sheet/${teachingMien}?term=1`);
    expect(feuille.statusCode, 'sa feuille, par la porte de la direction').toBe(403);
  });

  it('aucune note ne sort dans le corps du refus', async () => {
    const r = await lire('prof_mien', `/grades/class/${groupeAutre}?term=1`);
    expect(r.body).not.toContain('students');
    expect(r.body).not.toContain(eleveAutre);
  });

  it('lit toujours SA feuille par /teacher, et saisit toujours ses notes', async () => {
    const feuille = await lire('prof_mien', `/teacher/sheet/${teachingMien}?term=1`);
    expect(feuille.statusCode, feuille.body).toBe(200);
    expect(JSON.stringify(feuille.json())).toContain(eleveMien);

    const saisie = await app.inject({
      method: 'POST',
      url: `/teacher/sheet/${teachingMien}`,
      headers: entetes('prof_mien'),
      payload: { term: 1, eleves: [{ studentId: eleveMien, devoirs: ['13'], examen: '15' }] },
    });
    expect(saisie.statusCode, saisie.body).toBeLessThan(300);

    const classes = await lire('prof_mien', '/teacher/my-classes');
    expect(classes.statusCode).toBe(200);
  });

  it('et reste refusé sur la feuille d’un collègue par /teacher', async () => {
    const r = await lire('prof_mien', `/teacher/sheet/${teachingAutre}?term=1`);
    expect(r.statusCode).toBe(403);
    expect(r.json().message).toMatch(/n’est pas la vôtre/);
  });
});

describe('la direction lit tout', () => {
  for (const cle of ['super_admin', 'admin']) {
    it(`${cle} : chaque lecture de /grades répond, pour n’importe quelle classe`, async () => {
      for (const groupeEtEleve of [
        [groupeMien, eleveMien],
        [groupeAutre, eleveAutre],
      ] as const) {
        for (const [quoi, url] of lecturesDirection(...groupeEtEleve)) {
          const r = await lire(cle, url);
          expect(r.statusCode, `${quoi} — ${url} — ${r.body.slice(0, 200)}`).toBe(200);
        }
      }
      const feuille = await lire(cle, `/grades/sheet/${teachingAutre}?term=1`);
      expect(feuille.statusCode).toBe(200);
    });
  }

  it('les bulletins de la classe portent bien l’élève et sa note', async () => {
    const r = await lire('admin', `/grades/class/${groupeAutre}?term=1`);
    expect(r.statusCode).toBe(200);
    expect(JSON.stringify(r.json())).toContain(eleveAutre);
  });

  it('le cumul admin + secrétaire entre, comme `mes_roles()` le veut', async () => {
    for (const [quoi, url] of lecturesDirection(groupeAutre, eleveAutre)) {
      const r = await lire('admin_secretaire', url);
      expect(r.statusCode, `${quoi} — ${url}`).toBe(200);
    }
  });
});

describe('la secrétaire garde ce qu’El Ourwa lui donne : la feuille de notes, rien de plus', () => {
  it('lit et saisit la feuille de n’importe quel enseignement (`saisir_notes.php`)', async () => {
    const feuille = await lire('secretaire', `/grades/sheet/${teachingAutre}?term=1`);
    expect(feuille.statusCode, feuille.body).toBe(200);
    expect(JSON.stringify(feuille.json())).toContain(eleveAutre);

    const saisie = await app.inject({
      method: 'POST',
      url: `/grades/sheet/${teachingAutre}`,
      headers: entetes('secretaire'),
      payload: { term: 1, eleves: [{ studentId: eleveAutre, devoirs: ['11'], examen: '14' }] },
    });
    expect(saisie.statusCode, saisie.body).toBeLessThan(300);
  });

  it('⚠ mais pas les bulletins, le classement ni la formule (`require_staff_admin()`)', async () => {
    for (const [quoi, url] of lecturesDirection(groupeAutre, eleveAutre)) {
      const r = await lire('secretaire', url);
      expect(r.statusCode, `${quoi} — ${url}`).toBe(403);
    }
  });
});

describe('la comptable n’a ni les bulletins ni la feuille', () => {
  it('est refusée partout', async () => {
    for (const [quoi, url] of [
      ...lecturesDirection(groupeAutre, eleveAutre),
      ['la feuille de notes', `/grades/sheet/${teachingAutre}?term=1`] as [string, string],
    ]) {
      const r = await lire('comptable', url);
      expect(r.statusCode, `${quoi} — ${url}`).toBe(403);
    }
  });
});
