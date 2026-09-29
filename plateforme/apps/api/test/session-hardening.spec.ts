import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { hashPassword } from '../src/auth/passwords.js';

/**
 * LE JETON DIT QUI VOUS ÉTIEZ ; LA BASE DIT QUI VOUS ÊTES.
 *
 * Quatre gestes de réaction à un incident, et ce qui doit être vrai à la
 * requête SUIVANTE — pas dans quinze minutes :
 *
 *   - le mot de passe change → le jeton d'accès émis avant est mort (sceau, 17) ;
 *   - le compte est désactivé → idem (18) ;
 *   - un rôle est retiré → la permission n'est plus là (23) ;
 *   - un jeton de rafraîchissement est présenté depuis un autre appareil et un
 *     autre réseau → toute la famille est révoquée (empreinte, 15).
 *
 * El Ourwa fait les quatre à chaque requête (`est_connecte()`), et son
 * commentaire dit pourquoi : « désactiver un compte ou réinitialiser son mot
 * de passe — les deux gestes de réaction à un incident — ne fermaient donc pas
 * la session en cours ».
 */

let app: NestFastifyApplication;
let owner: pg.Pool;
let auth: AuthService;
let userId: string;
let roleId: string;
let schoolId: string;

const MDP = 'dev12345';
const CTX = { ip: '10.1.2.3', userAgent: 'vitest-telephone' };

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  schoolId = (
    await owner.query<{ id: string }>(
      `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('durci', 'Durci', 'DU') RETURNING id`,
    )
  ).rows[0]!.id;
  roleId = (
    await owner.query<{ id: string }>(
      `INSERT INTO roles (code, label, is_system) VALUES ('durci_role', 'Durci', true) RETURNING id`,
    )
  ).rows[0]!.id;
  await owner.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [
    roleId,
    'scolarite.inscrire',
  ]);
  userId = (
    await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name) VALUES ('durci@test', $1, 'Durci') RETURNING id`,
      [await hashPassword(MDP)],
    )
  ).rows[0]!.id;
  await owner.query(
    'INSERT INTO user_school_roles (user_id, school_id, role_id) VALUES ($1, $2, $3)',
    [userId, schoolId, roleId],
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  auth = moduleRef.get(AuthService);
});

afterAll(async () => {
  await app?.close();
  await owner.query('DELETE FROM users WHERE email = $1', ['durci@test']);
  await owner.query('DELETE FROM roles WHERE id = $1', [roleId]);
  await owner.query('DELETE FROM schools WHERE id = $1', [schoolId]);
  await owner.end();
});

const appel = (token: string) =>
  app.inject({
    method: 'GET',
    url: '/students/count',
    headers: { authorization: `Bearer ${token}`, 'x-school-slug': 'durci' },
  });

describe('à la requête suivante', () => {
  it('un jeton valide passe', async () => {
    const { accessToken } = await auth.login('durci@test', MDP, 'durci', CTX);
    expect((await appel(accessToken)).statusCode).toBe(200);
  });

  it('⚠ un mot de passe changé tue le jeton émis avant', async () => {
    const { accessToken } = await auth.login('durci@test', MDP, 'durci', CTX);
    expect((await appel(accessToken)).statusCode).toBe(200);

    await owner.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
      userId,
      await hashPassword('nouveau-mdp-9'),
    ]);
    try {
      const r = await appel(accessToken);
      expect(r.statusCode).toBe(401);
      expect(r.json().message).toContain('identifiants modifiés');
    } finally {
      await owner.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
        userId,
        await hashPassword(MDP),
      ]);
    }
  });

  it('⚠ un compte désactivé ne passe plus, même avec un jeton encore signé', async () => {
    const { accessToken } = await auth.login('durci@test', MDP, 'durci', CTX);
    await owner.query('UPDATE users SET active = false WHERE id = $1', [userId]);
    try {
      const r = await appel(accessToken);
      expect(r.statusCode).toBe(401);
      expect(r.json().message).toContain('désactivé');
    } finally {
      await owner.query('UPDATE users SET active = true WHERE id = $1', [userId]);
    }
  });

  it('⚠ un rôle retiré retire la permission tout de suite', async () => {
    const { accessToken } = await auth.login('durci@test', MDP, 'durci', CTX);
    expect((await appel(accessToken)).statusCode).toBe(200);
    await owner.query('DELETE FROM user_school_roles WHERE user_id = $1 AND role_id = $2', [
      userId,
      roleId,
    ]);
    try {
      // Le jeton porte encore `scolarite.inscrire` ; la base ne la porte plus.
      expect((await appel(accessToken)).statusCode).toBe(403);
    } finally {
      await owner.query(
        'INSERT INTO user_school_roles (user_id, school_id, role_id) VALUES ($1, $2, $3)',
        [userId, schoolId, roleId],
      );
    }
  });
});

describe('l’empreinte du jeton de rafraîchissement', () => {
  it('passe depuis le même appareil sur le même réseau /24', async () => {
    const { refreshToken } = await auth.login('durci@test', MDP, 'durci', CTX);
    const r = await auth.refresh(refreshToken, { ip: '10.1.2.77', userAgent: 'vitest-telephone' });
    expect(r.accessToken).toBeTruthy();
  });

  it('⚠ révoque toute la famille depuis un autre appareil ET un autre réseau', async () => {
    const { refreshToken } = await auth.login('durci@test', MDP, 'durci', CTX);
    await expect(
      auth.refresh(refreshToken, { ip: '203.0.113.9', userAgent: 'curl/8' }),
    ).rejects.toThrow(/autre appareil/);
    // Et le porteur légitime aussi : on ne sait pas lequel des deux est le voleur.
    await expect(auth.refresh(refreshToken, CTX)).rejects.toThrow(/révoqu|réutilis|invalide/i);
  });
});
