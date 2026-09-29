import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { hashPassword } from '../src/auth/passwords.js';

/**
 * SUPPRIMER SON COMPTE — ce que les deux magasins exigent, et ce qu'une école
 * peut réellement promettre : la personne n'est plus identifiable et ne peut
 * plus se connecter ; ses écritures restent, anonymes.
 */
let owner: pg.Pool;
let auth: AuthService;
let ecole: string;
let userId: string;
const MDP = 'dev12345';
const CTX = { ip: '10.0.0.5', userAgent: 'vitest' };

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  ecole = (
    await owner.query<{ id: string }>(
      `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('suppr', 'Suppr', 'SU') RETURNING id`,
    )
  ).rows[0]!.id;
  await owner.query(`INSERT INTO roles (code, label) VALUES ('parent', 'Parent') ON CONFLICT (code) DO NOTHING`);
  userId = (
    await owner.query<{ id: string }>(
      `INSERT INTO users (phone, password_hash, full_name, locale)
       VALUES ('+22200007777', $1, 'Famille Test', 'ar') RETURNING id`,
      [await hashPassword(MDP)],
    )
  ).rows[0]!.id;
  await owner.query(
    `INSERT INTO user_school_roles (user_id, school_id, role_id)
     SELECT $1, $2, id FROM roles WHERE code = 'parent'`,
    [userId, ecole],
  );
  // Une écriture qui DOIT survivre : un encaissement rattaché à cette famille.
  await owner.query(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, 'R-SU', 'N-SU', 'Enfant', 'Suppr')`,
    [ecole, userId],
  );
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  auth = moduleRef.get(AuthService);
});

afterAll(async () => {
  await owner.query('DELETE FROM schools WHERE id = $1', [ecole]);
  await owner.query('DELETE FROM users WHERE id = $1', [userId]);
  await owner.end();
});

describe('supprimer son compte', () => {
  it('⚠ refuse sans le bon mot de passe — une session volée ne suffit pas', async () => {
    await expect(auth.deleteOwnAccount(userId, 'pas-le-bon', CTX.ip)).rejects.toThrow();
    const { rows } = await owner.query('SELECT active FROM users WHERE id = $1', [userId]);
    expect(rows[0]!.active).toBe(true);
  });

  it('anonymise, désactive, révoque — et garde les écritures', async () => {
    const { refreshToken } = await auth.login('+22200007777', MDP, 'suppr', CTX);

    await auth.deleteOwnAccount(userId, MDP, CTX.ip);

    const { rows } = await owner.query<{
      full_name: string; phone: string | null; email: string | null; username: string; active: boolean; locale: string;
    }>('SELECT full_name, phone, email, username, active, locale FROM users WHERE id = $1', [userId]);
    expect(rows[0]!.full_name).toBe('Compte supprimé');
    expect(rows[0]!.phone).toBeNull();
    expect(rows[0]!.email).toBeNull();
    expect(rows[0]!.username).toBe(`supprime-${userId}`);
    expect(rows[0]!.active).toBe(false);
    expect(rows[0]!.locale).toBe('fr');

    // Plus de connexion possible, ni par l'ancien numéro ni par une session ouverte.
    await expect(auth.login('+22200007777', MDP, 'suppr', CTX)).rejects.toThrow();
    await expect(auth.refresh(refreshToken, CTX)).rejects.toThrow();

    // L'enfant reste rattaché : le grand livre n'a pas bougé.
    const enfants = await owner.query('SELECT COUNT(*)::int AS n FROM students WHERE guardian_id = $1', [userId]);
    expect(enfants.rows[0]!.n).toBe(1);

    // Et la trace, sans les valeurs effacées.
    const audit = await owner.query<{ after: unknown }>(
      "SELECT after FROM audit_log WHERE entity_id = $1 AND action = 'account_deleted'",
      [userId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0]!.after ?? {})).not.toContain('+22200007777');
  });
});
