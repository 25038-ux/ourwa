import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { MailService } from '../src/mail/mail.service.js';

/**
 * The outbound queue.
 *
 * ⚠ Replaces two things that were wrong at once: password resets were SENT
 * inside the request, so a slow mail host hung it and a restart lost the message;
 * and when SMTP was unreachable the reset LINK was printed to stdout — a live
 * credential in a log file that gets shipped elsewhere.
 */

let owner: pg.Pool;
let mail: MailService;
let userId: string;

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const user = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('mail.user@test', 'x', 'Mail User') RETURNING id`,
  );
  userId = user.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  mail = moduleRef.get(MailService);
});

afterAll(async () => {
  await owner?.end();
});

beforeEach(async () => {
  await owner.query('DELETE FROM outbound_mail');
  delete process.env.SMTP_HOST;
});

describe('queueing', () => {
  it('accepts a message with no tenant, because a reset predates signing in', async () => {
    const queued = await mail.enqueue({
      schoolId: null,
      kind: 'password_reset',
      recipient: 'someone@test',
      subject: 'Sujet',
      body: 'Corps',
    });
    expect(queued.id).toBeTruthy();

    const { rows } = await owner.query<{ status: string; attempts: number }>(
      'SELECT status, attempts FROM outbound_mail WHERE id = $1',
      [queued.id],
    );
    expect(rows[0]!.status).toBe('pending');
    expect(rows[0]!.attempts).toBe(0);
  });
});

/*
 * ⚠ LES DEUX TESTS DE « MOT DE PASSE OUBLIÉ » SONT PARTIS AVEC LE LIBRE-SERVICE.
 * Décision du propriétaire (2026-09-04) : seul un super administrateur
 * réinitialise un mot de passe, et il le fait depuis un écran d'administration
 * — aucun courriel, aucun jeton, aucun lien.
 *
 * La file de courriels reste testée ci-dessus et ci-dessous : elle sert encore
 * aux notifications aux familles.
 */

describe('draining with no mail host', () => {
  it('⚠ keeps the message rather than losing it', async () => {
    await mail.enqueue({
      schoolId: null,
      kind: 'test',
      recipient: 'a@test',
      subject: 'S',
      body: 'B',
    });

    // ⚠ SANS HÔTE, LA FILE N'EST MÊME PAS RÉCLAMÉE (22/09) : réclamer comptait
    // une tentative, et cinq tentatives plus tard le courriel était abandonné.
    const result = await mail.drain();
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);

    const { rows } = await owner.query<{ status: string; attempts: number }>(
      'SELECT status, attempts FROM outbound_mail',
    );
    // Still pending, untouched, so it goes out the moment SMTP is configured.
    expect(rows[0]!.status).toBe('pending');
    expect(rows[0]!.attempts).toBe(0);
  });

  it('backs off rather than hammering, and the delay survives a restart', async () => {
    // Un hôte configuré mais injoignable : la livraison échoue vite.
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '9';
    await mail.enqueue({
      schoolId: null,
      kind: 'test',
      recipient: 'a@test',
      subject: 'S',
      body: 'B',
    });
    await mail.drain();

    const { rows } = await owner.query<{ due_in_future: boolean }>(
      'SELECT run_after > now() AS due_in_future FROM outbound_mail',
    );
    expect(rows[0]!.due_in_future).toBe(true);

    // Because it is not due, a second pass finds nothing at all.
    const second = await mail.drain();
    expect(second.failed).toBe(0);
  });

  it('gives up after the attempt ceiling instead of retrying for ever', async () => {
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '9';
    const queued = await mail.enqueue({
      schoolId: null,
      kind: 'test',
      recipient: 'a@test',
      subject: 'S',
      body: 'B',
    });
    await owner.query(
      "UPDATE outbound_mail SET attempts = max_attempts, run_after = now() WHERE id = $1",
      [queued.id],
    );

    await mail.drain();
    const { rows } = await owner.query<{ status: string }>(
      'SELECT status FROM outbound_mail WHERE id = $1',
      [queued.id],
    );
    expect(rows[0]!.status).toBe('abandoned');
  });
});

describe('queue health', () => {
  it('reports what is stuck and whether a host is even configured', async () => {
    await mail.enqueue({
      schoolId: null,
      kind: 'test',
      recipient: 'a@test',
      subject: 'S',
      body: 'B',
    });

    const health = await mail.queueHealth();
    expect(health.pending).toBe(1);
    expect(health.abandoned).toBe(0);
    // The thing a school actually needs to be told: nothing will ever leave.
    expect(health.configured).toBe(false);
    expect(health.oldestPending).not.toBeNull();
  });
});
