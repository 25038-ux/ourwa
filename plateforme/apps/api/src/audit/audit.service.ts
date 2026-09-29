import { Inject, Injectable } from '@nestjs/common';
import type { Queryable } from '@elourwa/db';
import { DbService } from '../db/db.service.js';

export interface AuditEntry {
  actorId?: string | null;
  schoolId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  impersonated?: boolean;
}

/**
 * The audit log. Written on every mutation (PROJECT.md 1.8).
 *
 * Deliberately never throws: a failure to log must not fail the operation the
 * user asked for. A login that 500s because the audit table is briefly
 * unavailable is worse than a missing log line. Failures go to stderr so they
 * stay visible.
 *
 * ⚠ PASS `tx` WHEN YOU ARE ALREADY IN A TRANSACTION.
 *
 * Two reasons, and the first one bites hard:
 *
 *  1. Acquiring a second connection while holding one deadlocks the pool under
 *     concurrency. With a pool of N, N simultaneous transactions each waiting
 *     for a second connection wait forever. This was found by the 20-way
 *     concurrent receipt test, which hung rather than failed.
 *  2. Writing on the caller's transaction makes the audit line commit or roll
 *     back WITH the thing it describes. Otherwise a rolled-back payment leaves
 *     a log entry claiming it happened.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async record(entry: AuditEntry, tx?: Queryable): Promise<void> {
    const run = (q: Queryable) =>
      q.query(
          `INSERT INTO audit_log
             (actor_id, school_id, action, entity, entity_id, before, after, ip, impersonated)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            entry.actorId ?? null,
            entry.schoolId ?? null,
            entry.action,
            entry.entity ?? null,
            entry.entityId ?? null,
            entry.before === undefined ? null : JSON.stringify(entry.before),
            entry.after === undefined ? null : JSON.stringify(entry.after),
            entry.ip ?? null,
            entry.impersonated ?? false,
        ],
      );

    if (tx) {
      // On the caller's transaction, a failure here has ALREADY aborted it:
      // Postgres rejects every subsequent statement and turns the COMMIT into a
      // rollback. Swallowing would hand back a "success" for work that silently
      // vanished — which is exactly what happened before this comment existed.
      // Let it propagate so the caller fails loudly.
      await run(tx);
      return;
    }

    // On its own connection, a logging failure must not fail the user's
    // operation. A login that 500s because the audit table is briefly
    // unavailable is worse than a missing log line.
    try {
      await this.db.registry(run);
    } catch (error) {
      console.error('[audit] failed to record', entry.action, error);
    }
  }
}
