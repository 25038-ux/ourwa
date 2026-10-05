import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { hashPassword } from '../src/auth/passwords.js';
import { ParametreInvalideFilter, estValeurIllisible } from '../src/common/parametre-invalide.filter.js';
import { estDateIso } from '../src/common/dates.js';
import type { ArgumentsHost } from '@nestjs/common';

/**
 * « PARAMÈTRE INVALIDE », PAS « INTERNAL SERVER ERROR » (05/10/2026).
 *
 * Trouvées en balayant toutes les routes GET avec des valeurs mal formées :
 * ces adresses répondaient 500. Elles répondent 400 avec un message qui dit
 * quoi regarder — et ce qui marchait marche toujours (une erreur de Zod garde
 * son message par champ, une route inconnue reste 404, un refus reste 403).
 */
let app: NestFastifyApplication;
let owner: pg.Pool;
let jeton: string;

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  await owner.query(`INSERT INTO schools (slug, name, receipt_prefix) VALUES ('pi-ecole', 'PI École', 'PIE')`);
  const { rows: r } = await owner.query<{ id: string }>(
    `INSERT INTO roles (code, label, is_system) VALUES ('pi_direction', 'PI Direction', true) RETURNING id`,
  );
  for (const p of ['comptes.parents', 'journal.consulter', 'finance.consulter']) {
    await owner.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [r[0]!.id, p]);
  }
  const hash = await hashPassword('dev12345');
  const { rows: u } = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('pi.direction@test', $1, 'PI Direction') RETURNING id`,
    [hash],
  );
  await owner.query(
    `INSERT INTO user_school_roles (user_id, school_id, role_id)
     SELECT $1, s.id, $2 FROM schools s WHERE s.slug = 'pi-ecole'`,
    [u[0]!.id, r[0]!.id],
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  jeton = (await moduleRef.get(AuthService).login('pi.direction@test', 'dev12345', 'pi-ecole', { ip: '10.0.0.7', userAgent: 'vitest' })).accessToken;
});

afterAll(async () => {
  await app?.close();
  await owner?.end();
});

const get = (url: string) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${jeton}`, 'x-school-slug': 'pi-ecole' } });

describe('une valeur illisible dans l’adresse', () => {
  it.each([
    '/reports/jour?jour=2026-02-31',
    '/reports/jour?jour=2026-13-45',
    '/reports/transactions?day=2026-02-31',
  ])('%s → 400, jamais 500', async (url) => {
    const r = await get(url);
    expect(r.statusCode, r.body).toBe(400);
    expect(JSON.stringify(r.json().message)).toMatch(/Paramètre invalide|Date invalide|Expected/);
  });

  it('une date qui n’existe pas : refusée avec son message, à la source', async () => {
    const r = await get('/reports/jour?jour=2026-02-31');
    expect(JSON.stringify(r.json().message)).toContain('Date invalide');
  });

  it('une limite illisible est ignorée (taille de page par défaut), plus de 500', async () => {
    for (const v of ['abc', '2026-13', 'zz-2026-13-45']) {
      expect((await get(`/accounts/parents?limit=${v}`)).statusCode, v).toBe(200);
    }
  });

  it('l’historique d’un jour impossible retombe sur aujourd’hui (comme une date absente)', async () => {
    expect((await get('/accounts/connection-history?jour=2026-02-31')).statusCode).toBe(200);
  });

  it('ce qui marchait marche toujours : 200, 404, 403, et le message de Zod', async () => {
    expect((await get('/accounts/parents')).statusCode).toBe(200);
    expect((await get('/route-qui-n-existe-pas')).statusCode).toBe(404);
    const sansJeton = await app.inject({ method: 'GET', url: '/accounts/parents', headers: { 'x-school-slug': 'pi-ecole' } });
    expect(sansJeton.statusCode).toBe(401);
    // Une erreur de Zod : 400 avec le champ en cause (son filtre à lui).
    const zod = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json', 'x-school-slug': 'pi-ecole' },
      payload: { identifier: 42 },
    });
    expect(zod.statusCode).toBe(400);
    expect(JSON.stringify(zod.json().message)).toMatch(/identifier|password/);
  });
});

describe('le filet : une valeur que Postgres ne lit pas', () => {
  function hote() {
    const envoye: { status?: number; corps?: unknown } = {};
    const reply = {
      status(c: number) { envoye.status = c; return this; },
      send(b: unknown) { envoye.corps = b; return this; },
    };
    const host = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ method: 'GET', url: '/x?d=2026-02-31' }), getResponse: () => reply }),
    } as unknown as ArgumentsHost;
    return { host, envoye };
  }
  const erreurPg = (code: string) => Object.assign(new Error('date/time field value out of range'), { code });

  it.each(['22P02', '22007', '22008', '22003'])('%s → 400 « Paramètre invalide »', (code) => {
    const { host, envoye } = hote();
    new ParametreInvalideFilter().catch(erreurPg(code), host);
    expect(envoye.status).toBe(400);
    expect((envoye.corps as { message: string }).message).toMatch(/^Paramètre invalide/);
  });

  it('une autre erreur de la base n’est pas une « valeur illisible »', () => {
    expect(estValeurIllisible(erreurPg('23505'))).toBe(false);
    expect(estValeurIllisible(erreurPg('40001'))).toBe(false);
    expect(estValeurIllisible('22P02')).toBe(false);
  });

  it('estDateIso : la forme ET le calendrier', () => {
    expect(estDateIso('2026-02-28')).toBe(true);
    expect(estDateIso('2028-02-29')).toBe(true);
    for (const d of ['2026-02-29', '2026-02-31', '2026-13-01', '2026-00-10', '26-02-01', '', null, undefined]) {
      expect(estDateIso(d), String(d)).toBe(false);
    }
  });
});
