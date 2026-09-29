import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import bcrypt from 'bcryptjs';

/**
 * Password hashing and verification.
 *
 * Argon2id for everything new (standing rule 12). Legacy bcrypt hashes from
 * El Ourwa are accepted and transparently upgraded, because forcing a reset
 * would lock out 1,372 parents simultaneously (PROJECT.md §2.8).
 */

export interface VerifyResult {
  ok: boolean;
  /**
   * Present only when the stored hash was legacy AND the password was correct.
   * The caller must persist it — otherwise the upgrade never happens and the
   * account stays on bcrypt forever.
   */
  upgradedHash?: string;
}

export async function hashPassword(plain: string): Promise<string> {
  return argonHash(plain);
}

export async function verifyAndUpgrade(
  storedHash: string,
  plain: string,
): Promise<VerifyResult> {
  if (!storedHash) return { ok: false };

  // Argon2id — the current format. Nothing to upgrade.
  if (storedHash.startsWith('$argon2')) {
    try {
      return { ok: await argonVerify(storedHash, plain) };
    } catch {
      // A malformed hash must fail closed, not throw into the login handler.
      return { ok: false };
    }
  }

  // bcrypt. PHP's password_hash() writes `$2y$`; bcryptjs writes `$2a$`/`$2b$`.
  // The prefix differs, the algorithm does not, so all are accepted.
  if (/^\$2[abxy]\$/.test(storedHash)) {
    let ok = false;
    try {
      ok = await bcrypt.compare(plain, storedHash);
    } catch {
      return { ok: false };
    }
    if (!ok) return { ok: false };
    return { ok: true, upgradedHash: await hashPassword(plain) };
  }

  // Anything else — plaintext, SHA-anything, a truncated column — fails closed.
  // Never treat an unrecognised value as a match.
  return { ok: false };
}

/**
 * Levels the time taken by a failed login.
 *
 * bcrypt and Argon2 verification take measurably different times, which leaks
 * which hash type an account uses — and a login for a non-existent account
 * returns faster than one that actually hashed anything, which leaks whether the
 * account exists at all. Both are minor; both are cheap to remove.
 */
export async function constantTimeFloor<T>(work: Promise<T>, floorMs = 120): Promise<T> {
  const started = Date.now();
  const result = await work;
  const remaining = floorMs - (Date.now() - started);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  return result;
}
