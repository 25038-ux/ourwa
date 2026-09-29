import { startTestPostgres, stopTestPostgres } from '@elourwa/db/testing';

/**
 * The API suite needs a real database for the token tests: reuse detection
 * depends on a unique constraint and a transaction, neither of which a mock has.
 * Uses a different port from the db package so the two suites can run at once.
 *
 * ⚠ The services under test connect as `app_user`, exactly as the API does in
 * production. `startTestPostgres` leaves `DATABASE_URL` pointing at the owner,
 * which is the right default for a migration harness and the wrong one here:
 * the owner of these tables is a superuser, superusers bypass RLS whatever the
 * policy says, and a suite running as one cannot tell an isolated query from a
 * leaking one. Overriding it is what makes a cross-school assertion mean
 * something.
 */
/**
 * ⚠ THE PORT IS OVERRIDABLE, and it needs to be. When a run is killed mid-flight
 * — a Ctrl-C, an agent turn ending, a crash — Windows can leave the socket bound
 * to a PID that no longer exists, and every subsequent run then dies with
 * "could not create any TCP/IP sockets" and reports **no tests** rather than a
 * failure. That reads as a broken suite and is a stuck port.
 *
 * `TEST_PG_PORT=54331 pnpm test` gets past it without waiting for the socket to
 * age out. The default stays 54330 so the API and db suites still run together.
 */
export async function setup(): Promise<void> {
  const port = Number(process.env.TEST_PG_PORT ?? 54330);
  const { appUrl } = await startTestPostgres({ port });
  process.env.DATABASE_URL = appUrl;
}

export async function teardown(): Promise<void> {
  await stopTestPostgres();
}
