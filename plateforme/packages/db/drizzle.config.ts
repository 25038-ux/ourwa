import type { Config } from 'drizzle-kit';

/**
 * Drizzle introspects and types the schema; the migrations in `migrations/` are
 * hand-written SQL. That split is deliberate: RLS policies, FORCE, composite
 * foreign keys and the UUIDv7 function have no Drizzle representation, and a
 * generated migration would silently drop them.
 */
export default {
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/elourwa',
  },
} satisfies Config;
