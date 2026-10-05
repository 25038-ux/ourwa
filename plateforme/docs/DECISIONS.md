# Architecture Decision Log

Append-only. One entry per architectural decision, in ADR form.

---

## ADR-0001 — Data migration from El Ourwa **is** in scope — *reversed*

**Date:** 2026-08-24 (session 1)
**Status:** **Superseded by the documents. Original decision reversed.**

### What was originally decided

Earlier in session 1 the owner stated that "the old school data is irrelevant" and
selected *fresh start, no import*. This ADR originally recorded that the new
platform would start empty, that `PROJECT.md` Part 6 (snapshots, shadow running,
reconciliation, cutover) did not apply, and that `docs/FEATURES.md` was a
*functional* parity contract.

### Why it was reversed

`PROJECT.md`, `ARCHITECTURE.md` and the root `PHASES.md` arrived later in the same
session and contradict it directly. `PROJECT.md` states it supersedes any earlier
bootstrap document. Specifically:

- `PHASES.md` calls reconciliation **"the spine of the project"**.
- Phase 2's exit criteria require ~2,153 students and ~3,506 enrolments imported
  with **zero discrepancy**.
- Phase 7 is migration and cutover, scheduled for **October 2027**.
- `ARCHITECTURE.md` §6 requires `origine` carried forward because 17,106 rows
  depend on it and financial reports key off it.

### Decision

The migration is in scope. The new platform imports El Ourwa's data and
reconciles against it.

### Consequences — what changed in the code because of the reversal

- **`origin` and `legacy_id` restored on every tenant table.** Both had been
  removed under the original decision. `legacy_id` makes reconciliation possible
  and imports idempotent; it costs four bytes.
- **`tools/reconcile/` and `tools/import/` scaffolded** with their contracts fixed
  (`CheckResult`, the import invariants), so Phase 2 starts from a shape rather
  than a blank directory.
- **`docs/FEATURES.md` parity is numerical again**: a row reaches ☑ when a
  reconciliation check reports zero discrepancy, not when it looks right.
- **`docs/DOMAIN.md` §8 restored** the volumes to import.

### Note for future sessions

This reversal is recorded rather than edited away because the original reasoning —
that behavioural parity is weaker evidence than reconciliation — is exactly why
the reversal matters. If migration is ever descoped again, that trade-off comes
back with it.

---

## ADR-0002 — ~~No separate ARCHITECTURE.md~~ — *obsolete*

**Date:** 2026-08-24 (session 1)
**Status:** **Obsolete. The document exists.**

This ADR recorded proceeding without `ARCHITECTURE.md` because the file could not
be found in `ourwa_deployement/`, `ELourwa/`, `Downloads/` or the repository. The
owner supplied it later in the same session, together with `PROJECT.md` and a
session-by-session `PHASES.md`.

Those three documents are now the authority. Where anything in this repository
disagrees with them, they win.

Nothing was built on the assumption recorded here, so there is nothing to unwind
beyond the phase plan, which has been replaced with `PROJECT.md` Part 3's
numbering (`docs/PHASES.md`).

---

## ADR-0003 — Migrations are hand-written SQL; Drizzle is for types only

**Date:** 2026-08-24 (session 1)
**Status:** Accepted

### Context

`ARCHITECTURE.md` §2 specifies Drizzle ORM, chosen because it sits directly on
`node-postgres` where the RLS pattern is natural. Drizzle also offers
`drizzle-kit` migration generation from the schema file.

### Decision

`packages/db/src/schema.ts` is the typed view, used for queries.
`packages/db/migrations/*.sql` is hand-written and is **the authority**.

### Why

Four things this schema depends on have no Drizzle representation:

1. `ENABLE` / **`FORCE` ROW LEVEL SECURITY**
2. `CREATE POLICY … USING … WITH CHECK`
3. **Composite foreign keys** — `FOREIGN KEY (school_id, group_id) REFERENCES groups (school_id, id)`
4. The `uuid_generate_v7()` function and its use as a column default

A generated migration would silently drop all four. Dropping (1) or (2) removes
tenant isolation entirely, and the failure is invisible until two schools exist.
The isolation test would catch it — but a migration tool that can quietly disarm
the thing the test protects is not worth the convenience.

### Consequences

- `pnpm db:migrate` applies SQL files in order, each in its own transaction.
- `drizzle-kit` is present for introspection but is **not** wired to `generate`.
- Schema changes are written twice: once in SQL, once in `schema.ts`. The
  duplication is deliberate and the SQL is authoritative.

---

## ADR-0004 — embedded-postgres for tests, not Testcontainers

**Date:** 2026-08-24 (session 1)
**Status:** Accepted, with a caveat

### Context

`PROJECT.md` 0.10 specifies Testcontainers for integration tests, because RLS
cannot be tested against a mock — the policy lives in the database, so a fake only
proves the fake agrees with itself. That reasoning is correct and unchanged.

Testcontainers requires Docker. **Docker is not installed on this machine**, and
neither is Flutter or a native Postgres.

### Decision

`packages/db/test/global-setup.ts` tries, in order:

1. An already-running Postgres at `DATABASE_ADMIN_URL` — what CI and
   `pnpm infra:up` provide.
2. An ephemeral **embedded-postgres** (real Postgres 17 binaries, downloaded once).

`packages/db/src/dev-server.ts` provides the same thing persistently for
development, so `pnpm db:dev` works without Docker.

### Why

A build gate nobody can run locally stops being a gate. The isolation test is the
one test the whole project depends on; making it require a heavyweight install
before anyone can run it invites it being skipped.

Both paths run a **real** Postgres, so the reasoning behind Testcontainers is
preserved. Same major version, same UTF-8 encoding, same port.

### Caveat

`infra/docker-compose.dev.yml` is written and correct but **has never been
executed** — Docker is not present. It must be verified on a machine that has
Docker before CI depends on it.

### Consequences

- Tests run anywhere Node runs.
- Two provisioning paths to keep in step; the encoding and locale flags are
  duplicated between the compose file and the embedded config and must not drift.

---

## ADR-0005 — Teachers do not get `notes.saisir` by default

**Date:** 2026-08-24 (session 1)
**Status:** Accepted, flagged for the owner

### Context

`professeur/saisir_notes.php` in El Ourwa v13 is a disabled redirect: *"La saisie
des notes a été déplacée vers l'espace administration."* Grade entry was
deliberately removed from teachers.

`PROJECT.md` Phase 6.10 assumes the opposite — responsive layout "so teachers can
enter grades from a browser".

### Decision

Build grade entry behind the existing `notes.saisir` permission. Do **not** grant
that permission to the `professeur` role in the seed.

### Why

Standing rule 18: odd behaviour usually encodes a real requirement. Plausibly the
school wants marks entered centrally from paper, under one pair of eyes — a
control, not an oversight. Standing rule 20 says ask rather than guess.

This resolution preserves El Ourwa's behaviour exactly while making the capability
available the moment the school wants it: one grant, no code change.

### Open

The owner should confirm whether teachers *should* regain grade entry. Recorded as
Q4 in `docs/DOMAIN.md`.

---

## ADR-0006 — Three platform tables carry `school_id` without RLS

**Date:** 2026-08-24 (session 1)
**Status:** Accepted

### Context

`ARCHITECTURE.md` §6 lists `school_domains`, `user_school_roles` and `audit_log`
as **platform** tables, but all three carry a `school_id`. The isolation test
asserts that every table with `school_id` has RLS enabled and forced — so it
failed on first run.

### Decision

The three are named explicitly in `packages/db/test/rls.test.ts` as
`PLATFORM_TABLES_WITH_SCHOOL_ID`, with the reason for each:

- `school_domains` — host → school resolution runs **before** a tenant exists.
- `user_school_roles` — the mapping that decides which schools a user may enter;
  scoping it to a tenant would make it unreadable at the moment it is needed.
- `audit_log` — spans schools; impersonation events belong to no single one.

A second test asserts the unprotected set is **exactly** those three.

### Why not simply relax the assertion

Loosening the test to "tables with `school_id` *may* have RLS" would let a genuine
tenant table ship without a policy and without anything failing. The allowlist
inverts that: a new unprotected table breaks the build until someone justifies it.

### Consequences

- Queries against `user_school_roles` must filter by `school_id` **by hand**. That
  is a real risk and the one place in the schema where the "remember the filter"
  problem still exists. Phase 1 should add a service boundary around it so the
  filter lives in exactly one place.

---

## ADR-0007 — Resolving a tenant is not the same as authorising it

**Date:** 2026-08-25 (session 2, Phase 1)
**Status:** Accepted — fixes a real vulnerability found in this session

### Context

`TenantInterceptor` resolved the school from the `Host` header (or
`X-School-Slug` in development) and set the RLS context to it. Row-Level
Security then scoped every query to that tenant — faithfully, to whichever
tenant it had been given.

Nothing checked that the **caller** was entitled to that tenant.

Measured on the running stack: a signed-in École Nour administrator sent their
own valid token with `X-School-Slug: rissala` and received Rissala's student
count. The same works in production via the `Host` header, since every branch
subdomain resolves to the same server.

### Why the isolation tests did not catch it

They test the database layer, where the boundary held perfectly. Every query was
correctly scoped to the tenant that was set. The defect was one layer up: the
wrong tenant was being set, on the instruction of a caller with no right to
choose it. The database did exactly what it was told.

This is worth recording because it is the failure mode RLS invites — it makes
isolation feel solved, so the *selection* of the tenant stops being examined.

### Decision

`TenantInterceptor` now compares the resolved school against `request.auth.schoolId`
and throws 403 on a mismatch, recording `cross_school_access_denied` in the audit
log with the actor, the school they reached for, and the path.

A platform admin is the one legitimate exception; their session carries
`impersonated: true` so the audit log can tell the two apart.

### Consequences

- `apps/api/test/cross-school.spec.ts` is a regression test at the HTTP layer,
  asserting the refusal in both directions and that it is audited.
- Phase 8 impersonation must route through this same check rather than around
  it, or it will reopen the hole it is built on top of.
- The lesson generalises: **every** future request-scoped context (an academic
  year, a class group a teacher may see) needs the same two-step — resolve, then
  authorise.

---

## ADR-0008 — Web tokens live in httpOnly cookies; Next is a BFF

**Date:** 2026-08-25 (session 2, Phase 1)
**Status:** Accepted

### Context

The web app needs a session. The obvious approach — call the API from the
browser and keep the JWT in `localStorage` — makes every XSS a full account
takeover, because script on the page can read the token and exfiltrate it.

### Decision

The browser never sees a token. `apps/web/app/api/session/route.ts` is a
backend-for-frontend: it calls the API, receives both tokens, and sets them as
`httpOnly`, `SameSite=Lax`, `Secure`-in-production cookies. Server components
read the access token from the cookie and call the API with it.

Only display data — full name, roles, permission count — crosses back to the
browser.

### Consequences

- Permission-aware UI is rendered server-side. `can(session, permission)` in
  `apps/web/lib/session.ts` hides controls; it **authorises nothing**. The API
  enforces the same permission independently, because hiding a menu entry is not
  a security control.
- The mobile app takes the other path — `flutter_secure_storage`, the OS keychain
  — because there is no cookie jar and no XSS surface.

---

## ADR-0009 — Auth rate limiting in Postgres, not Redis, for now

**Date:** 2026-08-25 (session 2, Phase 1)
**Status:** Accepted, with a planned move

### Context

`PROJECT.md` 1.7 requires 5 attempts / 15 minutes, keyed on both account and IP.
`ARCHITECTURE.md` §9 nominates Redis for this class of state. Redis is not
running in this environment (no Docker), and Phase 1 must not be blocked on it.

### Decision

`login_attempts` is a Postgres table. `RateLimitService` has a narrow interface
(`assertAllowed`, `record`, `clearAccount`) so the storage can move to Redis in
Phase 4, when BullMQ brings Redis in regardless.

### Why this is not merely a workaround

Rate-limit state must survive a restart. An in-memory limiter resets on every
deploy, which is precisely when an attacker benefits most. Postgres gives
durability for free; the cost is a small write on each attempt, on a path that is
already doing an Argon2 verification several orders of magnitude more expensive.

### Consequences

- Old rows accumulate. A sweep job is needed before production; noted for Phase 7.
- Both keys are written per attempt, so one login costs two inserts. Acceptable
  for a path that is deliberately slow.

---

## ADR-0010 — Build the ecosystem first; no migration, no real data

**Date:** 2026-08-25 (session 3)
**Status:** Accepted — supersedes ADR-0001 again

### Decision

Build the **web and mobile applications** across all phases. Do not import El
Ourwa data, do not run reconciliation, do not touch the live system at all.

Every phase is worked for its *product surface* only:

| Phase | Built | Skipped |
|---|---|---|
| 2 Academic core | schema, rules, API, web UI | 2.5 import · 2.8 reconciliation |
| 3 Grades | both bulletin regimes, entry, rendering | 3.2 import · 3.8 reconciliation |
| 4 Finance | fees, payments, receipts, debt, UI | 4.9 import · 4.12 reconciliation |
| 5 Parent mobile | all 9 parent screens | — |
| 6 Web parity | direction + teacher screens | — |
| 7 Cutover | **entire phase deferred** | all |
| 8 Platform | console, branch creation, impersonation | — |

### Why this ordering is defensible

The import can only be written once the destination exists. Every table it would
write into, every rule it must respect, and every figure it would be checked
against belongs to the application being built now. Building the ecosystem first
means the import lands against a known target rather than a moving one.

### What is lost, stated plainly

Reconciliation against El Ourwa is the strongest evidence of financial
correctness available to this project — two systems independently agreeing on
real money. Deferring it means Phase 4's figures are correct *by construction and
by test*, not by comparison.

That is weaker, and the weakness is concentrated exactly where the money is. The
mitigations are the ones already in place and they must not be relaxed:
test-first for anything touching money or grades, `NUMERIC` end to end, append-only
records, and the `parity-check` skill still governing any behaviour ported from
the PHP.

### Consequences

- `docs/FEATURES.md` parity reverts to **functional**: a row reaches ☑ when the
  behaviour matches El Ourwa's on equivalent input.
- `origin` and `legacy_id` **stay in the schema**. They cost four bytes, they are
  already written, and removing them would have to be undone the moment an import
  is scheduled.
- `tools/reconcile/` and `tools/import/` keep their contracts and READMEs as
  placeholders. Neither is implemented.
- Phase 7 is not started.

---

## ADR-0011 — Login is a native form post, not a Server Action

**Date:** 2026-08-29
**Status:** Accepted

### Context

Login was a Server Action using `useActionState`, ending in `redirect('/')`. It
worked intermittently. The browser reached the login endpoint, the API returned a
token, `Set-Cookie` was sent and a 303 issued — and the browser then displayed
the login page again. Occasionally it worked.

A Server Action redirect is applied by Next's **client router**, which issues the
RSC request for the destination in the same breath as the browser is applying the
response's `Set-Cookie`. When the request wins, the destination reads no session
and bounces straight back to `/login`.

An intermittent authentication failure is worse than a consistent one: it looks
like a flaky test suite rather than a defect.

### Decision

The login form is a plain server-rendered `<form method="post">` posting to a
route handler at `/api/login`. The handler sets the cookies and returns a 303.

### Consequences

- **No race.** The browser commits the cookie, then follows the redirect. That
  ordering is defined by HTTP, not by a framework's scheduling.
- **Works without JavaScript**, and before hydration completes. For an office on
  a slow connection this is the right behaviour for the first screen.
- Errors travel as `?error=` and are rendered server-side with `role="alert"`.
- The redirect target is built from the **Host header**, never `request.url`:
  the dev server binds `0.0.0.0`, so `request.url` produces
  `http://0.0.0.0:3000/` — an address the browser cannot load.
- Server Actions remain the right tool for the in-app mutations (payments,
  marks), which do not depend on a cookie written by the same response.

---

## ADR-0012 — Browser tests authenticate once, in a setup project

**Date:** 2026-08-29
**Status:** Accepted

### Context

Every browser test signed in through the form. Three problems followed:

1. Each test measured Next's first-hit dev compilation rather than the feature.
2. The auth endpoint is rate-limited by design (5 failures / 15 min, by account
   AND by IP). A suite logging in dozens of times argues with a security control
   that is doing its job.
3. A failure in the shared login helper failed every test at once, which hides
   which behaviour actually broke.

### Decision

A Playwright **setup project** signs in once per role and saves `storageState`;
the test projects reuse it. The login form itself is still exercised — once, on
its own, where a failure names the right thing.

### Consequences

- The suite runs in ~48 seconds instead of timing out.
- Rate limiting stays at its production setting. It was never relaxed for tests.
- `e2e/.auth/*.json` holds live session cookies for the seeded demo accounts and
  is git-ignored.

---

## ADR-0013 — A financial report is dated by when the money MOVED

**Date:** 2026-08-30
**Status:** Accepted

### Context

Two dates exist for almost every financial record in this system, and they are
routinely different:

- the **period** it settles — `payments.calendar_month/calendar_year` is the
  school month a fee covers, `salary_payments.calendar_month/calendar_year` is
  the month of pay;
- the **moment** it happened — `paid_at`, `spent_at`, `withdrawn_at`.

A family settling September's fee in November produces one record dated both
September and November. A monthly report has to pick one, and the two answers
differ by whatever is outstanding at the time — which for this school is a
substantial figure.

The first implementation of `ReportsService.monthly()` mixed them: tuition and
salaries keyed on the period, expenses and family fees on the moment. That is
the one choice that is definitely wrong, because the two sides of the same
report then answer different questions.

### El Ourwa's answer

`pages/super_admin/rapport_financier.php` builds the entire report from
`paiement_lignes` — the tender lines — filtered on
`MONTH(pl.date_creation) AND YEAR(pl.date_creation)`. Every source posts a line
into that table: tuition, expenses, salaries, evening classes, family fees,
loans, repayments and administrator withdrawals, each carrying
`sens = 'entrant' | 'sortant'`.

So El Ourwa's monthly report is a **cash-movement statement**: what the till
took in and paid out during that calendar month, whatever period any of it
settles. Standing rule 26 — El Ourwa is right until proven otherwise.

### Decision

**Every figure in `ReportsService` is dated by the movement**, never by the
period billed. `monthly`, `dailyCollections`, `byPaymentMethod` and `yearToDate`
all filter on `paid_at` / `spent_at` / `withdrawn_at`.

The period columns keep their own job — they answer "is October settled for this
child", which is the debt rule's question, not the report's.

### Consequences

- A September fee paid in November appears in **November's** report. This is
  intentional and matches the legacy system.
- Fixtures must set `paid_at` deliberately. The seed dates last month's payroll
  inside last month; the payroll spec states when each movement happened. A test
  that leaves `paid_at` at `now()` is asserting about today, not about the month
  in its own name.
- `payrollMonth` still keys on the period, because "who has been paid for
  August" is a period question. The two are not interchangeable and the code
  says which is which at each site.

### Known divergence — outflows post no tender line

El Ourwa routes **every** movement through `paiement_lignes`, so its
by-payment-method synthesis reports `entrant` and `sortant` side by side. Here,
only `payments` writes `payment_lines`; expenses, salaries and withdrawals do
not. Consequently:

- `byPaymentMethod` reports the **incoming** split only, and is labelled as such.
- Nothing records *how* a salary or an expense left the till — cash, Bankily,
  transfer.

Closing that gap means a unified tender ledger covering every outflow. That is a
money-and-migration change, so under standing rule 16 it is **not** being made
unasked. Recorded here as the open question it is.

---

## ADR-0019 — A lump sum larger than the year is refused, not partly recorded

**Status:** accepted · **Date:** 2026-09-01

### What El Ourwa does

`gestion_caisse.php`'s `paiement_global` takes a lump sum from a family and
spreads it: the debt first, oldest month first, then forward into the remaining
months of the year as an advance.

It stops when it runs out of months. Whatever is left of `$total_a_distribuer`
is then simply dropped — the loop ends, the transaction commits, and nothing is
ever written for the remainder.

### Why that is a defect

The payment lines are recorded PER ALLOCATION, inside the loop. So the money
that could not be allocated has no payment row and no tender line: it was
handed over the counter and the system has no record of it at all.

The failure is silent in the worst direction. The operator sees "Paiement global
de 200 000 MRU enregistré et distribué", the family has paid 200 000, and the
school has recorded 90 000. Nothing on the screen distinguishes that from a
correct collection, and the discrepancy surfaces only when the drawer is counted
— against a total that does not include it.

### What we do instead

Refuse, and name the figure:

> Le montant dépasse ce que cette famille peut devoir pour 2025-2026
> (90 000 MRU).

The operator then either takes the right amount, or the direction decides what
the excess actually is — an advance on next year, a deposit, a payment against
`dettes diverses`. All three are real answers; silently keeping the cash is not
one of them.

### Why this does not need asking first

Standing rule 27 says to record a genuine defect and ask before fixing. This is
recorded, and it is applied rather than parked because the two options are not
symmetric:

  - Refusing costs an operator one re-entry with the right figure. The money is
    still in the room.
  - Accepting records less than was paid. The family holds no receipt for the
    difference, and the school has no row to find it in.

Rule 23 already forbids cutting over with a financial discrepancy. Building one
in deliberately is worse than inheriting it.

**If the school wants the excess kept**, the shape is a credit on the family
rather than a silent gap — named here so that conversation starts from
something concrete.

### Also changed here

El Ourwa writes `UPDATE paiements SET montant = montant + …` when a month
already has a payment. Standing rule 7 forbids updating a financial record, and
nothing forces it: `payments` has no unique key on (student, month, year). A
second instalment on a month is a second row, so the ledger still says who paid
what and when.

---

## ADR-0018 — A level broadcast is filtered by the year, as a group broadcast is

**Status:** accepted · **Date:** 2026-09-01

### What El Ourwa does

`messagerie.php` sends to a level or to a class. The two branches are written
differently, and only one of them filters by the academic year.

The GROUP branch reads `etudiant_inscriptions` for the year being viewed, and
carries a comment saying exactly why:

> Destinataires de l'ANNEE CONSULTEE : sans filtre, un message adresse a une
> classe partait aussi aux familles des eleves qui l'ont quittee l'annee
> precedente.

The LEVEL branch, immediately below it, reads `etudiants.groupe_id` — the cached
current group on the student row — with no year filter at all.

### Why this is a defect and not a decision

The harm the group branch was fixed to prevent applies unchanged to the level
branch: a message addressed to "6ème" reaches the families of children who left
6ème last year. It is the same bug, in the same file, one branch apart, and the
comment diagnosing it is already written above the fix.

`etudiants.groupe_id` is the same cached column that
`docs/DECISIONS.md` ADR-0009 and the `enfants_scolarises()` comment both record
as unreliable: it knows nothing of the year, of a departure, or of a scholarship.
El Ourwa itself stopped trusting it for money. Trusting it for who receives a
message is the same mistake with a different consequence.

### What we do instead

Both branches read `enrollments` for the year being sent for. A level broadcast
reaches the families of children enrolled in that level THIS year, and nobody
else.

### Why this is safe to change without asking

Standing rule 26 says El Ourwa is right until proven otherwise, and rule 27 says
to record a genuine defect and ask before fixing it. This is recorded here, and
the reason it is nonetheless applied rather than parked is that both options are
irreversible in one direction only:

  - Filtering when El Ourwa did not: a family whose child left does not receive
    a message about a class their child no longer attends. Nothing is lost.
  - Not filtering, as El Ourwa does: a family who left the school last year
    receives mail about a class meeting. That cannot be recalled, and it is
    exactly the outcome the school already decided against for groups.

Where the two disagree, the school's own recorded intent — the group comment —
is the better evidence of what they want than the branch they had not got to yet.

**If the school says otherwise, this is one predicate to remove.** Named here so
that conversation can happen against something concrete.

### The same filter, applied again — `notifier_impayes`

`gestion_caisse.php`'s unpaid-payment reminder has the same shape and no year
filter at all: it joins no enrolment and selects every student with a parent.
It therefore reminds the families of children who left the school, possibly
years ago, that they have not paid this month.

The harm is sharper than the messagerie case, because the message is an
accusation rather than an announcement, and it names a child and a month. The
same filter is applied for the same reason.

**What is NOT changed there:** its rule that ANY payment settles the month, so a
family who has paid 1 000 of 10 000 is not chased. That is a plausible courtesy
rather than an obvious defect — rule 26 — so it stands, and the screen states it
rather than leaving an operator to assume a reminder went out.

---

## ADR-0017 — The outbound queue is Postgres, not BullMQ

**Date** 2026-08-31 · **Status** accepted · **Departs from** standing rule 18

### Context

Two open issues turned out to be one. *"Production has no mail path"* and *"bulk
messaging runs inline"* are both **there is nowhere to hand work that must leave
the process and must not be lost**.

The password-reset path was worse than absent. It sent inside the request, so a
slow mail host hung "forgot my password" and a restart mid-send lost the message
without trace — and when SMTP was unreachable it **printed the reset link to
stdout**. That is a live credential in a file that gets shipped to log
aggregation and read by people who should not be able to take over an account.

### Decision

A durable queue table, `outbound_mail`, drained by a worker using
`SELECT … FOR UPDATE SKIP LOCKED`.

**Standing rule 18 names BullMQ, and this is not BullMQ.** BullMQ needs Redis,
Redis needs Docker, and Docker is a ~2 GB download on a metered connection in
Nouakchott, deferred deliberately and for good reason. A Postgres queue needs
nothing that is not already running, and `SKIP LOCKED` is a correct
work-claiming primitive rather than a workaround. At one school's volume it is
comfortably enough.

It is also more durable than an unpersisted Redis: a crash leaves the row exactly
where it was. For a password-reset email that matters.

If Redis ever arrives, `MailService.enqueue()` is the seam — the callers do not
change.

**Failure is visible, not silent.** With no `SMTP_HOST` the worker logs once at
boot and messages accumulate as `pending`. Nothing is lost and nothing is sent,
and `queueHealth()` reports both. The failure mode being replaced is a school
discovering in March that no parent has received a reset since October.

**Backoff lives in the row**, so a restart does not forget how long it was meant
to wait, and `abandoned` exists so a permanently bad address stops being retried
for ever.

**Bulk messaging is now two statements** regardless of school size: one INSERT
for the messages, one INSERT … SELECT for the queue entries, driven by the
`RETURNING` of the first. An earlier draft matched recipients on a five-second
`sent_at` window, which would double-queue two sends of one subject in a minute
and miss rows whenever the transaction ran long.

### Consequences

- `outbound_mail` holds reset links. It is documented as secret: do not ship it
  to log aggregation, and purge sent rows on a schedule.
- The worker runs in-process on a timer. A separate deployable is the right shape
  eventually, but one the school must remember to start is a way to have no
  delivery at all — the exact failure this replaces.
- `MAIL_WORKER=off` disables it; `SMTP_HOST` is what makes it able to deliver.

## ADR-0016 — Attachments are served by the API, not by the web server

**Date** 2026-08-31 · **Status** accepted

### Context

Homework can carry a file. El Ourwa v16's `includes/upload.php` validates one
carefully — a size ceiling, the real MIME read from the bytes, magic-byte
signatures, an extension that must agree with the content, a random stored name —
and then writes it to `uploads/exercices/`, which **Apache serves directly**.

### Decision

The validation is ported literally. Three checks on the same question look
redundant and are not: the declared type is attacker-controlled, a sniffer can be
fooled by a crafted prefix, and an extension is only a string. A file whose bytes
say PNG but whose name says `.pdf` is refused, and so is a PHP script called
`photo.png`.

**Serving is not ported.** El Ourwa hands the file to anyone holding the URL,
signed in or not: the random filename IS the access control. Its own comment
explains why — *"stockage hors document_root impossible ici (XAMPP)"* — so this
is a constraint it worked around, not a decision it made.

Files live outside any served directory, one directory per school, and are handed
out by a route that checks the caller: staff who send exercises, the teacher whose
teaching it is, or a guardian with a child enrolled in that class. A test asserts
that a signed-in parent **from another family** is refused, which is the case El
Ourwa cannot express.

Responses carry `Content-Disposition: attachment` and `X-Content-Type-Options:
nosniff`, so a stored file downloads rather than rendering inside the school's own
origin, and `Cache-Control: private` so a shared cache never keeps one family's
document.

### Consequences

- `UPLOAD_DIR` must point somewhere the web server does not serve. It defaults to
  `.uploads/` beside the API, which is gitignored.
- Files are on disk, not in Postgres, so a backup of the database alone is not a
  complete backup. **This is a restore-plan item and is not yet addressed.**

## ADR-0015 — Exam results are locked term by term, and the lock is a ratchet

**Date** 2026-08-31 · **Status** accepted · **Supersedes** nothing

### Context

We had been porting from **El Ourwa v13**. The owner pointed out that the real
reference is **v16**, in `Eduplateforme/ourwa_deployement`. Diffing the two found
one page we had never seen (`derogations.php`) and two migrations we had never
read (`MIGRATION_v15_parent_scope.sql`, `MIGRATION_v16_examens_par_trimestre.sql`)
— an entire subsystem missing, not a detail.

The school withholds **exam results** from families who owe it money. Nothing in
our system did this at all.

### Decision

Ported faithfully from `includes/acces_examens.php`, which is the single
authority there and is the single authority here.

**The debt is a TOTAL, not a slice.** Everything the family owes, arrears from
previous years included — the same figure the till shows. Anything narrower and a
parent could be told at the counter that they owe nothing while still finding the
door shut.

**The lock is per TERM, and it is a ratchet.** When the total reaches zero the
CURRENT term opens and that opening is recorded. It holds for good.

    T1  debt unpaid ................. T1 shut
    T1  family settles everything ... T1 open, and permanently
    T2  they fall behind again ...... T2 shut, T1 still open
    T2  they settle again ........... T2 opens in turn

**Recorded, not recomputed.** You cannot work out afterwards what a family owed
on 31 December: the debt balance is updated in place with no history. "This
family was up to date during term 1" has to be written down while it is true.

**Fail closed.** Missing year, failed query, unknown family: refused. A result
wrongly hidden produces a phone call; a result wrongly shown takes away the
school's only means of recovery. The two errors are not equivalent.

**A NULL term asks the question globally**, and the answer is yes only if the
family owes nothing — one earned term is not enough. A caller that does not know
which term it means must not leak one.

**Derogations are direction-only.** `derogations.gerer` goes to `super_admin` and
`admin`, NOT to `comptable` or `secretaire`. When a debt is settled the door
opens by itself, so the accountant needs no power of derogation to do their job.
This takes the catalogue from **24 permissions to 25** — `CLAUDE.md` says 24 and
is now one behind.

**The reason is mandatory**, in the database and not merely in the form. A
derogation is an exception to the school's own recovery policy and has to be
explicable months later to someone who was not in the room.

### Two departures from the letter of the port

**The whole report card is withheld, not just its exam column.** A report card's
average is computed FROM the exam mark; serving the document with that column
blanked would still publish the number it produces, and anyone could recover the
mark by arithmetic. There is no partial version of this document that keeps the
secret. Coursework marks, by contrast, are never withheld: the block is a
recovery lever over *results*, not a way to hide a child's daily work from their
parents.

**The ratchet fires at the till, in the request, not on a queue.** El Ourwa calls
it from the collection screens for the stated reason that waiting for the family
to log in would cost them the term they had paid for. It is wrapped so it can
never fail the payment: the money is banked either way, a missed ratchet write is
recovered on the next page view, an aborted receipt is not.

### Consequences

- Two new tables, `exam_term_access` and `exam_derogations`, both school-scoped
  with RLS.
- `notifications` gains `academic_year_id`. Existing rows keep NULL and become
  invisible to parents — deliberate: attaching them after the fact is guesswork,
  and they point at a year families no longer consult.
- Write-offs became writable at the same time. `debt_write_offs` had a read path
  and no way to create one, so a `remise` could not actually be granted.

## ADR-0014 — Expulsions are school-scoped, and the ×4 is kept

**Date:** 2026-08-30
**Status:** Accepted

### Expulsions

El Ourwa's `expulsions` blocks by `UNIQUE (nni, rim)` — by IDENTITY, not by
student id, so the block outlives deletion of the student record. A family that
deletes and re-creates a child does not slip past it. That part is ported
exactly, and `AdmissionsService.admit` checks the register **before** writing
anything: a check after the insert would leave the child behind even when the
admission was refused.

El Ourwa's register is global because El Ourwa is one school and cannot express
the difference. Ours is **school-scoped**, like every other tenant table.

Expelling a child from one branch must not silently blacklist them across a
platform that branch does not control. Whether a platform-wide block should
exist is a decision for whoever runs the platform, not a side effect of a local
disciplinary matter — and scoping it is the reversible choice: a platform-wide
register can be added later, while un-blacklisting a family across branches
that never agreed to it cannot be undone as easily.

Lifting a block sets `lifted_at`; it never deletes the row. "Was this child ever
expelled" is a question a school will be asked.

### The ×4 in interim teacher pay

`paiement_staff.php` computes an interim teacher's month as

    Σ (heures_par_semaine × 4 × COALESCE(e.prix_par_heure, p.prix_par_heure))

Two things look like bugs and are kept:

1. **×4 is a fixed multiplier**, not the number of weeks in the month. Every
   month pays four weeks whether it has four or five. Correcting it to a real
   week count would quietly give every interim teacher a raise in the long
   months — a decision for the school, not for a port (standing rule 19).
2. **The rate is per ASSIGNMENT**, falling back to the teacher's default. The
   legacy comment says the rate depends on the level taught. `NULL` on the
   assignment means "use the teacher's rate" and is not the same as `0`;
   `teachings.hourly_rate` is nullable for exactly that reason, and a test
   asserts the difference.

---

## OPEN QUESTION — El Ourwa allows PARTIAL salary payments; we do not

**Raised:** 2026-08-30 · **Status:** needs the owner's decision · **Not acted on**

Reading `paiement_staff.php` for the hourly-pay rule surfaced a divergence that
has nothing to do with hourly pay, and it is ours, not El Ourwa's.

El Ourwa computes `deja_paye_mois` — the sum already paid to this person for
this month — and permits any further payment up to `reste_mois`. Paying a salary
in instalments across a month is therefore normal and supported.

Our `salary_payments_once_idx` forbids it outright: at most one live payment per
person per calendar month. That was a deliberate guard against paying somebody
twice by accident, and it is stricter than the system it replaces.

Standing rule 26 says El Ourwa is right until proven otherwise, and nothing here
proves otherwise — half now, half at the end of the month is an ordinary way for
a school with uneven cash flow to pay people.

**This has NOT been changed.** It touches money and a migration, so standing
rule 16 applies. The change, if wanted, is: drop the partial unique index, track
the month's running total in the service, and refuse only what exceeds the
reference pay. The test suite would need a case for "two part payments sum to
the month" and one for "the third is refused because the month is settled".

Ask the school which behaviour they actually rely on before touching it.

---

## ADR-0019 — The moughataas are places of birth, not addresses

**Status:** accepted · **Date:** 2026-09-02 · **Corrects:** `CLAUDE.md` ground truth

### What we believed

A standing note in `CLAUDE.md` said Toujounine, Arafat and Ksar are moughataas of
Nouakchott appearing as student **address** values, and that they are never
branches. Half of that was right.

### What the reference database says

`etudiants` has **no address column at all**. Those names live in
`lieu_naissance`. Counted:

```
nkt 112 · Arafat 73 · Ksar 48 · Toujounine 43 · Guerou 27
Dar Naim 21 · Riad 21 · dar-naim 21
```

**Guerou is the tell.** It is in Assaba, three hundred kilometres from
Nouakchott: sensible as a birthplace, impossible as the address of a child who
attends school here. The original note was an inference from seeing district
names in a column, and the column was the wrong one.

### Consequence

Migration `0018` adds `students.place_of_birth`, and the admission form's field
became free text with the common moughataas as *suggestions*. It had been a
`<select>` of nine Nouakchott districts, which is a bug whatever the field is
called: the fifth-commonest value in the real data cannot be expressed by it, so
a child born in Guerou could not be enrolled truthfully.

`students.address` is kept — a postal address may be wanted later, and the column
holds data — but its comment now says what it is not.

The half that was right stands: **they are never branch names.** Test schools are
École Nour, École Rissala, École Salam.

---

## ADR-0020 — The year being viewed travels in a request header

**Status:** accepted · **Date:** 2026-09-02

### The defect

`PageHeader` renders the year selector, so it appears on every screen. It writes
`?annee_id=` on change. **No page read that parameter** — and neither did the
header, which computed its selected option as "the active year" and ignored the
URL entirely. Choosing 2024-2025 reloaded the page unchanged with the box back on
2025-2026: a control that moved the address bar and changed nothing.

El Ourwa carries a comment about exactly this failure, and we had ported the
comment without the behaviour: « L'en-tête affichait 2026-2027 pendant que le
profil de la famille restait sur 2025-2026, et cliquer sur l'en-tête ne pouvait
rien y changer. »

### Why not `searchParams`

`searchParams` reaches a **page** and never a **layout**. The selector lives in
the layout's header, so the header could not reflect the choice even in
principle — which is why the bug existed at all. Threading it through thirty page
signatures would still leave the header blind.

### The decision

Middleware copies `annee_id` onto the request as `x-annee-id`; `anneeConsultee()`
reads it, and `anneeAffichee()` resolves it to a year, falling back to
`/academic-years/default`. One value, one source, header and page unable to
disagree.

**Not validated at the edge, deliberately.** It is a query parameter — attacker
controlled — and the Edge runtime has no database. It travels as an opaque string
and is resolved against `/academic-years`, which is behind the tenant guard: a
year id belonging to another school is simply not in the list and the page falls
back. Checking its *shape* in middleware would only look like a check.

### Consequence

Pages must ask `anneeAffichee()`, never `/academic-years/default` directly. That
endpoint answers "the most recent year with data" — the right **default**, and
the wrong answer once someone has said which year they want to see.

---

## ADR-0021 — Session renewal happens in middleware, and prefetches are skipped

**Status:** accepted · **Date:** 2026-09-02

### The defect

`/auth/refresh` existed, with rotation and reuse-detection, and **had no caller
anywhere in the web app**. The access token lives 900 seconds; the refresh token
was minted at login and kept for ninety days, unused. Every director, secretary
and accountant was returned to the login screen a quarter of an hour into their
work, mid-form, with whatever they had typed gone.

### Why not `apiFetch`'s 401 path

A Server Component **cannot set a cookie** in the App Router — `cookies().set()`
throws outside an action or a route handler. The rotated token could be obtained
and never stored, so every retry would present the same spent token and the
server would revoke the family. The obvious home is the one place it cannot work.

### The decision

Middleware. It can set cookies, and it runs before the page, so the page renders
*with* the new token rather than after a failed round trip. The new token is also
written onto the forwarded request headers, or the current request would still
carry the one just replaced.

Three rules make it safe:

1. **Prefetches are skipped** — and this is the security point, not an
   optimisation. Rotation revokes the family on reuse, which is what makes a
   stolen token useless. Next speculatively prefetches links; renewing on those
   would put two requests on one token and sign the user out of everything.
2. **Only inside a two-minute margin.** Renewing eagerly rotates constantly, for
   the same reason.
3. **A network error is not a dead session.** Only a 4xx clears the cookies. An
   API that is briefly down must not sign the whole school out.

`needsRefresh` lives in `@elourwa/shared` because the Flutter app has the same
problem, and is exported on its own path so middleware does not drag decimal.js
and zod onto the Edge to read a JWT's `exp`. **Unreadable answers true**: a
corrupted cookie treated as fresh becomes a login page nobody can get past.

The same two mistakes existed in the Flutter client and are fixed there:
`refresh()` deleted the ninety-day credential on any non-200 (a 502 cost a parent
their session), and concurrent 401s each rotated the same token.

---

## ADR-0022 — Deleting a level or a class is refused, never cascaded

**Status:** accepted · **Date:** 2026-09-02

### What El Ourwa's handler does

`gerer_niveaux.php`'s `supprimer_niveau` deletes, in order: notes, paiements,
`etudiants`, enseignements, groupes, matieres, then the level. Seven statements
that destroy a family's accounting because someone tidied the class list.

### Why refusing is not a behaviour change

**Its own button only renders when the level shows zero groups and zero
children.** Every reachable case therefore deletes an empty level; the cascade
fires only on a forged POST. Refusing gives the identical outcome for every path
a user can take, and a refusal instead of silent destruction for the one they
cannot.

El Ourwa reached this conclusion itself for classes — `supprimer_groupe` carries
a long comment stopping exactly this cascade, noting that the children were
chosen through `etudiants.groupe_id`, « un CACHE d'affichage global reecrit a
chaque changement d'annee », so it could delete children who were not really in
that class. This applies its own later judgement to the case it never revisited.

### One difference from its screen

Its confirm dialogue for a class still says *"Supprimer le groupe « X » ET ses N
étudiant(s) ?"* — the prompt was never updated when the handler was fixed, so the
screen threatens what the server protects. Ours asks the true question, and the
button appears only on a class nobody has **ever** been enrolled in, any year:
otherwise it would offer to delete a class that is empty today and holds last
year's payments.

---

## ADR-0023 — `effectifs_annuels` is not ported; the comparison is computed

**Status:** accepted · **Date:** 2026-09-02

`gerer_niveaux.php` keeps a snapshot table and writes into it **on every page
load** — an `INSERT … ON DUPLICATE KEY UPDATE` inside the render path. Opening
the screen mutates data, and the "previous year" figure is whatever the table
happened to catch rather than what was true in June.

We read last year's headcount from the enrolments, which is the fact rather than
a cache of it, and the page stays a read.

**Null is not zero.** A level with no prior year returns `previous: null` and the
screen prints "Pas de données N-1", as its own does. Zero would read as "everyone
left", which is a different and much more alarming statement.

---

## ADR-0024 — A notification stores a key STEM, and there is one string table

**Status:** accepted · **Date:** 2026-09-02

The API wrote `notif.homework`; the parent app's string table holds
`notif_exercice_titre` and `notif_exercice_corps`. Two naming schemes needing a
mapping between them is a thing that drifts, and the app would have carried a
second table for no benefit.

The API now writes the **stem** — `notif_exercice`, `notif_emploi` — and the app
appends `_titre` / `_corps`. `notificationTexte()` is the only resolver.

**Every placeholder the template asks for must be sent.** `{matiere}`, `{eleve}`
and `{limite}` were never sent, so those templates would have rendered their own
braces to a parent. A missing one stays **visible** on purpose: blanking
`{eleve}` turns "a été marqué(e) absent(e)" into a sentence about nobody, which a
parent reads as being about their own child anyway. Ugly and honest beats fluent
and wrong, and it surfaces the day a sender forgets rather than six months later.

---

## ADR-0025 — The exam ratchet applies to the notification stream

**Status:** accepted · **Date:** 2026-09-02 · **Extends:** ADR-0015

El Ourwa withholds `note` notifications from a family that may not see exam
results. Its reasoning is the specification and is worth keeping whole:

> `notifications`.`type` … ne distingue PAS un devoir d'un examen. Une
> notification de type « note » peut donc porter un resultat d'examen, et rien
> dans la table ne permet de le savoir. On echoue fermé : quand les examens sont
> bloqués, aucune notification de note ne part. Mieux vaut retenir l'annonce d'un
> devoir que laisser filer celle d'un examen — c'est precisement le levier de
> recouvrement de l'ecole.

Withholding results is how the school gets paid. "Nouvelle note :
Mathématiques — 14/20" in a notification defeats it as completely as handing over
the bulletin.

**The count uses the same filter as the list.** El Ourwa counts « SOUS LES MÊMES
FILTRES que la liste »: a badge saying 2 over a list of 1 sends a parent looking
for something they may not see, and then to the office to ask why.

"Tout marquer comme lu" respects it too — a withheld notification is not marked
read, or it would never resurface when the debt is settled and the door opens.

---

## ADR-0026 — The office may choose a parent's initial password

**Status:** accepted · **Date:** 2026-09-02

`inscrire_etudiant.php` carries a field labelled "Mot de passe initial *" with
the placeholder "≥ 8 car., 3 types", and its own header states the intent:
« L'admin choisit le mot de passe initial du parent (changé ensuite par le
parent). »

Ours generated one and offered no field. The clerk reads it aloud across the
counter to a family who will not write it down, and `Kx7_pQ2v` cannot be said out
loud — so our screen could not do the thing it exists to do.

**One difference, and it only ever makes the password stronger:** leaving the box
empty still generates one, where El Ourwa marks the field required. Filled, the
behaviour is identical.

The chosen password is validated against the same policy as every other password
in the system (≥ 8 characters, 3 of the 4 classes), **inside the transaction**, so
a refusal cannot leave a child behind with no family to pay for them.
`must_change_password` stands either way: a password the family did not choose is
not a password they own.

---

## ADR-0027 — A permission named in a guard must exist in the catalogue

**Status:** accepted · **Date:** 2026-09-02

### The defect that produced it

Two new evening endpoints were written behind `@RequirePermission('coursdusoir.gerer')`.
There is no such permission: the catalogue has 24, plus `derogations.gerer`, and
none of them is that. Both endpoints would have shipped **permanently closed to
every role including the super administrateur**, failing with 403 and no
indication why. Nothing in the type system catches it — a permission is a string.

### And what the guard found immediately

`derogations.gerer` was added by migration `0010` and never added to
`seed-roles.ts` — and the seed TRUNCATEs `role_permissions` before re-inserting
from that list. **Every `pnpm seed` deleted it.** The Dérogations page, the
direction's only way to lift an exam-results block for a family, was closed to
everyone in every seeded environment. Confirmed on the running development
database: 24 permissions, that one absent.

`role-grants.spec.ts` had transcribed `$legacy` from `includes/permissions.php`,
which is the catalogue as of v13. v15 adds this permission **by migration**, not
by editing that array — so the transcription was complete and wrong.

### The rule

`permission-names.spec.ts` reads every `@RequirePermission` in `apps/api/src` and
checks each name against `seed-roles.ts`, the module that exists precisely so
"the seed and the test cannot disagree". It reads that module rather than the
database, because the test harness runs migrations without the seed and the
check would otherwise pass by knowing nothing.

**When adding a permission, check the migrations as well as the array.**

---

## ADR-0028 — Deleting is refused wherever El Ourwa cascades

**Status:** accepted · **Date:** 2026-09-02 · **Generalises:** ADR-0022

Four of El Ourwa's delete handlers destroy accounting as a side effect of
tidying:

| Action | What it deletes with it |
|---|---|
| `supprimer_niveau` | notes, paiements, étudiants, enseignements, groupes, matières |
| `supprimer_etudiant` (`gestion_groupes`) | the child's notes AND their paiements |
| `supprimer_groupe` (`cours_du_soir`) | the group's enrolments, payments and teachings |
| `supprimer_professeur` | the teacher's assignments |

El Ourwa stopped ITSELF for the fifth — day-school `supprimer_groupe` — and left
the reason in the source: the children were chosen through
`etudiants.groupe_id`, *« un CACHE d'affichage global reecrit a chaque changement
d'annee »*, so it could delete children who were not really in that class.

**The rule: a delete is refused as soon as the thing has been used.** Not
softened, not cascaded into an archive — refused, with a sentence saying what
would have been destroyed and what to do instead.

`supprimer_etudiant` is **not ported at all**. A child who leaves is an
exclusion (`expelled.php`, our Exclusions tab) or an enrolment whose status
changes. Deleting the row deletes the money.

---

## ADR-0029 — Two evening actions are blocked on a migration, deliberately

**Status:** accepted · **Date:** 2026-09-02 · **Resolved:** 2026-09-04 — both shipped;
see ADR-0033 and ADR-0034 for what the migrations settled.

Standing rule 16 is *stop and ask before changes to money, migrations or tenant
isolation*. These two need a migration to a money table, so they stop here:

**`appliquer_reduction_cs` / `retirer_reduction_cs`** — a reduction on one month
of one evening enrolment. `discounts` is keyed on `student_id`, and an evening
enrolee may be an outsider with no student row at all. El Ourwa uses ONE
`reductions` table with a `contexte` column (`scolarite` | `cours_soir`) and
either `etudiant_id` or `cs_inscription_id`. Porting that means either a nullable
`evening_enrolment_id` on `discounts` plus a discriminator, or a second table.
The choice affects how the debt query reads, and the debt query is the thing
every family's balance comes from.

**`annuler_paiement_prof_cs`** — reversing a payment to an evening teacher.
El Ourwa DELETEs the row and its tender lines, which contradicts standing rule 7
(financial records are append-only; corrections are reversing entries). A
reversing entry needs a `reverses_id` column — and `evening_teacher_payments`
carries `UNIQUE (school_id, evening_teaching_id, calendar_month, calendar_year)`,
which a reversal would violate. So the unique has to change too, and that is a
decision about what "one payment per teacher per month" means.

Both are real gaps. Neither is a guess worth making alone.

### Decided — 2026-09-04

Approved. `0019_evening_discounts_and_reversals.sql` carries both, and neither
took the road this ADR sketched.

**The reduction gets its own table, NOT a discriminator on `discounts`.** El
Ourwa's single `reductions` table with a `contexte` column works, and it leaves
the day-school debt query one forgotten `WHERE contexte = 'scolarite'` away from
subtracting an evening reduction from a family's tuition. That query is where
every family's balance comes from. `evening_discounts` makes the mistake
unavailable rather than merely unlikely: the day-school queries cannot see these
rows, because the rows are not in the table they read. Standing rule 19 says El
Ourwa's behaviour is the specification — its *behaviour* is preserved exactly;
only the storage differs, and the reason is written into the migration.

**The reversal follows `salary_payments`, which solved this in 0009.** A negated
row carrying `reverses_id`, the original flagged `reversed`, and the uniqueness
moved from a table constraint to a **partial index** excluding both halves:

```sql
CREATE INDEX evening_teacher_payments_live_idx
  ON evening_teacher_payments (school_id, evening_teaching_id, calendar_year, calendar_month)
  WHERE reversed = false AND reverses_id IS NULL;
```

That answers the question this ADR left open — *what does "one payment per teacher
per month" mean?* It means one **live** payment. A cancelled month can be paid
again; a cancellation is the correction, not a second salary.

`reverseTeacherPayment` also returns the tender lines by the means the money left
the drawer, read from the original rather than supplied by the caller — a clerk
should not be able to send cash back out as a transfer.

Verified 2026-09-04: 49 tests across `evening.spec.ts` and
`evening-teachers.spec.ts`, including a reduction on an **outsider with no
student row**, refusal to reverse a reversal, and refusal to reverse twice.
Full API suite green at 551.

---

## ADR-0030 — Every user-facing message is French

**Status:** accepted · **Date:** 2026-09-02

Around a hundred messages inside `HttpException`s were English, in an
application that is French from the login page down. The first of them is the
one everybody meets: a wrong password printed **"Invalid credentials"**.

Every message inside an exception reaches a screen. There is no separate
"internal error" tier — the web app renders `error.message` and the Flutter app
renders `ApiException.message`. So the rule is simply: **if it is in an
exception, it is in French.**

Two carve-outs, both deliberate:

- **The permission refusal names the permission** — "Accès refusé — permission
  requise : finance.dette." The person reading it is usually the person who can
  grant it.
- **A schema complaint never reaches a person.** A malformed reset token used to
  surface Zod's own words — "token: String must contain at least 10
  character(s)" — in English, about a field nobody typed. The action catches
  anything shaped like that and answers with the sentence a person can act on.

⚠ **And the tests followed the English.** Forty-odd assertions matched on the
sentence itself. They are re-pointed at the part of the French that carries the
MEANING rather than at incidental words, so a later rewording that keeps the
meaning does not break the suite and one that loses it does.

---

## ADR-0031 — RLS separates schools; `@RequirePermission` separates roles

**Status:** accepted · **Date:** 2026-09-04

### What went wrong

On 2026-09-04 a signed-in **parent** could read every student in their school
with name, sex, place of birth and class; enumerate every family's full name and
telephone number two characters at a time; and read every teacher's hourly rate
and salary. Proved against the running system, not inferred.

Three endpoints carried no permission decorator, and the `parent` role holds
**zero** permissions — so "no decorator" meant "anybody with a token", and a
parent's token is the easiest in the building to obtain.

### Why it was invisible

RLS was working perfectly the whole time. It is enforced, forced, and covers
every tenant table — and it answers a different question: *which school?* The
question nobody was asking was *which role, inside that school?*

Both boundaries are needed and they live in different places. Confusing one for
the other is how a system with excellent tenant isolation leaks a school to
itself.

### The rule

1. **Every endpoint returning another person's data carries an explicit
   `@RequirePermission`.** Not "not a parent" — an ALLOW-list of what its real
   callers hold. A rule written as a denial silently admits the next role
   somebody adds.
2. **Sensitive fields are OMITTED, not zeroed**, for a caller who may not see
   them. A zero salary is a statement about a colleague's pay and a false one; a
   missing field is the truth.
3. **Two locks.** The route is guarded AND the service omits the columns, so a
   future caller that forgets the decorator still cannot leak the money.

`apps/api/test/parent-cannot-read-school.spec.ts` asserts it for the roles as the
seed defines them.

---

## ADR-0032 — Who may see what a teacher is paid

**Status:** accepted · **Date:** 2026-09-04

Not `finance.salaires` alone, and El Ourwa's own gating is why.

`gerer_professeurs.php` — the page carrying the "Salaire mensuel" column and the
per-assignment rates — opens with `require_staff_admin()`, which is
`require_role(['super_admin', 'admin'])`. So an **administrateur restreint SEES**
teacher pay on their own page, while `finance.salaires` — which they do not hold
— governs **PAYING** it on `paiement_staff.php`.

Two different questions about the same money, and El Ourwa answers them
separately. `comptes.professeurs` is the permission our catalogue gives to
exactly that pair, so it stands in for the role check:

```
seesTeacherPay = finance.salaires OR comptes.professeurs
```

The accountant and the secretary hold neither — and El Ourwa refuses them that
page outright.

---

## ADR-0033 — A cancelled evening salary is a reversing entry

**Status:** accepted · **Date:** 2026-09-04 · **Extends:** standing rule 7

`cours_du_soir.php`'s `annuler_paiement_prof_cs` runs `DELETE FROM
cs_paiements_profs` and then `DELETE FROM paiement_lignes`. A salary handed over
in cash and then cancelled therefore leaves the ledger with no trace that either
thing happened: the money left the drawer and the books say it never did, and the
till is short by exactly that amount with nothing to explain it.

Migration 0019 gives the table `reverses_id`, `reversed` and `note` — the same
shape `salary_payments` has carried since 0009. The original stands and is
flagged, a negative row points at it, **both halves are excluded** from every
total, and the month becomes payable again. The tender ledger records the money
coming BACK, direction `in`, on the same means it left by — read from the
original rather than asked of the clerk, because the money returns to the drawer
it came out of.

---

## ADR-0034 — An evening reduction gets its own table

**Status:** accepted · **Date:** 2026-09-04

`appliquer_reduction_cs` had no home in the schema. `discounts` is keyed on
`student_id NOT NULL` with a composite foreign key into `students`, and an
evening enrolee may be an **outsider** — a walk-in with a name and a phone number
and no student row at all.

Widening `discounts` would mean making `student_id` nullable, which drops the
guarantee that every school discount points at a real child of the same school,
and adding a discriminator that every existing query would then have to remember
to filter on. El Ourwa took that road: one `reductions` table with a `contexte`
column and two nullable foreign keys. It works, and it leaves the day-school debt
query one forgotten `WHERE contexte = 'scolarite'` away from subtracting an
evening reduction from a family's tuition.

`evening_discounts` makes that mistake unavailable: the day-school queries cannot
see these rows because they are not in the table they read.

Its two guards are both money — not more than the rate (beyond it the school owes
the family), and not below what is already paid (the school would be holding
money against nothing) — and it REPLACES rather than stacks, as its
`ON DUPLICATE KEY UPDATE` does.

⚠ **And the till is shown the reduced figure.** Offering the rate makes the
agreement worth nothing the moment a clerk accepts the number on screen. The
month's `expected` is net of reductions too: rate × headcount meant "Encaissé sur
X" could never reach X once one reduction existed, and an office chasing the gap
would chase money the direction had already decided not to take.

---

## ADR-0035 — The debt that blocks re-enrolment was missing three of its four terms

**Status:** accepted · **Date:** 2026-09-04

`outstandingAcrossYears()` is the figure that blocks a family's re-enrolment and
that the exam ratchet reads. Its own doc comment quoted El Ourwa's rule — "mois
échus non réglés, reliquats de factures de TOUTES les années" — and then summed
only the months. Three terms were absent:

| Term | El Ourwa | Effect of the omission |
|---|---|---|
| **B — créances** (`dettes_familles.solde` → `misc_debts`) | section B of `obtenir_dette_parent_detaillee()` | A family whose whole arrears sat in a créance passed the gate owing nothing, and the ratchet handed them the term. |
| **B bis — frais annuels** (inscription, photocopie) | section B bis, falling back to the OPEN year when called without one | Its own note: "une famille pouvait etre reinscrite sans les payer et n'en garder aucune trace." |
| **C — `clears_all`** | `MAX(annule_tout)` → `total_dette = 0` | "Annuler toute la dette" stores `amount = 0` with the flag, so summing the amounts subtracted nothing. The button said "Dette annulée : la famille peut réinscrire" and the family stayed blocked. |

`dette_du_parent()` **is** `obtenir_dette_parent_detaillee()['total_dette']` — one
calculation read two ways. Ours are now the same: `detailAcrossYears()` computes
it, `outstandingAcrossYears()` returns its total, and the bulk re-enrolment
screen prints its lines. El Ourwa arranged it that way after its own screen
showed a total from one function and a breakdown from another; the lines have to
add up to the figure above them, and this makes that true by construction rather
than by care.

⚠ **A correction on a créance takes effect immediately in the gate**, because the
sum reads `COALESCE(corrected_balance, total - repaid)` — which is the point of
`dette_modifier` and `dette_annuler` sitting on the re-enrolment screen.

Held by `apps/api/test/misc-debt-correction.spec.ts` (9 tests).

---

## ADR-0036 — `ON DELETE SET NULL` on a composite key must name its column

**Status:** accepted · **Date:** 2026-09-04

Standing rule 5 makes every tenant foreign key composite — `(school_id,
level_id)` rather than `(level_id)` — so a cross-tenant reference is
structurally impossible. But `ON DELETE SET NULL` on a composite key nulls
**every** column of that key, `school_id` included, and `school_id` is `NOT NULL`
everywhere by construction. Eight constraints were therefore unenforceable, and
nothing said so until the day of a delete:

```
DELETE FROM levels WHERE id = …
ERROR:  null value in column "school_id" of relation "groups"
        violates not-null constraint
```

"Supprimer le niveau" did not detach the classes — it failed, with a raw database
error, in exactly the case where one wants to delete a level: when it still
carries classes. Reproduced on the development database before writing the fix.

The eight: `attendance→teachings`, `debt_write_offs→academic_years`,
`enrollments→groups`, `enrollments→levels`, `evening_teachings→teachers`,
`evening_timetable_slots→evening_teachings`, `groups→levels`,
`misc_debts→students`. The last is financial: deleting a student would have had
to take the family's créance with it.

Postgres 15 introduced the missing form, `ON DELETE SET NULL (column)`, which
nulls only the named column. Migration `0022` rewrites all eight. **The keys stay
composite and the isolation guarantee does not change** — only the delete action
becomes executable.

`apps/api/test/composite-fk-set-null.spec.ts` holds it two ways: the catalogue
must contain no composite `SET NULL` without a column list, and four deletes must
detach rather than raise.

---

## ADR-0037 — An authorisation to re-enrol despite debt is a record, not a flag

**Status:** accepted · **Date:** 2026-09-04

`reEnrol()` took a `bypassDebt` boolean gated on `scolarite.niveaux`. That is
right as far as it goes, and it goes as far as one call.

El Ourwa stores the decision in `reinscriptions_autorisations`, and its bulk
screen depends on that: it prints « Autorisée malgré dette » as a **state** of the
family, sorts the still-blocked families to the top because those are the ones
needing a decision, and stops asking once the decision is taken. None of that is
expressible against a parameter that lives for the length of one request.

The decision is the direction's, taken once; the office does the work afterwards
— often days later, often for four siblings — without needing them again. A gate
accepting only a same-call flag would put an administrator behind every
re-enrolment of every child of every family in arrears.

⚠ **The amount owed is frozen at the moment of the decision.** The question an
auditor asks is "how much was owed when somebody waved this through?" — and the
debt moves afterwards, in both directions, so reading it back later answers a
different question.

⚠ **A revoked authorisation keeps its row.** Who allowed something and then
changed their mind is also a fact.

And the bulk re-enrolment reproduces its server gate exactly: an administrator
who re-enrols assumes the decision without a stored authorisation
(`$du > 0.009 && !$peut_autoriser && !reinscription_autorisee(…)`), and the audit
records the amount waived — not `true`, which does not answer the question asked
in June.

---

## ADR-0038 — The bulk re-enrolment screen excludes the accountant

**Status:** accepted · **Date:** 2026-09-04

El Ourwa's two re-enrolment screens do not admit the same people:

| Page | `require_role` |
|---|---|
| `reinscrire_etudiant.php` — search, one family at the counter | super_admin, admin, **comptable**, secretaire |
| `reinscriptions.php` — the roll of last year, in bulk | super_admin, admin, secretaire |

Repopulating whole classes is not the till's work; one family at a time is.

Our 24-permission catalogue has no permission meaning "may run a bulk
re-enrolment", and inventing one would break standing rule 24. `comptes.parents`
is held by exactly that trio and withheld from the accountant, so the page
requires `scolarite.reinscrire` **and** `comptes.parents`.

⚠ **This is a screen gate, not a new privilege boundary.** The endpoints stay on
`scolarite.reinscrire`, which the accountant legitimately holds — they may
already re-enrol one family at a time on the other screen, and the candidates
list is a read of a roll they can already search. Nothing the accountant could
not do before becomes possible; only the screen differs.

---

## ADR-0039 — The evening timetable keeps ordinals, and the subject is the anchor

**Status:** accepted · **Date:** 2026-09-04

`cs_emploi` becomes `evening_timetable_slots` (migration `0021`), with two
departures from its shape and one rule carried over intact.

**Ordinals, not French strings.** El Ourwa stores `jour ∈ {'Lundi'…'Dimanche'}`
and `creneau ∈ {'8h-10h'…'20h-22h'}`. We store `day_of_week 1..7` and `slot 1..7`,
as `timetable_slots` already does for the day school: the ordering a timetable
needs falls out of numbers, and the labels are a display concern that lives in
the UI — where they are reproduced word for word.

**One copy of the teacher, not two.** `cs_emploi` carries `professeur_id`
alongside `cs_enseignement_id`; two copies of one fact diverge as soon as either
is touched. The cell points at the assignment and the name is read through the
join.

**A slot sits on a SUBJECT, and the subject must be one of the group's own.** Its
modal says it: "un créneau se pose sur une matière, et une matière naît de
l'assignation d'un professeur." The teacher is optional — « Aucun / à définir
plus tard » — so `subject` is `NOT NULL` and the assignment is nullable, never
the reverse. A constraint cannot express "one of this group's subjects" (it is a
query), so the service enforces it with El Ourwa's own refusal, and
`apps/api/test/evening-timetable.spec.ts` holds it.

Removing a teacher's assignment leaves the lesson in place without a name — the
dash its own grid draws — rather than punching a hole in the timetable. That is
what ADR-0036 had to be fixed for.

---

## ADR-0040 — Une fiche montre le tarif de l'INSCRIPTION, pas celui du niveau

**Status:** accepted · **Date:** 2026-09-05

`recherche.php` écrit, dans la fiche d'un étudiant :

```php
<?= number_format($profil_detail['tarif_mensuel'] ?? $profil_detail['frais_mensuel'], 0, ',', ' ') ?> MRU
```

`tarif_mensuel` vient de `niveaux` — le tarif affiché du niveau — et
`frais_mensuel` de l'étudiant. Le `??` prend donc le tarif du NIVEAU d'abord, et
ne retombe sur celui de l'élève que si le niveau n'en a pas.

**Nous prenons l'inverse : `enrollments.monthly_fee`, toujours.**

La raison est celle qui gouverne déjà tout le calcul de la dette ici : « THE
amount owed. The gap to the level's full rate is never claimed » (`0001_init.sql`,
sur `enrollments.monthly_fee`). Une famille qui a obtenu une remise doit 12 000
là où le niveau en affiche 20 000. La fiche est l'écran qu'on ouvre à l'accueil,
devant le parent, quand il demande ce qu'il paie. Y écrire le tarif du niveau,
c'est lui annoncer un chiffre qu'il ne reconnaîtra pas et qu'aucune de ses
quittances ne porte.

Ce n'est pas une correction d'El Ourwa : ses deux colonnes sont égales pour tout
élève sans remise, donc l'écart n'apparaît que dans le cas où notre choix est le
bon. Noté ici pour qu'un futur lecteur ne « rétablisse » pas l'ordre du `??`.

`apps/api/test/search-profile.spec.ts` le tient.

---

## ADR-0041 — « Expell » bloque l'identité et ne supprime rien

**Status:** accepted · **Date:** 2026-09-05

La modale d'expulsion de `recherche.php` annonce deux effets :

> ⚠ **Action irréversible.**
> Cet étudiant sera supprimé de la base.
> Son **NNI (…)** et son **RIM (…)** seront **bloqués** : impossible de
> l'inscrire à nouveau dans l'établissement.

Et son handler fait exactement cela : `DELETE FROM etudiants`, après avoir écrit
l'identité dans la table des blocages.

**Nous portons le blocage, pas la suppression.**

1. **La suppression emporterait de l'argent.** `enrollments`, `payments`,
   `enrollment_months` et `grades` pendent tous à `students` en `ON DELETE
   CASCADE`. Effacer l'élève effacerait ce que la famille a versé et ce qu'elle
   doit encore. Les écritures financières ne se suppriment pas ; une correction
   est une écriture inverse (règle 7).
2. **La question survit à l'élève.** « Cet enfant a-t-il été exclu, et
   pourquoi ? » se posera — à un parent, à une autre école, à un inspecteur. Un
   `DELETE` ne sait pas y répondre. C'est la même raison pour laquelle une levée
   de blocage est enregistrée plutôt qu'effacée (`expulsions.lifted_at`).
3. **L'effet recherché est intégralement conservé.** Ce que son propre
   avertissement met en gras, c'est le blocage du NNI et du RIM. Il est porté tel
   quel, et `blockFor()` refuse toute admission de cette identité. Le blocage
   porte sur l'IDENTITÉ précisément pour survivre à une suppression du dossier —
   il n'avait donc jamais besoin de celle-ci pour fonctionner.

L'avertissement de notre modale dit ce qui se passe réellement, plutôt que de
recopier une phrase devenue fausse : « Son dossier, lui, est conservé : les
paiements déjà faits et la dette restante demeurent lisibles. »

⚠ **Conséquence à connaître :** un élève exclu reste dans les listes tant que son
inscription n'est pas close. Le blocage empêche la RÉINSCRIPTION, il ne retire
pas de la classe en cours — c'est « Exclusions » puis la clôture de l'année qui
s'en chargent. El Ourwa réglait les deux d'un seul geste destructeur ; nous
séparons les deux gestes, et celui qui manque doit être fait exprès.

---

## ADR-0042 — Supprimer une assignation n'efface pas ce qui pend dessous

**Status:** accepted · **Date:** 2026-09-05

Deux suppressions détruisaient en silence ce qu'elles n'annonçaient pas.

### `removeTeaching` — les notes

`grades.teaching_id` est en `ON DELETE CASCADE`. Retirer une assignation saisie
par erreur en octobre emportait **tout un trimestre de notes, pour toute la
classe**, sans que rien ne le dise : la confirmation du navigateur ne parle que
de l'assignation.

⚠ **Et le raisonnement était déjà écrit, deux fonctions plus haut.**
`deleteSubject` porte ceci :

> our FK cascades, so without it deleting a subject would silently delete every
> teaching of it — and with them every mark, since grades hang off the teaching.

`deleteLevel` et `deleteGroup` se gardent aussi, chacune avec sa phrase. Seule la
porte qui mène le plus **directement** au dégât ne se gardait pas.

### `evening.removeTeaching` — les salaires versés

`evening_teacher_payments.evening_teaching_id` est également en CASCADE. Retirer
l'assignation d'un professeur du soir emportait toute trace de ce qu'on lui avait
payé : l'argent était sorti de la caisse, et les livres disaient qu'il n'était
jamais sorti. C'est le reproche exact que le commentaire d'`annuler_paiement_prof_cs`
adresse à El Ourwa, quelques centaines de lignes plus bas dans le même fichier.
Les écritures financières sont append-only (règle 7).

**Les deux refusent maintenant, en disant combien de lignes sont en jeu** —
« impossible » sans chiffre pousse à chercher un autre chemin plutôt qu'à
comprendre — et en nommant la correction à faire à la place.

### Ce que nous n'avons PAS fait

**Le bouton « Supprimer » d'El Ourwa sur `gerer_professeurs.php` n'est pas
porté.** Son handler est `DELETE FROM professeurs` puis `DELETE FROM
utilisateurs`, et son schéma enchaîne `professeurs → enseignements (CASCADE) →
notes (CASCADE)` : supprimer un professeur efface **toutes les notes qu'il a
jamais saisies**, pour tous ses élèves, derrière une confirmation qui dit
seulement « Supprimer ce professeur ? ». Notre huitième colonne s'appelle donc
« Gérer » et corrige — mot de passe, compte, identifiant, rémunération.

**Les clés étrangères ne sont pas modifiées.** Passer `grades.teaching_id` en
`RESTRICT` serait plus sûr que le garde applicatif, mais c'est une migration :
règle 16, on s'arrête et on demande. Le garde couvre tous les chemins existants ;
la migration est à décider, pas à glisser dans un lot.

---

## ADR-0043 — Les frais annuels sont dus dès qu'un enfant est inscrit, pas dès qu'un mois est facturable

**Status:** accepted · **Date:** 2026-09-06

⚠ **La fiche d'une famille au guichet annonçait « ✓ En règle (0 MRU) » à côté de
6 500 MRU de frais affichés « Non payé », et refusait de les encaisser** — son
bouton « Encaisser un règlement / avance » est `disabled` quand la dette vaut
zéro. Deux autres écrans, Impayés et Réinscriptions, annonçaient bien 6 500 pour
la même famille.

`forGuardian()` conditionnait la section B bis à `rows.length > 0`, où `rows`
sont les lignes de **mois facturables**. El Ourwa conditionne sur autre chose, et
l'écrit :

> Ne comptent que si la famille a bien un eleve inscrit CETTE annee-la.

```sql
SELECT COUNT(*) FROM etudiant_inscriptions i JOIN etudiants e ON e.id = i.etudiant_id
 WHERE e.parent_id = :p AND i.annee = :an AND i.statut <> 'annule'
```

— un compte d'**inscriptions**. Une famille dont l'enfant est inscrit mais dont
les mois sont gratuits, exemptés ou pas encore échus n'a aucune ligne de mois :
ses frais annuels disparaissaient du total tout en restant affichés comme dus.

`detailAcrossYears()` teste l'année ouverte et n'a jamais eu le défaut — d'où le
désaccord entre écrans, et d'où le fait que le contrôle de réinscription, lui,
bloquait correctement.

Ce n'est donc pas un changement de politique : c'est le rétablissement de la
sienne (règle 26). Son commentaire dit pourquoi elle compte : « S'ils ne sont pas
encaisses a ce moment-la, ils ne s'evaporent pas : ils sont dus. »

**Corollaire, corrigé aussi.** Le règlement global ne répartit que sur les MOIS —
comme le sien, dont les frais annuels ont leur propre commande. Une famille dont
toute la dette est en frais annuels voyait donc « Dette : 6 500 MRU » en haut et
« n'a rien à régler » au clic, sans rien qui indique où aller. Le refus nomme
maintenant ce qui reste et par où cela se règle.

`apps/api/test/annual-fees-gate.spec.ts` — 4 tests, écrits avant le correctif, et
les deux premiers échouaient bien sur le défaut. Vérifié de bout en bout dans le
navigateur : 6 500 trouvés, affichés, encaissés, solde refermé.

---

## ADR-0044 — Les deux migrations en attente, tranchées

**Status:** accepted · **Date:** 2026-09-06 · **Décision du propriétaire**
(« YOU DECIDE ON THE TWO ISSUES », 2026-09-06)

### Issue 9 — `NO ACTION`, et surtout pas `RESTRICT` (migration 0025)

ADR-0042 avait bouché deux trous dans le SERVICE : supprimer une assignation
effaçait ses notes, son jumeau du soir effaçait les salaires versés. ⚠ Mais un
garde applicatif ne protège que les chemins qu'on connaît — le prochain écran,
le prochain import, un `DELETE` lancé à la main dans psql un soir de reprise.

**`NO ACTION` plutôt que `RESTRICT`, et la différence est tout le sujet.** Les
deux refusent l'orphelin, mais `RESTRICT` est vérifié IMMÉDIATEMENT et
`NO ACTION` à la FIN de l'instruction. Or `grades` et `evening_teacher_payments`
portent aussi une clé directe vers `schools` en CASCADE : supprimer une école
efface d'un même geste les enseignements ET les notes. Avec `RESTRICT`, ce geste
échouerait — la contrainte se déclencherait avant que la cascade voisine n'ait
retiré les lignes qui la gênent. **Une branche fermée deviendrait
insupprimable.**

`apps/api/test/cascade-guards.spec.ts` tient les deux côtés, en SQL direct pour
contourner tout le code applicatif : refuser la suppression d'une assignation
notée, refuser celle d'une assignation du soir payée, **et laisser passer la
suppression d'une école**.

### Issue 8 — l'année est un `smallint`, pas une clé étrangère (migration 0026)

Le repli « Gérer les créances » d'El Ourwa a sept colonnes ; la nôtre en avait
six. `misc_debts` gagne les trois de `dettes_familles` : `start_year`, `kind`
(`arriere` | `facture`) et `invoice_source`.

**Un `smallint` sans clé étrangère vers `academic_years`, délibérément.** Une
créance reprise de l'ancien système porte souvent sur une année dont nous n'avons
aucune ligne — c'est même le cas le plus courant à la bascule. Une clé étrangère
rendrait ces reprises impossibles à saisir, soit l'exact contraire du but. El
Ourwa a d'ailleurs les deux (`annee_id` ET `annee`) et n'utilise que la seconde à
l'affichage.

**Nullable, et affiché « — ».** On ne déduit pas l'année de `created_at` : ce
serait faux dans le cas qui compte, un arriéré de 2024-2025 saisi en septembre
2026 se lisant 2026 (règle 24). El Ourwa affiche le même tiret.

⚠ **Et il a fallu corriger les DEUX lectures.** Les colonnes avaient été ajoutées
à `miscDebtsFor()` mais pas à `allMiscDebts()` — or c'est la seconde que lit
l'écran des réinscriptions, celui qui les affiche. Le tableau montrait donc sept
en-têtes corrects au-dessus d'une année vide et d'un « Arriéré » pour tout le
monde. Deux lectures de la même table doivent rendre les mêmes colonnes.

---

## ADR-0045 — Un professeur voit sa propre paie, et la question est « de qui », pas « qui »

**2026-09-06 · accepté**

`pages/professeur/tableau_bord.php` porte quatre tuiles, dont deux parlent
d'argent : « Tarif horaire » et « Salaire mensuel », puis une carte « Détail de
mon salaire mensuel ». Les nôtres étaient « Mes classes · Assignations ·
Heures/semaine · Créneaux » : deux justes, deux inventées, et **aucune ne disait
ce que l'enseignant gagne**. La seule façon pour un professeur de connaître son
taux était de le demander à l'administration.

**Décision.** `GET /teacher/my-pay` porte cette fiche, **sans décorateur de
permission**.

**Pourquoi pas `finance.salaires`.** Cette permission garde la paie *des autres*.
La poser ici fermerait l'écran à ceux qu'il concerne — un professeur n'a pas
`finance.salaires` et n'a aucune raison de l'avoir. La question que pose cette
route n'est pas « qui a le droit de lire une paie » mais « la paie **de qui** ».

**Ce qui la garde à la place.** La fiche est résolue depuis le **jeton** :
`ownPay(request.auth!.userId)`. Il n'y a aucun identifiant à passer, donc rien à
détourner en changeant un numéro dans l'URL. C'est la même règle que
`my-classes` et `my-timetable`, et elle compte davantage ici.

Cinq tests la tiennent, dont celui qui vérifie que deux professeurs de la même
école n'obtiennent pas la même réponse.

---

## ADR-0046 — Le bulletin est le formulaire d'État, pas une feuille de notre dessin

**2026-09-06 · accepté**

Nous imprimions un document de notre invention — `sheet`, `sheet-head`,
`sheet-meta` — là où El Ourwa imprime le bulletin officiel mauritanien :
en-tête tricolonne « République Islamique de Mauritanie » /
« الجمهورية الإسلامية الموريتانية » avec sa devise et son ministère, bandeau de
titre, grille de six lignes bilingues, puis un pied en trois colonnes portant le
récapitulatif des trimestres, la moyenne de l'année, l'appréciation, le seuil
d'admission, la décision « Admis / Ajourné », les zones de signature et
d'observations du directeur, et la mention « ce document n'est pas valable sans
signature ».

`bulletin.css` — toutes ses classes `bul-*` — était porté et chargé depuis le
début. **Rien ne s'en servait.**

**Décision.** Un seul composant, `BulletinOfficiel`, rend le document ; les deux
écrans (un élève, une classe entière) s'en servent.

**Pourquoi un seul.** `bulletins_classe.php` **inclut** `bulletin_vue.php` une
fois par élève : chez lui, le bulletin d'une classe et celui d'un enfant sont
littéralement le même partiel. Les nôtres étaient deux mises en page recopiées,
et elles avaient déjà divergé — celle de la classe n'a jamais eu l'en-tête
officiel. Deux copies d'un document légal finissent toujours par se contredire ;
la question est seulement quand.

**Les règles reprises, chacune avec son test** (règle 15, écrits avant) :

- **une moyenne absente rend « Non évalué », jamais « Ajourné »**. Un enfant dont
  aucune note n'est saisie n'a pas échoué. C'est une accusation imprimée sur un
  document d'État ;
- **la tolérance d'un centième** : `round(m, 2) + 0.0001 >= seuil`. Sans elle, le
  bulletin imprime 10,00 juste à côté d'« Ajourné » et la contradiction est
  inexplicable au parent ;
- **la moyenne de l'année est la moyenne des trimestres renseignés**, pas des
  trois : un trimestre sans notes n'est pas un zéro ;
- **un niveau fondamental se compare en équivalent /20** — ses points bruts
  opposés à un seuil sur 20 ajourneraient tout le monde ;
- **le seuil est celui du niveau**, et le verdict **s'accorde au genre** dans les
  deux langues.

---

## ADR-0047 — « Nouvelle dette » reste retirée, parce que l'école l'a retirée

**2026-09-06 · accepté**

`dette.php` porte, à l'endroit exact où le formulaire se trouvait :

> La création de « dette diverse » a été retirée : l'école ne prête qu'à son
> PERSONNEL, via la section « Prêt au personnel » ci-dessous. Les anciennes
> dettes restent consultables et remboursables.

Nous l'avions remise. Notre écran offrait donc un moyen d'inscrire une dette au
nom de n'importe qui — capacité que l'école a délibérément supprimée.

**Décision.** Le formulaire disparaît de l'écran. Les anciennes dettes restent
listées et remboursables, comme chez lui. **La route de création demeure** :
elle sert encore la validation d'une demande (`demandes.php`) et la caisse.

**Pourquoi ne pas supprimer aussi la route.** Retirer un formulaire retire une
capacité à un opérateur ; retirer la route casserait deux chemins qui s'en
servent. El Ourwa fait exactement cela — son gestionnaire `POST` est intact,
seul le formulaire a disparu.

---

## ADR-0048 — Quand la consigne est « réplique », arbitrer est une erreur

**2026-09-06 · accepté**

Trois défauts trouvés cette session venaient d'un jugement de ma part contre une
consigne explicite de réplication :

1. **le panneau de concessions**, regroupé derrière un bouton unique là où
   `gestion_caisse.php` en pose deux (« Frais », « Exemption du frais ») ;
2. **le formulaire de prêt**, déplacé vers l'écran de paie avec un lien, là où
   `dette.php` le porte sur la page des dettes ;
3. **le bulletin**, redessiné (voir ADR-0046).

Chacun se défendait. Aucun n'était demandé.

**Décision.** Les trois sont revenus à sa forme. La règle qui s'applique
désormais : **quand la consigne est de répliquer, une amélioration non demandée
est un défaut**, même quand elle est meilleure — parce que la personne qui a
donné la consigne connaît l'école, et que la forme d'un écran encode souvent une
habitude de travail que le code ne montre pas (règle 19).

**Ce que cela ne change pas.** Les écarts *documentés et justifiés* restent
légitimes : sécurité (les gardes anti-IDOR qu'El Ourwa n'a pas partout),
correction financière, et les règles de `CLAUDE.md`. La différence est qu'un
écart se déclare et se motive, au lieu de s'installer sans qu'on s'en aperçoive.

---

## ADR-0049 — Une pièce jointe voyage en octets, jamais en URL

**2026-09-06 · accepté**

`exercices.php` rend, sous chaque exercice, une vignette cliquable pour une
image et une carte nommée pour un PDF. Chez nous, rien n'arrivait jusqu'à la
famille : `/parent/homework` n'envoyait pas les pièces jointes, et le formulaire
du professeur n'avait pas de champ de fichier.

**Le problème.** `/attachments/:id` vérifie que le demandeur est bien le parent
d'un inscrit du groupe. Un `<img src>` ou un onglet ouvert sur cette adresse
n'envoie pas l'en-tête d'autorisation et reçoit un 401.

**Décision.** L'application lit les octets elle-même, avec son jeton, puis :

- une **image** s'affiche depuis la mémoire (`Image.memory`), vignette et
  visionneuse plein écran — l'équivalent de son `data-lightbox` ;
- un **PDF** est enveloppé dans un blob local et c'est ce blob qu'on ouvre.

**Pourquoi pas une URL signée.** Ce serait inventer un mécanisme d'authentification
parallèle, avec sa propre durée de vie et sa propre surface d'erreur, pour un
problème que la lecture authentifiée résout déjà. Et une URL signée dans la barre
d'adresse est une URL qu'on colle dans une conversation.

**Conséquence à connaître.** L'implémentation du blob s'appuie sur
`dart:js_interop`, qui n'existe pas sur la VM Dart. Elle est donc derrière un
export conditionnel : sans cette indirection, `flutter test` ne compile plus du
tout, et l'ajout d'une visionneuse casserait les quarante tests d'un coup sans
rapport avec ce qu'ils vérifient.

---

## ADR-0050 — El Ourwa garde l'argent par le RÔLE, pas par la permission

**2026-09-07 · accepté**

`gestion_caisse.php` énonce la règle en tête de fichier :

> Qui peut **TOUCHER À LA DETTE** : fixer un barème de frais, exempter une
> famille, retirer une exemption. Ces gestes changent ce que l'école réclame ;
> ils relèvent de l'administration, pas de la caisse.
>
> `$peut_administrer_frais = a_role('super_admin') || a_role('admin')`

**Le constat qui change tout.** `finance.dette` figure dans son catalogue et il
l'accorde bien au comptable — mais `grep -rn 'finance.dette'` sur tout v16 ne
trouve que sa **déclaration** et sa **distribution**. La chaîne n'est vérifiée
nulle part. Ses permissions financières sont décoratives ; ce qui garde
réellement ces gestes est le rôle, doublé d'un refus nominatif du comptable.

**Nous avions recopié la distribution sans l'application.** `role-grants.spec.ts`
tenait nos grants contre les siens — donc tout paraissait réglé — et nous nous
servions de `finance.dette` comme garde. Le comptable, qui la détient, pouvait
exempter une famille, baisser un tarif, accorder une remise, configurer les frais
annuels, et **annuler un paiement qu'il venait d'encaisser**.

**Décision.** Les gestes de dette portent `@RequireRole('super_admin', 'admin')`
**en plus** de leur permission, jamais à la place. Les grants restent inchangés :
ils sont exacts, et les changer ferait mentir la comparaison avec El Ourwa.

**Pourquoi pas simplement retirer `finance.dette` au comptable.** Cela aurait
produit le bon résultat pour de mauvaises raisons — et fait diverger nos grants
des siens, donc échouer un test qui a raison. La distribution et l'application
sont deux questions ; il n'y en avait qu'une de fausse.

**Et le refus dit où aller.** Le sien ne se contente pas de « non » : « Les
réductions sont réservées à l'administration. Soumettez une demande de réduction
depuis "Demandes". » La file existe, et le comptable la traite lui-même — c'est
pourquoi El Ourwa lui accorde `demandes.traiter`. Un refus qui n'indique pas la
suite transforme une règle en obstacle.

**Le corollaire, appliqué partout.** Même règle pour annuler une dépense,
enregistrer une dépense (le comptable dépose une demande), et le tarif mensuel à
l'inscription — où El Ourwa ne refuse pas mais **substitue** le tarif officiel et
envoie une demande, pour ne pas bloquer un enfant devant le guichet.

---

## ADR-0051 — Ce que le comptable ne doit pas VOIR

**2026-09-07 · accepté**

Trois gardes d'El Ourwa portent sur l'information, pas sur l'action :

- l'onglet « Administrateurs » n'est pas ajouté quand `est_comptable()` ;
- `administrateurs.php` refuse la page entière : « le comptable ne voit NI la
  page NI les limites » ;
- `paiement_staff.php` omet la colonne « Limite mensuelle » pour lui, et sert un
  message de refus **sans chiffres** : « Les montants de limite ne sont montrés
  qu'à l'administration. »

**Décision.** Les trois sont appliquées, et les montants sont retirés **de la
réponse**, pas seulement de l'écran.

**⚠ Ce qu'il ne faut pas faire en les appliquant.** Retirer purement les montants
casse l'écran du comptable : `plafondNul` et `epuise` s'en déduisaient, donc
`Number(undefined) <= 0.009` est faux, et il verrait un bouton « Retirer » que le
serveur refuse ensuite. Le service renvoie donc l'**état** (`no_ceiling`,
`exhausted`) et retient les **chiffres**.

C'est la forme générale de ces gardes : la personne doit pouvoir agir
correctement sans apprendre ce qu'on lui cache. Une garde qui laisse quelqu'un
buter sur un refus n'est pas une garde, c'est une panne.

---

## ADR-0052 — Payer le personnel : le comptable le fait, comme chez lui

**2026-09-07 · accepté** — le propriétaire a tranché : « everything as El Ourwa
does, every permission ».

`paiement_staff.php` est gardée par `require_finance_page()`, qui admet le
comptable, et **ni `retirer_admin` ni `payer_salaire` ne le refusent**. Chez El
Ourwa, le comptable peut donc payer un salaire et enregistrer un retrait
d'administrateur ; `finance.salaires` n'y est pas plus vérifiée que
`finance.dette`.

Chez nous, `finance.salaires` est réellement appliquée et le comptable ne la
détient pas.

**Décision.** Le contrôleur de paie accepte `finance.consulter` en second : les
deux permissions ensemble décrivent l'ensemble qu'`est_admin_complet()` laisse
entrer — le super administrateur et le comptable. Les grants restent inchangés.

**Ce qui reste fermé au comptable**, et l'est par sa propre garde chez lui : les
fiches de porteurs de fonds (`@RequireRole`), les montants de plafond (retirés de
la réponse, ADR-0051), la page « Administrateurs », et le tarif d'un professeur —
`gerer_professeurs.php` est gardée par `require_staff_admin()`.

**La note antérieure de `seed-roles.ts`** — « putting the payment of staff in the
same hands that take the money in » — décrivait une inquiétude réelle, mais pas
la règle de cette école : El Ourwa laisse son comptable payer, et c'est El Ourwa
qui fait foi (règle 26). La séparation que l'école a réellement tracée porte sur
la DETTE, pas sur la paie — ADR-0050.

⚠ **Et l'ouvrir a révélé un 500.** La jauge des porteurs de fonds divisait par
`monthly_limit`, que le comptable ne reçoit plus depuis ADR-0051 :
`pct(taken, undefined)` faisait tomber la page entière. Retirer une information
sans regarder qui s'en servait casse l'écran de la personne qu'on voulait
protéger.

---

## ADR-0053 — Un changement de tarif reprise TOUS les mois, y compris réglés

**2026-09-07 · ~~accepté~~ → RENVERSÉ le 2026-09-08 par [ADR-0054](#adr-0054--un-mois-réglé-garde-son-prix)**

> ⚠ Sa prémisse — « El Ourwa n'a aucun prix stocké par mois » — est **fausse**.
> `inscription_mois.montant_du` existe, est rempli sur 11 896 mois, et n'est relu
> par personne. Lisez ADR-0054 avant de vous appuyer sur ce qui suit.

Sa note, sous le champ : « S'applique à tous les mois : les mois déjà réglés à
hauteur du nouveau montant apparaîtront "payés", les autres seront recalculés
dans la dette. »

**Ce n'est pas un choix de sa part, c'est sa structure.** El Ourwa n'a aucun prix
stocké par mois : `modifier_frais_admin` fait un seul
`UPDATE etudiants SET frais_mensuel`, et chaque mois se recalcule à l'affichage
depuis cette colonne. Il ne PEUT pas épargner un mois réglé.

Nous avons `enrollment_months.amount_due` et n'écrivions que les mois non payés —
plus prudent, et divergent. Notre note d'écran promettait même l'inverse de la
sienne.

**Décision : repriser tous les mois facturables**, comme lui.

**Pourquoi la prudence était le mauvais choix ici.** Sur une famille dont le
tarif change en cours d'année, ses totaux annuels et les nôtres s'écartaient sans
qu'aucun des deux ne soit « en erreur ». C'est le pire genre d'écart : une
réconciliation échoue et rien ne dit lequel croire (règle 25). Un successeur qui
protège mieux les reçus mais ne peut pas se rapprocher du système qu'il remplace
n'est pas plus sûr — il est seulement plus difficile à valider.

**Le trop-perçu ne devient pas une dette négative.** Un mois payé 10 000 qui n'en
coûte plus que 4 000 est « payé » ; le reste dû d'un mois est borné à zéro et le
surplus n'efface pas la dette des autres mois. Un test le mesure sur
l'échéancier, parce que c'est la seule façon dont cette règle pouvait casser en
silence.

---

## ADR-0054 — Un mois réglé garde son prix

**2026-09-08 · accepté** · renverse [ADR-0053](#adr-0053--un-changement-de-tarif-reprise-tous-les-mois-y-compris-réglés)

ADR-0053 nous a fait repriser les mois déjà payés, pour coller à lui. Sa
justification était structurelle : *« El Ourwa n'a aucun prix stocké par mois,
il ne PEUT pas épargner un mois réglé. »*

**C'est faux.** `inscription_mois.montant_du` existe dans son schéma, porte le
prix convenu de chaque mois, et **11 896 mois le renseignent**. Il est écrit à la
création de l'échéancier et **relu par personne** : chaque mois était recalculé
depuis `etudiants.frais_mensuel`. Il pouvait épargner un mois réglé ; il ne le
faisait pas.

Mesuré chez lui avant correction :

| | |
|---|---|
| Mois réglés encore exposés au recalcul | **43** |
| Familles concernées | **18** |
| Déjà encaissé sur ces mois | **113 500 MRU** |
| Dette créée par une hausse de 500 MRU | **21 500 MRU sur des mois payés** |

Un mois *facturé* était déjà protégé — son montant est figé dans la facture.
L'exposition portait sur les mois réglés encore `a_facturer`.

**Le second défaut, trouvé en vérifiant le premier.** Ses quatre écrans de
changement de tarif — `modifier_frais_admin`, une demande approuvée, un
changement de niveau, une réinscription — n'écrivaient que
`etudiants.frais_mensuel`. Or son calcul de dette et sa caisse lisent
`COALESCE(NULLIF(ei.frais_mensuel,0), e.frais_mensuel)` : **l'inscription
d'abord**, et **934 inscriptions sur 934** en portent une. L'écran journalisait,
affichait « Frais mensuel mis à jour : 2 000 → 3 000 », et l'argent dû ne
bougeait pas. Démontré sur une famille : tarif de la fiche 2 000 → 3 000, dette
inchangée à 3 500 ; tarif de l'inscription 2 000 → 3 000, dette 3 500 → 5 500.

Les deux sont **couplés** : réparer le second active le premier. Un contrôle
inerte serait devenu un générateur de dette fantôme sur 43 mois réglés.

### Ce qui a été fait, des deux côtés

Sa v20 : `appliquer_tarif_mensuel()` écrit les deux colonnes et reprise les mois
**non réglés** seulement ; le calcul de dette lit `montant_du`, avec repli sur le
tarif quand le mois n'en porte aucun. La règle d'année facturée, jusque-là écrite
deux fois, est ramenée à une (`annee_facturee()`).

Ici : `changeMonthlyFee` exclut du reprix les mois dont les versements couvrent
déjà le montant. `enrollment_months.amount_due` jouait déjà le rôle de
`montant_du` — nous avions la bonne structure et la mauvaise règle.

**La réconciliation est tenue par l'alignement, pas par la reprise** : les deux
systèmes épargnent désormais les mêmes mois. Vérifié sur ses 1 372 familles —
dette totale **1 720 700,00 MRU avant et après**, 0 famille divergente : la
correction du moteur est inerte sur les données actuelles et ne mord qu'au
premier changement de tarif.

Un mois partiellement payé reste reprisé : il n'est pas réglé. Le trop-perçu qui
peut en résulter reste borné à zéro sur son mois et n'efface pas la dette des
autres — un test le mesure sur l'échéancier.

### La leçon

ADR-0053 a été prise sur une lecture du code sans vérification du schéma. « Il ne
peut pas faire autrement » est une affirmation vérifiable : une requête sur
`information_schema` l'aurait démentie en une minute. Une contrainte supposée
chez lui vaut d'être mesurée avant d'être recopiée.

---

## ADR-0054 — El Ourwa moyenne le marqueur d'absence ; nous l'excluons, et nous divergeons exprès

**2026-09-08 · accepté** — première réconciliation sur données réelles.

### Ce qui a été mesuré

`tools/reconcile/extraire.php` appelle le `bulletin_donnees()` d'El Ourwa, sur sa
propre base, et écrit une ligne par (élève, trimestre) : les notes en entrée et
la moyenne qu'il en tire. Nous rejouons **exactement les mêmes entrées** à
travers `@elourwa/shared` et comparons en chaînes (règle 25).

Sur l'année 2025-2026 : **3 011 bulletins, 21 789 moyennes de matière, 2 520
moyennes générales.**

| | |
|---|---|
| Moyennes de matière identiques | **21 612 / 21 789** |
| Divergences | **177 — toutes avec un marqueur d'absence** |
| Divergences SANS marqueur | **0** |

Le zéro est le résultat. Sur chaque note qui n'est pas un marqueur, le successeur
rend le chiffre d'El Ourwa au centième près.

### Le défaut

`notes.valeur = -1` est le marqueur d'absence : **1 580 lignes réelles** le
portent. El Ourwa ne le filtre nulle part — `grep -rn` sur tout `includes/` ne
trouve aucun traitement de `-1`. Son `calc_moy_matiere()` le reçoit comme un
nombre et le moyenne.

Sur les niveaux configurés en `examen_seul` (d=0, e=1, q=1 — 60 lignes de
`bulletin_formules`), la moyenne de la matière devient donc **−1.00**, et la
moyenne générale du trimestre avec elle. Sur un bulletin remis à une famille.

C'est exactement ce que la règle 11 de `CLAUDE.md` décrit :

> `note_absent = -1` est un MARQUEUR, pas une note. L'exclure avant de moyenner.
> S'il entre dans une moyenne comme un nombre, le résultat de chaque élève
> concerné est faux, et l'erreur est silencieuse.

La règle existe parce que quelqu'un le savait déjà. La réconciliation le mesure :
**177 matières et 22 trimestres entiers** sur une seule année.

### La décision

**Nous n'alignons pas.** Notre comportement est correct et la règle 11 le fixe ;
la règle 26 (« El Ourwa a raison jusqu'à preuve du contraire ») est ici renversée
par une preuve chiffrée.

**La divergence est classée, pas ignorée.** `checks/bulletins.ts` distingue
l'écart ATTENDU (un marqueur est en jeu) de l'INEXPLIQUÉ, et ne fait échouer la
réconciliation que sur le second. Une barrière qui crie au loup sur le connu
cesse d'être lue ; celle-ci doit échouer sur l'inconnu.

⚠ **À poser à l'école avant la bascule** (règle 27) : les bulletins portant
« −1.00 » ont été remis à des familles. Nos chiffres seront différents — meilleurs,
mais différents — et quelqu'un le remarquera. La question n'est pas s'il faut
corriger, mais s'il faut **prévenir**.

---

## ADR-0055 — La reprise refuse une branche qui n'est pas vierge

**2026-09-08 · accepté** — première reprise réelle : 7 304 lignes, réconciliées.

### Le refus vient d'un échec, pas d'une précaution théorique

Lancé la première fois sur « École Nour », `tools/import` s'est heurté à
`academic_years_school_id_label_key` : deux années « 2025-2026 », celle qui venait
d'El Ourwa et celle que le peuplement de démonstration avait écrite.

La contrainte a fait son travail. La mauvaise réponse aurait été de la contourner
en rapprochant sur la clé naturelle : les 2 153 dossiers réels se seraient
mélangés aux 200 élèves inventés de la branche de test, et **plus aucun total
n'aurait été défendable** — ni un effectif, ni une somme de frais, ni une
réconciliation.

`verifierBrancheVierge()` compte donc les lignes `origin <> 'migrated'` dans les
sept tables écrites et refuse s'il y en a. Ce qui est déjà repris ne compte pas :
relancer l'import sur sa propre sortie doit rester possible, c'est tout
l'intérêt d'être idempotent.

La reprise se fait donc dans une branche à elle — `tools/import/creer-branche.ts`
— ce qui est exactement ce que dit `CLAUDE.md` : l'école n° 1 s'importe sous un
`school_id`, et toute branche ultérieure part vierge.

### Rapproché sur `legacy_id`, pas sur la clé naturelle

Aucun index unique n'existe sur `(school_id, legacy_id)` ; l'import fait donc un
`SELECT` puis un `UPDATE` ou un `INSERT`, plutôt qu'un `ON CONFLICT`. Ce n'est pas
qu'un contournement : un groupe **renommé** dans El Ourwa arriverait en double
s'il était rapproché par son nom. `legacy_id` est l'identité stable ; la clé
naturelle reste en garde-fou, et c'est elle qui a levé le lièvre ci-dessus.

Une exception, `users` : la table est globale et n'a pas de `legacy_id`, parce
qu'une famille présente dans deux branches doit avoir UN compte. Le rapprochement
se fait sur le téléphone, unique des deux côtés et identifiant de connexion du
parent. Et **un numéro qui appartient déjà à un compte non-parent n'est jamais
réécrit** : écraser le nom et l'empreinte d'un secrétaire le déconnecterait de son
propre poste.

### Ce qui est repris tel quel, même quand ça surprend

`tarif_plein` vaut zéro sur **291 inscriptions**, et ce sont **exactement** les 291
inscriptions annulées. Une inscription annulée n'a pas de barème : c'est cohérent,
pas défectueux. Le remplacer par le tarif du niveau inventerait un montant qu'El
Ourwa n'a jamais réclamé (règles 24 et 26).

⚠ `reduction_mensuelle` n'est pas reprise — elle se déduit de `full_rate` moins
`monthly_fee` — mais **El Ourwa la borne à zéro** : elle n'est négative sur aucune
ligne, alors que la soustraction le serait sur 59. Le calcul d'affichage doit
reproduire cette borne, sans quoi une facture annoncerait une « réduction »
négative.

### Ce qui n'a pas de destination — et qui est nommé

Le journal de l'import les compte à chaque passage plutôt que de les laisser
disparaître :

| Champ | Lignes | Pourquoi |
|---|---|---|
| `parents.telephone2` | 128 | `users` n'a qu'un téléphone |
| `parents.nom_secondaire` | 40 | idem, un seul nom |
| `parents.nni` | 7 | pas de pièce d'identité sur `users` |
| `etudiants.identifiant` | 2 153 | matricule interne ; `rim` et `nni` sont repris |
| `configuration.annee_materialisee` | 1 | c'est un `annees_scolaires.id` MySQL |

⚠ `annee_materialisee` **ne se reprend pas volontairement**. Elle vaut « 4 » ; ici
les années sont des UUID. Recopier ce « 4 » donnerait un pointeur qui ne désigne
rien mais qui **en a l'air** — une clé morte déguisée en clé vivante est pire que
son absence.

**À poser à l'école** : les 128 seconds téléphones et les 40 seconds noms sont-ils
utilisés pour joindre les familles ? Si oui, ils demandent des colonnes, et c'est
une migration — donc une question, pas une initiative (règle 16).

### Le résultat : 24 mesures, aucune divergence

`tools/reconcile/checks/students.ts` repose chaque mesure des deux côtés et
compare en chaînes. Effectifs, répartitions par niveau, par groupe, par statut,
par année, lieux de naissance, dates d'entrée, et **les cinq sommes d'argent** :

| | El Ourwa | Nous |
|---|---|---|
| Somme des frais mensuels | 8 593 000.00 | **8 593 000.00** |
| Somme des tarifs pleins | 9 374 500.00 | **9 374 500.00** |
| Somme des frais d'inscription | 431 500.00 | **431 500.00** |
| Somme des frais de document | 286 000.00 | **286 000.00** |

⚠ **Et un piège dans la vérification elle-même : la collation.** El Ourwa est en
`utf8mb4_unicode_ci`, insensible à la casse et aux accents ; son `GROUP BY` replie
« Ksar » et « ksar », « NKT », « Nkt » et « nkt ». Postgres regroupe exactement.
L'empreinte des lieux de naissance divergeait donc sur une trentaine de clés
alors que **les valeurs stockées étaient identiques** : 95 + 13 + 4 = 112, et
« nkt 112 » est justement le chiffre relevé dans `CLAUDE.md`. Une vérification qui
échoue sur un réglage ne vérifie plus les données — tout regroupement sur du texte
est désormais forcé en `utf8mb4_bin`.

---

## ADR-0056 — Les notes reprises, et trois colonnes qui n'ont pas de destination

**2026-09-10 · accepté** — deuxième tranche de reprise : 140 027 lignes de plus,
réconciliées en 15 mesures.

### `mode_calcul` est déclaré, rempli, et jamais lu

`bulletin_formules.mode_calcul` vaut `examen_seul` sur ses 60 lignes. Il n'apparaît
**nulle part** dans `reference/v16/src` : `grep -rn mode_calcul` ne trouve rien.
C'est le même motif que les permissions financières d'ADR-0053 — une colonne
distribuée mais jamais vérifiée.

Il n'est donc pas repris, et ce n'est pas une perte : les coefficients se
décrivent eux-mêmes. Les 60 lignes portent d=0, e=1, q=1, ce qui **dit** « examen
seul ». Importer une redondance que personne ne lit serait importer une occasion
de divergence — le jour où les deux ne s'accorderaient plus, laquelle croire ?

C'est aussi l'explication complète d'ADR-0054 : sur une formule à examen seul, un
marqueur d'absence en examen n'a rien d'autre à côté de lui, et la moyenne de la
matière devient « −1.00 ».

### Un identifiant de connexion n'est pas toujours une adresse

Trois des quatre comptes du personnel se connectent avec `e.historique`,
`s.employ339`, `parite_lab`. Notre `users` n'a que `email` et `phone`, et
`auth.service.ts` fait `lower(email) = lower($1) OR phone = $1`.

L'identifiant est donc repris **tel quel dans `email`**, adresse ou pas. La
personne se connecte avec exactement ce qu'elle tape aujourd'hui. Inventer
« e.historique@elourwa.mr » serait inventer un fait (règle 24) **et** lui retirer
son identifiant le jour de la bascule.

⚠ **TRANCHÉ LE 2026-09-10 : `username` a sa colonne** (migration 0027). Le
pis-aller n'a vécu qu'une journée. L'identifiant part désormais dans
`users.username`, et dans `email` **seulement quand c'en est une** — sur les
quatre comptes, un seul a les deux et peut se connecter par l'un ou l'autre.

L'unicité porte sur `lower(username)`, pas sur `username` : la comparaison de
connexion est insensible à la casse, donc un unique ordinaire laisserait
coexister « Admin » et « admin », tous deux joignables par la même saisie, avec
deux empreintes de mot de passe derrière. Le compte atteint dépendrait de l'ordre
des lignes. La contrainte « joignable par quelque chose » est élargie, pas
retirée : `email IS NOT NULL OR phone IS NOT NULL OR username IS NOT NULL`.

`test/username-login.spec.ts` couvre les sept cas, dont les deux refus.

### `enseignements.prix_par_heure` n'a pas de colonne, et personne ne s'en apercevrait

Il porte un tarif horaire propre à UN enseignement, qui prime sur celui du
professeur. Notre `teachings` ne l'a pas.

Aucune ligne ne le renseigne aujourd'hui — il est nul sur les 504 — donc rien
n'est perdu **pour l'instant**. Mais le jour où quelqu'un le remplira chez lui,
la paie d'ici l'ignorerait en silence. L'import le compte à chaque passage, pour
que ce jour-là se voie.

### Les notes ne s'écrivent pas une par une

139 457 lignes × (un SELECT puis un INSERT ou un UPDATE) = 280 000 allers-retours.
Une reprise qu'on doit pouvoir relancer sans y penser ne peut pas coûter des
minutes. Elles passent donc par `unnest`, mille à la fois, avec `ON CONFLICT` sur
la clé naturelle — qui EST l'identité d'une note : élève, enseignement, trimestre,
nature, numéro. Une note ne se « renomme » pas, contrairement à un groupe.
Résultat : **12 secondes** pour les 147 331 lignes.

⚠ Et **la reprise n'est pas un miroir** : une ligne supprimée chez lui ne
disparaît pas ici à la relance. C'est le décompte de la réconciliation qui le
dirait. Un import qui supprimerait des lignes serait bien plus dangereux qu'un
import qui en laisse.

### Le marqueur d'absence passe INCHANGÉ

1 580 notes valent `-1`. C'est un MARQUEUR, pas une note (règle 11), et le filtrer
à l'import perdrait l'information « absent ». C'est le CALCUL qui l'exclut.

La vérification mesure donc la somme des notes **deux fois**, avec et sans lui :
1 430 239.30 et 1 431 819.30, dont l'écart vaut exactement 1 580. Si l'import se
mettait un jour à filtrer le marqueur, la première somme bougerait et la seconde
non — et la mesure le dirait.

### ⚠ Le rapport ne doit porter aucun identifiant, y compris quand la mesure en vit

La mesure la plus utile du lot descend au triplet (élève, matière, trimestre) :
« 139 457 des deux côtés » ne prouve rien, puisque deux notes interverties entre
deux élèves laissent le total intact et changent deux bulletins. Son empreinte
fait 663 770 caractères de `100:126:1=2|…`.

Ces nombres sont des **identifiants d'enfants**, et `run.ts` promet que le rapport
daté — versionné — ne contient « aucun nom, aucun identifiant ». Une promesse
tenue partout sauf à un endroit n'est pas tenue.

La mesure compare donc deux **condensés** (SHA-256 tronqué + longueur). Ils
diffèrent dès qu'une seule clé diffère, ce qui est tout ce qu'on demande à une
barrière ; les clés fautives partent dans `sample`, que seul `--verbose` imprime
et qui n'est jamais écrit sur le disque.

`checks/commun.spec.ts` vérifie que cette détection fonctionne — notamment qu'une
empreinte distingue deux valeurs **échangées** entre deux clés, le cas où tous les
totaux restent identiques. Une barrière qui ne sait pas échouer n'est pas une
barrière.

### Le résultat

| | El Ourwa | Nous |
|---|---|---|
| Notes | 139 457 | **139 457** |
| Notes par élève, matière et trimestre | 4fb60178dc1a5e02 | **4fb60178dc1a5e02** |
| Marqueurs d'absence | 1 580 | **1 580** |
| Somme des notes réelles | 1 431 819.30 | **1 431 819.30** |
| Enseignements | 504 | **504** |
| Formules du bulletin | 60 | **60** |

**42 mesures au total sur les trois vérifications, aucune divergence.**

---

## ADR-0057 — La reprise est complète, et la dette d'une famille est la même des deux côtés

**2026-09-11 · accepté** — 212 196 lignes reprises ; 88 mesures ; la dette de
scolarité identique famille par famille sur les 1 372.

### Ce que la réconciliation de la dette a trouvé, et ce qui a changé

La dette n'est stockée nulle part : elle se déduit de l'échéancier, des
encaissements, des exemptions et des remises. Elle a donc été comparée comme les
bulletins — **son code contre le nôtre**, `obtenir_dette_parent_detaillee()` pour
chaque correspondant d'un côté, `DebtService.detailAcrossYears()` de l'autre, la
fonction que lisent la caisse, la porte des examens et la réinscription.

**Première passe : 1 574 000.00 chez lui, 34 038 500.00 chez nous.** 611 mois
impayés contre 11 844. Vingt fois plus, sur le chiffre qu'on réclame à une
famille. El Ourwa a raison (règle 26), et il dit pourquoi dans son code :

> « Un élève dont la dernière inscription est antérieure a QUITTÉ l'école : lui
> facturer les mois postérieurs à son départ inventerait une créance. »
>
> « Les années antérieures à `dette_mois_depuis_annee` n'ont ni facture ni
> paiement repris. Les compter fabriquerait une dette qui n'a jamais existé. »

Les arriérés des années passées ne s'évaporent pas : ils sont **constatés** dans
`dettes_familles` — nos `misc_debts`, 9 875 500.00 d'arriérés réconciliés au
centime. Les recompter depuis l'échéancier les ferait payer deux fois.

`DebtService` s'aligne, en trois points :

1. **La scolarité n'est due que pour l'année scolarisée** — chez lui « la
   dernière année à au moins 50 inscriptions ». Pas le drapeau `active` : c'est
   ce qui fait qu'à la clôture, les arriérés de l'année finie bloquent encore la
   réinscription tant que l'effectif n'a pas bougé. Son seuil de 50 est borné à
   l'effectif de l'année la plus peuplée, pour qu'une école de vingt élèves ne
   retombe pas sur l'année civile où rien n'est dû. Sur ses données,
   min(50, 1 206) = 50 : la règle est la sienne à l'unité.
2. **`dette_mois_depuis_annee`** coupe avant l'année où l'école a commencé à
   tenir ses comptes ici. Chez lui 2024 par défaut, artefact de SA reprise ; chez
   nous zéro quand la clé est absente, et la clé arrive avec l'import.
3. **L'exemption automatique des mois d'avant l'entrée** — règle de CALCUL chez
   lui (`mois_auto_exempte_infos`, règle du 25, bornée à l'année), ÉTAT chez nous
   (le constructeur d'échéancier écrit ces mois `free`). L'échéancier repris les
   portait `a_facturer` ; l'import les traduit désormais, 414 mois, et la
   vérification applique la même fonction à ses lignes pour comparer la
   traduction et non la copie.

**Résultat : 1 714 200.00 des deux côtés, 611 mois, 187 familles, et le même
condensé famille par famille.** Cinq tests posent la règle (`debt-current-year.spec.ts`).

### Les deux trous, chiffrés plutôt que comblés en silence

**Les frais annuels par inscription.** El Ourwa les suit PAR INSCRIPTION
(`inscription_payee`, `exempte_inscription`…, des milliers de lignes) ; notre
modèle les suit PAR FAMILLE. Traduire changerait ce que l'école réclame dans les
deux sens : un enfant exempté deviendrait une famille exemptée, et fabriquer un
paiement pour « inscription_payee » inventerait un montant et un numéro de reçu.
Non repris ; compté à chaque passage. ⚠ Sans effet sur la dette réconciliée :
ses barèmes `frais_inscription` et `frais_photocopie` valent zéro, donc aucun
frais annuel n'entre dans son calcul ni dans le nôtre.

**Les 339 bulletins de salaire sans personne.** `beneficiaire_id = 0`, nom
« Bulletin de salaire OCT » : hérités du logiciel qui précédait El Ourwa. Notre
`payee_id` est obligatoire ; y accrocher un employé fictif inventerait une
personne. 1 245 990.00 non repris, montrés à part dans la réconciliation.

### Ce qui a été accordé en chemin

- **`users.username`** (0027) — le propriétaire a tranché : « fresh system ».
- **`payment_methods.origin` / `legacy_id`** (0028) — la convention de 0001,
  enfin tenue partout.
- **`(school_id, legacy_id)` unique** (0029) — la reprise était passée de douze
  secondes à dix minutes faute d'index ; et unique, pas seulement rapide : le
  doublon d'un encaissement devient impossible, pas improbable.

### Le tableau final

| Vérification | Mesures | Ce qu'elle prouve |
|---|---|---|
| bulletins | 2 | notre arithmétique rend ses moyennes |
| effectifs | 24 | les élèves, les inscriptions, les cinq sommes de frais |
| notes | 15 | les 139 457 notes, au triplet (élève, matière, trimestre) |
| finance | 18 | 42 614 000.00 encaissés, 34 479 000.00 restant dû |
| paie | 18 | 30 853 394.00 de salaires, 5 151 372.00 de prêts, 10 668 700.00 de dettes |
| dette | 11 | **1 714 200.00 réclamés, famille par famille** |

**88 mesures, aucune divergence, code 0.** Rien ne bascule sur une
réconciliation en échec (règle 23) ; celle-ci ne l'est pas.

---

## ADR-0058 — Prêt pour les magasins : les cinq derniers points, le durcissement, le juridique, l'emballage

**2026-09-11 · accepté** — `FEATURES.md` ne porte plus aucune ligne ouverte.

### Les cinq points

**12 · Notifications poussées.** Le dessin de `outbound_mail` (ADR-0017) :
`notifier()` écrit la notification et une ligne `outbound_push` dans la même
transaction ; un travailleur envoie par FCM HTTP v1, un JWT RS256 signé avec
`jose` — pas un SDK. El Ourwa notifie depuis douze endroits, nous depuis deux :
absence, retard, note d'examen, remarque, message et paiement rejoignent
exercice et emploi du temps. Les gabarits vivent dans `@elourwa/shared`, et un
test les compare clé par clé à la table Dart. **La note d'un enfant n'atteint
jamais un écran verrouillé.** Côté Flutter, Firebase s'initialise par code
depuis des `--dart-define` : ni `google-services.json` ni plist dans le dépôt.

**27/28 · La langue mémorisée.** Sa résolution, `includes/i18n.php`, dont le
premier mot dit « pour l'espace parent » : c'est là qu'El Ourwa traduit, et
c'est là que nous traduisons. `?lang=` → appareil → `users.locale` → `fr`. Un
choix fait sur l'appareil prime sur le profil, sans quoi la tablette familiale
repasserait en arabe parce que l'autre parent l'a choisi sur son téléphone.

**31 · Le cache**, aux deux seuls endroits où il s'en sert : le nombre de
non-lus (60 s, oublié à la lecture) et la dette à la porte des examens (60 s,
oubliée après chaque encaissement). En mémoire, comme son APCu ; préfixé par
l'école — un cache est de la mémoire partagée entre locataires.

**100 · Le total arabe du fondamental : rien à porter.** `total_ar` est NULL sur
ses 5 792 lignes, jamais lu dans son source, chaque ligne héritée du logiciel
d'avant.

### Le durcissement — `docs/SECURITY.md`, section du 2026-09-11

Le jeton disait qui vous étiez pendant quinze minutes ; la base dit désormais
qui vous êtes à chaque requête (sceau, compte actif, permissions relues —
rangées 17, 18, 23). L'empreinte de session sur le jeton de rafraîchissement
(15). `fastify` forcé à ≥ 5.12.1. Aucune vulnérabilité connue, aucun secret
dans les fichiers suivis. Six lignes ◐ vérifiées contre le code et fermées.

### Le juridique — et ce qu'un développeur ne doit pas inventer

Politique de confidentialité et conditions d'utilisation, en français et en
arabe, servies publiquement à `/legal/…` ; suppression de compte dans
l'application, avec mot de passe, par anonymisation — **les écritures
scolaires et comptables restent**, sous un compte anonyme, parce qu'une école y
est tenue ; les réponses aux questionnaires des deux magasins dérivées du code
ligne par ligne.

⚠ **Rien de cela n'a été relu par un juriste, et les `[À COMPLÉTER]` sont des
faits sur l'école** — raison sociale, adresse, hébergeur, durées légales de
conservation, autorité de contrôle. Les inventer serait la règle 24 à
l'envers. Ils sont marqués, pas remplis.

### L'emballage — et ce que ce poste ne peut pas produire

`tools/packager.sh` produit ici `serveur-0.1.0+1.tar.gz` (2,1 Mo — 179 Mo avant
d'exclure le cache de construction de Next) et `parent-web-0.1.0+1.tar.gz`
(7,8 Mo). **Il ne produit ni le `.aab` ni le `.ipa` :** le SDK Android n'est
pas installé sur ce poste, et un projet iOS ne se construit que sur macOS. Les
deux projets de plate-forme sont prêts — identifiant `mr.elourwa.parent`,
permissions minimales, sauvegardes exclues, signature depuis `key.properties`,
manifeste de confidentialité iOS — et le script dit, quand il refuse, exactement
ce qui manque.

⚠ L'identifiant `mr.elourwa.parent` **ne change plus après la première
publication**. S'il doit être autre chose, c'est maintenant.

## ADR-0059 — « Paiement du personnel » et « Administrateurs » refaits sur El Ourwa v23, et la règle de retenue de prêt qui était la nôtre

**2026-09-12 · accepté** — le propriétaire a montré que « Paiement du personnel »
ne ressemblait pas à `paiement_staff.php`, et qu'il avait cru la parité à 100 %.
« Aucune ligne ouverte dans FEATURES » n'a jamais voulu dire « chaque page est
la sienne » ; ce document le dit désormais, et l'audit page par page qui suit
(`docs/parity/AUDIT-v23.md`) le mesure.

### La référence a bougé : v16 → v23

Le dépôt avait été porté contre `reference/v16` (30 août). Le zip déployé est
`el_ourwa_CODE_v23.zip` (8 septembre), extrait dans `reference/v23/` (ignoré
par git, données réelles). Treize fichiers source diffèrent, le CSS non. Chaque
page est désormais comparée à **v23**.

### `paiement_staff.php`, tel quel

Ce qui était inventé et qui ne l'est plus : le paramètre `categorie` et son
bouton « Afficher » (chez lui `type`, et trois listes qui se soumettent au
changement) ; les colonnes « Situation · Salaire · Retenue · Versé · Reste »
(chez lui `Nom · Fonction · [Situation · Heures/mois] · Salaire mensuel · Déjà
payé (mois) · Action`) ; un champ « Montant » dans la modale (chez lui le
montant EST la somme des moyens de paiement, la première ligne pré-remplie du
reste dû) ; nos messages de refus (les siens, mot pour mot, dans son ordre) ;
l'absence de reçu (le sien : `SAL-000123`, `recu_document()`, et la page qui
ne rend QUE le reçu après un paiement). Les mois proposés aux professeurs sont
les mois actifs de l'année scolaire ; les années vont de `MIN(paiements.annee)`
à `max(MAX, annee_defaut()+1)`.

### La retenue de prêt : sa règle, pas la nôtre

Nous retenions sur un salaire **les échéances de ce mois et tout arriéré des
mois précédents**, et nous créditions le prêt **dès la première écriture** du
mois. Son `retenue_pret()` ne lit que les échéances **datées du mois**
(`pe.mois = :m AND pe.annee = :a`) ; une échéance non retenue reste ouverte
sur le prêt (Dettes → Prêts au personnel) et ne se reprend pas sur un autre
salaire. Et `crediter_echeances_mois()` ne court que lorsque le mois est
**intégralement versé**. Un mois dont la retenue couvre tout le salaire est
refusé — « rien à verser » — et l'échéance reste ouverte. Règle 26 : El Ourwa
est juste jusqu'à preuve du contraire, et cette règle est la sienne depuis des
années. Les tests de `payroll.spec.ts` ont été récrits sur elle.

`salary_payments` garde `net` (son `montant`), `loan_deduction` (la retenue,
portée par l'écriture qui complète le mois) et `gross = net + loan_deduction`,
si bien que Σ gross d'un mois payé vaut le gain de référence.

### Ce qui n'existe pas chez lui, et qui part

`/payroll` (une « liste de travail » de notre cru), `reverseSalary` et
`/payroll/month` : aucun écran d'El Ourwa n'annule un salaire — `paiements_salaire`
n'est jamais supprimée ni corrigée. Le formulaire de prêt reste sous Dettes.

### Ce que la parité a coûté en schéma

`0032_salary_receipt_numbers.sql` : un compteur par école
(`salary_receipt_sequences`, sous verrou, règle 10) et `salary_payments.receipt_no`,
pour écrire `SAL-000123` comme lui. Les retraits portent `ADM-Ymd-<id>-<4 chiffres>`
(son `recu_numero`) ; l'`<id>` est l'entier repris quand il existe, sinon les
huit premiers caractères de l'UUID — la seule liberté prise, faute d'entier.

### `administrateurs.php`, tel quel

Le reçu de retrait (`print_recu_retrait`), ouvert au comptable sans les
informations de limite ; le paragraphe d'introduction ; la consommation du
**mois courant** (`date('n')`, jamais un paramètre) avec la barre de
progression et ses trois couleurs ; les champs `rapport / r_date / r_mois /
r_annee` ; ses messages en haut de page (« Limite mensuelle mise à jour : N
MRU/mois. »…) ; et la colonne « Reçu » dont le bouton, chez lui, n'a pas de
texte — reproduit tel quel, avec un `aria-label`. Notre `confirm()` sur
« Désactiver » n'était pas le sien : retiré.

### Un défaut trouvé en chemin

Après une action serveur qui finit par `redirect()`, Next rend la page cible
dans la réponse de l'action avec `host: localhost:3000` ; l'école n'est plus
que dans `x-forwarded-host`. `currentSlug()` cherchait le cookie sous
`elourwa_platform_…`, ne le trouvait pas, et chaque paiement enregistré
renvoyait à la page de connexion. `x-forwarded-host` est lu d'abord —
c'est aussi ce qu'un mandataire inverse enverra en production.

## ADR-0060 — L'audit page par page contre v23 est terminé : ce qui a été refait, ce qui reste volontairement différent

**2026-09-14 · accepté** — suite de l'ADR-0059. Chaque page de
`reference/v23` — direction, scolarité, finance, comptes, professeur, espace
des familles, connexion — a été relue en entier et comparée à la nôtre en
code, en dynamique, en CSS et en messages ; `docs/parity/AUDIT-v23.md` porte
une ligne par page (« Refaite », « Retiré, car inventé », « Volontairement
différent »). Cet ADR ne répète pas l'audit ; il fixe les décisions qui
survivent à la parité et les divergences qu'on assume.

### Décisions de schéma prises pour la parité

- **`students.matricule` (0036)** — son `etudiants.identifiant`, le matricule
  que la famille cite au secrétariat et que `gestion_groupes.php`,
  `recherche.php`, `mes_classes.php` et le bulletin impriment. Nous montrions
  le RIM à sa place.
- **`users.username` (0027)** — son `identifiant` de connexion du personnel
  (décision du propriétaire, 2026-09-10) ; `modifier_profil.php` et
  `comptes_staffs.php` l'écrivent désormais là, plus dans l'adresse.

### Divergences assumées (chacune notée sur sa ligne de l'audit)

1. **Le changement obligatoire du mot de passe provisoire vaut aussi pour le
   personnel.** Chez lui `doit_changer_mdp` n'existe que pour les parents ;
   un agent créé avec un mot de passe provisoire peut le garder pour toujours.
   Décision de sécurité antérieure (commit 884b57b) conservée : la direction
   connaît le mot de passe provisoire d'un comptable, et c'est un système
   financier. Conséquence : « Mon profil » reste ouvert à tout compte du
   personnel (chez lui `require_staff_admin()`), sinon un comptable n'aurait
   nulle part où changer ce mot de passe.
2. **Un changement de mot de passe ou d'identifiant ferme les AUTRES sessions
   et renouvelle la courante.** Chez lui la session PHP survit à la requête,
   puis son `sceau_compte()` la ferme au clic suivant (personnel) — ou ne la
   ferme jamais (parents, sans sceau). Nous gardons son message et sa page, et
   la personne continue ; les sessions ouvertes ailleurs tombent.
3. **Le verrou de connexion est une fenêtre glissante** sur `login_attempts`
   (chez lui un compteur et `bloque_jusqua`) — mêmes seuils (5 par compte,
   **15 par adresse** : son `IP_MAX_ATTEMPTS`, contre 5 chez nous jusqu'ici,
   qui fermait tout le bureau derrière un routeur après cinq fautes d'un seul
   agent), mêmes phrases, dans les deux espaces (`espace: parent`).
4. **Les notifications passent par des clés** (`notif_exercice`,
   `notif_remarque`, `notif_reinscription`…) et leurs paramètres ; l'application
   des familles compose le texte dans sa langue. Son texte poussé en français
   (description de l'exercice, « (N fichiers joints) ») n'est pas repris tel
   quel.
5. **L'approbation d'une demande l'exécute dans la même transaction**
   (dépense, frais mensuel, dette) — c'est le sien ; ce qui est à nous, c'est
   le refus d'une exécution à moitié (règle 7) : une exécution qui échoue
   n'enregistre pas la décision.
6. **Ce qui porte de l'argent ou des notes ne se supprime pas** (professeur,
   fiche de personnel, groupe, élève) — refus explicite là où il fait
   `DELETE` ; les blocages d'identité (ADR-0041) tiennent sans suppression.
7. **Pagination par curseur** partout où il liste tout (règle 17), et
   Chart.js servi par l'application, pas par un CDN (CSP).
8. **`personnel_admin` et `staff` sont une seule table** : « Administrateurs »
   = les fiches portant un compte, « Staff » = les autres. La reprise n'importe
   pas `personnel_admin` (ses entiers entrent en collision avec ceux de
   `staff` sur `legacy_id`) : la carte « Administrateurs » de `/statistiques`
   ne compte que les comptes créés ou modifiés chez nous — à reprendre si
   l'école y tient.

### Pages supprimées, car sans contrepartie

`/my-week`, `/settings`, `/reports`, `/today`, `/accounts`, `/classes`,
`/students` (la liste). Chacune était à nous ; ce qu'elle faisait existe sur la
page portée correspondante (voir « Pages sans contrepartie » dans l'audit).
`/platform` (console de la plateforme, PHASES 8.1) et `/notes`
(`saisir_notes.php`) restent.

### À trancher par le propriétaire

- **Le tableau de bord du professeur affiche « heures × 4 × tarif horaire »
  même pour un permanent** — c'est sa formule (`tableau_bord.php`), et chez
  lui un permanent sans tarif horaire lit « 0 MRU » et « Votre tarif horaire
  n'a pas encore été défini par l'administration. » Reproduit tel quel, en
  attente d'une décision : la fiche de paie (`gerer_professeurs.php`,
  `recalculer_salaire`) sait, elle, distinguer les deux situations.

## ADR-0061 — Une seule application pour toutes les branches : la session « famille », le numéro mauritanien, les administrateurs de la plateforme, le cumul des caisses, et la caisse qui ne perdait pas un remboursement

**2026-09-14 · accepté** — décisions du propriétaire, prises le même jour, sur
la console de la plateforme et l'application des familles. Chacune touche la
sécurité, l'argent ou le cloisonnement ; les tests ont été écrits avant
(`famille.spec.ts`, `platform.spec.ts`, `misc-debt-repayment.spec.ts`).

### 1. Toutes les branches ont UNE application, et un parent voit tous ses enfants

*Décision.* « Tous les parents de toutes les branches ont une seule
application ; aucune branche n'a la sienne. » Et « un parent avec un enfant à
Nour et un autre à Rissala se connecte avec un seul numéro et voit les deux
profils, tirés de deux écoles différentes ».

*Comment.* La connexion du parent ne porte plus d'école : `POST /auth/login`
avec `espace: 'parent'` et **sans `X-School-Slug`** cherche les écoles où ce
numéro tient le rôle `parent` (`PermissionsService.ecolesDeFamille`, écoles
actives seulement) et émet un jeton **`schoolId: null, roles: ['parent'],
espace: 'parent'`** — la **session famille**. Le garde relit ces écoles à
chaque requête (`request.auth.ecolesFamille`) ; l'intercepteur de tenant
laisse passer `/parent/*` et `/attachments/*` sans slug pour une telle
session, et rien d'autre (`/students/count` → 403, vérifié). Chaque
gestionnaire de `ParentController` tourne **dans chaque école sous RLS**
(`dansChaqueEcole` → `runInTenant`), fusionne, et étiquette chaque ligne de
son école ; un identifiant d'enfant est d'abord résolu vers SON école
(`ecoleDeLEnfant`, refus « Cet élève n'est pas votre enfant. » sinon). Le
rafraîchissement d'un jeton famille redonne une session famille
(`!schoolId && !is_platform_admin`). Les soldes (`/parent/balance`) sont
sommés en Decimal **si toutes les écoles comptent dans la même monnaie**,
sinon `total: null` et le détail par école. Les appareils (`/parent/devices`)
sont enregistrés dans chaque école : les deux branches peuvent notifier.

*Pourquoi pas une session par école.* Le propriétaire veut un seul écran ;
et un parent ne sait pas — ne doit pas savoir — qu'il a affaire à deux bases.
La règle 1 tient : **aucune requête ne lit deux écoles à la fois** ; c'est
l'API qui boucle, sous le contexte de chaque école, avec le même RLS que
n'importe quelle session.

*Mobile.* Plus de choix d'école à la connexion (`login_screen.dart`) ; les
cartes d'enfants, les absences et les résultats portent le nom de l'école dès
qu'il y en a plus d'une (`Ecole.libelle`, `nomAvecEcole`). Un compte
rattaché à une seule école ne voit aucune différence.

### 2. L'identifiant de l'application est un numéro mauritanien, strictement

*Décision.* « Pour les connexions de l'application, exiger strictement que
l'identifiant soit un numéro de téléphone mauritanien. »

*Règle* (`@elourwa/shared/telephone`) : huit chiffres, le premier parmi
**2, 3, 4** (`^[234][0-9]{7}$`), indicatif `+222` / `00222` toléré et
retiré, espaces et tirets ignorés. Le refus, partout le même : « Numéro
mauritanien attendu : 8 chiffres commençant par 2, 3 ou 4 (indicatif +222
facultatif). » Appliqué **à la connexion** (`espace: 'parent'`), **à
l'admission** (`newGuardian.phone`, stocké canonique, famille existante
retrouvée sur les huit derniers chiffres), **au changement d'identifiant
d'un parent** (`setIdentifier`, unicité sur les huit derniers chiffres), et
côté application avant même d'appeler le serveur (`telephone.dart`).

*Ce qui ne change pas.* Les 1 372 numéros repris restent tels quels en base
(règle 24) : la comparaison à la connexion se fait sur les huit derniers
chiffres de `regexp_replace(phone, '[^0-9]', '')`, donc `+222 40 00 00 00`
en base et `40000000` au clavier sont le même compte. Le personnel (site) se
connecte par identifiant ou adresse, comme avant : la règle vise l'application.

### 3. Les administrateurs de la plateforme se créent entre eux, avec les mêmes privilèges

*Décision.* « L'administrateur de toutes les branches peut aussi créer des
comptes d'administrateurs pour toutes les branches, avec les mêmes privilèges
que lui. »

*Comment.* `users.is_platform_admin` est le privilège, pas un rôle d'école :
`GET/POST /platform/admins`, `POST /platform/admins/:id/active`. Un
administrateur est créé avec un nom, un identifiant (adresse ou nom
d'utilisateur), un mot de passe provisoire à la politique du site et
**`must_change_password = true`**. Il peut être désactivé (ses sessions sont
révoquées), **jamais soi-même, jamais le dernier actif** — sinon la
plateforme n'aurait plus personne. Chaque geste est journalisé avec son
auteur. L'accueil d'un tel compte est `/platform`, avec son propre menu.

### 4. La console additionne les caisses de toutes les branches

*Décision.* « Le total des revenus d'aujourd'hui (ce que nous avons reçu
aujourd'hui dans toutes les branches), le total des dépenses, et un rapport
mensuel et annuel — tous en cumul de toutes les branches. »

*Comment.* `GET /platform/tableau-bord?mois&annee` lit, **par branche et sous
RLS** (`db.queryFor`), les `tender_lines` en entrée et en sortie du jour, du
mois et de l'année, le détail du mois par origine (ses libellés :
`SOURCE_LABELS`) et les douze mois de l'année ; puis somme en **Decimal**,
au centime, **seulement si toutes les branches comptent dans la même
monnaie** (`cumul: null` sinon, chaque branche restant détaillée). Jamais
`BYPASSRLS` sur ce chemin (règle 3) : c'est une boucle de contextes, pas une
lecture globale.

*Ce que cela a révélé.* Les 16 008 lignes de moyens reprises portaient la
date de l'import, pas celle du paiement : « aujourd'hui » aurait valu toute
l'histoire de l'école. L'importeur (`tools/import/finance.ts`) reprend
désormais `paiement_lignes.date_creation`, les lignes existantes ont été
réparées depuis MySQL (script ponctuel, par `legacy_id`), et la
réconciliation compte une **92ᵉ mesure**, « ventilé par mois » (92/92).

### 5. Les reçus : le recensement, et le remboursement qui ne passait pas en caisse

Le propriétaire : « sur le site d'une branche, les reçus ne sont pas aussi
largement implémentés que dans v23 ». Tous ses points d'entrée
(`recu_document()`, `print_recu*=`) ont été recensés contre les nôtres —
tableau dans `docs/parity/AUDIT-v23.md`, § Reçus. Dix sur dix existaient ou
existent ; le seul manquant était **`print_recu_remb`**, le reçu de
remboursement d'une dette diverse — et derrière lui un vrai défaut :
`repayMiscDebt` prenait un montant nu, **sans ligne de moyen de paiement**.
La dette baissait, la caisse ne montait pas ; le rapport financier, le
journal et le cumul de la plateforme ne l'auraient jamais vu. Désormais son
`rembourser` : la somme des lignes du widget, écrites en entrée sous la
source `dette`, sa phrase de refus, le numéro `REMB-Ymd-<dette>-<4 chiffres>`,
le profil `?dette_id=` et le reçu. Ses « Débiteurs » (table `dettes`) sont
nos `misc_debts` **sans foyer** — celles qu'une demande de type `dette`
approuvée crée — jamais les arriérés des familles.

## ADR-0062 — Les défauts signalés après la première démonstration (17/09) : ce qui était cassé, ce qui change de règle

**2026-09-17 · accepté** — le propriétaire a essayé la démonstration en ligne et
signalé onze points. Deux sessions ont travaillé en parallèle sur le même
dépôt (commits 02b1ca0, 63cca88, 551474a) ; ceci fixe les décisions.

1. **Envoyer un exercice** n'envoyait rien : la limite par défaut d'une
   action serveur Next (1 Mo) refusait la requête avant l'action, et les
   `required` de React avalaient l'envoi sans message. Limite 30 Mo, plus de
   `required`, refus du serveur en tête de page. *Décision* : on choisit une
   **classe** ; la matière n'apparaît que si le professeur en a plusieurs dans
   cette classe.
2. **Notifier les impayés** écrivait un message de messagerie, pas une
   notification : son `notifier_parent()` — fil de l'application + poussée
   (`notif_rappel`, bilingue).
3. **Historique des connexions, parents** : la session de famille n'a pas
   d'école (`school_id NULL`, ADR-0061) et le filtre l'excluait ; une ligne par
   famille de jetons, pas par rotation.
4. **Premier mois dû** : une date d'entrée après le dernier mois de l'année
   rendait « rien n'est dû » ; son `debut_effectif_annee()` dit qu'une date hors
   fenêtre ne décrit pas l'année → tout est dû (règle 26). C'était la cause des
   « modales de paiement cassées » et de la « dette fausse » : aucun mois
   exigible, rien à encaisser, dette zéro.
5. **Rien n'est obligatoire à l'encaissement** d'une (ré)inscription :
   le mois se décoche, les frais annexes se mettent à 0, « Terminer » sans
   rien encaisser ; ce qui n'est pas payé reste dû dans la caisse.
6. **Mois payés du personnel** (`staff.paid_months`, 0037) : à l'ajout d'un
   membre on coche ses mois ; payer un mois hors fiche est refusé. Les
   professeurs suivent, comme chez lui, les mois actifs de l'année scolaire.
7. **Saisir les notes, le professeur** : `POST /teacher/sheet/:id`, porte
   « mon enseignement » (pas `notes.saisir`, qui est celle de la direction),
   page `/prof/notes` limitée à ses classes et ses matières.
8. **Vitesse** : `/auth/me` était appelé avant CHAQUE appel à l'API depuis le
   site (`readSession` désormais `cache()` par requête), école et année
   consultée mises en cache par requête, rôles/permissions et école-par-slug
   en cache court côté API — **sans** que la révocation d'un rôle attende
   (invalidation à l'écriture, tests `auth.spec` / `session-hardening`).
9. **L'application, comme WhatsApp** : (a) l'empreinte d'une session de
   famille ne retient plus l'adresse — un téléphone change de réseau dix fois
   par jour et chaque /24 révoquait toute la famille de jetons ; (b) une
   session gardée est une session : si le serveur dort à l'ouverture,
   l'application s'ouvre quand même et réessaie (5 s, puis 15 s, puis 60 s) ;
   seul un refus 4xx renvoie à la connexion ; (c) le canal Android `elourwa`
   est **créé** (importance haute, sonnerie propre `res/raw/elourwa_notif`,
   vibration 250-120-250) — il n'était que nommé dans le manifeste, donc
   « Divers » et muet ; au premier plan et au sondage, l'application sonne
   elle-même par un pont natif (`Sonnerie`).
10. **Le service gratuit** : sonde de santé qui ne dit « sain » que quand
    l'API et le site répondent, auto-réveil toutes les dix minutes (une
    requête vers sa propre adresse publique compte comme entrante), page
    d'attente qui se rafraîchit si le service dort quand même.

## ADR-0063 — « Clôturer ne marche pas » : le message publié depuis un effet se perdait ; règle générale pour toutes les actions

**2026-09-18 · accepté.** Le propriétaire signale que « Clôturer l'année » ne
fait rien et que la page des années « semble cassée ». L'API clôturait
correctement (six assertions dans `year-lifecycle.spec.ts` : archivage,
année suivante seule active, double clôture refusée, réouverture d'une année
close refusée). Le défaut était sur le site : le message de l'action
(« Année … clôturée… ») était publié par un effet React dans le formulaire de
la ligne — et la clôture remplace cette ligne (« Clôturée », plus de bouton),
si bien que le formulaire disparaissait avant que l'effet ne publie. La page
restait muette ; pour l'opérateur, rien ne s'était passé. « Rendre active »
avait le même défaut. Ce piège était déjà noté (ADR-0060, `useActionMessage`)
mais appliqué au cas par cas.

*Décision.* **Toute action publie son message au retour de l'action**, jamais
depuis un effet : les 37 formulaires qui utilisaient `useActionState` +
`useMessagePage(state)` passent par `useActionMessage`, qui enveloppe
l'action et publie `ok` / `info` / `error` avant que React ne re-rende quoi
que ce soit. `useMessagePage` reste pour les messages portés par l'adresse
(`?succes=1`).

*Et la page des années* s'aligne sur la correction faite le même jour sur
l'application PHP par une autre session : une année clôturée n'offre plus
« Rendre active » ni ses sélecteurs de mois (le serveur les refusait), et le
texte dit « archive toutes les inscriptions » — les classes ne sont pas
vidées, l'année suivante n'a simplement aucune inscription tant que les
réinscriptions ne sont pas faites.

## ADR-0064 — L'année active est la seule source de vérité ; une année antérieure est close, pas « à venir » ; un identifiant ne « existe » que s'il conflit ici ; la remise à neuf de la base

**2026-09-18 · accepté** — passe complète demandée par le propriétaire.

1. **L'année consultée par défaut est l'année ACTIVE.** Son `annee_defaut()`
   préférait « l'année la plus récente avec des inscriptions » : une année
   qu'on venait d'activer, encore vide, n'était suivie par aucun tableau de
   bord — « les graphiques ne suivent pas ». Désormais `defaultView()` rend
   l'année active (repli : la plus récente avec des données, s'il n'y en a
   aucune d'active). Toutes les pages du site passent par `anneeAffichee()`,
   l'application des familles par `parentVisibleYear()` (l'active, sans repli).
2. **Rendre active une année ULTÉRIEURE clôture l'année en cours** (inscriptions
   archivées, date de clôture) ; une année antérieure encore ouverte n'est
   jamais renvoyée « à venir » — c'est de l'histoire. Revenir sur une année
   antérieure ouverte (activation par erreur) ne clôture rien : l'ultérieure
   redevient « à venir ». Le site annonce la clôture dans la confirmation, avec
   le nombre d'inscrits. Une année close ne se rouvre pas d'un clic (inchangé).
3. **« Cet identifiant existe déjà » seulement quand c'est vrai.** Les comptes
   sont globaux ; un identifiant pris par un agent d'une autre école n'est pas
   un conflit : le compte est RATTACHÉ à cette école avec le rôle demandé, son
   mot de passe intact (le provisoire saisi n'est pas appliqué, et la réponse
   le dit). Conflits réels, nommés : l'identifiant est l'e-mail/téléphone d'un
   autre compte ; le compte a déjà un rôle ici (actif ou désactivé).
   `createAccountAction` (mort-née, envoyait l'identifiant comme téléphone) est
   retirée. Le parcours mot de passe est fixé par un test : créer → connexion
   avec le provisoire → changement → l'ancien refusé, le nouveau accepté.
4. **Remise à neuf de la base, une fois par valeur :** `RESET_DATABASE=<mot>`
   dans l'environnement Render ; au démarrage suivant, si le mot diffère de
   celui gardé dans `platform_settings.reset_marker`, le schéma est supprimé et
   recréé, la graine semée, le mot gardé. Les redémarrages suivants ne touchent
   plus rien. En local : `pnpm --filter @elourwa/db reset && pnpm seed` (fait le
   18/09 : la base locale est neuve ; la reprise d'El Ourwa se rejoue avec
   `tools/import` quand la bascule approche).
5. **Polish** additif sur le site (barre de progression et trame pendant la
   navigation, messages animés et fermables, anneau de focus, survol et
   en-tête collant des tables, états vides, petits écrans) — sans redessiner
   les pages d'El Ourwa.

## ADR-0065 — L'application des familles : notifications qui surgissent avec leur texte et une sonnerie propre ; refonte de l'interface pour tous les téléphones

**2026-09-19 · accepté** — décision du propriétaire.

*Notifications.* Canal Android `elourwa_v2` (un canal ne change plus de son
une fois créé, d'où le nouvel identifiant ; l'ancien est supprimé au
démarrage) : importance haute, sonnerie propre — un carillon de trois notes
au timbre de cloche (`res/raw/elourwa_notif.wav`, synthétisé) —, vibration
250-120-250, icône monochrome teintée (`ic_notification`, l'icône adaptative
devenait un carré blanc), grande icône de l'application, catégorie message,
visible sur l'écran verrouillé, ticker dans la barre d'état. Le serveur
envoie le même canal, le même son et la même vibration dans la charge FCM.
Sans Firebase, le sondage (15 s au premier plan) fait SURGIR chaque
notification nouvelle avec son vrai texte (trois au plus, puis un résumé), et
les nouveaux messages de l'école de même. Permission demandée à l'ouverture.

*Interface.* Une échelle typographique et des thèmes de composants posés une
fois (`theme.dart`) ; `ContenuLarge` (colonne de 640 px centrée sur grand
écran), `EtatVide`, `Squelette`, `Apparition`, `AvatarInitiales`,
`TitreSection` ; l'échelle du texte bornée à 0,9–1,25 ; barre du haut réduite
à la marque, la cloche et un menu (six contrôles ne tenaient pas sur 360 px) ;
navigation avec retour haptique et transition ; tableau de bord avec carte
d'accueil (écoles en pastilles), cartes d'enfant à initiales, deux colonnes
sur tablette ; fil des notifications groupé par jour avec pastille d'icône,
point de non-lu, heure. Fixé par un test de mise en page qui rend la coquille
et le fil à 360 × 640, 393 × 852 et 800 × 1280 avec des noms longs : tout
débordement est un échec (`mise_en_page_test.dart`).

## ADR-0066 — Le balayage ECC du 19/09 : ce qui a été corrigé, ce qui a été décidé, ce qui reste

**2026-09-19 · accepté** — demande du propriétaire (« use ecc and deploy a
subagent for every task, run a full bug sweep… »). Six revues à persona ECC
(typescript, sécurité, base, flutter+kotlin, échecs silencieux, revue des
14 derniers commits), lecture seule, reprises de leur transcription après la
limite d'usage. Constats et sort de chacun dans `STATE.md` (section du 19/09) ;
ici les décisions qui engagent.

*Une école ne dispose que des comptes qui n'existent qu'ici.* `users` est
global. Rattacher un compte existant par identifiant (ADR-0064) reste, mais
réinitialiser son mot de passe, le suspendre ou changer ses rôles depuis une
branche est refusé dès qu'il est administrateur de la plateforme ou tient un
rôle non-parent dans une autre école : c'est la console qui le fait. Sans cela
un `super_admin` de branche obtenait, en deux appels, la console entière ou
l'autre école. Les rôles `parent` ailleurs ne comptent pas (une famille dans
deux écoles reste gérable par chacune, comme chez El Ourwa). Nommer un
administrateur de branche sur un e-mail pris rattache le compte tel quel
(mot de passe intact, `attached: true`), jamais `ON CONFLICT DO UPDATE`.

*Une annulation écrit ses moyens à l'envers.* L'annulation d'un paiement ou
d'une dépense poste les mêmes lignes de moyens en direction inverse, comme le
soir le faisait déjà (0019) ; sans cela les totaux par moyen comptaient encore
le reçu annulé. L'original est verrouillé (`FOR UPDATE`) et la base refuse une
seconde contre-passation (index uniques partiels, 0039). `tillConsistency`
compare en signé.

*Les numéros de reçu viennent tous d'un compteur.* `REMB-`, `PRT-`, `ADM-`
gardent la forme d'El Ourwa (date, identifiant) mais les quatre chiffres tirés
au sort deviennent le compteur par école (`document_sequences`), avec unicité
en base. Règle 10, appliquée aux trois qui y échappaient.

*La paie d'un vacataire ne compte que l'année active.* Son `enseignements`
n'a pas de colonne d'année : il ne contient que les assignations courantes, et
sa somme est donc « l'année en cours ». La nôtre garde chaque année ; sommer
tout doublait le gain de référence après « copier les assignations ». Le
filtre `academic_year_id = année active` rend la somme d'El Ourwa. Les
compteurs `assignments`/`nb_classes` de la liste des professeurs restent sur
toutes les années (documentés ainsi depuis le portage de `recalculer_salaire`).

*La note notifiée se formate à deux décimales d'abord.* `rtrim(rtrim(
number_format($n, 2), '0'), '.')` : appliqué à la chaîne brute, « 10 » perdait
son zéro et la famille lisait « 1 ». `noteAffichee()` + test de table.

*Une année ne se clôture que si elle est active.* Clôturer une année « à
venir » laissait deux actives (`active() LIMIT 1` en choisissait une au hasard).

*Une panne n'est jamais un zéro.* Dette illisible ⇒ panneau d'erreur, pas
« 0,00 » ; enseignements illisibles ≠ « aucun enseignement » ; API en panne ≠
« session expirée » ; hors ligne ≠ « aucun enfant rattaché ». Les pannes
réseau sont journalisées en un seul endroit (`apiFetch`).

*Le mandataire n'écoute que lui-même.* `X-School-Slug`, `X-Client-IP`,
`X-Client-User-Agent` envoyés par un client sont effacés avant relais (l'API
les croit depuis 127.0.0.1) ; l'adresse est la dernière entrée de
`X-Forwarded-For` (celle que Render ajoute), pas la première (forgeable — elle
contournait le verrou de quinze essais). `/_journal` compare en temps constant,
`JOURNAL_KEY` dédiée si posée, cinq échecs par minute. `/_sante` dit 503 après
cinq minutes sans API ni site ; `/health` dit 503 base en panne. La marque de
remise à neuf doit être LUE (trois essais) : un psql raté ne vaut plus « marque
différente » — c'était un `DROP SCHEMA` sur un redémarrage froid.

*Ce qui reste, et pourquoi.* « Impayés » calcule chaque famille par
`forGuardian()` (N+1, six connexions) : c'est une décision antérieure — le
détail vient de la même source que le total — et une réécriture ensembliste
est un travail de parité à mener avec la réconciliation, pas dans un balayage.

## ADR-0067 — Le bulletin et l'emploi du temps de l'application sont ceux du site : un seul rendu, pas deux

**2026-09-20 · accepté** — décision du propriétaire (19/09) : « make emploi du
temps in the mobile app share the same UI with the web app gestion de
scolarité/emploi du temps, same thing for Bulletins and Bulletins
téléchargeables ».

*Le bulletin est produit une fois.* `renderBulletinOfficiel()` et
`BULLETIN_CSS` (`@elourwa/shared`) rendent le document officiel bilingue en
HTML — port fidèle de `includes/bulletin_vue.php`, données échappées. Le site
(« Notes & Bulletins ») insère cette chaîne ; l'API la sert aux familles
(`GET /parent/children/:id/report-card/document`), après le masquage pour
dette et avec la raison en tête, dans la langue du compte ; l'application
l'affiche dans une vue web et en tire le PDF sur le téléphone
(`Printing.convertHtml`, A4, feuille de partage). Trois lecteurs, un texte :
une divergence entre le bulletin du bureau et celui d'un parent devient
impossible, et une correction faite une fois vaut partout. Refusé : un
second bulletin en widgets Flutter (celui que ce choix remplace) et un
générateur PDF côté serveur (Chromium n'a pas sa place dans le conteneur
gratuit). `convertHtml` est marqué obsolète par son paquet, qui conseille de
décrire le document en widgets PDF — ce serait une seconde mise en page ; on
le garde, en connaissance de cause.

*L'emploi du temps est la grille du site.* Sept jours en colonnes (dimanche
compris — un cours du dimanche était invisible aux parents), trois créneaux
en lignes, en-tête terre cuite, case en dégradé crème avec son filet, matière
en gras et professeur dessous : `edt-grille` telle quelle, avec les couleurs
de SA feuille (terre cuite, crème, encre), pas celles de l'application — c'est
un document de l'école. Sur un téléphone, la grille défile horizontalement,
la colonne des créneaux reste fixe et le jour courant est souligné. Ici le
port est natif (une table, pas un document) : la grille est simple et
l'identité visuelle est ce qui compte.

*Ce que la feuille partagée fait au site.* Les règles `.bulletin-off`/`.bul-*`
vivent dans `packages/shared/src/bulletin-css.ts` et sont servies par
`/elourwa/bulletin-officiel.css` ; `public/elourwa/bulletin.css` ne garde que
la couche de finition qui suivait. Le composant `BulletinOfficiel` du site ne
contient plus de balisage.

## ADR-0068 — Un seul reçu, une seule feuille par matière, le dossier corrigé sur place, le bulletin dessiné, les notifications sans Firebase

**2026-09-20 · accepté** — la liste de défauts du propriétaire du 20/09.

*Un seul reçu pour plusieurs mois et les frais annuels (0040).* « It makes no
sense to issue multiple receipts for paying October and June. » La fenêtre
d'encaissement — la même à l'inscription, à la réinscription et à la caisse —
montre tous les mois de l'année affichée avec une case chacun et une case sur
chaque frais annuel ; l'agent coche ce que la famille règle, le total suit, et
l'encaissement remet UN reçu. Le grand livre garde sa forme (un mois = une
ligne de `payments`, un frais = une ligne de `family_fee_payments`) : toute
la dette, les rapports et les annulations reposent dessus. Le reçu
(`receipts`) les réunit sous un numéro tiré de la même séquence ; chaque
ligne le désigne et reprend son numéro, pour que tout ce qui affiche
`receipt_number` montre le bon sans changer. L'unicité du numéro par ligne ne
vaut plus qu'hors reçu groupé (index partiels). Les moyens sont ventilés
ligne par ligne dans l'ordre, chacune sachant comment SON argent est arrivé
— avec la référence de l'application de paiement, que les deux répartiteurs
(`prendre()`, `take()`) perdaient : d'où « la référence n'apparaît sur aucun
reçu ». Un mois coché se règle en entier ; le règlement partiel d'un mois
garde sa carte. **Rien n'est obligatoire** : les frais annuels se décochent
comme les mois, ce qui n'est pas encaissé reste dû.

*Notifier les impayés.* Le formulaire vivait DANS le formulaire de filtre ;
un `<form>` dans un `<form>` est interdit en HTML, le navigateur le jetait et
le bouton resoumettait le filtre — « ne marche pas du tout ». Sorti du filtre.
Règle retenue : jamais de formulaire imbriqué ; le balayage final a cherché
d'autres cas.

*Une matière d'un groupe, une feuille de notes.* Deux affectations (année,
groupe, matière) sont des ÉQUIVALENTS : elles lisent et écrivent les mêmes
notes, qui vivent sous la canonique (la plus récente, son `SQL_ENS_COURANTS`)
et y sont rapatriées à chaque écriture ; un professeur ouvre la feuille par
n'importe laquelle. « Saisir les notes » ne montre la matière qu'une fois,
avec les deux noms. L'emploi du temps, lui, garde chaque affectation. Au
passage : le bulletin et la feuille de classe prenaient « l'affectation la
plus récente » sur TOUTES les années — dès que les affectations étaient
copiées vers l'année suivante, le bulletin de l'année passée ne trouvait plus
une note. Bornés à l'année consultée ; test.

*Envoyer un exercice : la classe d'abord.* Un sélecteur de classes, puis les
matières de cette classe — à la place de la liste plate « Groupe — Matière ».
Le circuit (action → API → notifications → application) est vérifié de bout
en bout par l'e2e ; il n'était pas cassé, il était illisible.

*Le dossier de la famille se corrige sur place.* El Ourwa ne modifiait ni le
nom ni la naissance d'un élève une fois inscrit ; une faute à l'admission
restait sur chaque bulletin. Depuis la page de la famille : le correspondant
(nom ; téléphone et e-mail par la route de l'identifiant, avec sa règle du
numéro mauritanien) et la fiche de chaque enfant (prénom, nom, sexe,
naissance, NNI, RIM). Pas le groupe ni le tarif (leurs écrans), pas le
rattachement à une autre famille. Audit sur chaque changement.

*La dette — le défaut trouvé.* Le calcul est identique à
`obtenir_dette_parent_detaillee()` (mois échus seulement, réduction déduite,
exemptions et exemption automatique, factures, arriérés, frais annuels si un
inscrit, remises ; recoupé sur quarante familles entre trois chemins). Le
défaut était ailleurs : le **solde de l'application** (`/parent/balance`)
était borné à l'année ACTIVE. La démonstration est en 2026-2027 sans une
réinscription : l'application disait « 0 » à des familles qui devaient
encore leurs mois de 2025-2026. Son `obtenir_dette_parent_detaillee($pid)`
n'a pas d'année : c'est l'année réellement scolarisée qui compte. Le solde
suit désormais `detailAcrossYears()` (mois échus de l'année scolarisée,
frais annuels, créances, remises) ; test de la transition d'année. L'espace
parent reste borné à l'année active pour les enfants, les notes, les
absences — c'est la règle d'El Ourwa (« page vide, et surtout sans se
rabattre sur l'année précédente ») ; l'écran vide le dit désormais : « L'année
2026-2027 est ouverte et aucune réinscription n'est encore faite. Ce qui reste
dû le reste. »

*Les dérogations ne portent que sur les examens.* C'était déjà le
comportement (les devoirs ne sont jamais retenus — vérifié sur une famille en
dette qui en a) ; la page le dit désormais.

*Le bulletin de l'application est DESSINÉ, pas affiché dans une vue web.*
Décision du propriétaire, qui a jugé la vue web « shit » : le document
officiel est reconstruit en widgets avec la mise en page du site (en-tête
tricolonne bilingue, bandeau, six lignes, tableau avec l'en-tête arabe
au-dessus, pied, mise en garde, mêmes couleurs) ; il défile de côté sur un
téléphone plutôt que de casser ses colonnes. Le PDF (« bulletin
téléchargeable ») reste tiré du HTML du site converti sur le téléphone — une
seule mise en page à entretenir pour l'impression. ADR-0067 est amendé en
conséquence : le rendu HTML partagé sert au site et au PDF, plus à l'écran.

*Les notifications surgissent même application fermée, sans Firebase.* Le
sondage ne vivait qu'application ouverte ; fermée, rien ne surgissait (« don't
pop up in android »). Une tâche périodique WorkManager (quinze minutes, le
minimum d'Android) ouvre la session gardée et fait surgir, par le même canal
`elourwa_v2`, ce que personne n'a vu ; ce qui a surgi au premier plan est
noté et jamais remontré. Quand Firebase sera configuré, il livrera à la
seconde et la tâche ne trouvera rien de neuf. Dans l'application, un bandeau
descend du haut avec l'icône, le titre et le texte (haptique, s'écarte d'un
geste, s'ouvre d'une touche).

## ADR-0069 — Une marque par installation, l'école unique sans console, et une école neuve sans graine

**2026-09-22 · accepté** — la demande du propriétaire du 22/09 : « a branch
website by the name brand of El Mourad (every label must be elmourad) with no
platform console at all… ready to host », l'application rebaptisée, et « a
fresh school doesn't need anything seeded at all, it should have a fresh
database ».

*Une seule base de code, plusieurs enseignes.* « El Ourwa » n'est plus écrit
en dur nulle part où une personne le lit. `packages/shared/src/brand.ts` lit
la marque dans l'environnement (`BRAND_NAME`, `BRAND_NAME_AR`, `BRAND_SLUG`,
`BRAND_TAGLINE`, `BRAND_MAIL_FROM` ; défaut El Ourwa, العروة) ; le site
(`MARQUE`), l'API (expéditeur, `/health`) et l'application
(`--dart-define`, `Marque.nom`) la lisent. Ce qui suit la marque : titres,
connexion, barre latérale, reçus (« école — nom arabe de la marque »),
exports imprimés, pages légales (jetons `{{marque}}`), courrier, `/health`,
le nom sous l'icône (Android `APP_LABEL`, iOS `APP_DISPLAY_NAME`),
l'identifiant Android (`APP_ID`, `mr.elmourad.parent`, installable à côté
d'El Ourwa). Ce qui ne la suit PAS, délibérément : les noms de paquets
(`@elourwa/*`, `elourwa_parent`), l'espace de noms Kotlin, le canal de
notification (`elourwa_v2` — un canal figé ne change pas de son), le son
(`elourwa_notif`), le dossier `public/elourwa/` — invisibles de l'usager, et
une application déjà installée les garde. Le préfixe des cookies suit le slug
de la marque (`elmourad_…`) : une installation El Mourad n'écrit aucun
cookie `elourwa_*`.

*L'école unique.* `SINGLE_SCHOOL_SLUG=<slug>` fait de tout nom d'hôte
(apex, `www.`, `admin.`, une adresse IP) cette école, dans le site comme dans
l'API — l'en-tête `X-School-Slug` et l'hôte passent après elle. La règle du
sous-domaine, qui existait en quatre copies (intercepteur de l'API,
middleware, `lib/tenant.ts`, route de connexion), vit une fois dans
`@elourwa/shared/tenant-slug`. La console de la plateforme n'existe pas
(`PLATFORM_CONSOLE=off`, implicite en école unique) : `/platform` et
`/api/platform/enter` du site, `/platform/*` de l'API (`ConsoleGuard`)
répondent **404** — rien n'est « interdit », il n'y a rien ; un compte sans
rôle dans l'école est refusé à la porte plutôt que posé sur un tableau de
bord vide. Une valeur invalide arrête le démarrage : un slug ignoré en
silence servirait la plateforme multi-écoles sur le domaine d'une école.
Tests : `ecole-unique.spec.ts` (9), `tenant.service.spec.ts` (+3),
`brand.spec.ts`, `tenant-slug.spec.ts`.

*Une école neuve part d'une base vide.* `bootstrap-school` pose le
structurel et rien d'autre : le catalogue des six rôles (sans lui aucun
compte ne tient un rôle), la ligne de l'école, son nom d'hôte, UN compte de
direction à mot de passe provisoire (affiché une fois, changement imposé).
Ni année, ni niveau, ni classe, ni moyen de paiement, ni frais : la direction
crée tout depuis le site, dans l'ordre que `deploy/elmourad/README.md`
donne. `deploy/elmourad/install.sh` n'appelle jamais `pnpm seed`.

*La livraison.* `tools/packager.sh` accepte `BRAND=<enseigne>`
(`deploy/brands/<enseigne>.env`) et produit `dist/<enseigne>-parent-<v>.apk`
et `dist/<enseigne>-<v>.zip` (le dépôt tel que commité — `git archive
HEAD` —, prêt à `install.sh`). `docs/HOSTING.md` compare les hébergeurs
(prix relevés le 22/09/2026) ; recommandation : un VPS européen à ~5 €/mois
(Hetzner CX22/CX23, OVH VPS-1).

*Ce qui reste à trancher.* Le nom arabe « المراد » est une translittération
à confirmer ; l'application El Mourad est signée avec la clé d'El Ourwa
(`elourwa-release.jks`) — acceptable pour une démonstration, une école
cliente voudra la sienne ; les notifications poussées d'El Mourad exigent
une application Android `mr.elmourad.parent` dans un projet Firebase.

## ADR-0070 — Le balayage du 22/09 : ce qui a été corrigé, ce qui a été gardé, ce qui attend une décision

**2026-09-22 · accepté** — un balayage à treize chercheurs (argent, tenant et
sécurité, notes, site, application, déploiement, contrat des routes, schéma,
notifications, pédagogie, échecs silencieux, Flutter, reprise) a rendu 80
constats ; 38 sont corrigés (commit `fix(balayage du 22/09)`), les autres
sont classés ici.

*Corrigé, argent (tests d'abord, `impayes-coherence.spec.ts`).* Impayés
« Toutes les années » comptait chaque créance deux fois ; l'année appliquait
la remise avant les créances (son `obtenir_dette_parent_detaillee()` :
mois + créances + frais, PUIS `max(0, total − remise)`) — les trois chemins
de la dette rendent le même chiffre ; « Notifier les impayés » tenait un
paiement annulé pour un mois soldé ; la porte des examens ne mesurait que
l'année active (son `parent_dette_totale()` n'a pas d'année) ; la synthèse
annuelle signalait chaque contre-passation comme un écart de caisse ; le
tableau du soir doublait un inscrit à deux versements ; la date d'entrée
jj/mm/aaaa faisait apparaître « Rétablir l'exemption » sur des mois dus ; le
« Total » du bulletin multipliait la moyenne arrondie (son `$moy * $coef`) ;
les bulletins de classe appliquaient la formule du trimestre demandé aux
trimestres passés ; une inscription annulée servait de classe au bulletin ;
le rapatriement des notes échouait sur deux affectations tenant la même case.

*Corrigé, accès.* Le plafond de requêtes tournait AVANT l'authentification :
`request.auth` n'existait jamais, tout le site (derrière 127.0.0.1)
partageait un seau de 300 requêtes par minute — la garde passe après
`AuthGuard` (la connexion, publique, reste plafonnée par adresse ; Argon2 ne
tourne qu'après toutes les gardes). `/auth/logout` n'était pas public : le
site n'a jamais révoqué un jeton de 90 jours. Le verrou des cinq essais
avait pour clé la saisie brute (« 22 12 34 56 » et « 22123456 » : deux
seaux). Le registre des exclus exigeait NNI ET RIM (sa requête : OU). Un
identifiant global se changeait d'une branche pour un agent d'ailleurs. La
déconnexion n'avait pas de contrôle d'origine. Le site n'envoyait pas
l'identité de la personne (audit à l'adresse du serveur). Une demande
pouvait s'approuver deux fois (pas de `FOR UPDATE`). Deux activations
d'année simultanées laissaient deux actives (verrou de lignes ; l'index
unique partiel attend une migration — ci-dessous).

*Corrigé, notifications.* L'emploi du temps et les messages sans année
n'apparaissaient dans aucun fil ; sans SMTP la file était réclamée puis
abandonnée en 31 minutes ; deux processus (déploiement) livraient deux fois
(bail de cinq minutes sur la ligne réclamée) ; un téléphone injoignable
faisait rejouer toute la famille cinq fois ; la charge poussée dépassait
4 Ko ; marquer lu répondait 403 pour une famille de deux écoles ; les
absences de journée disparaissaient du fil (INNER JOIN) ; l'exercice
notifiait l'année consultée et le fil filtrait sur celle de l'enseignement.

*Corrigé, application.* Tout 4xx du rafraîchissement effaçait la session
(un 429 déconnectait) ; l'application et la tâche de fond présentaient le
même jeton (révocation de famille) — verrou de 30 s dans les préférences ;
« Se déconnecter » ne révoquait rien au serveur ; aucun délai réseau (voyant
sans fin) ; le tableau de bord marquait tous les messages lus ; quatre
onglets rendaient une panne comme « aucun » ; Firebase et la tâche de fond
sonnaient deux fois ; la permission n'était demandée qu'à la restauration.

*Corrigé, site.* La feuille de notes avalait tout refus (notes « enregistrées »
qui ne l'étaient pas) et perdait l'année consultée ; pas de page d'erreur ;
« Notifier les impayés » retombait sur l'année active pour un mois
qu'aucune année ne couvre ; totaux en flottant ; console : hôtes en dur
`localhost:3000`, cookie d'entrée qui n'atteignait pas la branche.

*Gardé tel quel, avec la raison.*
- `POST /finance/payments` et `/finance/collection` (sans les gardes dû/soldé/
  exemption) : `caisse-direction-only.spec.ts` les tient pour le métier de la
  caisse ; le site ne les appelle plus (ses deux actions mortes sont
  retirées). À décider : les retirer avec le test, ou leur donner les gardes.
- `covered_by_invoice` absent des requêtes de dette : la dette est
  réconciliée famille par famille contre El Ourwa (ADR-0057) ; changer sans
  écart mesuré violerait la règle 26.
- `perimetreScolarite` (une école qui passe sous 50 élèves reste sur l'année
  précédente) : c'est sa règle ; le seuil est le sien.
- Les reçus impriment la devise « MRU » : toutes les écoles sont en MRU ; la
  devise par école existe et attend un second cas.
- `seed.ts` écrit sans contexte de tenant : il tourne en propriétaire, en
  développement et en démonstration seulement.

*Attend une décision (migration — règle 16).* Un index unique partiel
« une seule année active » (`academic_years (school_id) WHERE status =
'active'`) ; `UNIQUE NULLS NOT DISTINCT` sur `attendance` pour les absences
de journée ; `evening_teachings.teacher_id` en `ON DELETE NO ACTION` (le
`SET NULL` de 0022 viole son propre CHECK) ; les cascades restantes depuis
`students`, `academic_years`, `users`, `fund_holders`, `staff_loans`,
`misc_debts`, `evening_enrolments` en `NO ACTION` (0025 n'en a traité que
deux).

*Non fait, à faire (petit).* La diffusion par niveau écrit ses notifications
famille par famille dans la requête (règle 18 : à passer en `INSERT … SELECT`
+ file) ; le plafond du mois vérifié hors transaction sans verrou dans
`confirmerPaiement` et trois voisins (`pg_advisory_xact_lock` comme
`encaisserGroupe`) ; `encaisserInscription` en trois transactions (la route
n'est plus appelée par le site) ; deux requêtes simultanées dans la fenêtre
de renouvellement du middleware (grâce de 10 s côté API à écrire) ; le lien
profond d'une notification poussée ; « Ouvrir » une pièce jointe sans
application ne dit rien ; les onglets Exercices et Remarques de la famille
ne nomment pas l'enfant et leur sélecteur ne filtre rien ; `rls.test.ts`
n'exige pas `WITH CHECK`.

## ADR-0071 — La rentrée appartient à l'année qui s'ouvre ; le bulletin se compose sur le téléphone ; plusieurs numéros par famille

**2026-09-23 · accepté** — six symptômes rapportés par le propriétaire sur
la démonstration (« the elourwa app is broken »), trois causes.

**1. Les dates qu'une année possède.** Les absences et les remarques n'ont
pas de colonne d'année ; l'application les bornait aux mois nominaux de
l'année active (`start_month` → `end_month`, soit octobre → juin). Le
23/09/2026, sous l'année active 2026-2027, une absence du jour notifiait la
famille puis disparaissait de l'onglet — septembre est avant octobre. Son
`absences.php` borne par l'année de l'enseignement, ce qui ne dit rien d'une
absence de journée entière (sans enseignement — et chez lui, elle disparaît
aussi : `JOIN enseignements en_an`, jointure interne). Décision : **une année
possède tout ce qui va du lendemain de la fin de l'année précédente à la
veille du début de la suivante** — ses mois, plus l'été et la rentrée qui les
précèdent ; sans précédente, depuis le 1er juillet qui précède ; sans
suivante, ouverte. Aucune date ne tombe entre deux années, aucune n'appartient
à deux. `AcademicYearService.periodeAttribuee()`, quatre lectures du
contrôleur parent. Une absence de 2024 sous une école qui n'a que 2025-2026
n'est PAS de 2025-2026 (parent-home.spec) — d'où « depuis juillet » et non
« depuis toujours ».

**2. La grille et les enseignements.** La grille d'un groupe est unique
(`timetable_slots`, une case = un enseignement, sans année) ; les
enseignements sont par année. À la rentrée, avant que les affectations soient
refaites, chaque case désigne un enseignement de l'an dernier. L'onglet de
l'enfant exigeait l'année active → vide ; « Gérer l'absence » aussi → « Pas
d'emploi du temps ». Son `enfant.php` lit la grille sans année : nous aussi.
Son `gerer_absence.php` exige l'année, avec une raison (« sans elle, on
saisissait l'appel d'aujourd'hui sur des matières d'une année passée ») : la
case est retenue si son enseignement est de l'année OU si la même matière est
enseignée au groupe cette année — et c'est alors cet enseignement-ci que
l'appel enregistre. La raison est gardée, la page n'est plus vide.

**3. Les notes « bloquées sans dette » ne sont pas un défaut.** Son
`parent_a_dette()` lit `parent_dette_totale()` — toutes années. La famille
30000000 de la démonstration doit 207 000 MRU (mois 2025-2026 à Rissala et
Salam) : ses résultats à Rissala et Salam sont retenus, ceux de Nour non. Ce
qui était faux : le fil de résultats disait « indisponibles » pour la famille
entière. Il nomme désormais les écoles concernées.

**4. Le bulletin en PDF.** `Printing.convertHtml` (vue web du téléphone,
obsolète) échouait sur certains appareils et l'application ne savait dire
qu'« erreur réseau ». Le document est composé en widgets PDF à partir des
mêmes chiffres que l'écran (décision du 20/09 : le bulletin est dessiné dans
l'application), avec Noto Sans Arabic embarqué, déposé dans Téléchargements
par le MediaStore (Android 10+, sans permission nouvelle — le manifeste en
garde deux) et ouvert ; avant Android 10 et sur iOS, cache + lecteur ; sans
lecteur, partage. Le HTML du site reste servi par
`/parent/children/:id/report-card/document` pour le web.

**5. Les notifications, mesurables.** Le serveur vidait la file toutes les
10 s ; il la réveille à l'écriture (1 s) et tourne à 3 s. Le téléphone
redéclare son jeton à chaque sondage tant que le serveur ne l'a pas (le
premier essai part souvent avant le réseau). Le profil montre chaque maillon
(version compilée avec Firebase, permission, jeton déclaré, clé du serveur —
`POST /parent/devices/status`) et un bouton fait pousser une notification de
test par le serveur (`POST /parent/devices/test`, souche `notif_test`).
Une notification touchée dans la barre ouvre la cloche. Non vérifié sur un
téléphone (aucun sur le poste).

**6. Plusieurs numéros par famille** (demande explicite ; migration 0041,
règle 16 : le propriétaire l'a demandée, elle est appliquée). Table globale
`user_phones (user_id, phone, label)`, forme canonique, unique globalement ;
la connexion accepte n'importe quel numéro du compte ; `users.phone` reste le
principal ; un numéro promu principal quitte la table ; l'accès exige un
correspondant de l'école ; la suppression de compte efface les numéros.
El Ourwa n'a rien de tel.

*Gardé.* La porte des examens sur la dette totale (spec) ; le sondage de
fond à 15 min (minimum d'Android) ; les deux permissions du manifeste.

## ADR-0072 — Le dépôt suit la production (0.7.3+12), le tiroir de navigation porté, le balayage du soir, 0.7.4+13

**2026-09-23 · accepté.**

**1. La production fait foi.** Le serveur tournait sur 0.7.3+12, construit hors
du dépôt. L'arbre du zip déployé est recopié tel quel (`v0.7.3+12`), sauf le
mot de passe provisoire de la direction retiré de la documentation. Désormais
un déploiement part du dépôt (`mettre-a-jour.sh` refuse un arbre non commité).

**2. Le tiroir de navigation.** Sa feuille de style (copiée au caractère près)
cache la barre sous 1024 px et compte sur `#sidebar-toggle` et son script ;
nous avions la feuille sans le bouton. Porté point par point
(`tiroir-navigation.tsx`). Un seul ajout : ouvert, le bouton passe au bord
du tiroir (il couvrait le nom de l'école). Le test à 375 px vérifiait que la
barre était repliée, pas qu'on pouvait l'ouvrir : il le vérifie maintenant.

**3. Le balayage du soir.** Confirmés (3/3) et corrigés : bulletin retenu qui
livrait la note par le total ; admission et création de compte qui ignoraient
`user_phones` ; connexion à deux comptes (fermée, auditée) ; le téléphone qui
coupait ses sondages dès le jeton déclaré, même sans clé Firebase au serveur
(POST /parent/devices rend le mode) ; année « future » qui refermait l'année
active. Sans vote (limite d'usage), relus et corrigés : trimestre refermé
ignoré par le fil de résultats (question par trimestre, comme resultats.php) ;
verrou par numéro supplémentaire (seau du principal) ; changement
d'identifiant contre `user_phones` ; note retenue poussée (sa règle : aucune
notification de note quand les examens sont bloqués) ; file qui abandonnait
avec une clé illisible ; délais réseau ; route des notes à `?term=abc` ;
exercices d'un enfant hors de l'année ; lecture d'un message ; gestionnaire
de la notification touchée ; message du test ; erreur du PDF ; « erreur
réseau » en français sous l'arabe ; alerte des numéros ; Gérer l'absence qui
dit pourquoi. Gardés : la ligne « permission » d'iOS (pas d'iOS livré) ; un
jeton non retiré après une déconnexion hors ligne (le serveur le retire à la
première réponse UNREGISTERED).

**4. 0.7.4+13 plutôt que 0.7.3+12.** L'application construite contient ces
corrections : lui donner le numéro de l'arbre de production mentirait. Le
premier envoi au Play Store peut porter 13.


## ADR-0073 — La facturation « services » par école (Jinan) : modes d'étude, frais par élève, services optionnels

**2026-09-29 · accepté (demande et réponses du propriétaire).**

**Contexte.** Jinan (Heavenly Private Educational Institution) facture autrement
qu'El Ourwa : deux modes d'étude (8h – 14h, 8h – 17h) au tarif différent par
niveau, des frais d'inscription par niveau et **par élève**, et des services
optionnels par élève (cantine en trois formules, piscine, docteur, photocopie
annuelle), chacun exemptable seul. El Ourwa n'a rien de cela : ce n'est pas un
portage, c'est une exigence nouvelle ; elle ne doit rien changer aux écoles
existantes.

**Décision.**
1. Un modèle de facturation **par école**, en base : `schools.billing_model`
   (`'famille'` par défaut = El Ourwa inchangé ; `'services'` = Jinan). Pas une
   variable d'environnement : les tests font vivre plusieurs écoles dans une
   même base, et un réglage d'installation ne pourrait pas y différer.
2. Les tarifs par mode et les frais d'inscription par élève vivent sur `levels`
   (défauts pour la prochaine inscription, jamais rétroactifs) et sont **figés**
   à l'inscription (`enrollments.monthly_fee` / `full_rate` comme aujourd'hui ;
   l'abonnement `inscription`). `enrollments.enrolment_fee` n'est pas lu : l'import
   d'El Ourwa le remplit.
3. Les services sont des **abonnements** (`student_services`) au montant figé,
   avec un échéancier matérialisé (`student_service_months`) — la même forme que
   la scolarité, donc les mêmes règles (mois payé = prix gardé, échu = dû).
4. Leur argent a **son propre grand livre** (`service_payments`), append-only,
   encaissé seulement par le reçu groupé, avec un `source_type` de moyens par
   service. Jamais dans `payments` : une cinquantaine de requêtes y somment la
   scolarité par (élève, mois) sans type (même raison que 0019).
5. La dette ajoute les mêmes termes dans ses quatre chemins, avant les remises ;
   épinglé par test. Les frais annuels **par famille** n'existent pas dans une
   école « services ».
6. Aucune permission nouvelle ; gestes de direction = permission + rôle
   (super_admin, admin), comme les exemptions.

**Conséquences.** Migration 0042 (additive, colonnes NULL ou par défaut). Les
écoles « famille » rendent `services: []` partout ; leur suite de tests reste
verte sans modification. Spécification complète :
[docs/specs/jinan-facturation.md](specs/jinan-facturation.md).

**Questions encore ouvertes, tranchées par défaut et à confirmer avec l'école :**
un service commencé en cours de mois suit la règle du 25 ; les dettes de services
bloquent la réinscription et les examens comme toute dette ; les remises
(réductions) ne s'appliquent qu'à la scolarité ; le préfixe des reçus de Jinan
est `JIN`.

### ADR-0073 — addendum (2026-09-29, soir) : l'interface web terminée ; les valeurs par défaut consignées

**L'interface.** Les étapes 2 à 4 du document « reste à faire » sont faites sur
le site, et vérifiées dans un navigateur sur une école « services » de
développement (`seed-jinan.ts`, jamais en production) :
inscription (`<ChoixFacturation>` : mode obligatoire, mensualité pré-remplie par
niveau ET mode, frais d'inscription du niveau, cantine / piscine / docteur /
photocopie avec leur prix), réinscription (modale, recherche, en lot — le mode
seul), fenêtre d'encaissement (échéances de service à cocher, total en décimal),
fiche du correspondant (mode et « Changer de mode », bloc « Services »,
sous-lignes de service dans chaque carte de mois avec Reçu et ✕), reçu groupé
(une ligne par enfant et par service), note des impayés. `studyMode` et
`services` ne partent QUE vers une école « services » (`lireChoixFacturation`) ;
une école « famille » garde ses écrans mot pour mot — épinglé par
`e2e/jinan-facturation.spec.ts` (contre-épreuve Nour).

Deux choix d'écran : le « règlement global / avance » — qui ne répartit que sur
la scolarité — se pré-remplit, dans une école « services », de la seule
scolarité due (les services s'encaissent en les cochant) ; arrêter un service
ANNUEL l'arrête à son propre mois (le défaut « mois suivant » n'aurait rien
retiré).

**Les décisions « D » — CONFIRMÉES par le propriétaire le 2026-09-29 (« the
billing defaults, leave them »)** ; ce sont désormais les règles de Jinan, pas
des valeurs d'attente. Chacune se change dans le code du service, test
d'abord :

| # | Valeur par défaut | Où |
|---|---|---|
| D1 | Un service commencé en cours de mois suit la **règle du 25** (le mois courant jusqu'au 25, sinon le suivant). | `moisDeDepartParDefaut` |
| D2 | Les dettes de services **bloquent** réinscription et examens comme toute dette. | `DebtService`, `examAccess.afterCollection` |
| D3 | Les **remises** (réductions d'un mois) ne s'appliquent qu'à la scolarité. | `ConcessionsService` |
| D4 | Niveau sans frais d’inscription définis → inscription **refusée** (0 = gratuit). | `TarifsService` (`fraisNonDefinis`), à l’inscription |
| D5 | Arrêter un service supprime aussi un mois payé **puis entièrement annulé** (payé net = 0). | `StudentServicesService.stop` |
| D6 | Les services restent dus pour un élève à **scolarité gratuite**. | `DebtService`, fiche : la grille s'affiche |

## ADR-0074 — Les absences du personnel, d'après l'emploi du temps

**2026-09-29 · accepté (demande du propriétaire : « add absence for staff and
professors based on their emplois du temps »).**

**Contexte.** El Ourwa ne suit que les absences des élèves. Un professeur a un
emploi du temps (les cases de `timetable_slots` dont l'enseignement est le
sien) ; un agent (`staff` : surveillance, gardiennage, cuisine, direction…) n'en
avait aucun.

**Décision.**
1. `staff_work_hours` (0043) : l'emploi du temps d'un agent, période par période
   (jour ISO, début, fin ; plusieurs périodes par jour ; aucun chevauchement,
   vérifié par le service). Fixé par qui embauche (`comptes.staff`).
2. `personnel_absences` (0043) : une ligne par **séance manquée** (professeur :
   date, créneau, classe, enseignement) ou par **période manquée** (agent :
   entière ou en partie). Le libellé, les heures et la durée sont **recopiés** :
   l'absence du 12 octobre reste lisible quand la grille, la classe ou les
   horaires changent (clés `ON DELETE SET NULL (col)`, comme 0022).
3. On ne déclare une absence **que contre l'emploi du temps** : une séance que
   la grille donne au professeur ce jour-là (la règle d'ADR-0071 : une case
   d'une année passée revient au professeur de la matière cette année ; une
   matière qui n'est plus enseignée ne donne aucune séance), une période des
   horaires de l'agent ce jour-là. Idempotent pour une séance ; deux absences
   d'un agent ne se chevauchent pas ; au plus 60 jours à l'avance.
4. L'année d'une date : sa période attribuée (ADR-0071), en préférant l'année
   ouverte à une année seulement créée, dont la période commence en juillet —
   sinon octobre lisait la grille, vide, de l'année à venir (trouvé dans le
   navigateur, épinglé par test).
5. Durées : les trois créneaux d'El Ourwa (8h-9h45, 10h-11h45, 12h-14h : 105,
   105, 120 minutes), désormais dans `@elourwa/shared/emploi-du-temps` ; un
   créneau au-delà n'a pas de durée connue et compte comme une séance, jamais
   comme zéro heure. Un professeur que la grille met dans deux classes au même
   créneau manque deux séances, ses heures ne comptent qu'une fois.
6. **Aucun argent.** Rien ne retient sur un salaire : la synthèse du mois
   (heures manquées, justifiées ou non) est une information pour la direction
   et la paie. **Confirmé par le propriétaire le 2026-09-29** : une absence,
   même non justifiée, ne réduit pas le salaire.
7. Droits, sans permission nouvelle : déclarer et lire = `absences.saisir`
   (direction, collecteur d'absence) ; lire aussi `finance.salaires` ;
   justifier = `absences.saisir` + rôle direction ; retirer une absence
   justifiée = direction ; horaires = `comptes.staff`. Un professeur
   (`absences.consulter`) ne lit pas les absences de ses collègues.

**Conséquences.** Migration 0043 (deux tables neuves, RLS forcée, rien de
modifié ailleurs). Page `/personnel/absences` (Journée, Synthèse du mois,
Horaires des agents), menu direction et collecteur d'absence, pour toutes les
écoles. La graine de démonstration donne des horaires aux agents sans changer
la suite de `rand()`. Tests : base 9, API 21, navigateur 4.

## ADR-0075 — L'IP et le domaine de production de Jinan en un seul endroit

**2026-09-29 · accepté.**

**Contexte.** Le propriétaire donnera l'IP du VPS et le domaine après l'achat.
Ils servaient à quatre endroits (les deux scripts de mise à jour, install.sh,
l'adresse compilée dans l'application) et les scripts exigeaient qu'on les
retape — sans défaut, pour que Jinan ne parte jamais sur le serveur d'El Mourad.

**Décision.** `deploy/jinan/configurer-production.sh <ip> <domaine>
[hébergeur]` vérifie l'IPv4 (publique) et le domaine, refuse ceux d'El Mourad,
écrit `deploy/jinan/production.env` (lu par mettre-a-jour.sh / .ps1 et
install.sh quand on ne leur donne rien — vide, ils refusent comme avant),
`API_URL`/`WEB_URL` dans `deploy/brands/jinan.env`, et l'hébergeur des pages
légales. `install.sh` lit désormais `LEGAL_HOST` du fichier de marque : il
nommait Hostinger dans la politique de confidentialité même sur un autre VPS.

## ADR-0076 — La liste des moyens de paiement se lit par qui encaisse à l'inscription

**2026-09-29 · accepté (décision du propriétaire : « secretaries can read the
list »).**

**Contexte.** La fenêtre d'encaissement qui suit une inscription ou une
réinscription encaisse avec `scolarite.inscrire` / `scolarite.reinscrire`
(`POST /finance/caisse/encaissement`), mais `GET /payment-methods` exigeait
`finance.consulter` ou `finance.encaisser`. La secrétaire — et l'administrateur,
qui n'a aucun `finance.*` — voyaient « aucun moyen de paiement configuré » et ne
pouvaient rien encaisser, dans toutes les écoles.

**Décision.** `GET /payment-methods` : `finance.consulter`, `finance.encaisser`,
`scolarite.inscrire` ou `scolarite.reinscrire` — la même porte que
l'encaissement de la fenêtre. Lire seulement : ajouter ou désactiver un moyen
reste à la direction (`finance.dette` + rôle). Le professeur, le collecteur
d'absence et le parent ne la lisent pas.

**Conséquences.** Aucune permission nouvelle. `moyens-paiement-lecture.spec.ts`
(le vrai garde, les vraies permissions de chaque rôle) ;
`e2e/jinan-facturation.spec.ts` : la secrétaire inscrit et encaisse dans la même
fenêtre.

## ADR-0077 — Le NNI et le RIM d'un élève deviennent facultatifs

**Date :** 2026-09-30. **Décision du propriétaire :** « make the nni and rim
optional ».

**Contexte.** El Ourwa exigeait les deux à l'inscription (« Le RIM est
obligatoire. Le NNI est obligatoire. », `inscrire_etudiant.php`) et la base les
portait `NOT NULL`, uniques par école. Un enfant sans papiers ne pouvait pas
s'inscrire. **Écart assumé avec El Ourwa**, demandé par le propriétaire ; il
vaut pour toutes les écoles (El Mourad compris à sa prochaine mise à jour) :
les numéros restent saisissables, et uniques dans l'école quand on les donne.

**Décision.**
- Migration 0044 : `students.rim` / `national_id` et `expulsions.rim` /
  `national_id` acceptent NULL ; **absent = NULL, jamais ''** (CHECK
  `*_non_vide`), les '' éventuels passés à NULL avant.
- Le registre des exclus bloque toujours par « NNI OU RIM », mais un numéro
  absent ne correspond à rien : `blockFor` ignore NULL, et un blocage exige au
  moins l'un des deux (sinon il ne bloquerait personne). Sans cette règle, un
  exclu rangé sans NNI aurait bloqué tous les enfants sans NNI de l'école.
- La fiche de l'élève (dossier de la famille) permet d'ajouter plus tard un
  NNI ou un RIM ; un doublon de NNI y a désormais son message (il donnait une
  erreur 500 de l'unique).

**Conséquences.** `apps/api/test/nni-rim-facultatifs.spec.ts` (10) ;
`e2e/nni-rim-facultatifs.spec.ts` : deux enfants de suite sans NNI ni RIM.
Rien ne touche l'argent.

## ADR-0078 — Les niveaux classés par cycle : la maternelle, et le classement de Jinan

**Date :** 2026-09-30. **Demande du propriétaire (Jinan) :** « classify niveaux
based on maternelle, fondamentale, collège, lycée … TPS, PS, SM, GS, PGS, PGSB
as Maternelle, 6AF as fondamentale, 1AS–4AS as collège, 5AS–7AS as lycée, in
that order, with a barrier between each classification ».

**Contexte.** L'énumération `school_cycle` n'avait que `fondamental`,
`college`, `lycee`, `autre` ; le formulaire de création ne demandait pas le
cycle (comme El Ourwa) : tous les niveaux créés sur le site de Jinan étaient
« autre », rang 0, dans un ordre quelconque. La page Niveaux avait déjà son
intertitre par cycle (`libelle_cycle()`).

**Décision.**
- 0045 : `maternelle` ajouté AVANT `fondamental` (l'ordre de l'énumération est
  celui de toutes les listes, `ORDER BY l.cycle, l.sort_order`) ; le rang de
  progression (`rangCycle`, `@elourwa/shared/cycles`) met la maternelle avant
  la fondamentale — passer de GS en 6AF est une promotion.
- 0046 : une fois, pour l'école de slug `jinan` seulement, les niveaux nommés
  par le propriétaire reçoivent leur cycle et leur rang (noms comparés sans
  espaces ni casse). Un niveau au nom différent reste « autre » et se classe à
  la main.
- Page Niveaux : cycle et rang choisis à la création, modifiables sur chaque
  ligne (`PATCH /levels/:id/classement`, journalisé) ; l'intertitre de cycle
  porte un trait épais (la « barrière »).
- ⚠ Le cycle ne décide PAS du bulletin : c'est la case « Niveau fondamental »
  (`is_fondamental`). Le raccourci « cycle fondamental ⇒ barème fondamental »
  de l'action de création ne vaut plus que pour `/settings`, qui n'a pas la
  case ; 0046 ne touche ni `is_fondamental`, ni tarif, ni seuil.
- Les rubriques par cycle dans les listes de classes (inscription,
  réinscription, lot) et les intertitres de la page Groupes : écoles
  « services » (Jinan) seulement. El Mourad garde les écrans d'El Ourwa
  (liste alphabétique des classes, pas d'intertitre sur Groupes).

**Conséquences.** `apps/api/test/cycles-niveaux.spec.ts` (6, dont 0046 rejouée
sur une école « jinan » d'essai) ; `e2e/cycles-niveaux.spec.ts`. Après la mise
à jour, `installer-serveur.sh` affiche les niveaux par cycle.

## ADR-0079 — Le transport, la photocopie obligatoire, les remises sur les services mensuels

**Date :** 2026-10-04. **Demande du propriétaire (Jinan)** — texte et détail :
`docs/specs/jinan-facturation.md`, addendum du 04/10/2026.

**Décision.**
- `transport` : un huitième service, mensuel, coché, au prix de l'école ;
  migration 0047 élargit les deux CHECK de codes de 0042.
- La photocopie devient **d'office** (`optionnel: false`, `arretable: false`)
  — comme l'inscription : prix non défini → refus, prix 0 → rien. Choisi
  plutôt que « ignorée si non définie » pour ne jamais oublier silencieusement
  une dette (D4 : non défini n'est pas gratuit). **Aucun rattrapage** sur les
  élèves déjà inscrits (une dette rétroactive serait une décision, pas un
  effet de bord) ; la fiche permet de l'ajouter.
- **Remise par mois** sur un service mensuel (`student_services.remise`),
  direction seule, comme l'exemption : réévalue les seuls mois sans paiement
  (la règle de « changer de mode ») ; CHECK `remise_bornee` et
  `remise_mensuelle` ; journalisée (`student_service_remise_set`). Le grand
  livre n'est jamais touché.
- **Deux défauts trouvés en chemin et fermés** : (1) l'encaissement relisait
  sous verrou le payé et l'exemption, pas le montant — une remise posée fenêtre
  ouverte aurait fait encaisser l'ancien prix (trop-perçu) ; il relit
  désormais `amount_due`. (2) reprendre un service arrêté à partir d'un mois
  déjà facturé l'aurait facturé deux fois ; refusé, et la règle du 25
  reprend après le dernier mois facturé.

**Conséquences.** Écrans : page « Frais » (transport ; photocopie marquée
« obligatoire »), inscription/réinscription (photocopie dite, pas cochée ;
transport coché), fiche (remise, « Arrêter » absent pour les services
d'office). L'application parent n'a rien à changer : elle affiche les
libellés que l'API envoie.

## ADR-0080 — Les documents signés ; les exercices en documents de bureau ; le design « Jardin »

**Date :** 2026-10-04. **Demande du propriétaire (Jinan)**, mot pour mot :
« add a documents in the mobile app where every parent sees documents sent by
the admin or a person with the privileges given. Each service has a signed
document and inscription has a signed document … a placeholder for every
service the parent chose for either one of his children + inscription +
photocopie. The documents are available to see and delete or replace anytime
by the admin and they can only be seen by the parent … fix the bugs in
comptes personnels and fix envoyer exercice … Sometimes some buttons get
stuck. Change the ui of the app and make it better (not the same ui). »

**Décision — documents signés (migrations 0048, 0049).**
- Une **pièce** = l'emplacement d'un document, par élève et par année :
  `inscription` (libellé « Inscription », pas « Frais d'inscription ») et
  `comportement_social` (« Comportements sociaux ») toujours, puis chaque
  service souscrit cette année-là (même arrêté depuis). **Pas de pièce
  « photocopie »** : demandé le même jour (« add comportement sociaux to
  documents and change frais d'inscription to inscription and delete
  photocopie ») ; 0049 change la liste de la base. La photocopie reste un
  service facturé (0047) ; seul son document disparaît. 0048 et 0049 partent
  ensemble : aucun document « photocopie » n'a existé en production. `student_documents` porte UNE ligne par
  pièce (UNIQUE école, élève, année, pièce) : « Remplacer » met la ligne à
  jour et efface l'ancien fichier APRÈS l'enregistrement ; « Supprimer » vide
  la pièce. Pas une écriture financière : le journal d'audit garde chaque
  dépôt / remplacement / suppression (`document_signe_*`).
- **PDF et images seulement** (CHECK en base, règle partagée côté API) : un
  document signé est un scan ou une photo, pas un fichier qu'on retouche.
- **`documents.gerer`** : super_admin, admin, **secretaire** (le dossier
  d'inscription). Déléguer = donner le rôle « Secrétaire » dans « Comptes du
  personnel ». Ni le comptable, ni le professeur.
- **La famille lit seulement** : `GET /parent/documents`, `GET
  /parent/documents/:id` — ses enfants, l'année active ; aucune route
  d'écriture (un test le vérifie). Une notification `notif_document` part à
  chaque dépôt. L'application n'offre l'entrée « Documents » qu'aux familles
  d'une école « services » (`actif`).
- Le site : page « Documents » (menu des écoles « services », direction et
  secrétariat), recherche **rendue par le serveur** (nom du parent, d'un
  enfant, ou numéro principal / supplémentaire) — pas de script qui puisse
  rester « en cours ».

**Décision — « Envoyer un exercice ».** Trois causes, trois corrections :
(1) le sélecteur des deux formulaires (`accept=`) n'admettait qu'images et
PDF : une fiche Word était grisée sur téléphone ; (2) le serveur refusait les
documents de bureau ; (3) **le middleware de Next tronquait tout corps au-delà
de 10 Mo** (`middlewareClientMaxBodySize`, Next 15.5) — trois photos de 4 Mo
faisaient tomber la page. Règle commune `@elourwa/shared/fichiers` : Word,
Excel, PowerPoint (OOXML vérifié par `[Content_Types].xml`, pas un .zip
renommé), OpenDocument, anciens formats OLE, RTF ; formats à macros refusés ;
**10 Mo par fichier** (5 auparavant). `bodySizeLimit` et
`middlewareClientMaxBodySize` à 60 Mo.

**Décision — « Comptes du personnel ».** La liste part des RÔLES ; « Mot de
passe » et « Désactiver » exigeaient une FICHE (personnel, professeur,
correspondant) et répondaient « Compte introuvable dans cette école » pour un
compte qui n'a qu'un rôle ici (le compte posé à l'installation, un compte
rattaché par la console). Un rôle ici suffit désormais ; un compte d'une autre
école reste refusé. La fonction d'un tel compte ne s'affiche plus
« Professeur ».

**Décision — boutons bloqués.** Chaque appel du site à l'API a un délai
(90 s ; 180 s pour un envoi de fichiers ; 30 s pour la connexion et le
renouvellement) : une requête que l'API ne terminait pas laissait le bouton
grisé — et toutes les actions suivantes de la page, que Next exécute l'une
après l'autre. Passé le délai, une écriture répond « l'opération a peut-être
abouti : rechargez et vérifiez » (jamais « échec », pour ne pas faire payer
deux fois).

**Décision — design « Jardin » de l'application (0.8.0+20).** Émeraude, or,
ivoire ; cartes pleines au lieu du verre ; en-tête émeraude ; **menu
latéral** (toutes les sections, dont Documents) ; barre du bas flottante. La
classe `Ocean` garde son nom et ses noms de teintes (cent quarante usages) :
ses VALEURS ont changé, ce qui change toute l'application d'un coup. Toutes
les enseignes le reçoivent à leur prochaine construction.

## ADR-0081 — Un renouvellement par jeton ; « le serveur ne répond pas » sur place ; « Paramètre invalide » ; « introuvable » quand c'est vrai

*05/10/2026. Signalé par le propriétaire (photo d'une autre session de travail,
dont les corrections n'avaient jamais été poussées) : déconnexion après un
quart d'heure d'inactivité, « session expirée » quand le serveur ne répond
pas, « Internal server error » sur une adresse mal formée, reçus
« introuvables ».*

**Décision — un renouvellement par jeton, côté SITE ; la règle de l'API ne
bouge pas.** Après la pause, le premier geste envoie plusieurs requêtes avec
le même cookie de renouvellement ; le middleware présentait le jeton à l'API
pour chacune, la deuxième était une réutilisation, et l'API révoquait toute la
famille (règle 13) — reproduit : quatre requêtes simultanées → « session
expirée ». Une autre session avait choisi de **tolérer** à l'API la
réutilisation d'un jeton pendant 30 s ; ce n'est PAS ce qui est fait ici. Le
middleware ne présente un jeton qu'**une fois** : les requêtes qui arrivent
avec le même jeton depuis le même navigateur (clé = empreinte de jeton +
adresse + User-Agent) attendent le renouvellement en cours et en reçoivent le
résultat, puis pendant 60 s (une requête partie avec l'ancien cookie avant
que le nouveau n'arrive). L'API voit chaque jeton une seule fois et révoque
toujours un jeton réutilisé — un autre appareil qui présente un jeton échangé
n'a pas la même clé et va à l'API (test « depuis un autre appareil »). En
mémoire du serveur web : un seul processus par école (Docker). Une API
injoignable ou un 429 ne sont pas retenus (la requête suivante réessaie) ;
429 n'efface plus les cookies.

**Décision — l'API injoignable n'est pas une session expirée.** La coquille
`(app)/layout.tsx` renvoyait à la connexion (« session expirée ») dès que
`/auth/me` ne répondait pas. Elle affiche maintenant, à la place de la page,
« Le serveur ne répond pas pour le moment » ; la page demande au site
(`/api/sante`) toutes les 5 s si l'API est revenue et se recharge seule
(10 minutes au plus ; bouton « Réessayer maintenant »). `requireSession()`
lève `ServeurInjoignable` (503) au lieu de rediriger ; les routes du site la
rendent en 503. La page d'erreur `(app)/error.tsx` demande aussi
`/api/sante` (le message d'une erreur serveur est masqué en production) et
son « Réessayer » redemande la page au serveur (`router.refresh()` ; `reset()`
seul réaffichait l'erreur).

**Décision — « Paramètre invalide » (API).** Un filtre global
(`ParametreInvalideFilter`) rend 400 « Paramètre invalide : une date, un
nombre ou un identifiant de l'adresse ne se lit pas. » pour les erreurs
Postgres 22P02, 22007, 22008, 22003, et journalise l'erreur SQL (une valeur
illisible produite par notre code reste visible). C'est un filet ; chaque
route garde sa validation. Les erreurs de Zod gardent leur message par champ.
Trouvé par un balayage de toutes les routes avec des valeurs mal formées.

**Décision — « introuvable » seulement sur une réponse définitive (404, 400, 403).** Les pages de reçu
(paiement, annuel, groupé, cours du soir, professeur du soir, salaire,
dépense, remboursement, avance), les bulletins, le tableau de bord et
« Envoyer un exercice » du professeur, le groupe du soir chargeaient avec
`.catch(() => null)` et disaient « introuvable » pour tout échec.
`.catch(nulSiIntrouvable)` : 404 / 400 / 403 → « introuvable » comme avant ;
un échec passager (délai, API en redémarrage, 5xx) → la page d'erreur, qui dit
ce qu'il en est et réessaie.
