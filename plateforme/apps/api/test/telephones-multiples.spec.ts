import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { hashPassword } from '../src/auth/passwords.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * PLUSIEURS NUMÉROS POUR UN COMPTE PARENT — 0041, demande du propriétaire (23/09/2026).
 *
 * Le père, la mère et l'oncle ouvrent le MÊME compte, avec le même mot de
 * passe ; un numéro n'appartient qu'à un compte ; une école ne touche qu'aux
 * familles qui sont les siennes.
 */

let owner: pg.Pool;
let accounts: AccountsService;
let auth: AuthService;
let schoolId: string;
let autreEcoleId: string;
let guardianId: string;
let voisinId: string;
let ACTOR: string;
const PASSWORD = 'Famille#2026';
const CTX = { ip: '10.0.0.9', userAgent: 'vitest' };

const inTenant = <T>(fn: () => Promise<T>) => runInTenant({ schoolId, slug: 'multitel' }, fn);

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  // Le module d'abord : son démarrage sème les rôles (le fichier seul, lancé en premier, n'en avait pas).
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('multitel', 'Multitel', 'MTL') RETURNING id`,
  );
  schoolId = school.rows[0]!.id;
  const autre = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('multitel2', 'Multitel 2', 'MT2') RETURNING id`,
  );
  autreEcoleId = autre.rows[0]!.id;
  const hash = await hashPassword(PASSWORD);
  const g = await owner.query<{ id: string }>(
    `INSERT INTO users (phone, password_hash, full_name) VALUES ('22110011', $1, 'Famille Multitel') RETURNING id`,
    [hash],
  );
  guardianId = g.rows[0]!.id;
  const v = await owner.query<{ id: string }>(
    `INSERT INTO users (phone, password_hash, full_name) VALUES ('22110022', $1, 'Famille Voisine') RETURNING id`,
    [hash],
  );
  voisinId = v.rows[0]!.id;
  await owner.query("INSERT INTO roles (code, label, is_system) VALUES ('parent', 'Parent', true) ON CONFLICT (code) DO NOTHING");
  const role = await owner.query<{ id: string }>(`SELECT id FROM roles WHERE code = 'parent'`);
  for (const [uid, sid] of [
    [guardianId, schoolId],
    [voisinId, autreEcoleId],
  ]) {
    await owner.query(
      `INSERT INTO user_school_roles (user_id, school_id, role_id) VALUES ($1, $2, $3)`,
      [uid, sid, role.rows[0]!.id],
    );
    await owner.query(
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, $3, $4, 'Enfant', 'Multitel')`,
      [sid, uid, `RIM-MT-${sid.slice(0, 6)}`, `NID-MT-${sid.slice(0, 6)}`],
    );
  }
  const a = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('multitel.actor@test', 'x', 'Direction') RETURNING id`,
  );
  ACTOR = a.rows[0]!.id;
  accounts = moduleRef.get(AccountsService);
  auth = moduleRef.get(AuthService);
});

afterAll(async () => {
  await owner?.end();
});

describe('Plusieurs numéros pour une famille', () => {
  it('ajoute un numéro sous sa forme canonique, et il ouvre le compte', async () => {
    await inTenant(() => accounts.ajouterTelephone(guardianId, { phone: '+222 33 44 55 66', label: 'Mère' }, ACTOR));
    const liste = await inTenant(() => accounts.telephonesDe(guardianId));
    expect(liste.map((p) => [p.phone, p.label])).toEqual([['33445566', 'Mère']]);

    const session = await auth.login('33 44 55 66', PASSWORD, null, CTX, true);
    expect(session.user.id).toBe(guardianId);
    // Le principal continue d'ouvrir.
    expect((await auth.login('22110011', PASSWORD, null, CTX, true)).user.id).toBe(guardianId);
  });

  it('refuse un numéro qui est déjà celui d’un autre compte, principal ou supplémentaire', async () => {
    await expect(
      inTenant(() => accounts.ajouterTelephone(guardianId, { phone: '22110022' }, ACTOR)),
    ).rejects.toThrow('déjà utilisé');
    await inTenant(() => accounts.ajouterTelephone(guardianId, { phone: '44001122' }, ACTOR));
    await expect(
      runInTenant({ schoolId: autreEcoleId, slug: 'multitel2' }, () =>
        accounts.ajouterTelephone(voisinId, { phone: '44001122' }, ACTOR),
      ),
    ).rejects.toThrow('déjà utilisé');
    // Ni un numéro qui est déjà le principal du compte lui-même.
    await expect(
      inTenant(() => accounts.ajouterTelephone(guardianId, { phone: '22110011' }, ACTOR)),
    ).rejects.toThrow('principal');
  });

  it('refuse un numéro mal formé', async () => {
    await expect(inTenant(() => accounts.ajouterTelephone(guardianId, { phone: '12345' }, ACTOR))).rejects.toThrow(
      'Numéro mauritanien',
    );
  });

  it('ne touche qu’aux familles de l’école', async () => {
    await expect(inTenant(() => accounts.telephonesDe(voisinId))).rejects.toThrow('introuvable');
    await expect(inTenant(() => accounts.ajouterTelephone(voisinId, { phone: '44009900' }, ACTOR))).rejects.toThrow(
      'introuvable',
    );
  });

  it('retire un numéro : il n’ouvre plus le compte', async () => {
    await inTenant(() => accounts.retirerTelephone(guardianId, '44 00 11 22', ACTOR));
    const liste = await inTenant(() => accounts.telephonesDe(guardianId));
    expect(liste.map((p) => p.phone)).toEqual(['33445566']);
    await expect(auth.login('44001122', PASSWORD, null, CTX, true)).rejects.toThrow('incorrect');
    await expect(inTenant(() => accounts.retirerTelephone(guardianId, '44001122', ACTOR))).rejects.toThrow('rattaché');
  });

  it('un numéro supplémentaire promu identifiant principal ne reste pas en double', async () => {
    await inTenant(() => accounts.setIdentifier(guardianId, { phone: '33445566' }, ACTOR, { correspondantSeulement: true }));
    const liste = await inTenant(() => accounts.telephonesDe(guardianId));
    expect(liste).toEqual([]);
    const { rows } = await owner.query<{ phone: string }>('SELECT phone FROM users WHERE id = $1', [guardianId]);
    expect(rows[0]!.phone).toBe('33445566');
  });

  it('changer l’identifiant refuse le numéro supplémentaire d’un autre compte', async () => {
    await runInTenant({ schoolId: autreEcoleId, slug: 'multitel2' }, () =>
      accounts.ajouterTelephone(voisinId, { phone: '46464646' }, ACTOR),
    );
    await expect(
      inTenant(() => accounts.setIdentifier(guardianId, { phone: '46464646' }, ACTOR, { correspondantSeulement: true })),
    ).rejects.toThrow('déjà utilisé');
  });
});
