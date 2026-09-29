import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { hashPassword } from '../src/auth/passwords.js';

/**
 * LES DEUX PORTES D'AUTHENTIFICATION QUI N'ÉTAIENT PAS COMPTÉES.
 *
 * Signing in is protected — five failures per fifteen minutes, keyed on BOTH the
 * account and the IP, because account-only lets one machine spray a password
 * across many accounts and IP-only lets a botnet grind one account.
 *
 * ⚠ TWO OTHER DOORS OPEN ONTO THE SAME LOCK AND NEITHER WAS COUNTED:
 *
 *   `forgot-password`  — sends an email. The global ceiling is 300 requests a
 *                        minute, so one caller could put three hundred messages
 *                        into a family's inbox every minute, and burn the
 *                        school's SMTP quota doing it. Mail-bombing is the
 *                        attack; enumeration is prevented separately by always
 *                        answering the same way.
 *
 *   `change-password`  — checks the CURRENT password before accepting a new one,
 *                        which makes it a password oracle for anyone holding a
 *                        session: three hundred guesses a minute against the
 *                        password of the account they are already in, and from
 *                        there against a password reused elsewhere.
 *
 * Both now count into the same buckets as signing in, so an attacker gains
 * nothing by moving between the three.
 */

let owner: pg.Pool;
let auth: AuthService;
let userId: string;

const IP = '203.0.113.77';

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const hash = await hashPassword('Le-Bon-Mdp2');
  const user = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('limits@test', $1, 'Compte limité') RETURNING id`,
    [hash],
  );
  userId = user.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  auth = moduleRef.get(AuthService);
});

afterAll(async () => {
  await owner?.end();
});

async function clear() {
  await owner.query('DELETE FROM login_attempts');
}

describe('⚠ changer son mot de passe est un oracle, et il se compte', () => {
  it('refuses after five wrong current passwords', async () => {
    await clear();

    for (let i = 0; i < 5; i++) {
      await expect(
        auth.changeOwnPassword(userId, 'mauvais', 'Un-Autre-Mdp3', 'Un-Autre-Mdp3', IP),
      ).rejects.toThrow(/ancien mot de passe est incorrect/i);
    }

    // The sixth is refused by the LIMIT, not by the password — and says so, so
    // the person who really did forget knows to wait rather than keep trying.
    await expect(
      auth.changeOwnPassword(userId, 'mauvais', 'Un-Autre-Mdp3', 'Un-Autre-Mdp3', IP),
    ).rejects.toThrow(/trop de tentatives|réessayez/i);
  });

  it('⚠ and the CORRECT password is refused too while the lock holds', async () => {
    // A lock an attacker can step around by guessing right once is not a lock.
    await expect(
      auth.changeOwnPassword(userId, 'Le-Bon-Mdp2', 'Un-Autre-Mdp3', 'Un-Autre-Mdp3', IP),
    ).rejects.toThrow(/trop de tentatives|réessayez/i);
  });

  it('succeeds once the counter is clear', async () => {
    await clear();
    await expect(
      auth.changeOwnPassword(userId, 'Le-Bon-Mdp2', 'Encore-Un-Mdp4', 'Encore-Un-Mdp4', IP),
    ).resolves.toBeUndefined();
  });
});

describe('la connexion refuse avec ses phrases — `tenter_connexion()`', () => {
  const CTX = { ip: IP, userAgent: 'test' };

  it('quatre échecs : « Identifiant ou mot de passe incorrect. » ; le cinquième pose le verrou et le dit', async () => {
    await clear();
    for (let i = 0; i < 4; i++) {
      await expect(auth.login('limits@test', 'mauvais', null, CTX)).rejects.toThrow(
        /Identifiant ou mot de passe incorrect\./,
      );
    }
    await expect(auth.login('limits@test', 'mauvais', null, CTX)).rejects.toThrow(
      /Trop de tentatives échouées\. Compte verrouillé pendant 15 minutes\./,
    );
  });

  it('puis « Compte verrouillé. Réessayez dans N minute(s). », même avec le bon mot de passe', async () => {
    await expect(auth.login('limits@test', 'Le-Bon-Mdp2', null, CTX)).rejects.toThrow(
      /Compte verrouillé\. Réessayez dans 15 minute\(s\)\./,
    );
  });

  it("l'adresse épuisée : « Trop de tentatives depuis votre réseau. Réessayez plus tard. »", async () => {
    await clear();
    // Son `IP_MAX_ATTEMPTS = 15` : quinze échecs de quinze comptes différents.
    for (let i = 0; i < 15; i++) {
      await auth.login(`inconnu${i}@test`, 'mauvais', null, CTX).catch(() => undefined);
    }
    await expect(auth.login('limits@test', 'Le-Bon-Mdp2', null, CTX)).rejects.toThrow(
      /Trop de tentatives depuis votre réseau\. Réessayez plus tard\./,
    );
    await clear();
  });
});

/*
 * ⚠ TROIS TESTS ONT DISPARU AVEC LEUR ENDPOINT — et ce qu'ils tenaient mérite
 * d'être dit, parce que la protection existe toujours ailleurs.
 *
 * Ils couvraient la limite sur « demander un lien de réinitialisation » :
 * cinq essais par adresse ET par machine, un refus en 429 plutôt que le
 * silence habituel, et un décompte identique pour une adresse inconnue — sinon
 * le limiteur lui-même devenait l'oracle d'énumération que l'endpoint évitait.
 *
 * Le libre-service n'existe plus (décision du propriétaire, 2026-09-04) : il n'y
 * a plus de courriel à envoyer, donc plus de bombardement possible par ce
 * chemin. Les deux limites qui restent — la connexion et le changement de son
 * propre mot de passe — sont testées ci-dessus.
 */
