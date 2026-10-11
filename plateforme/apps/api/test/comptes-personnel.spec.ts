import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { AccountsController } from '../src/accounts/accounts.controller.js';
import { runInTenant } from '../src/tenant/tenant.context.js';
import type { AuthenticatedRequest } from '../src/auth/permissions.guard.js';

/**
 * « COMPTES DU PERSONNEL » — les défauts relevés le 04/10/2026 sur l'école en
 * service, chacun reproduit ici avant sa correction.
 *
 *  1. un compte listé sur la page mais sans fiche de personnel ne se désactivait
 *     ni ne se réinitialisait (« Compte introuvable dans cette école ») ;
 *  2. qui détient UNE permission `comptes.*` agissait sur TOUS les comptes : la
 *     secrétaire (comptes.parents) désactivait un professeur et changeait
 *     l'e-mail du comptable ; un administrateur désactivait le super
 *     administrateur — le `staff_gerable()` d'El Ourwa n'était pas porté ;
 *  3. `GET /accounts/parents?limit=abc` répondait 500 ;
 *  4. le téléphone de « Modifier » s'enregistrait tel quel (« abc ») ;
 *  5. un compte sans fiche s'affichait avec la fonction « Professeur » ;
 *  6. un téléphone trop court répondait par une phrase de zod, en anglais.
 */

let owner: pg.Pool;
let accounts: AccountsService;
let controller: AccountsController;

let schoolId: string;
let SUPER: string;

const SUPER_ACTEUR = {
  roles: ['super_admin'],
  permissions: ['comptes.staff', 'comptes.professeurs', 'comptes.parents'],
};
/** L'administrateur « restreint » : pas `comptes.staff` (seed-roles.ts). */
const ADMIN_ACTEUR = { roles: ['admin'], permissions: ['comptes.professeurs', 'comptes.parents'] };
const SECRETAIRE_ACTEUR = { roles: ['secretaire'], permissions: ['comptes.parents'] };
/** Un rôle sur mesure qui aurait reçu `comptes.staff` sans être super administrateur. */
const AGENT_STAFF_ACTEUR = { roles: ['admin'], permissions: ['comptes.staff'] };

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'cptp' }, fn);
}

async function utilisateur(email: string, nom: string, role: string | null): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', $2) RETURNING id`,
    [email, nom],
  );
  if (role) {
    await owner.query(
      `INSERT INTO user_school_roles (user_id, school_id, role_id)
       SELECT $1, $2, id FROM roles WHERE code = $3`,
      [rows[0]!.id, schoolId, role],
    );
  }
  return rows[0]!.id;
}

const actif = async (id: string) =>
  (await owner.query<{ active: boolean }>('SELECT active FROM users WHERE id = $1', [id])).rows[0]!.active;

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const schools = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('cptp', 'Comptes Personnel', 'CPT') RETURNING id`,
  );
  schoolId = schools.rows[0]!.id;
  await owner.query(
    `INSERT INTO roles (code, label, is_system, sort_order) VALUES
       ('super_admin', 'Super administrateur', true, 1),
       ('admin', 'Administrateur', true, 2),
       ('comptable', 'Comptable', true, 10),
       ('secretaire', 'Secrétaire', true, 11),
       ('collecteur_absence', 'Collecteur d''absence', true, 12),
       ('professeur', 'Professeur', true, 20),
       ('parent', 'Parent', true, 30)
     ON CONFLICT (code) DO NOTHING`,
  );
  SUPER = await utilisateur('cptp.super@test', 'Directeur Cptp', 'super_admin');
  // Un second super administrateur : le premier n'est donc pas « le dernier ».
  await utilisateur('cptp.super2@test', 'Directrice Cptp', 'super_admin');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  accounts = moduleRef.get(AccountsService);
  controller = moduleRef.get(AccountsController);
});

afterAll(async () => {
  await owner?.end();
});

describe('un compte listé sans fiche de personnel (compte semé ou repris)', () => {
  let userId: string;

  beforeAll(async () => {
    userId = await utilisateur('cptp.absence@test', 'Collecteur Sansfiche', 'collecteur_absence');
  });

  it('est bien sur la page, avec la fonction de son rôle — pas « Professeur »', async () => {
    const liste = await inTenant(() => accounts.listComptesPersonnel());
    const c = liste.find((x) => x.id === userId);
    expect(c).toBeDefined();
    expect(c!.est_professeur).toBe(false);
    expect(c!.fonction).not.toBe('Professeur');
    // Le libellé est LU dans `roles`, pas écrit ici : la base de test est
    // partagée entre les fichiers, et `accounts.spec.ts` y sème ce rôle sous
    // « Collecteur » (ON CONFLICT DO NOTHING — le premier arrivé gagne). Ce
    // qui est affirmé : la fonction est le libellé du rôle du compte.
    const { rows } = await owner.query<{ label: string }>(
      `SELECT label FROM roles WHERE code = 'collecteur_absence'`,
    );
    expect(rows[0]!.label).toMatch(/^Collecteur/);
    expect(c!.fonction).toBe(rows[0]!.label);
  });

  it('se désactive et se réactive depuis la page', async () => {
    await inTenant(() => accounts.setActive(userId, false, SUPER, SUPER_ACTEUR));
    expect(await actif(userId)).toBe(false);
    await inTenant(() => accounts.setActive(userId, true, SUPER, SUPER_ACTEUR));
    expect(await actif(userId)).toBe(true);
  });

  it('reçoit un mot de passe provisoire', async () => {
    const r = await inTenant(() => accounts.resetPassword(userId, SUPER));
    expect(r.temporaryPassword).toMatch(/^\S{10}$/);
  });

  it('⚠ mais un compte sans aucun lien avec cette école reste introuvable', async () => {
    const ailleurs = await utilisateur('cptp.nullepart@test', 'Personne Ici', null);
    await expect(inTenant(() => accounts.setActive(ailleurs, false, SUPER, SUPER_ACTEUR))).rejects.toThrow(/introuvable/i);
    await expect(inTenant(() => accounts.resetPassword(ailleurs, SUPER))).rejects.toThrow(/introuvable/i);
  });
});

describe('⚠ une permission `comptes.*` ne vaut que pour SES comptes', () => {
  let profUserId: string;
  let comptableUserId: string;
  let parentId: string;

  beforeAll(async () => {
    const prof = await inTenant(() =>
      accounts.create({ role: 'professeur', firstName: 'Sidi', lastName: 'Prof', username: 'cptp.prof' }, SUPER),
    );
    profUserId = prof.userId;
    const comptable = await inTenant(() =>
      accounts.create({ role: 'comptable', firstName: 'Mariem', lastName: 'Caisse', username: 'cptp.comptable' }, SUPER),
    );
    comptableUserId = comptable.userId;

    const p = await owner.query<{ id: string }>(
      `INSERT INTO users (phone, password_hash, full_name) VALUES ('45117788', 'x', 'Famille Cptp') RETURNING id`,
    );
    parentId = p.rows[0]!.id;
    await owner.query(
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, 'RIM-CPTP', 'NID-CPTP', 'Enfant', 'Cptp')`,
      [schoolId, parentId],
    );
  });

  it('la secrétaire (comptes.parents) ne désactive pas un professeur', async () => {
    await expect(
      inTenant(() => accounts.setActive(profUserId, false, SUPER, SECRETAIRE_ACTEUR)),
    ).rejects.toThrow(/comptes\.professeurs/);
    expect(await actif(profUserId)).toBe(true);
  });

  it('la secrétaire ne change pas l’identifiant du comptable', async () => {
    await expect(
      inTenant(() => accounts.setIdentifier(comptableUserId, { email: 'pris@cptp.test' }, SUPER, {}, SECRETAIRE_ACTEUR)),
    ).rejects.toThrow(/comptes\.staff/);
    const { rows } = await owner.query<{ email: string | null }>('SELECT email FROM users WHERE id = $1', [comptableUserId]);
    expect(rows[0]!.email).toBeNull();
  });

  it('l’administrateur (sans comptes.staff) ne désactive pas le comptable', async () => {
    await expect(
      inTenant(() => accounts.setActive(comptableUserId, false, SUPER, ADMIN_ACTEUR)),
    ).rejects.toThrow(/comptes\.staff/);
    expect(await actif(comptableUserId)).toBe(true);
  });

  it('la secrétaire gère toujours les comptes des parents', async () => {
    await inTenant(() => accounts.setActive(parentId, false, SUPER, SECRETAIRE_ACTEUR));
    expect(await actif(parentId)).toBe(false);
    await inTenant(() => accounts.setActive(parentId, true, SUPER, SECRETAIRE_ACTEUR));
    await inTenant(() => accounts.setIdentifier(parentId, { phone: '45117799' }, SUPER, {}, SECRETAIRE_ACTEUR));
    const { rows } = await owner.query<{ phone: string }>('SELECT phone FROM users WHERE id = $1', [parentId]);
    expect(rows[0]!.phone).toBe('45117799');
  });

  it('l’administrateur gère toujours les comptes des professeurs', async () => {
    await inTenant(() => accounts.setActive(profUserId, false, SUPER, ADMIN_ACTEUR));
    expect(await actif(profUserId)).toBe(false);
    await inTenant(() => accounts.setActive(profUserId, true, SUPER, ADMIN_ACTEUR));
    expect(await actif(profUserId)).toBe(true);
  });
});

describe('⚠ le super administrateur ne se modifie que par un super administrateur — `staff_gerable()`', () => {
  let cible: string;

  beforeAll(async () => {
    const made = await inTenant(() =>
      accounts.create({ role: 'super_admin', firstName: 'Ahmed', lastName: 'Fondateur', username: 'cptp.fondateur' }, SUPER),
    );
    cible = made.userId;
  });

  it('un administrateur ne le désactive pas', async () => {
    await expect(inTenant(() => accounts.setActive(cible, false, SUPER, ADMIN_ACTEUR))).rejects.toThrow(/super administrateur/i);
    await expect(inTenant(() => accounts.setActive(cible, false, SUPER, AGENT_STAFF_ACTEUR))).rejects.toThrow(/super administrateur/i);
    expect(await actif(cible)).toBe(true);
  });

  it('ni ne change son identifiant, ni son identité', async () => {
    await expect(
      inTenant(() => accounts.setUsername(cible, 'cptp.vole', SUPER, AGENT_STAFF_ACTEUR)),
    ).rejects.toThrow(/super administrateur/i);
    await expect(
      inTenant(() => accounts.setIdentifier(cible, { email: 'vole@cptp.test' }, SUPER, {}, AGENT_STAFF_ACTEUR)),
    ).rejects.toThrow(/super administrateur/i);
    await expect(
      inTenant(() =>
        accounts.updateIdentity(cible, { prenom: 'X', nom: 'Y', telephone: null, fonction: '' }, SUPER, AGENT_STAFF_ACTEUR),
      ),
    ).rejects.toThrow(/super administrateur/i);
    const { rows } = await owner.query<{ username: string; email: string | null; full_name: string }>(
      'SELECT username, email, full_name FROM users WHERE id = $1',
      [cible],
    );
    expect(rows[0]).toEqual({ username: 'cptp.fondateur', email: null, full_name: 'Ahmed Fondateur' });
  });

  it('un super administrateur, lui, le peut', async () => {
    await inTenant(() => accounts.setActive(cible, false, SUPER, SUPER_ACTEUR));
    expect(await actif(cible)).toBe(false);
    await inTenant(() => accounts.setActive(cible, true, SUPER, SUPER_ACTEUR));
  });
});

describe('les comptes des parents — la liste', () => {
  it('⚠ une limite illisible ou négative ne fait pas tomber la page (500)', async () => {
    const nan = await inTenant(() => accounts.listParents({ limit: Number.NaN }));
    expect(Array.isArray(nan.rows)).toBe(true);
    const neg = await inTenant(() => accounts.listParents({ limit: -3 }));
    expect(Array.isArray(neg.rows)).toBe(true);
    const zero = await inTenant(() => accounts.listParents({ limit: 0 }));
    expect(zero.rows.length).toBeGreaterThan(0);
  });

  it('par le contrôleur : `?limit=abc` répond comme sans limite', async () => {
    const r = await inTenant(() => controller.parents(undefined, undefined, 'abc'));
    expect(r.rows.length).toBeGreaterThan(0);
  });
});

describe('« Modifier » — le téléphone', () => {
  let userId: string;

  beforeAll(async () => {
    const made = await inTenant(() =>
      accounts.create({ role: 'secretaire', firstName: 'Zeinebou', lastName: 'Bureau', username: 'cptp.bureau' }, SUPER),
    );
    userId = made.userId;
  });

  it('ne garde que ce qui fait un numéro — son `nettoyer_telephone()`', async () => {
    await inTenant(() =>
      accounts.updateIdentity(userId, { prenom: 'Zeinebou', nom: 'Bureau', telephone: 'abc', fonction: 'Secrétaire' }, SUPER),
    );
    let { rows } = await owner.query<{ phone: string | null }>('SELECT phone FROM staff WHERE user_id = $1', [userId]);
    expect(rows[0]!.phone).toBeNull();

    await inTenant(() =>
      accounts.updateIdentity(userId, { prenom: 'Zeinebou', nom: 'Bureau', telephone: 'tél: +222 22 33 44 55', fonction: 'Secrétaire' }, SUPER),
    );
    ({ rows } = await owner.query<{ phone: string | null }>('SELECT phone FROM staff WHERE user_id = $1', [userId]));
    expect(rows[0]!.phone).toBe('+222 22 33 44 55');
  });
});

describe('créer un compte — les refus se lisent', () => {
  const requete = () => ({ auth: { userId: SUPER, schoolId, impersonated: false, ...SUPER_ACTEUR } }) as unknown as AuthenticatedRequest;

  it('⚠ un téléphone trop court reçoit la phrase du numéro mauritanien, pas celle de zod', async () => {
    await expect(
      inTenant(async () =>
        controller.create(
          { role: 'comptable', firstName: 'Court', lastName: 'Numero', username: 'cptp.court', phone: '12345' },
          requete(),
        ),
      ),
    ).rejects.toThrow(/Numéro mauritanien attendu/);
  });

  it('le téléphone de la fiche est le même que celui du compte (huit chiffres)', async () => {
    const made = await inTenant(async () =>
      controller.create(
        { role: 'comptable', firstName: 'Bon', lastName: 'Numero', username: 'cptp.bon', phone: '+222 36 11 22 33' },
        requete(),
      ),
    );
    const { rows } = await owner.query<{ fiche: string; compte: string }>(
      'SELECT s.phone AS fiche, u.phone AS compte FROM staff s JOIN users u ON u.id = s.user_id WHERE s.id = $1',
      [made.personnelId],
    );
    expect(rows[0]).toEqual({ fiche: '36112233', compte: '36112233' });
  });
});
