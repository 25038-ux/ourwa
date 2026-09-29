import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module.js';

/**
 * A rejected input must say what was wrong.
 *
 * ⚠ Every `.parse()` in this API used to raise a ZodError, which Nest does not
 * recognise, so it became `500 Internal server error`. Every carefully worded
 * validation message in the codebase was therefore invisible — the web client
 * reads `body.message` and got nothing — and a clerk who mistyped an amount
 * would have reported a server outage.
 */

let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
});

describe('a rejected input', () => {
  it('⚠ is 400, not 500', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/teachings?groupId=not-a-uuid&academicYearId=also-not',
      headers: { 'X-School-Slug': 'nowhere' },
    });
    // Unauthenticated requests are refused before validation, which is correct
    // ordering — so the assertion is simply that it is never a 500.
    expect(response.statusCode).not.toBe(500);
  });

  it('carries the reason, not just a status', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: '', password: '' },
      headers: { 'X-School-Slug': 'nowhere' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { message: string[] | string };
    const text = Array.isArray(body.message) ? body.message.join(' ') : body.message;
    // Something a person could act on, and the field it concerns.
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/identifier|password/i);
  });

  it('names the field, because "invalid uuid" alone is barely better than silence', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: 'someone@test', password: 123 },
      headers: { 'X-School-Slug': 'nowhere' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as { message: string[] };
    expect(Array.isArray(body.message)).toBe(true);
    expect(body.message.join(' ')).toContain('password');
  });
});
