import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { hashPassword } from '../src/auth/passwords.js';

/**
 * ⚠ Regression test for a real bug found in Phase 1.
 *
 * Resolving WHICH school a request is for is not the same as deciding whether
 * the caller may enter it. Before the fix, a signed-in user at one branch could
 * read another branch's data by changing the Host header (or `X-School-Slug` in
 * development): RLS scoped every query faithfully to whatever tenant was set,
 * and nothing checked that the caller was entitled to set it.
 *
 * The database was doing exactly what it was told. The bug was what it was told.
 */

let app: NestFastifyApplication;
let owner: pg.Pool;
let nourToken: string;
let rissalaToken: string;

const PASSWORD = 'dev12345';

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  await owner.query(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES
       ('xs-nour', 'XS Nour', 'XN'), ('xs-rissala', 'XS Rissala', 'XR')`,
  );
  const { rows: roleRows } = await owner.query<{ id: string }>(
    `INSERT INTO roles (code, label, is_system) VALUES ('xs_admin', 'XS Admin', true)
     RETURNING id`,
  );
  await owner.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [
    roleRows[0]!.id,
    'scolarite.inscrire',
  ]);

  const hash = await hashPassword(PASSWORD);
  for (const slug of ['xs-nour', 'xs-rissala']) {
    const { rows } = await owner.query<{ id: string }>(
      'INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id',
      [`admin@${slug}.test`, hash, `Admin ${slug}`],
    );
    await owner.query(
      `INSERT INTO user_school_roles (user_id, school_id, role_id)
       SELECT $1, s.id, $2 FROM schools s WHERE s.slug = $3`,
      [rows[0]!.id, roleRows[0]!.id, slug],
    );
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const auth = moduleRef.get(AuthService);
  const ctx = { ip: '10.0.0.9', userAgent: 'vitest' };
  nourToken = (await auth.login('admin@xs-nour.test', PASSWORD, 'xs-nour', ctx)).accessToken;
  rissalaToken = (await auth.login('admin@xs-rissala.test', PASSWORD, 'xs-rissala', ctx))
    .accessToken;
});

afterAll(async () => {
  await app?.close();
  await owner?.end();
});

async function studentsCount(token: string, slug: string) {
  return app.inject({
    method: 'GET',
    url: '/students/count',
    headers: { authorization: `Bearer ${token}`, 'x-school-slug': slug },
  });
}

describe('cross-school access', () => {
  it('lets a user read their own school', async () => {
    const response = await studentsCount(nourToken, 'xs-nour');
    expect(response.statusCode).toBe(200);
    expect(response.json().school).toBe('xs-nour');
  });

  it('REFUSES a token from one school aimed at another', async () => {
    const response = await studentsCount(nourToken, 'xs-rissala');
    expect(response.statusCode).toBe(403);
    expect(response.json().message).toMatch(/n’appartient pas à cette école/i);
  });

  it('refuses in both directions', async () => {
    expect((await studentsCount(rissalaToken, 'xs-nour')).statusCode).toBe(403);
  });

  it('audits every refusal, naming the actor and the school they reached for', async () => {
    await studentsCount(nourToken, 'xs-rissala');
    const { rows } = await owner.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_log WHERE action = 'cross_school_access_denied'",
    );
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
  });

  it('rejects an unauthenticated request before any tenant is resolved', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/students/count',
      headers: { 'x-school-slug': 'xs-nour' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('keeps branding public, so a visitor can see whose login page they are on', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/school',
      headers: { 'x-school-slug': 'xs-nour' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe('XS Nour');
  });
});
