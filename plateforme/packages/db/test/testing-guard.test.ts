import { afterEach, describe, expect, it } from 'vitest';

/**
 * The guard that stops the test suite destroying a real database.
 *
 * `startTestPostgres` drops and recreates the schema of whatever database it
 * adopts. It once adopted any reachable `DATABASE_ADMIN_URL`, which meant that
 * exporting that variable for a migration and then running the suite in the
 * same shell wiped the development database — 600 seeded students replaced by
 * test fixtures, with a failed login as the only symptom.
 *
 * This is the control experiment for the fix: a guard nobody has watched refuse
 * anything is not a guard.
 */

// The predicate is not exported — it is an implementation detail of the module —
// so it is restated here EXACTLY. If the two ever disagree, this test is wrong
// and should be corrected against the module, not the other way round.
function isDisposable(url: string): boolean {
  if (process.env.ELOURWA_TEST_DB_RESET === 'i-know-this-wipes-it') return true;
  try {
    const name = new URL(url).pathname.replace(/^\//, '');
    return /(^test|[_-]test)$/i.test(name);
  } catch {
    return false;
  }
}

const original = process.env.ELOURWA_TEST_DB_RESET;
afterEach(() => {
  if (original === undefined) delete process.env.ELOURWA_TEST_DB_RESET;
  else process.env.ELOURWA_TEST_DB_RESET = original;
});

describe('which databases the suite may reset', () => {
  it('⚠ REFUSES the development database', () => {
    // The exact URL from the repo's .env. This is the one that got wiped.
    expect(isDisposable('postgres://postgres:postgres@localhost:5432/elourwa')).toBe(false);
  });

  it('refuses anything that does not say it is disposable', () => {
    for (const url of [
      'postgres://u:p@db.example.com:5432/elourwa_production',
      'postgres://u:p@localhost:5432/school',
      'postgres://u:p@localhost:5432/testing',   // "testing" is not "test"
      'postgres://u:p@localhost:5432/contest',   // nor is "contest"
    ]) {
      expect(isDisposable(url), url).toBe(false);
    }
  });

  it('accepts a database whose name says it is for tests', () => {
    for (const url of [
      'postgres://u:p@localhost:5432/elourwa_test',
      'postgres://u:p@localhost:5432/elourwa-test',
      'postgres://u:p@localhost:5432/test',
      'postgres://u:p@localhost:5432/TEST',
    ]) {
      expect(isDisposable(url), url).toBe(true);
    }
  });

  it('accepts an explicit opt-in, for CI', () => {
    process.env.ELOURWA_TEST_DB_RESET = 'i-know-this-wipes-it';
    expect(isDisposable('postgres://postgres:postgres@localhost:5432/elourwa')).toBe(true);
  });

  it('is not satisfied by a casual truthy value', () => {
    // The opt-in has to be hard to set by accident: `=1` or `=true` will not do.
    for (const v of ['1', 'true', 'yes', 'on']) {
      process.env.ELOURWA_TEST_DB_RESET = v;
      expect(isDisposable('postgres://postgres:postgres@localhost:5432/elourwa'), v).toBe(false);
    }
  });

  it('refuses a connection string it cannot parse, rather than assuming', () => {
    expect(isDisposable('not a url')).toBe(false);
  });
});
