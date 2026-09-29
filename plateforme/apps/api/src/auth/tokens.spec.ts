import { beforeAll, describe, expect, it } from 'vitest';
import { SignJWT, generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
  type AccessClaims,
} from './tokens.js';

let keys: { privateKey: string; publicKey: string };
let otherKeys: { privateKey: string; publicKey: string };

const CLAIMS: AccessClaims = {
  sub: '00000000-0000-0000-0000-000000000001',
  schoolId: '00000000-0000-0000-0000-0000000000aa',
  roles: ['comptable'],
  permissions: ['finance.encaisser'],
  impersonated: false,
};

async function makeKeys() {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  return { privateKey: await exportPKCS8(privateKey), publicKey: await exportSPKI(publicKey) };
}

beforeAll(async () => {
  keys = await makeKeys();
  otherKeys = await makeKeys();
});

describe('access tokens (ES256)', () => {
  it('round-trips its claims', async () => {
    const token = await signAccessToken(CLAIMS, keys.privateKey, 900);
    const verified = await verifyAccessToken(token, keys.publicKey);
    expect(verified.sub).toBe(CLAIMS.sub);
    expect(verified.schoolId).toBe(CLAIMS.schoolId);
    expect(verified.permissions).toEqual(['finance.encaisser']);
  });

  it('is actually ES256, not RS256 or HS256', async () => {
    const token = await signAccessToken(CLAIMS, keys.privateKey, 900);
    const header = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString());
    expect(header.alg).toBe('ES256');
  });

  it('rejects a token signed with a different key', async () => {
    const token = await signAccessToken(CLAIMS, otherKeys.privateKey, 900);
    await expect(verifyAccessToken(token, keys.publicKey)).rejects.toThrow();
  });

  it('rejects a tampered payload', async () => {
    const token = await signAccessToken(CLAIMS, keys.privateKey, 900);
    const [h, p, s] = token.split('.');
    const payload = JSON.parse(Buffer.from(p!, 'base64url').toString());
    payload.permissions = ['finance.encaisser', 'finance.salaires'];
    const forged = Buffer.from(JSON.stringify(payload)).toString('base64url');
    await expect(verifyAccessToken(`${h}.${forged}.${s}`, keys.publicKey)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = await signAccessToken(CLAIMS, keys.privateKey, -1);
    await expect(verifyAccessToken(token, keys.publicKey)).rejects.toThrow();
  });

  it('rejects the alg=none confusion attack', async () => {
    // A verifier that trusts the header's `alg` accepts an unsigned token.
    // `verifyAccessToken` must pin ES256 rather than read it from the header.
    const unsigned =
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') +
      '.' +
      Buffer.from(JSON.stringify(CLAIMS)).toString('base64url') +
      '.';
    await expect(verifyAccessToken(unsigned, keys.publicKey)).rejects.toThrow();
  });

  it('rejects an HMAC token signed with the public key as its secret', async () => {
    // The classic RS/ES -> HS confusion: attacker signs with the *public* key,
    // and a verifier that honours the header's alg treats it as valid.
    const forged = await new SignJWT({ ...CLAIMS })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode(keys.publicKey));
    await expect(verifyAccessToken(forged, keys.publicKey)).rejects.toThrow();
  });
});

describe('refresh tokens', () => {
  it('is 256 bits of randomness', () => {
    const token = generateRefreshToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateRefreshToken()));
    expect(seen.size).toBe(1000);
  });

  it('hashes deterministically, and the hash is not the token', () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    expect(hashRefreshToken(token)).not.toBe(token);
    // SHA-256 hex.
    expect(hashRefreshToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});
