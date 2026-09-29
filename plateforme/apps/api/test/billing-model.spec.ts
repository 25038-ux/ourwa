import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module.js';
import { BillingModelService } from '../src/finance/billing-model.service.js';
import { DbService } from '../src/db/db.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LE MODÈLE DE FACTURATION, PAR ÉCOLE — le seul point de lecture de l'API.
 *
 * ADR-0073, docs/specs/jinan-facturation.md §1. Chaque comportement nouveau de
 * la facturation « services » (Jinan) se décide sur `BillingModelService` ;
 * une école « famille » (El Mourad, Nour, Rissala, Salam) doit y lire
 * « famille » et rien d'autre, sans qu'on ait rien à poser : c'est la valeur
 * par défaut de la colonne. Le site le lit dans `GET /school` (`billingModel`).
 *
 * ⚠ Deux écoles dans la même base, lues l'une après l'autre sur la même pile
 * de connexions : un modèle qui fuirait d'une école à l'autre ferait facturer
 * des services à une famille d'El Mourad.
 */

let app: NestFastifyApplication;
let owner: pg.Pool;
let billing: BillingModelService;
let db: DbService;
let famille: { schoolId: string; slug: string };
let services: { schoolId: string; slug: string };

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  // École « famille » : la colonne n'est pas nommée — c'est le défaut qu'on éprouve.
  const f = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('bm-nour', 'BM Nour', 'BMN') RETURNING id`,
  );
  const s = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix, billing_model)
     VALUES ('bm-jinan', 'BM Jinan', 'BMJ', 'services') RETURNING id`,
  );
  famille = { schoolId: f.rows[0]!.id, slug: 'bm-nour' };
  services = { schoolId: s.rows[0]!.id, slug: 'bm-jinan' };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  billing = moduleRef.get(BillingModelService);
  db = moduleRef.get(DbService);
});

afterAll(async () => {
  await app?.close();
  await owner?.end();
});

describe('BillingModelService.current()', () => {
  it('lit « famille » pour une école créée sans rien préciser', async () => {
    expect(await runInTenant(famille, () => billing.current())).toBe('famille');
  });

  it('lit « services » pour une école créée ainsi', async () => {
    expect(await runInTenant(services, () => billing.current())).toBe('services');
  });

  it('ne fuit pas d’une école à l’autre, lectures entrelacées', async () => {
    const lus = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        runInTenant(i % 2 ? services : famille, () => billing.current()),
      ),
    );
    expect(lus).toEqual(Array.from({ length: 10 }, (_, i) => (i % 2 ? 'services' : 'famille')));
  });

  it('se lit aussi dans une transaction déjà ouverte (currentIn)', async () => {
    const [a, b] = await Promise.all([
      runInTenant(famille, () => db.query((tx) => billing.currentIn(tx))),
      runInTenant(services, () => db.query((tx) => billing.currentIn(tx))),
    ]);
    expect([a, b]).toEqual(['famille', 'services']);
  });

  it('isServices() : vrai pour Jinan seulement', async () => {
    expect(await runInTenant(famille, () => billing.isServices())).toBe(false);
    expect(await runInTenant(services, () => billing.isServices())).toBe(true);
  });

  it('⚠ refuse de répondre hors de toute école — pas de modèle « par défaut » silencieux', async () => {
    await expect(billing.current()).rejects.toThrow(/tenant/i);
  });
});

describe('GET /school', () => {
  const ecole = (slug: string) =>
    app.inject({ method: 'GET', url: '/school', headers: { 'x-school-slug': slug } });

  it('expose billingModel = « famille » pour une école existante', async () => {
    const r = await ecole('bm-nour');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ slug: 'bm-nour', name: 'BM Nour', billingModel: 'famille' });
  });

  it('expose billingModel = « services » pour Jinan', async () => {
    const r = await ecole('bm-jinan');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ slug: 'bm-jinan', billingModel: 'services' });
  });
});
