import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, importPKCS8, importSPKI } from 'jose';

/**
 * Access tokens (ES256 JWT) and refresh tokens (opaque, hashed at rest).
 *
 * ES256 rather than RSA (standing rule 12): smaller tokens at equivalent
 * strength and faster verification — which matters because mobile clients verify
 * on every request.
 */

export interface AccessClaims {
  /** User id. */
  sub: string;
  /** The school this session is scoped to. Null for a platform-admin session. */
  schoolId: string | null;
  roles: string[];
  permissions: string[];
  /** True when a platform admin is inside a branch (ARCHITECTURE.md §5). */
  impersonated: boolean;
  /**
   * `parent` : une session de FAMILLE — sans école (`schoolId` nul), valable
   * dans toutes les écoles où le compte est parent. Le garde relit ces écoles
   * à chaque requête ; les routes `/parent/*` les parcourent une à une, sous
   * le contexte de chacune. Absente pour le personnel et la plateforme.
   */
  espace?: 'parent';
  /**
   * Son « sceau » : les 32 premiers hexadécimaux du SHA-256 du hachage du mot
   * de passe. Le garde le recompare à chaque requête — un mot de passe changé
   * tue le jeton à la requête suivante, pas dans quinze minutes.
   */
  seal?: string;
  /** Who this really is, when impersonating. */
  actorId?: string;
}

const ALG = 'ES256';

export async function signAccessToken(
  claims: AccessClaims,
  privateKeyPem: string,
  ttlSeconds = 900,
): Promise<string> {
  const key = await importPKCS8(privateKeyPem, ALG);
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(key);
}

export async function verifyAccessToken(
  token: string,
  publicKeyPem: string,
): Promise<AccessClaims & { exp: number; iat: number }> {
  const key = await importSPKI(publicKeyPem, ALG);
  // `algorithms` is PINNED. Without it, a verifier honours the header's `alg`,
  // which lets an attacker present `alg: none` (unsigned) or an HMAC token
  // signed with the public key as its secret. Both are accepted by a naive
  // verifier and both are tested against.
  const { payload } = await jwtVerify(token, key, { algorithms: [ALG] });
  return payload as unknown as AccessClaims & { exp: number; iat: number };
}

/**
 * An opaque refresh token: 256 bits of randomness, never a JWT.
 *
 * It carries no claims, so it cannot be read or forged offline — its only
 * meaning is the row it matches in `refresh_tokens`.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * What gets stored. The token itself is never persisted: a database leak must
 * not hand over live sessions.
 *
 * SHA-256 without a work factor is correct here and would be wrong for a
 * password. A password is low-entropy and must be slow to guess; this is 256
 * bits of uniform randomness, so brute force is already impossible and a slow
 * KDF would only add latency to every refresh.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
