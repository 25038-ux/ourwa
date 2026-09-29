import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    globalSetup: ['./test/global-setup.ts'],
  },
});
