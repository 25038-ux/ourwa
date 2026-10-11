import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ROLES } from '@elourwa/db/seed-roles';
import { AppModule } from '../src/app.module.js';
import { hashPassword } from '../src/auth/passwords.js';

/**
 * « VOUS DEVEZ CHANGER VOTRE MOT DE PASSE AVANT DE CONTINUER » — DIT PAR LE
 * SERVEUR, plus seulement par les deux écrans. Revue de sécurité du 2026-10-10,
 * écrit AVANT le correctif (règle 15).
 *
 * ⚠ LA PORTE N'ÉTAIT QUE DANS LES CLIENTS. Le site (`(app)/layout.tsx`) et
 * l'application (`main.dart`) renvoient vers leur écran de changement ; l'API,
 * elle, ne regardait jamais `must_change_password`. Qui tenait un jeton valide
 * d'un compte encore sur son mot de passe remis appelait donc toutes les
 * routes — et 1 372 comptes de familles sont dans cet état, sur le même mot de
 * passe de départ.
 *
 * Tant que le drapeau est levé, l'API refuse tout par un 403 qui porte un code
 * (`MOT_DE_PASSE_A_CHANGER`), SAUF ce dont les deux écrans ont besoin — la
 * liste est dans `auth.guard.ts`, établie en lisant le site et l'application :
 *
 *   site, « Mon profil » obligé .... GET /auth/me, GET /auth/profil,
 *                                    GET /academic-years (le sélecteur d'année
 *                                    de l'en-tête), POST /auth/change-password
 *   application, de la connexion à
 *   la fin de son écran ............ GET /auth/me, POST /auth/locale,
 *                                    POST et DELETE /parent/devices,
 *                                    POST /auth/change-password
 *   publics, donc jamais concernés . POST /auth/login, /auth/refresh,
 *                                    /auth/logout, GET /school
 *
 * Personne ne doit être enfermé dehors : chaque appel permis est éprouvé ici
 * pour un compte au drapeau levé, dans les deux espaces.
 */

let app: NestFastifyApplication;
let owner: pg.Pool;

const SLUG = 'mdp-nour';
const REMIS = 'Temporaire1';
const CHOISI = 'Rentree2026';
const CODE = 'MOT_DE_PASSE_A_CHANGER';
const JETON_APPAREIL = 'jeton-fcm-de-test-pour-le-changement-oblige-0001';

const droitsAjoutes: { role_id: string; permission: string }[] = [];
let schoolId: string;
let groupeId: string;
let ids: Record<'staffOblige' | 'staffLibre' | 'parentOblige' | 'parentLibre', string>;

type Session = { accessToken: string; refreshToken: string; mustChangePassword: boolean };

async function connecter(identifier: string, password: string, espace: 'direction' | 'parent'): Promise<Session> {
  const r = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: espace === 'direction' ? { 'x-school-slug': SLUG } : {},
    payload: espace === 'parent' ? { identifier, password, espace: 'parent' } : { identifier, password },
  });
  expect(r.statusCode, r.body).toBeLessThan(300);
  const corps = r.json();
  return {
    accessToken: corps.accessToken,
    refreshToken: corps.refreshToken,
    mustChangePassword: corps.user.mustChangePassword,
  };
}

const direction = (s: Session) => ({ authorization: `Bearer ${s.accessToken}`, 'x-school-slug': SLUG });
const famille = (s: Session) => ({ authorization: `Bearer ${s.accessToken}` });

type Appel = { method: 'GET' | 'POST' | 'DELETE'; url: string; payload?: Record<string, unknown> };
const appeler = (entetes: Record<string, string>, a: Appel) =>
  app.inject({ method: a.method, url: a.url, headers: entetes, ...(a.payload ? { payload: a.payload } : {}) });

/** Un 403 qui dit POURQUOI : le code que les clients reconnaissent, et la phrase d'El Ourwa. */
function attendreLeRefus(r: { statusCode: number; body: string; json: () => any }, quoi: string) {
  expect(r.statusCode, `${quoi} — ${r.body.slice(0, 160)}`).toBe(403);
  expect(r.json().code, quoi).toBe(CODE);
  expect(r.json().message, quoi).toBe('Vous devez changer votre mot de passe avant de continuer.');
}

async function drapeau(userId: string): Promise<boolean> {
  const { rows } = await owner.query<{ must_change_password: boolean }>(
    'SELECT must_change_password FROM users WHERE id = $1',
    [userId],
  );
  return rows[0]!.must_change_password;
}

/** Ce que le bureau ouvre tous les jours : la dette d'une famille, les élèves, les notes. */
const routesDirection = (): Appel[] => [
  { method: 'GET', url: `/finance/debt/${ids.parentLibre}` },
  { method: 'GET', url: '/students' },
  { method: 'GET', url: '/students/count' },
  { method: 'GET', url: `/grades/class/${groupeId}?term=1` },
];

/** Ce que l'application ouvre dès la coquille : les enfants, le solde, les notes, les notifications. */
const routesFamille = (): Appel[] => [
  { method: 'GET', url: '/parent/children' },
  { method: 'GET', url: '/parent/balance' },
  { method: 'GET', url: '/parent/grades' },
  { method: 'GET', url: '/parent/notifications' },
  { method: 'GET', url: '/parent/messages/unread' },
];

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const q = async (sql: string, params: unknown[] = []) =>
    (await owner.query<{ id: string }>(sql, params)).rows[0]!.id;

  schoolId = await q(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ($1, 'École Nour (mot de passe obligé)', 'MDP') RETURNING id`,
    [SLUG],
  );
  const yearId = await q(
    `INSERT INTO academic_years (school_id, label, start_year, start_month, end_month, status)
     VALUES ($1, '2025-2026', 2025, 10, 6, 'active') RETURNING id`,
    [schoolId],
  );
  const niveauId = await q(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order)
     VALUES ($1, '6eme', 3000, 'college', 10) RETURNING id`,
    [schoolId],
  );
  groupeId = await q(
    `INSERT INTO groups (school_id, level_id, name, capacity) VALUES ($1, $2, '6A', 30) RETURNING id`,
    [schoolId, niveauId],
  );

  for (const code of ['super_admin', 'parent'] as const) {
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

  const remis = await hashPassword(REMIS);
  const compte = async (
    champ: 'email' | 'phone',
    identifiant: string,
    nom: string,
    role: 'super_admin' | 'parent',
    oblige: boolean,
  ) => {
    const id = await q(
      `INSERT INTO users (${champ}, password_hash, full_name, must_change_password)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [identifiant, remis, nom, oblige],
    );
    await owner.query(
      `INSERT INTO user_school_roles (user_id, school_id, role_id)
       SELECT $1, $2, r.id FROM roles r WHERE r.code = $3`,
      [id, schoolId, role],
    );
    return id;
  };
  ids = {
    staffOblige: await compte('email', 'mdp.oblige@test', 'Agent au mot de passe remis', 'super_admin', true),
    staffLibre: await compte('email', 'mdp.libre@test', 'Agent qui a déjà changé', 'super_admin', false),
    parentOblige: await compte('phone', '22770011', 'Famille au mot de passe remis', 'parent', true),
    parentLibre: await compte('phone', '22770012', 'Famille qui a déjà changé', 'parent', false),
  };

  for (const [rim, tuteur] of [
    ['MDP-1', ids.parentOblige],
    ['MDP-2', ids.parentLibre],
  ] as const) {
    const eleve = await q(
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, $3, $3, 'Enfant', $3) RETURNING id`,
      [schoolId, tuteur, rim],
    );
    await owner.query(
      `INSERT INTO enrollments (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee)
       VALUES ($1, $2, $3, $4, $5, 'enrolled', 3000)`,
      [schoolId, eleve, yearId, groupeId, niveauId],
    );
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
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

describe('le bureau — un agent encore sur son mot de passe remis', () => {
  let s: Session;

  it('se connecte : la porte se franchit par une session, pas autour', async () => {
    s = await connecter('mdp.oblige@test', REMIS, 'direction');
    expect(s.mustChangePassword).toBe(true);
  });

  it('chaque appel de « Mon profil » obligé répond', async () => {
    const moi = await appeler(direction(s), { method: 'GET', url: '/auth/me' });
    expect(moi.statusCode, moi.body).toBe(200);
    expect(moi.json().mustChangePassword).toBe(true);

    const profil = await appeler(direction(s), { method: 'GET', url: '/auth/profil' });
    expect(profil.statusCode, profil.body).toBe(200);
    expect(profil.json().identifiant).toBe('mdp.oblige@test');

    // Le sélecteur d'année de l'en-tête (`page-header.tsx`).
    const annees = await appeler(direction(s), { method: 'GET', url: '/academic-years' });
    expect(annees.statusCode, annees.body).toBe(200);

    // Le site renouvelle sa session par son intergiciel : la route est publique.
    const renouvele = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { 'x-school-slug': SLUG },
      payload: { refreshToken: s.refreshToken },
    });
    expect(renouvele.statusCode, renouvele.body).toBeLessThan(300);
    s = { ...s, accessToken: renouvele.json().accessToken, refreshToken: renouvele.json().refreshToken };
  });

  it('⚠ et tout le reste est refusé, avec le code — la dette d’une famille, les élèves, les notes', async () => {
    for (const a of routesDirection()) {
      attendreLeRefus(await appeler(direction(s), a), `${a.method} ${a.url}`);
    }
  });

  it('⚠ y compris les autres gestes du profil : seul le mot de passe se change', async () => {
    for (const a of [
      { method: 'POST', url: '/auth/change-name', payload: { prenom: 'Autre', nom: 'Nom' } },
      { method: 'POST', url: '/auth/change-identifier', payload: { newIdentifier: 'autre@test', currentPassword: REMIS } },
      { method: 'POST', url: '/auth/logout-all' },
      { method: 'POST', url: '/auth/delete-account', payload: { currentPassword: REMIS } },
      { method: 'GET', url: '/academic-years/default' },
    ] as Appel[]) {
      attendreLeRefus(await appeler(direction(s), a), `${a.method} ${a.url}`);
    }
    // Rien n'a été touché.
    const { rows } = await owner.query<{ email: string; full_name: string; active: boolean }>(
      'SELECT email, full_name, active FROM users WHERE id = $1',
      [ids.staffOblige],
    );
    expect(rows[0]).toEqual({ email: 'mdp.oblige@test', full_name: 'Agent au mot de passe remis', active: true });
  });

  it('un refus du changement lui-même n’est PAS ce refus-là, et ne lève pas le drapeau', async () => {
    const faux = await appeler(direction(s), {
      method: 'POST',
      url: '/auth/change-password',
      payload: { currentPassword: 'pas-le-bon', newPassword: CHOISI, confirmPassword: CHOISI },
    });
    expect(faux.statusCode).toBeGreaterThanOrEqual(400);
    expect(faux.json().code).toBeUndefined();

    const faible = await appeler(direction(s), {
      method: 'POST',
      url: '/auth/change-password',
      payload: { currentPassword: REMIS, newPassword: 'aaaaaaaa', confirmPassword: 'aaaaaaaa' },
    });
    expect(faible.statusCode).toBeGreaterThanOrEqual(400);
    expect(faible.json().code).toBeUndefined();
    expect(await drapeau(ids.staffOblige)).toBe(true);
  });

  it('change son mot de passe — et tout s’ouvre', async () => {
    const change = await appeler(direction(s), {
      method: 'POST',
      url: '/auth/change-password',
      payload: { currentPassword: REMIS, newPassword: CHOISI, confirmPassword: CHOISI, refreshToken: s.refreshToken },
    });
    expect(change.statusCode, change.body).toBeLessThan(300);
    expect(await drapeau(ids.staffOblige)).toBe(false);

    // Le site renouvelle la session gardée (`renouvelerSession`) : l'ancien
    // jeton d'accès porte le sceau de l'ancien mot de passe.
    const renouvele = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { 'x-school-slug': SLUG },
      payload: { refreshToken: s.refreshToken },
    });
    expect(renouvele.statusCode, renouvele.body).toBeLessThan(300);
    s = { ...s, accessToken: renouvele.json().accessToken, refreshToken: renouvele.json().refreshToken };

    for (const a of routesDirection()) {
      const r = await appeler(direction(s), a);
      expect(r.statusCode, `${a.method} ${a.url} — ${r.body.slice(0, 160)}`).toBe(200);
    }
    const moi = await appeler(direction(s), { method: 'GET', url: '/auth/me' });
    expect(moi.json().mustChangePassword).toBe(false);
  });

  it('et la déconnexion ferme la session, comme avant', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { 'x-school-slug': SLUG },
      payload: { refreshToken: s.refreshToken },
    });
    expect(r.statusCode, r.body).toBeLessThan(300);
  });
});

describe('le bureau — un agent qui a déjà changé n’est pas touché', () => {
  let s: Session;

  it('ouvre tout, sans rien changer', async () => {
    s = await connecter('mdp.libre@test', REMIS, 'direction');
    expect(s.mustChangePassword).toBe(false);
    for (const a of [...routesDirection(), { method: 'GET', url: '/academic-years/default' } as Appel]) {
      const r = await appeler(direction(s), a);
      expect(r.statusCode, `${a.method} ${a.url} — ${r.body.slice(0, 160)}`).toBe(200);
    }
  });

  it('⚠ le drapeau est relu à CHAQUE requête : une réinitialisation ferme les routes sans attendre', async () => {
    // Le drapeau seul, sans toucher au mot de passe : le jeton reste valide
    // (même sceau), et c'est bien le drapeau que la garde lit.
    await owner.query('UPDATE users SET must_change_password = true WHERE id = $1', [ids.staffLibre]);
    try {
      attendreLeRefus(await appeler(direction(s), { method: 'GET', url: '/students/count' }), 'GET /students/count');
      const moi = await appeler(direction(s), { method: 'GET', url: '/auth/me' });
      expect(moi.statusCode).toBe(200);
    } finally {
      await owner.query('UPDATE users SET must_change_password = false WHERE id = $1', [ids.staffLibre]);
    }
    const apres = await appeler(direction(s), { method: 'GET', url: '/students/count' });
    expect(apres.statusCode).toBe(200);
  });
});

describe('les familles — l’application, de la connexion à la fin de son écran de changement', () => {
  let s: Session;

  it('se connecte par son numéro, drapeau levé', async () => {
    s = await connecter('22770011', REMIS, 'parent');
    expect(s.mustChangePassword).toBe(true);
  });

  it('chaque appel de l’application avant la fin du changement répond', async () => {
    // `restore()` / `reessayer()` : le drapeau redemandé à chaque ouverture.
    const moi = await appeler(famille(s), { method: 'GET', url: '/auth/me' });
    expect(moi.statusCode, moi.body).toBe(200);
    expect(moi.json().mustChangePassword).toBe(true);

    // `_onSignedIn` : la langue choisie sur l'écran de connexion va au profil.
    const langue = await appeler(famille(s), { method: 'POST', url: '/auth/locale', payload: { locale: 'ar' } });
    expect(langue.statusCode, langue.body).toBeLessThan(300);

    // `Push.attacher` : le téléphone se déclare dès la connexion.
    const declare = await appeler(famille(s), {
      method: 'POST',
      url: '/parent/devices',
      payload: { platform: 'android', token: JETON_APPAREIL, locale: 'ar' },
    });
    expect(declare.statusCode, declare.body).toBeLessThan(300);

    // `Push.detacher`, avant `logout()` : « Se déconnecter » est offert sur
    // l'écran obligé, et le téléphone ne doit plus rien recevoir ensuite.
    const retire = await appeler(famille(s), {
      method: 'DELETE',
      url: '/parent/devices',
      payload: { token: JETON_APPAREIL },
    });
    expect(retire.statusCode, retire.body).toBeLessThan(300);

    // Le jeton d'accès expiré se renouvelle : la route est publique.
    const renouvele = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: s.refreshToken } });
    expect(renouvele.statusCode, renouvele.body).toBeLessThan(300);
    s = { ...s, accessToken: renouvele.json().accessToken, refreshToken: renouvele.json().refreshToken };
  });

  it('⚠ et rien de la famille ne sort avant : enfants, solde, notes, notifications, messages', async () => {
    for (const a of routesFamille()) {
      attendreLeRefus(await appeler(famille(s), a), `${a.method} ${a.url}`);
    }
    attendreLeRefus(
      await appeler(famille(s), { method: 'POST', url: '/auth/delete-account', payload: { currentPassword: REMIS } }),
      'POST /auth/delete-account',
    );
    attendreLeRefus(await appeler(famille(s), { method: 'POST', url: '/parent/devices/test', payload: {} }), 'POST /parent/devices/test');
  });

  it('change son mot de passe comme l’application le fait — et la coquille s’ouvre', async () => {
    const change = await appeler(famille(s), {
      method: 'POST',
      url: '/auth/change-password',
      payload: {
        currentPassword: REMIS,
        newPassword: CHOISI,
        confirmPassword: CHOISI,
        refreshToken: s.refreshToken,
        espace: 'parent',
      },
    });
    expect(change.statusCode, change.body).toBeLessThan(300);
    expect(await drapeau(ids.parentOblige)).toBe(false);

    // `changePassword()` : « un nouveau tout de suite, sinon le prochain appel est refusé ».
    const renouvele = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: s.refreshToken } });
    expect(renouvele.statusCode, renouvele.body).toBeLessThan(300);
    s = { ...s, accessToken: renouvele.json().accessToken, refreshToken: renouvele.json().refreshToken };

    for (const a of routesFamille()) {
      const r = await appeler(famille(s), a);
      expect(r.statusCode, `${a.method} ${a.url} — ${r.body.slice(0, 160)}`).toBe(200);
    }
    const enfants = await appeler(famille(s), { method: 'GET', url: '/parent/children' });
    expect(enfants.json().children).toHaveLength(1);
  });

  it('se déconnecte : la route est publique, et le jeton gardé ne sert plus', async () => {
    const r = await app.inject({ method: 'POST', url: '/auth/logout', payload: { refreshToken: s.refreshToken } });
    expect(r.statusCode, r.body).toBeLessThan(300);
    const apres = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: s.refreshToken } });
    expect(apres.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('les familles — un compte qui a déjà changé n’est pas touché', () => {
  it('ouvre la coquille tout de suite', async () => {
    const s = await connecter('22770012', REMIS, 'parent');
    expect(s.mustChangePassword).toBe(false);
    for (const a of routesFamille()) {
      const r = await appeler(famille(s), a);
      expect(r.statusCode, `${a.method} ${a.url} — ${r.body.slice(0, 160)}`).toBe(200);
    }
  });
});

describe('sans session, rien ne change', () => {
  it('un appel sans jeton reste un 401, pas ce 403', async () => {
    const r = await app.inject({ method: 'GET', url: '/students/count', headers: { 'x-school-slug': SLUG } });
    expect(r.statusCode).toBe(401);
    expect(r.json().code).toBeUndefined();
  });

  it('se déconnecter depuis l’écran obligé, sans avoir changé, reste possible', async () => {
    // Un parent qui ne retrouve pas le mot de passe remis doit pouvoir partir.
    await owner.query('UPDATE users SET must_change_password = true WHERE id = $1', [ids.parentLibre]);
    try {
      const s = await connecter('22770012', REMIS, 'parent');
      expect(s.mustChangePassword).toBe(true);
      const r = await app.inject({ method: 'POST', url: '/auth/logout', payload: { refreshToken: s.refreshToken } });
      expect(r.statusCode, r.body).toBeLessThan(300);
    } finally {
      await owner.query('UPDATE users SET must_change_password = false WHERE id = $1', [ids.parentLibre]);
    }
  });
});
