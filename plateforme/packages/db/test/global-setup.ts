import { startTestPostgres, stopTestPostgres } from '../src/testing.js';

export async function setup(): Promise<void> {
  await startTestPostgres();
}

export async function teardown(): Promise<void> {
  await stopTestPostgres();
}
