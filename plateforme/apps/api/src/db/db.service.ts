import { Injectable } from '@nestjs/common';
import pg from 'pg';
import { withTenant, type Queryable } from '@elourwa/db';
import { currentTenant } from '../tenant/tenant.context.js';

export const DB = Symbol('DB');

@Injectable()
export class DbService {
  private readonly pool: pg.Pool;

  constructor() {
    const connectionString =
      process.env.DATABASE_URL ?? 'postgres://app_user:devpassword@localhost:5432/elourwa';
    // The API connects as app_user — subject to RLS, no BYPASSRLS.
    // Standing rule 3: the admin and reporting URLs never appear here.
    this.pool = new pg.Pool({ connectionString, max: 20 });
  }

  /** Every tenant-scoped read or write goes through here. */
  async query<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const { schoolId } = currentTenant();
    return withTenant(schoolId, fn, this.pool);
  }

  /**
   * Untenanted access, for the school registry only. `schools` is the tenant
   * registry itself and carries no school_id, so it is not RLS-protected — which
   * is exactly why this method is deliberately narrow and separately named.
   */
  async registry<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  /**
   * A tenant-scoped query for an EXPLICIT school, rather than the request's own.
   *
   * For the platform layer only, which visits each branch in turn to build a
   * combined figure. It still goes through RLS — this names the tenant, it does
   * not escape it. `app_reporter` and its BYPASSRLS stay out of request paths.
   */
  async queryFor<T>(schoolId: string, fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return withTenant(schoolId, fn, this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
