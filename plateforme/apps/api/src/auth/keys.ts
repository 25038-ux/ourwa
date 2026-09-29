import { generateKeyPairSync } from 'node:crypto';

/**
 * ES256 signing keys.
 *
 * Read from the environment (standing rule 12 — secrets never committed). In
 * development, a pair is generated on first use so the app runs out of the box;
 * it is regenerated on every restart, which invalidates tokens across restarts.
 * That is the correct trade for development and would be catastrophic in
 * production, so it refuses to do it when NODE_ENV is production.
 *
 * Generate a stable pair with: pnpm --filter @elourwa/api keygen
 */

let cached: { privateKey: string; publicKey: string } | undefined;

export function getJwtKeys(): { privateKey: string; publicKey: string } {
  if (cached) return cached;

  // ⚠ Une clé arrive sur UNE ligne (keygen l'émet ainsi, JSON-citée) : selon
  // qui lit le `.env` (Node, dotenv, docker compose, systemd, un shell), les
  // `\n` sont déjà de vrais retours à la ligne — ou encore les deux caractères
  // « \ » « n ». On rétablit les seconds ; le remplacement précédent (un
  // retour à la ligne par lui-même) ne changeait rien, et une clé passée par
  // l'environnement d'un conteneur échouait à l'import avec un message sans
  // rapport.
  const pem = (v: string | undefined) =>
    (v ?? '').trim().replace(/^"|"$/g, '').replace(/\\n/g, '\n');
  const fromEnv = {
    privateKey: pem(process.env.JWT_PRIVATE_KEY),
    publicKey: pem(process.env.JWT_PUBLIC_KEY),
  };
  if (fromEnv.privateKey && fromEnv.publicKey) {
    cached = fromEnv;
    return cached;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be set in production. ' +
        'Generate them with: pnpm --filter @elourwa/api keygen',
    );
  }

  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  console.warn(
    '[auth] JWT keys not set — generated an ephemeral pair. ' +
      'Tokens will not survive a restart. Run `pnpm --filter @elourwa/api keygen`.',
  );
  cached = { privateKey, publicKey };
  return cached;
}

/** Test seam. */
export function setJwtKeys(keys: { privateKey: string; publicKey: string }): void {
  cached = keys;
}
