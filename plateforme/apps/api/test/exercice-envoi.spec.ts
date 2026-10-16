import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import multipart from '@fastify/multipart';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { hashPassword } from '../src/auth/passwords.js';
import { ParentController } from '../src/parent/parent.controller.js';
import { runInTenant } from '../src/tenant/tenant.context.js';
import type { AuthenticatedRequest } from '../src/auth/permissions.guard.js';
import { MAX_BYTES } from '../src/attachments/storage.js';

/**
 * « ENVOYER UN EXERCICE », DE BOUT EN BOUT ET PAR SES ROUTES.
 *
 * Les suites voisines appellent les services (`pedagogy.spec.ts`,
 * `attachments.spec.ts`). Celle-ci passe par HTTP, comme le site : la
 * direction et un professeur envoient, joignent, téléchargent ; la famille
 * lit. Chaque test ci-dessous est un défaut constaté en parcourant la page.
 */

let app: NestFastifyApplication;
let owner: pg.Pool;
let parent: ParentController;
let uploadDir: string;

const SLUG = 'exo';
const PASSWORD = 'Exercice-2026';
let schoolId: string;
let yearId: string;
let teachingA: string;
let teachingB: string;
let studentId: string;
let guardianId: string;
let direction: string;
let profA: string;
let profB: string;

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 3)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);

const entetes = (token: string) => ({ authorization: `Bearer ${token}`, 'x-school-slug': SLUG });

const envoyer = (token: string, teachingId: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/homework/${teachingId}`, payload, headers: entetes(token) });

/** Un formulaire multipart d'un seul fichier, comme l'action du site l'envoie. */
function joindre(token: string, homeworkId: string, nom: string, contenu: Buffer) {
  const frontiere = '----exo' + Math.random().toString(16).slice(2);
  const corps = Buffer.concat([
    Buffer.from(
      `--${frontiere}\r\nContent-Disposition: form-data; name="file"; filename="${nom}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
      'utf8',
    ),
    contenu,
    Buffer.from(`\r\n--${frontiere}--\r\n`),
  ]);
  return app.inject({
    method: 'POST',
    url: `/attachments/homework/${homeworkId}`,
    payload: corps,
    headers: { ...entetes(token), 'content-type': `multipart/form-data; boundary=${frontiere}` },
  });
}

const message = (r: { json: () => unknown }) => {
  const m = (r.json() as { message?: string | string[] }).message;
  return Array.isArray(m) ? m.join(' ') : (m ?? '');
};

const famille = (userId: string) =>
  ({ auth: { userId, schoolId, roles: ['parent'], permissions: [], impersonated: false } }) as unknown as AuthenticatedRequest;

beforeAll(async () => {
  uploadDir = mkdtempSync(join(tmpdir(), 'elourwa-exo-'));
  process.env.UPLOAD_DIR = uploadDir;

  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const q = async (sql: string, params: unknown[] = []) =>
    (await owner.query<{ id: string }>(sql, params)).rows[0]!.id;

  schoolId = await q(`INSERT INTO schools (slug, name, receipt_prefix) VALUES ($1, 'Exercices', 'EXO') RETURNING id`, [SLUG]);
  yearId = await q(
    `INSERT INTO academic_years (school_id, label, start_year, start_month, end_month, status)
     VALUES ($1, '2025-2026', 2025, 10, 6, 'active') RETURNING id`,
    [schoolId],
  );
  const levelId = await q(`INSERT INTO levels (school_id, name, monthly_rate, cycle) VALUES ($1, '6eme', 5000, 'college') RETURNING id`, [schoolId]);
  const groupA = await q(`INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6eme A') RETURNING id`, [schoolId, levelId]);
  const groupB = await q(`INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6eme B') RETURNING id`, [schoolId, levelId]);
  const subjectId = await q(`INSERT INTO subjects (school_id, level_id, name) VALUES ($1, $2, 'Maths') RETURNING id`, [schoolId, levelId]);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  // Comme `main.ts`.
  await app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 } }); // comme main.ts
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  parent = moduleRef.get(ParentController);

  // Deux rôles propres à ce fichier : la direction (toute l'école) et le
  // professeur (les permissions du rôle `professeur` de la graine).
  const roles: Record<string, string[]> = {
    exo_direction: ['exercices.envoyer', 'scolarite.groupes', 'scolarite.niveaux'],
    exo_prof: ['exercices.envoyer', 'notes.consulter', 'absences.consulter'],
  };
  for (const [code, perms] of Object.entries(roles)) {
    const roleId = await q(`INSERT INTO roles (code, label, is_system) VALUES ($1, $1, true) RETURNING id`, [code]);
    for (const p of perms) await owner.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [roleId, p]);
  }
  const hash = await hashPassword(PASSWORD);
  const auth = app.get(AuthService);
  const compte = async (email: string, role: string) => {
    const id = await q('INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $1) RETURNING id', [email, hash]);
    await owner.query(
      `INSERT INTO user_school_roles (user_id, school_id, role_id) SELECT $1, $2, id FROM roles WHERE code = $3`,
      [id, schoolId, role],
    );
    const { accessToken } = await auth.login(email, PASSWORD, SLUG, { ip: '10.0.0.77', userAgent: 'vitest' });
    return { id, accessToken };
  };
  direction = (await compte('exo.direction@test', 'exo_direction')).accessToken;
  const a = await compte('exo.profa@test', 'exo_prof');
  const b = await compte('exo.profb@test', 'exo_prof');
  profA = a.accessToken;
  profB = b.accessToken;

  const teacherA = await q(`INSERT INTO teachers (school_id, user_id, first_name, last_name) VALUES ($1, $2, 'Prof', 'A') RETURNING id`, [schoolId, a.id]);
  const teacherB = await q(`INSERT INTO teachers (school_id, user_id, first_name, last_name) VALUES ($1, $2, 'Prof', 'B') RETURNING id`, [schoolId, b.id]);
  teachingA = await q(
    `INSERT INTO teachings (school_id, academic_year_id, teacher_id, group_id, subject_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [schoolId, yearId, teacherA, groupA, subjectId],
  );
  teachingB = await q(
    `INSERT INTO teachings (school_id, academic_year_id, teacher_id, group_id, subject_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [schoolId, yearId, teacherB, groupB, subjectId],
  );

  guardianId = await q(`INSERT INTO users (phone, password_hash, full_name) VALUES ('+22241000777', 'x', 'Le parent') RETURNING id`);
  studentId = await q(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, 'RIM-EXO', 'NID-EXO', 'Aïcha', 'Exercice') RETURNING id`,
    [schoolId, guardianId],
  );
  await owner.query(
    `INSERT INTO enrollments (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee)
     VALUES ($1, $2, $3, $4, $5, 'enrolled', 5000)`,
    [schoolId, studentId, yearId, groupA, levelId],
  );
}, 120_000);

afterAll(async () => {
  await app?.close();
  await owner?.end();
  rmSync(uploadDir, { recursive: true, force: true });
});

describe("l'envoi : ses refus sont des phrases, jamais une panne", () => {
  it('⚠ la direction, sur un enseignement qui n’existe pas : « Enseignement invalide. », pas 500', async () => {
    const r = await envoyer(direction, '01900000-0000-7000-8000-000000000000', { title: 'T', body: 'B' });
    expect(r.statusCode).toBe(400);
    expect(message(r)).toBe('Enseignement invalide.');
  });

  it('un professeur, sur la classe d’un autre : « Enseignement invalide. »', async () => {
    const r = await envoyer(profA, teachingB, { title: 'T', body: 'B' });
    expect(r.statusCode).toBe(403);
    expect(message(r)).toBe('Enseignement invalide.');
  });

  it('titre ou consignes vides : « Titre et description obligatoires. »', async () => {
    const r = await envoyer(profA, teachingA, { title: '   ', body: 'B' });
    expect(r.statusCode).toBe(400);
    expect(message(r)).toBe('Titre et description obligatoires.');
  });

  it('une date qui n’existe pas : « Date limite invalide. »', async () => {
    for (const dueOn of ['2026-02-31', '31/12/2026', 'demain']) {
      const r = await envoyer(profA, teachingA, { title: 'T', body: 'B', dueOn });
      expect(r.statusCode, dueOn).toBe(400);
      expect(message(r), dueOn).toBe('Date limite invalide.');
    }
  });

  it('⚠ un titre de plus de 150 caractères est refusé EN FRANÇAIS', async () => {
    const r = await envoyer(profA, teachingA, { title: 'x'.repeat(151), body: 'B' });
    expect(r.statusCode).toBe(400);
    expect(message(r)).toBe('Titre trop long (150 caractères au plus).');
  });

  it('⚠ des consignes longues passent — sa colonne `description` est un TEXT, sans plafond à 5 000', async () => {
    const r = await envoyer(profA, teachingA, { title: 'Long', body: 'Consigne. '.repeat(1200) });
    expect(r.statusCode).toBe(201);
  });

  it('une année consultée vide (le champ caché sans valeur) ne casse rien', async () => {
    const r = await envoyer(profA, teachingA, { title: 'Sans année', body: 'B', academicYearId: '' });
    expect(r.statusCode).toBe(201);
  });
});

describe('un exercice envoyé, avec ses pièces jointes', () => {
  let homeworkId: string;
  let attachmentId: string;

  it('part, et compte les parents réellement notifiés', async () => {
    const r = await envoyer(profA, teachingA, {
      title: 'Fractions', body: 'Exercices 1 à 5 page 42.', dueOn: '2026-01-15', academicYearId: yearId,
    });
    expect(r.statusCode).toBe(201);
    const corps = r.json() as { id: string; notified: number };
    expect(corps.notified).toBe(1);
    homeworkId = corps.id;

    const notif = await owner.query(
      `SELECT kind, i18n_key, i18n_params FROM notifications WHERE guardian_id = $1 AND i18n_params->>'titre' = 'Fractions'`,
      [guardianId],
    );
    expect(notif.rows).toHaveLength(1);
    expect(notif.rows[0].i18n_params).toMatchObject({ matiere: 'Maths', eleve: 'Aïcha Exercice', limite: ' (15/01/2026)' });
  });

  it('reçoit un PDF dont le nom porte des accents et des espaces', async () => {
    const r = await joindre(profA, homeworkId, 'énoncé du devoir.pdf', PDF);
    expect(r.statusCode).toBe(201);
    const corps = r.json() as { id: string; displayName: string; mime: string };
    expect(corps.displayName).toBe('énoncé du devoir.pdf');
    expect(corps.mime).toBe('application/pdf');
    attachmentId = corps.id;
  });

  it('reçoit une photo de téléphone à l’extension en majuscules', async () => {
    const r = await joindre(profA, homeworkId, 'IMG_0042.PNG', PNG);
    expect(r.statusCode).toBe(201);
  });

  // Jinan (04/10/2026) : 10 Mo par fichier (MAX_BYTES, @elourwa/shared/fichiers),
  // et non 5 comme El Ourwa — les fiches Word et les photos de téléphone.
  it('⚠ un fichier de MAX_BYTES PILE passe (refusé AU-DELÀ)', async () => {
    const pile = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(MAX_BYTES - 9, 1)]);
    expect(pile.length).toBe(MAX_BYTES);
    const r = await joindre(profA, homeworkId, 'pile.pdf', pile);
    expect(r.statusCode, message(r)).toBe(201);
  });

  it('un octet de plus est refusé, par une phrase', async () => {
    const trop = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(MAX_BYTES - 8, 1)]);
    const r = await joindre(profA, homeworkId, 'trop.pdf', trop);
    expect(r.statusCode).toBe(400);
    expect(message(r)).toMatch(/trop volumineux/i);
  });

  it('un type refusé est refusé par SA phrase, et rien ne reste sur le disque', async () => {
    const avant = readdirSync(join(uploadDir, schoolId)).length;
    const r = await joindre(profA, homeworkId, 'notes.docx', Buffer.from('PK\u0003\u0004 pas une image'));
    expect(r.statusCode).toBe(400);
    // Jinan accepte aussi les documents de bureau — mais un vrai : ce « .docx » n'en est pas un.
    expect(message(r)).toBe('Type de fichier non autorisé. Acceptés : JPG, PNG, WebP, GIF, PDF, Word, Excel, PowerPoint, OpenDocument, RTF.');
    expect(readdirSync(join(uploadDir, schoolId)).length).toBe(avant);
  });

  it('⚠ un AUTRE professeur ne peut pas joindre un fichier à cet exercice', async () => {
    const r = await joindre(profB, homeworkId, 'intrus.pdf', PDF);
    expect(r.statusCode).toBe(403);
    const { rows } = await owner.query(`SELECT 1 FROM attachments WHERE homework_id = $1 AND display_name = 'intrus.pdf'`, [homeworkId]);
    expect(rows).toHaveLength(0);
  });

  it('la direction, elle, le peut (elle envoie pour toute l’école)', async () => {
    const r = await joindre(direction, homeworkId, 'corrige.pdf', PDF);
    expect(r.statusCode).toBe(201);
  });

  it('joindre à un exercice qui n’existe pas : 404, par une phrase', async () => {
    const r = await joindre(direction, '01900000-0000-7000-8000-000000000001', 'x.pdf', PDF);
    expect(r.statusCode).toBe(404);
    expect(message(r)).toBe('Exercice introuvable.');
  });

  it('la famille le lit, avec ses pièces jointes, par les deux routes', async () => {
    const parEnfant = await runInTenant({ schoolId, slug: SLUG }, () => parent.homework(studentId, famille(guardianId)));
    const fil = await runInTenant({ schoolId, slug: SLUG }, () => parent.familyHomework(famille(guardianId)));
    for (const liste of [
      (parEnfant as { homework: Record<string, unknown>[] }).homework,
      (fil as { homework: Record<string, unknown>[] }).homework,
    ]) {
      const exo = liste.find((h) => h.id === homeworkId) as { title: string; subject: string; attachments: { name: string }[] };
      expect(exo, 'l’exercice est dans la liste').toBeTruthy();
      expect(exo.subject).toBe('Maths');
      expect(exo.attachments.map((a) => a.name)).toEqual(
        ['énoncé du devoir.pdf', 'IMG_0042.PNG', 'pile.pdf', 'corrige.pdf'],
      );
    }
  });

  it('se télécharge : les octets, le type, et le nom accentué dans l’en-tête', async () => {
    const r = await app.inject({ method: 'GET', url: `/attachments/${attachmentId}`, headers: entetes(profA) });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(r.headers['content-disposition']).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('énoncé du devoir.pdf')}`,
    );
    expect(Buffer.compare(r.rawPayload, PDF)).toBe(0);
  });

  it('⚠ un fichier disparu du disque (restauration partielle) : 404 et une phrase, pas 500', async () => {
    const { rows } = await owner.query<{ stored_name: string }>('SELECT stored_name FROM attachments WHERE id = $1', [attachmentId]);
    unlinkSync(join(uploadDir, schoolId, rows[0]!.stored_name));
    const r = await app.inject({ method: 'GET', url: `/attachments/${attachmentId}`, headers: entetes(profA) });
    expect(r.statusCode).toBe(404);
    expect(message(r)).toBe('Pièce jointe introuvable.');
  });
});
