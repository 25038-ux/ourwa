# Testing and running

Everything you need to start the stack, seed it, run each suite, and reset.

---

## Ports — fixed, do not change

| Service | Port |
|---|---|
| Next.js web | 3000 |
| NestJS API | 3001 |
| Flutter web | 3002 |
| Postgres | 5432 |
| Redis | 6379 |
| Mailpit UI | 8025 (SMTP 1025) |

---

## Prerequisites

Node 20+ and pnpm. Enable pnpm with corepack:

```bash
corepack enable && corepack prepare pnpm@9.12.3 --activate
```

On Windows, if corepack cannot write to `C:\Program Files\nodejs`, install into a
user-writable prefix instead:

```bash
npm config set prefix "$HOME/.npm-global" && npm install -g pnpm@9.12.3
```

Then add `$HOME/.npm-global` to `PATH`.

---

## Starting the stack

### Option A — Docker (the documented path, used by CI)

```bash
pnpm infra:up
```

Starts Postgres 16, Redis 7 and Mailpit with health checks and named volumes.

> **Not yet verified.** Docker is not installed on the machine where this was
> built, so `infra/docker-compose.dev.yml` has never been executed. Confirm it
> works before CI depends on it. See ADR-0004.

### Option B — no Docker

```bash
pnpm db:dev
```

Starts a real embedded Postgres 17 on port 5432, applies migrations, and keeps
running. Data persists in `packages/db/.devdata/`. Same version family, same
UTF-8 encoding, same port — `DATABASE_URL` is identical either way.

Redis and Mailpit are not covered by this path; they are needed from Phase 4
(BullMQ) and Phase 1 (password reset) respectively.

### Then

```bash
pnpm db:migrate     # apply migrations
pnpm seed           # 3 schools, 600 students, full academic year and finance
pnpm dev            # API on 3001, web on 3000
```

---

## Where to look

| URL | What |
|---|---|
| `http://nour.localhost:3000` | École Nour |
| `http://rissala.localhost:3000` | École Rissala |
| `http://salam.localhost:3000` | École Salam |
| `http://admin.localhost:3000` | Platform console — lists every branch |
| `http://localhost:3001/health` | API health |
| `http://localhost:8025` | Mailpit inbox |

`*.localhost` resolves to 127.0.0.1 automatically in modern browsers. **No hosts-file
editing is needed.**

The three schools deliberately contain students with **identical names**. Search
"Ahmed Ould Mohamed" in each: every branch returns exactly one. If a branch ever
returns more, isolation is broken.

---

## Test credentials

Every account uses the password `dev12345`.

| Role | Identifier | Note |
|---|---|---|
| Platform admin | `admin@platform.test` | above all branches |
| Director | `admin@nour.test` | also `@rissala`, `@salam` |
| Accountant | `comptable@nour.test` | **seeded with a legacy `$2y$` bcrypt hash** — logging in upgrades it to Argon2id |
| Secretary | `secretaire@nour.test` | |
| Attendance collector | `absence@nour.test` | |
| Teacher | `prof0@nour.test` | deliberately has no `notes.saisir` (ADR-0005) |
| Parent | `parent2@nour.test` (site) · `40000002` (app: the phone on that account) | in the app the identifier is the phone number only; the seed's first two guardians of every school are the shared ones below |
| Parent, three schools | `30000000` (phone — the app takes no e-mail) | one account (`parent.multi0@test`), a child in each branch, one family session over all |

Branches: `nour.localhost:3000`, `rissala.localhost:3000`, `salam.localhost:3000`.
The platform console is `admin.localhost:3000`. `*.localhost` resolves to
127.0.0.1 in modern browsers with no hosts-file editing.

## Signing in

```bash
pnpm --filter @elourwa/api keygen >> .env    # stable ES256 keys, once
```

Without them the API generates an ephemeral pair per process, so **every restart
logs everyone out** — including every file save under `tsx watch`. It warns when
it does this.

`.env` is loaded by the API at boot. Changing it needs a **manual restart**:
`tsx watch` only watches source, and the keys are cached after first use.

Sign in at any branch, e.g. `http://nour.localhost:3000/login`. Tokens are stored
in `httpOnly` cookies by the Next BFF; the browser never sees them.

**Endpoints are closed by default.** The open ones are `/health`, `/auth/*`,
`/school` and `/platform/schools` — the last two on purpose, so a visitor can see
whose login page they are on before they have credentials.

To call the API directly:

```bash
curl -s -X POST http://localhost:3001/auth/login   -H 'Content-Type: application/json' -H 'X-School-Slug: nour'   -d '{"identifier":"admin@nour.test","password":"dev12345"}'
```

`X-School-Slug` is accepted **only outside production**; in production the school
comes from the `Host`. Either way, a token issued for one branch aimed at another
returns 403 and is audit-logged.

---

## Running the tests

```bash
pnpm test                    # everything
pnpm test:rls                # the isolation suite alone
pnpm --filter @elourwa/db test
```

The database suite starts its own Postgres if none is reachable, so it works from
a cold checkout with no setup.

### What the API suite covers — 50 tests

`apps/api/test/cross-school.spec.ts` — a token from one branch aimed at another
is refused in both directions, and the refusal is audited. This is a regression
test for a real bug (ADR-0007).

`apps/api/test/sessions.spec.ts` — rotation, and **reuse detection**: replaying a
rotated token revokes the whole family, while other devices keep working.

`apps/api/test/auth.spec.ts` — each role gets exactly its own permissions; two
roles union; a bcrypt user is silently upgraded; a revoked role takes effect on
the next refresh; wrong password and missing account give the identical error.

`apps/api/src/auth/tokens.spec.ts` — ES256 round trip, plus the two algorithm
confusion attacks (`alg: none`, HS256 signed with the public key).

`apps/api/src/auth/passwords.spec.ts` — Argon2id, bcrypt `$2a$`/`$2y$`, and
unrecognised formats failing closed.

### What the isolation suite covers — 30 tests

`packages/db/test/rls.test.ts`

- a read with **no `WHERE` clause** returns only the current tenant's rows
- exactly one "Ahmed Ould Mohamed" per school, never three
- **no tenant context set → zero rows**, not all rows (fails closed)
- writing a row into another school is refused
- updating or deleting another school's row by id affects 0 rows
- **100 interleaved operations across a 4-connection pool never cross tenants** —
  this is the one that catches the `SET`-instead-of-`set_config` bug
- no residual tenant setting survives a transaction
- every tenant table has RLS **enabled and forced** with a policy
- the unprotected-table set is exactly the four documented platform tables
- `app_user` has neither `BYPASSRLS` nor superuser
- `app_reporter` is the only holder of `BYPASSRLS`
- NUMERIC arrives as a **string**, and every money column is `NUMERIC(_,2)`
- the database is UTF-8 and round-trips Arabic

`packages/db/test/rls-gate.test.ts` — the control experiment. Builds a throwaway
table, shows rows leak with the policy off, and stop leaking with it on. Without
this, a suite that always passes proves nothing.

`packages/db/test/academic-year.test.ts` — the rule of the 25th, the month/year
boundary, payable-month generation.

### Verifying the gate actually bites

```bash
# In packages/db/src/client.ts change set_config(..., true) to false, then:
pnpm test:rls
```

The pooling test must **fail**. If it still passes, the test is not exercising
connection reuse and needs fixing before it can be trusted.

---

## E2E (Playwright)

```bash
pnpm --filter @elourwa/web test:e2e:install   # one-time browser download
pnpm --filter @elourwa/web test:e2e
```

Headed by default so you can watch. `PWTEST_HEADLESS=1` or `CI=true` for headless.
Needs the three dev servers up (`db`, `api`, `web` — see `.claude/launch.json`);
the suite signs in once per role (`auth.setup.ts`) and rewrites each context's
session state after every test (`session.ts`) — the refresh token rotates, and
two contexts presenting the same one are a reuse the API punishes.

`e2e/dump-structure.spec.ts` is a comparison tool, not a test: it is skipped
unless `STRUCTURE=1 pnpm exec playwright test --grep @structure` (34 pages,
several minutes on a cold dev server).

Last full run: see the top of `docs/STATE.md`.

---

## Load testing (k6, from Phase 4)

```bash
k6 run infra/k6/smoke.js
```

Measures tenant correctness under concurrency, not throughput: 30 VUs hitting
random branches, asserting every response belongs to the branch that asked. Any
wrong-tenant answer fails the run.

---

## Mobile

```bash
cd apps/mobile
flutter pub get
flutter run -d web-server --web-port 3002    # browser, hot reload, no emulator
flutter test
```

> **Not yet executed** — the Flutter SDK is not installed on the build machine.

### Android emulator — needed from Phase 5

**Push notifications do not work on Flutter web.** Testing FCM requires a real
Android emulator or device:

```bash
sdkmanager "system-images;android-34;google_apis;x86_64"
avdmanager create avd -n elourwa -k "system-images;android-34;google_apis;x86_64"
emulator -avd elourwa
flutter run -d emulator-5554
```

Use a **google_apis** image — Google Play Services is required for FCM, and plain
AOSP images do not have it.

iOS push additionally needs an Apple Developer account ($99/yr) and an APNs key.
Set that up in Phase 5.1, not 5.6 — approval takes longer than the code.

---

## Resetting

```bash
pnpm db:reset       # drop schema and roles, re-apply migrations
pnpm seed           # repopulate
```

`pnpm seed` truncates before inserting, so it is safe to re-run on its own.

The seed is **deterministic** — a fixed PRNG seed means the same data every time.
A flaky fixture would make every downstream test flaky and "it passed yesterday"
unanswerable.

With Docker: `pnpm infra:nuke` removes the volumes entirely.
Without Docker: delete `packages/db/.devdata/`.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Queries return nothing | Tenant context not set. **Never** fix by disabling RLS. |
| Data from the wrong school | Bare `SET` instead of `set_config(..., true)`. Emergency — stop and fix. |
| `EADDRINUSE :3001` | An earlier API instance is still running. Kill the process holding the port. |
| Money off by pennies | `pg` type parser not configured; `NUMERIC` became a float. |
| Averages slightly wrong | `note_absent = -1` counted as a grade instead of excluded. |
| Duplicate receipt numbers | `MAX()+1` instead of the atomic sequence. |
| Arabic renders as `?` or fails to insert | Database created with a non-UTF-8 encoding. On Windows, initdb defaults to WIN1252, which cannot represent Arabic at all. |
| Slow lists | `OFFSET` pagination, or an index not leading with `school_id`. |
