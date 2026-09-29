import { describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { hash as argonHash } from '@node-rs/argon2';
import { hashPassword, verifyAndUpgrade } from './passwords.js';

/**
 * El Ourwa's `utilisateurs` holds BOTH `$argon2id$` and `$2y$` bcrypt hashes.
 *
 * Forcing a reset would lock out 1,372 parents at once (PROJECT.md §2.8), so
 * verification must accept either and quietly re-hash to Argon2id on success.
 */
describe('password verification', () => {
  it('verifies an Argon2id hash and leaves it alone', async () => {
    const stored = await argonHash('dev12345');
    const result = await verifyAndUpgrade(stored, 'dev12345');
    expect(result.ok).toBe(true);
    expect(result.upgradedHash).toBeUndefined();
  });

  it('verifies a legacy bcrypt hash AND returns an Argon2id replacement', async () => {
    // `$2y$` is what PHP's password_hash() writes; bcryptjs emits `$2a$`.
    // Both must be accepted — the prefix differs, the algorithm does not.
    const legacy = bcrypt.hashSync('dev12345', 10);
    const result = await verifyAndUpgrade(legacy, 'dev12345');

    expect(result.ok).toBe(true);
    expect(result.upgradedHash).toBeDefined();
    expect(result.upgradedHash!.startsWith('$argon2id$')).toBe(true);

    // The replacement must actually work, or the user is locked out next login.
    const after = await verifyAndUpgrade(result.upgradedHash!, 'dev12345');
    expect(after.ok).toBe(true);
    expect(after.upgradedHash).toBeUndefined();
  });

  it('accepts the PHP `$2y$` prefix specifically', async () => {
    const legacy = bcrypt.hashSync('dev12345', 10).replace('$2a$', '$2y$');
    const result = await verifyAndUpgrade(legacy, 'dev12345');
    expect(result.ok).toBe(true);
    expect(result.upgradedHash!.startsWith('$argon2id$')).toBe(true);
  });

  it('rejects a wrong password against either algorithm', async () => {
    const argon = await argonHash('dev12345');
    const legacy = bcrypt.hashSync('dev12345', 10);
    expect((await verifyAndUpgrade(argon, 'wrong')).ok).toBe(false);
    expect((await verifyAndUpgrade(legacy, 'wrong')).ok).toBe(false);
  });

  it('never upgrades on a failed verification', async () => {
    const legacy = bcrypt.hashSync('dev12345', 10);
    const result = await verifyAndUpgrade(legacy, 'wrong');
    expect(result.ok).toBe(false);
    expect(result.upgradedHash).toBeUndefined();
  });

  it('rejects an unrecognised hash format rather than guessing', async () => {
    // A SHA-1 or plaintext value must fail closed, not be treated as a match.
    expect((await verifyAndUpgrade('5f4dcc3b5aa765d61d8327deb882cf99', 'password')).ok).toBe(false);
    expect((await verifyAndUpgrade('', 'anything')).ok).toBe(false);
    expect((await verifyAndUpgrade('dev12345', 'dev12345')).ok).toBe(false);
  });

  it('produces Argon2id, not Argon2i or Argon2d', async () => {
    expect((await hashPassword('x')).startsWith('$argon2id$')).toBe(true);
  });

  it('salts: the same password hashes differently every time', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
});
