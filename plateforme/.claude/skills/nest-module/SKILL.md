---
name: nest-module
description: Add a NestJS module to the API. Use when creating a new resource, endpoint or service in apps/api — covers controller, service, zod DTOs, tenant scoping, cursor pagination and tests.
---

# Adding a NestJS module

## Layout

```
apps/api/src/<resource>/
  <resource>.controller.ts
  <resource>.service.ts
  <resource>.dto.ts          # zod schemas — the single source of shape truth
  <resource>.spec.ts
```

Register controllers and providers in `app.module.ts`.

## Explicit injection tokens

Development runs under esbuild (`tsx`), which does **not** emit decorator
metadata. Always name the dependency:

```ts
constructor(@Inject(DbService) private readonly db: DbService) {}
```

Bare `constructor(private readonly db: DbService)` works under `tsc` and fails at
runtime under `tsx` — a difference between dev and build that is miserable to
diagnose. Be explicit and it behaves identically in both.

## Tenant scoping is automatic — do not re-implement it

`TenantInterceptor` is registered globally and establishes the tenant before any
handler runs. Inside a handler, reach data only through `DbService.query()`:

```ts
const rows = await this.db.query(async (tx) => {
  // No `WHERE school_id` — isolation is the database's job, and writing it by
  // hand invites the day somebody forgets.
  const { rows } = await tx.query('SELECT * FROM remarks WHERE student_id = $1', [id]);
  return rows;
});
```

Use `DbService.registry()` only for the `schools` table itself.

## Validate with zod at the boundary

```ts
const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

@Get()
async list(@Query() raw: unknown) {
  const { q, cursor, limit } = listQuery.parse(raw ?? {});
  …
}
```

## Cursor pagination only

`OFFSET` is banned (standing rule 15). Fetch `limit + 1`, slice, and return the
last id as `nextCursor`:

```ts
params.push(limit + 1);
sql += ` ORDER BY s.id LIMIT $${params.length}`;
const hasMore = rows.length > limit;
const page = hasMore ? rows.slice(0, limit) : rows;
return { items: page, nextCursor: hasMore ? page.at(-1)!.id : null };
```

## Permissions

Guard every sensitive handler explicitly. Hiding a menu entry is not
authorisation — without a server-side check, typing the URL is enough.
Permissions are re-read per request and never cached in a session, so a revoked
role takes effect on the next call.

## Heavy work goes to BullMQ

Anything slow or fan-out — bulk report cards, bulk notifications, imports — is a
queued job, never inline in a request (standing rule 16).

## Checklist

- [ ] `@Inject(Token)` on every constructor dependency
- [ ] Data access through `DbService.query()`, no manual `school_id` filtering
- [ ] zod schema for every input
- [ ] Cursor pagination, no `OFFSET`
- [ ] Permission guard on sensitive handlers
- [ ] Registered in `app.module.ts`
- [ ] Tests written first for anything touching money, grades or isolation
