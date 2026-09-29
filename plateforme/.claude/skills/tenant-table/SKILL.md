---
name: tenant-table
description: Create or review a tenant-scoped Postgres table. Use whenever adding a table that holds school data, changing an existing one, or reviewing a migration — every such table must carry school_id with RLS enabled and forced, a policy, a composite index leading with school_id, and school-scoped unique constraints.
---

# Adding a tenant table

Every table holding school data follows this shape without exception. Standing rule 4.

## The four requirements

1. `school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE`
2. `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY`
3. A `tenant_isolation` policy with both `USING` and `WITH CHECK`
4. A composite index leading with `school_id`, and every `UNIQUE` scoped `(school_id, …)`

`FORCE` is not optional. Without it the table owner bypasses the policy — and in
development you are usually connected as the owner, so isolation appears to work
in testing and fails in production.

## Template

```sql
CREATE TABLE remarks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  body       text NOT NULL,
  severity   text NOT NULL DEFAULT 'info'
             CHECK (severity IN ('info','positive','warning','serious')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, student_id, created_at)   -- scoped, never global
);

CREATE INDEX remarks_school_student_idx ON remarks (school_id, student_id, created_at DESC);

ALTER TABLE remarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE remarks FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON remarks
  USING      (school_id = current_school_id())
  WITH CHECK (school_id = current_school_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON remarks TO app_user;
GRANT SELECT ON remarks TO app_reporter;
```

## Scoped uniqueness — think before making it global

A national ID is unique *within a school*, not across the platform: a family that
moves from one branch to another legitimately appears in both. The same goes for
receipt numbers, student codes and usernames. A global unique constraint here is a
bug that only shows up once a second branch opens.

## Before you finish

- [ ] `school_id` present, `NOT NULL`, with a foreign key
- [ ] RLS enabled **and forced**
- [ ] Policy has `WITH CHECK`, not just `USING` — without it, a caller can insert rows into another tenant
- [ ] Leading index column is `school_id`
- [ ] Every `UNIQUE` starts with `school_id`
- [ ] Grants added for `app_user` and `app_reporter`
- [ ] `packages/db/test/rls.test.ts` still passes — it enumerates every table carrying `school_id` and asserts all of the above, so a missed step fails the build

## Never

- Never disable RLS to make a query work. An empty result means the tenant context
  is wrong; fix the context, not the policy.
- Never use a bare `SET` for tenant context — always `set_config(..., true)` inside
  a transaction, via `withTenant()`. A bare `SET` persists on the pooled connection
  and leaks the next request into the previous school's data.
- Never grant `BYPASSRLS` to `app_user`. It belongs to `app_reporter` alone,
  which is never reachable from an HTTP request path.
