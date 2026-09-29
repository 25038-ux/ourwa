import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Postgres must start before any test runs, and the tenant tests must not
    // race each other over the same connection pool.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    globalSetup: ['./test/global-setup.ts'],
  },
});
