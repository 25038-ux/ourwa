import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { ParentController } from '../src/parent/parent.controller.js';
import { hashPassword } from '../src/auth/passwords.js';
import { verifyAccessToken } from '../src/auth/tokens.js';
import { getJwtKeys } from '../src/auth/keys.js';
import type { AuthenticatedRequest } from '../src/auth/permissions.guard.js';

/**
 * UNE APPLICATION POUR TOUTES LES BRANCHES — la session de FAMILLE.
 *
 * Décision du propriétaire (2026-09-14) : les familles n'ont qu'une
 * application ; un parent avec un enfant à Nour et un autre à Rissala se
 * connecte avec un seul numéro — mauritanien, strictement — et voit les deux,
 * chacun lu dans son école. Ce que cette suite tient :
 *
 *  1. la connexion sans école ouvre une session de famille sur TOUTES les
 *     écoles où le compte est parent, et seulement celles-là ;
 *  2. un identifiant qui n'est pas un numéro mauritanien est refusé avant
 *     toute recherche ;
 *  3. `/parent/children` assemble les enfants des deux écoles, chacun avec
 *     son étiquette d'école — et un enfant d'une école où le compte n'est
 *     PAS parent n'apparaît pas, même s'il porte ce `guardian_id` (règle 1 :
 *     RLS par école, jamais contournée) ;
 *  4. un enfant qui n'est pas le sien reste refusé, dans toutes les écoles ;
 *  5. le renouvellement garde la session de famille.
 */

let owner: pg.Pool;
let auth: AuthService;
let parent: ParentController;
let nourId: string;
let rissalaId: string;
let salamId: string;
let familleId: string;
let enfantNour: string;
let enfantRissala: string;
let enfantSalam: string;
let autreParent: string;

const PASSWORD = 'Famille-2026';
const CTX = { ip: '10.0.0.9', userAgent: 'vitest' };

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const q = async <T,>(sql: string, params: unknown[] = []) =>
    (await owner.query<T & { id: string }>(sql, params)).rows[0]!;

  const ecole = async (slug: string, name: string) =>
    (await q(`INSERT INTO schools (slug, name, receipt_prefix) VALUES ($1, $2, $3) RETURNING id`, [slug, name, slug.toUpperCase()])).id;
  nourId = await ecole('fam-nour', 'École Nour');
  rissalaId = await ecole('fam-rissala', 'École Rissala');
  salamId = await ecole('fam-salam', 'École Salam');

  await owner.query(
    `INSERT INTO roles (code, label, is_system) VALUES ('parent', 'parent', true)
     ON CONFLICT (code) DO UPDATE SET is_system = true`,
  );

  familleId = (
    await q(`INSERT INTO users (phone, password_hash, full_name) VALUES ('22 44 55 66', $1, 'Famille Deux Écoles') RETURNING id`, [
      await hashPassword(PASSWORD),
    ])
  ).id;
  autreParent = (
    await q(`INSERT INTO users (phone, password_hash, full_name) VALUES ('33445566', $1, 'Autre Famille') RETURNING id`, [
      await hashPassword(PASSWORD),
    ])
  ).id;
  // Parent à Nour et à Rissala — PAS à Salam, même si un élève de Salam le porte.
  for (const s of [nourId, rissalaId]) {
    await owner.query(
      `INSERT INTO user_school_roles (user_id, school_id, role_id) SELECT $1, $2, id FROM roles WHERE code = 'parent'`,
      [familleId, s],
    );
  }
  await owner.query(
    `INSERT INTO user_school_roles (user_id, school_id, role_id) SELECT $1, $2, id FROM roles WHERE code = 'parent'`,
    [autreParent, nourId],
  );

  const structure = new Map<string, { y: string; level: string; group: string }>();
  for (const s of [nourId, rissalaId, salamId]) {
    const y = (await q(`INSERT INTO academic_years (school_id, label, start_year, status) VALUES ($1, '2025-2026', 2025, 'active') RETURNING id`, [s])).id;
    const level = (await q(`INSERT INTO levels (school_id, name, monthly_rate, cycle) VALUES ($1, '6eme', 5000, 'college') RETURNING id`, [s])).id;
    const group = (await q(`INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6eme A') RETURNING id`, [s, level])).id;
    structure.set(s, { y, level, group });
  }
  const enfant = async (s: string, prenom: string, guardian: string) => {
    const { y, level, group } = structure.get(s)!;
    const st = (
      await q(
        `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
         VALUES ($1, $2, $3, $4, $5, 'Famille') RETURNING id`,
        [s, guardian, `RIM-${prenom}`, `NNI-${prenom}`, prenom],
      )
    ).id;
    await owner.query(
      `INSERT INTO enrollments (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee)
       VALUES ($1, $2, $3, $4, $5, 'enrolled', 5000)`,
      [s, st, y, group, level],
    );
    return st;
  };
  enfantNour = await enfant(nourId, 'Aicha', familleId);
  enfantRissala = await enfant(rissalaId, 'Brahim', familleId);
  enfantSalam = await enfant(salamId, 'Cheikh', familleId);
  await enfant(nourId, 'Dada', autreParent);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  auth = moduleRef.get(AuthService);
  parent = moduleRef.get(ParentController);
});

afterAll(async () => {
  await owner.query(`DELETE FROM schools WHERE slug LIKE 'fam-%'`);
  await owner.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[familleId, autreParent]]);
  await owner.end();
});

/** La requête telle que le garde la pose pour une session de famille. */
function requeteFamille(userId: string, ecoles: { id: string; slug: string; name: string }[]): AuthenticatedRequest {
  return {
    auth: {
      userId,
      schoolId: null,
      roles: ['parent'],
      permissions: [],
      impersonated: false,
      ecolesFamille: ecoles.map((e) => ({ ...e, nameAr: null })),
    },
  } as unknown as AuthenticatedRequest;
}

describe('la connexion des familles', () => {
  it('⚠ n’accepte qu’un numéro mauritanien comme identifiant, avant toute recherche', async () => {
    await expect(auth.login('admin@nour.test', PASSWORD, null, CTX, true)).rejects.toThrow(/Numéro mauritanien attendu/);
    await expect(auth.login('12345678', PASSWORD, null, CTX, true)).rejects.toThrow(/Numéro mauritanien attendu/);
    await expect(auth.login('SANSTEL-0042', PASSWORD, null, CTX, true)).rejects.toThrow(/Numéro mauritanien attendu/);
  });

  it('ouvre une session de famille sur toutes les écoles où le compte est parent — et seulement celles-là', async () => {
    const r = await auth.login('+222 22 44 55 66', PASSWORD, null, CTX, true);
    expect(r.school).toBeNull();
    expect(r.roles).toEqual(['parent']);
    expect(r.ecoles.map((e) => e.slug).sort()).toEqual(['fam-nour', 'fam-rissala']);
    const claims = await verifyAccessToken(r.accessToken, getJwtKeys().publicKey);
    expect(claims.espace).toBe('parent');
    expect(claims.schoolId).toBeNull();

    // Le renouvellement garde la session de famille.
    const again = await auth.refresh(r.refreshToken, CTX);
    const claims2 = await verifyAccessToken(again.accessToken, getJwtKeys().publicKey);
    expect(claims2.espace).toBe('parent');
    expect(again.ecoles).toHaveLength(2);
  });

  it('refuse un numéro qui n’est parent nulle part, avec la même phrase qu’un mot de passe faux', async () => {
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO users (phone, password_hash, full_name) VALUES ('44556677', $1, 'Sans enfant') RETURNING id`,
      [await hashPassword(PASSWORD)],
    );
    await expect(auth.login('44556677', PASSWORD, null, CTX, true)).rejects.toThrow(/Numéro ou mot de passe incorrect\./);
    await owner.query('DELETE FROM users WHERE id = $1', [rows[0]!.id]);
  });
});

describe('les enfants d’une famille, école par école', () => {
  it('⚠ assemble les enfants de ses écoles, chacun étiqueté — et pas celui d’une école où le compte n’est pas parent', async () => {
    const out = await parent.children(
      requeteFamille(familleId, [
        { id: nourId, slug: 'fam-nour', name: 'École Nour' },
        { id: rissalaId, slug: 'fam-rissala', name: 'École Rissala' },
      ]),
    );
    const noms = out.children.map((c) => `${c.first_name}@${c.school.slug}`).sort();
    expect(noms).toEqual(['Aicha@fam-nour', 'Brahim@fam-rissala']);
    expect(out.ecoles).toHaveLength(2);
    expect(out.academicYear).toBe('2025-2026');
  });

  it('⚠ un enfant d’une autre famille reste refusé, dans toutes les écoles', async () => {
    const r = requeteFamille(familleId, [
      { id: nourId, slug: 'fam-nour', name: 'École Nour' },
      { id: rissalaId, slug: 'fam-rissala', name: 'École Rissala' },
    ]);
    // Cheikh est à Salam, où ce compte n'est pas parent : invisible, donc refusé.
    await expect(parent.attendance(enfantSalam, r)).rejects.toThrow(/n’est pas votre enfant/);
    // Et l'enfant de l'autre famille, à Nour, aussi.
    const { rows } = await owner.query<{ id: string }>(`SELECT id FROM students WHERE first_name = 'Dada'`);
    await expect(parent.attendance(rows[0]!.id, r)).rejects.toThrow(/n’est pas votre enfant/);
    // Les siens répondent, chacun depuis son école.
    await expect(parent.attendance(enfantNour, r)).resolves.toMatchObject({ total: 0 });
    await expect(parent.attendance(enfantRissala, r)).resolves.toMatchObject({ total: 0 });
  });

  it('le solde additionne les écoles quand elles comptent dans la même monnaie', async () => {
    const out = await parent.balance(
      requeteFamille(familleId, [
        { id: nourId, slug: 'fam-nour', name: 'École Nour' },
        { id: rissalaId, slug: 'fam-rissala', name: 'École Rissala' },
      ]),
    );
    expect(out.currency).toBe('MRU');
    expect(out.parEcole).toHaveLength(2);
    expect(typeof out.total).toBe('string');
  });

  it('⚠ le solde ne tombe pas à zéro quand l’école ouvre l’année suivante avant les réinscriptions', async () => {
    // Le défaut vu sur la démonstration (20/09) : 2026-2027 activée, aucune
    // réinscription, et l'application disait « 0 » à une famille qui devait
    // encore ses mois de 2025-2026. Son obtenir_dette_parent_detaillee($pid)
    // n'a pas d'année : c'est l'année réellement scolarisée qui compte.
    const ecoles = [{ id: nourId, slug: 'fam-nour', name: 'École Nour' }];
    // Des mois facturables échus pour Aicha à Nour (5 000 chacun), aucun paiement.
    const { rows: e } = await owner.query<{ id: string }>('SELECT id FROM enrollments WHERE student_id = $1', [enfantNour]);
    await owner.query(
      `INSERT INTO enrollment_months (school_id, enrollment_id, month_order, month_label, calendar_month, calendar_year, amount_due, status)
       VALUES ($1, $2, 1, 'Octobre', 10, 2025, 5000, 'billable'), ($1, $2, 2, 'Novembre', 11, 2025, 5000, 'billable')`,
      [nourId, e[0]!.id],
    );
    const avant = await parent.balance(requeteFamille(familleId, ecoles));
    expect(avant.total).toBe('10000.00');

    // L'école ouvre 2026-2027 : 2025-2026 est clôturée, personne n'est réinscrit.
    await owner.query(`UPDATE academic_years SET status = 'closed' WHERE school_id = $1`, [nourId]);
    await owner.query(
      `INSERT INTO academic_years (school_id, label, start_year, status) VALUES ($1, '2026-2027', 2026, 'active')`,
      [nourId],
    );
    const apres = await parent.balance(requeteFamille(familleId, ecoles));
    expect(apres.total).toBe('10000.00');
    expect(apres.tuition).toHaveLength(2);
  });
});
