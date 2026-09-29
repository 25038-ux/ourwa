import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  schoolId: string;
  slug: string;
}

/**
 * The current request's school.
 *
 * Held in AsyncLocalStorage rather than passed through every call, because the
 * alternative — threading it by hand — fails silently the one time somebody
 * forgets, and "forgot the tenant" is indistinguishable from "no results".
 * Reading it when unset throws, so a missing tenant is loud.
 */
const storage = new AsyncLocalStorage<TenantContext>();

export function runInTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentTenant(): TenantContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error(
      'No tenant in context. Every data path must run inside runInTenant().',
    );
  }
  return ctx;
}

export function maybeTenant(): TenantContext | undefined {
  return storage.getStore();
}
