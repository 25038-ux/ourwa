import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { hashPassword } from '../src/auth/passwords.js';

/**
 * L'ÉCOLE UNIQUE — une installation qui ne sert qu'une école, sans console.
 *
 * `SINGLE_SCHOOL_SLUG=<slug>` : tout nom d'hôte désigne cette école (l'apex du
 * domaine, `www.`, `admin.`, une adresse IP), l'en-tête `X-School-Slug` ne
 * peut pas en désigner une autre, et les routes de la console (`/platform/*`)
 * n'existent pas (404) — même pour un administrateur de la plateforme. Sans
 * la variable, rien ne change : c'est ce que le premier bloc vérifie.
 *
 * ⚠ C'est de la résolution de tenant, donc le test précède la fonction
 * (règle 15) : une école unique mal résolue servirait la mauvaise école, ou
 * aucune, sur le domaine d'une école réelle.
 */

let app: NestFastifyApplication;
let owner: pg.Pool;
let jetonPlateforme: string;
let jetonEcole: string;
const PASSWORD = 'dev12345';

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  await owner.query(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES
       ('eu-nour', 'EU Nour', 'EUN'), ('eu-rissala', 'EU Rissala', 'EUR')`,
  );
  const { rows: roleRows } = await owner.query<{ id: string }>(
    `INSERT INTO roles (code, label, is_system) VALUES ('eu_admin', 'EU Admin', true) RETURNING id`,
  );
  await owner.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [
    roleRows[0]!.id,
    'scolarite.inscrire',
  ]);
  const hash = await hashPassword(PASSWORD);
  const { rows: u } = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name, is_platform_admin) VALUES
       ('eu.owner@test', $1, 'EU Owner', true), ('eu.admin@test', $1, 'EU Admin', false)
     RETURNING id`,
    [hash],
  );
  await owner.query(
    `INSERT INTO user_school_roles (user_id, school_id, role_id)
     SELECT $1, s.id, $2 FROM schools s WHERE s.slug = 'eu-nour'`,
    [u[1]!.id, roleRows[0]!.id],
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const auth = moduleRef.get(AuthService);
  const ctx = { ip: '10.0.0.9', userAgent: 'vitest' };
  jetonPlateforme = (await auth.login('eu.owner@test', PASSWORD, null, ctx)).accessToken;
  jetonEcole = (await auth.login('eu.admin@test', PASSWORD, 'eu-nour', ctx)).accessToken;
});

afterEach(() => {
  delete process.env.SINGLE_SCHOOL_SLUG;
  delete process.env.PLATFORM_CONSOLE;
});

afterAll(async () => {
  await app?.close();
  await owner?.end();
});

const ecole = (host: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url: '/school', headers: { host, ...headers } });

describe('sans école unique (la plateforme)', () => {
  it('admin. et www. ne sont pas des écoles', async () => {
    expect((await ecole('admin.localhost:3001')).statusCode).toBe(400);
    expect((await ecole('www.example.com')).statusCode).toBe(400);
  });

  it('la console répond à l’administrateur de la plateforme', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/platform/branches',
      headers: { host: 'admin.localhost:3001', authorization: `Bearer ${jetonPlateforme}` },
    });
    expect(r.statusCode).toBe(200);
  });
});

describe('en école unique', () => {
  it('tout nom d’hôte désigne l’école — apex, www, admin, adresse IP', async () => {
    process.env.SINGLE_SCHOOL_SLUG = 'eu-nour';
    for (const host of ['elmourad.mr', 'www.elmourad.mr', 'admin.elmourad.mr', '127.0.0.1:3001', 'localhost:3001']) {
      const r = await ecole(host);
      expect(r.statusCode, host).toBe(200);
      expect(r.json().slug, host).toBe('eu-nour');
    }
  });

  it('l’en-tête X-School-Slug ne désigne pas une autre école', async () => {
    process.env.SINGLE_SCHOOL_SLUG = 'eu-nour';
    const r = await ecole('elmourad.mr', { 'x-school-slug': 'eu-rissala' });
    expect(r.statusCode).toBe(200);
    expect(r.json().slug).toBe('eu-nour');
  });

  it('un compte de l’école entre depuis n’importe quel hôte, dans cette école', async () => {
    process.env.SINGLE_SCHOOL_SLUG = 'eu-nour';
    const r = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { host: 'www.elmourad.mr', 'content-type': 'application/json' },
      payload: { identifier: 'eu.admin@test', password: PASSWORD },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().school?.slug).toBe('eu-nour');
  });

  it('la console n’existe pas : 404, même pour l’administrateur de la plateforme', async () => {
    process.env.SINGLE_SCHOOL_SLUG = 'eu-nour';
    for (const url of ['/platform/branches', '/platform/schools', '/platform/admins', '/platform/tableau-bord?mois=1&annee=2026']) {
      const r = await app.inject({
        method: 'GET',
        url,
        headers: { host: 'admin.elmourad.mr', authorization: `Bearer ${jetonPlateforme}` },
      });
      expect(r.statusCode, url).toBe(404);
    }
    const creer = await app.inject({
      method: 'POST',
      url: '/platform/branches',
      headers: { host: 'admin.elmourad.mr', authorization: `Bearer ${jetonPlateforme}`, 'content-type': 'application/json' },
      payload: { slug: 'eu-x', name: 'EU X' },
    });
    expect(creer.statusCode).toBe(404);
    const { rows } = await owner.query("SELECT 1 FROM schools WHERE slug = 'eu-x'");
    expect(rows).toHaveLength(0);
  });

  it('la console peut être gardée explicitement (PLATFORM_CONSOLE=on)', async () => {
    process.env.SINGLE_SCHOOL_SLUG = 'eu-nour';
    process.env.PLATFORM_CONSOLE = 'on';
    const r = await app.inject({
      method: 'GET',
      url: '/platform/branches',
      headers: { host: 'admin.elmourad.mr', authorization: `Bearer ${jetonPlateforme}` },
    });
    expect(r.statusCode).toBe(200);
  });

  it('les routes de l’école restent gardées comme avant', async () => {
    process.env.SINGLE_SCHOOL_SLUG = 'eu-nour';
    const sans = await app.inject({ method: 'GET', url: '/students/count', headers: { host: 'elmourad.mr' } });
    expect(sans.statusCode).toBe(401);
    const avec = await app.inject({
      method: 'GET',
      url: '/students/count',
      headers: { host: 'elmourad.mr', authorization: `Bearer ${jetonEcole}` },
    });
    expect([200, 403]).toContain(avec.statusCode);
  });

  it('/health dit le mode', async () => {
    process.env.SINGLE_SCHOOL_SLUG = 'eu-nour';
    const r = await app.inject({ method: 'GET', url: '/health', headers: { host: 'elmourad.mr' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().mode).toBe('ecole-unique');
    expect(r.json().ecole).toBe('eu-nour');
    expect(r.json().migration).toMatch(/^\d{4}_/);
    delete process.env.SINGLE_SCHOOL_SLUG;
    const m = await app.inject({ method: 'GET', url: '/health', headers: { host: 'localhost:3001' } });
    expect(m.json().mode).toBe('plateforme');
  });
});
