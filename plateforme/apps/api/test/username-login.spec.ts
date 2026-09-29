import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { hashPassword } from '../src/auth/passwords.js';

/**
 * SE CONNECTER AVEC UN NOM D'UTILISATEUR (migration 0027).
 *
 * ⚠ `users` N'AVAIT NULLE PART OÙ METTRE CE QUE LES GENS TAPENT VRAIMENT. Elle
 * offrait `email` et `phone` ; la connexion comparait l'un ou l'autre. Cela
 * couvre les correspondants, qui se connectent avec leur numéro. Cela ne couvre
 * pas le personnel : trois des quatre comptes d'El Ourwa se connectent avec
 * `e.historique`, `s.employ339`, `parite_lab`.
 *
 * Les ranger dans `email` marchait et était faux : un écran de profil les
 * annoncerait comme des adresses électroniques, et tout envoi de courrier
 * viserait une boîte qui n'existe pas.
 *
 * ⚠ ET L'UNICITÉ PORTE SUR `lower(username)`, pas sur `username`. La comparaison
 * de connexion est insensible à la casse ; un unique ordinaire laisserait
 * coexister « Admin » et « admin », tous deux joignables par la même saisie,
 * avec deux empreintes de mot de passe différentes derrière. Le compte atteint
 * dépendrait de l'ordre des lignes.
 */

let owner: pg.Pool;
let auth: AuthService;
let ecole: string;

const CTX = { ip: '10.0.0.9', userAgent: 'vitest' };
const MDP = 'dev12345';

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix)
     VALUES ('nom-utilisateur', 'École Test Identifiants', 'NUT') RETURNING id`,
  );
  ecole = rows[0]!.id;

  // `roles` est GLOBALE : plusieurs fichiers de test la partagent, donc jamais
  // d'INSERT nu — celui qui passe en second mourrait sur le code unique.
  await owner.query(
    `INSERT INTO roles (code, label) VALUES ('secretaire', 'Secrétaire')
     ON CONFLICT (code) DO NOTHING`,
  );

  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  auth = module.get(AuthService);
});

afterAll(async () => {
  await owner.query('DELETE FROM users WHERE username LIKE $1', ['t.%']);
  await owner.query('DELETE FROM schools WHERE id = $1', [ecole]);
  await owner.end();
});

async function creer(champs: { username?: string; email?: string; phone?: string }) {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO users (username, email, phone, password_hash, full_name)
     VALUES ($1, $2, $3, $4, 'Personne de test') RETURNING id`,
    [champs.username ?? null, champs.email ?? null, champs.phone ?? null, await hashPassword(MDP)],
  );
  await owner.query(
    `INSERT INTO user_school_roles (user_id, school_id, role_id)
     SELECT $1, $2, id FROM roles WHERE code = 'secretaire'`,
    [rows[0]!.id, ecole],
  );
  return rows[0]!.id;
}

describe('se connecter avec un nom d’utilisateur', () => {
  it('accepte un compte qui n’a QUE un nom d’utilisateur', async () => {
    await creer({ username: 't.historique' });

    const r = await auth.login('t.historique', MDP, 'nom-utilisateur', CTX);

    expect(r.school?.slug).toBe('nom-utilisateur');
    expect(r.roles).toEqual(['secretaire']);
    expect(r.accessToken.split('.')).toHaveLength(3);
  });

  it('l’accepte quelle que soit la casse, comme pour une adresse', async () => {
    await creer({ username: 't.casse' });

    const r = await auth.login('T.CASSE', MDP, 'nom-utilisateur', CTX);

    expect(r.roles).toEqual(['secretaire']);
  });

  it('laisse un compte qui a les deux se connecter par l’un ou par l’autre', async () => {
    await creer({ username: 't.deux', email: 't.deux@ecole.test' });

    const parNom = await auth.login('t.deux', MDP, 'nom-utilisateur', CTX);
    const parAdresse = await auth.login('t.deux@ecole.test', MDP, 'nom-utilisateur', CTX);

    expect(parNom.roles).toEqual(['secretaire']);
    expect(parAdresse.roles).toEqual(['secretaire']);
  });

  it('⚠ ne laisse pas un nom d’utilisateur ouvrir un compte avec un mauvais mot de passe', async () => {
    await creer({ username: 't.mdp' });

    await expect(auth.login('t.mdp', 'pas-le-bon', 'nom-utilisateur', CTX)).rejects.toThrow();
  });

  it('⚠ refuse deux comptes dont les noms ne diffèrent que par la casse', async () => {
    await creer({ username: 't.unique' });

    // Sans l'index sur `lower(username)`, les deux existeraient et « t.unique »
    // en désignerait un au hasard.
    await expect(creer({ username: 'T.UNIQUE' })).rejects.toThrow(/unique|duplicate/i);
  });

  it('⚠ refuse encore un compte sans aucun identifiant', async () => {
    // La contrainte a été élargie, pas retirée : une ligne doit rester
    // joignable par quelque chose.
    await expect(creer({})).rejects.toThrow(/users_identifiable|violates check/i);
  });

  it('n’empêche pas un correspondant de se connecter par son numéro', async () => {
    await creer({ username: 't.parent', phone: '+22200000099' });

    const r = await auth.login('+22200000099', MDP, 'nom-utilisateur', CTX);

    expect(r.roles).toEqual(['secretaire']);
  });
});
