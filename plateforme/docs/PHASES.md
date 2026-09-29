# Phases — task checkboxes

Copied from `PROJECT.md` Part 3, which is the authority. `PHASES.md` in the
project root documents (session-by-session guidance) expands each of these.

**No phase begins until the previous one's exit criteria pass.**

Legend: `[x]` done · `[~]` partially done, see note · `[ ]` not started

---

## PHASE 0 — Foundation and environment (1 week)

**Goal:** a running, seeded, tested skeleton. No features.

- [x] 0.1 Read PROJECT.md, ARCHITECTURE.md, El Ourwa source and SQL. Domain summary → `docs/DOMAIN.md`. Corrected by the owner twice (moughataas are not branches; three-level fees).
- [x] 0.2 `docs/GLOSSARY.md` — 95+ terms, 9 ambiguities resolved and recorded.
- [x] 0.3 `docs/FEATURES.md` — 166 rows across all 57 pages; 5 dead stubs identified.
- [x] 0.4 Monorepo: pnpm workspaces + Turborepo. `apps/api` (NestJS + Fastify), `apps/web` (Next.js 15), `packages/db`, `packages/shared`, `apps/mobile` (Flutter), `infra/`, `tools/`.
- [x] 0.5 `infra/docker-compose.dev.yml`: Postgres 16, Redis 7, Mailpit, health checks, named volumes.
- [x] 0.6 Drizzle ORM wired (`packages/db/src/schema.ts`); migrations are hand-written SQL because RLS, FORCE, composite FKs and UUIDv7 have no Drizzle representation.
- [x] 0.7 `withTenant()` — `set_config(..., true)` inside a transaction. Global NestJS interceptor so no handler can bypass it.
- [x] 0.8 Two DB roles: `app_user` (RLS enforced), `app_reporter` (`BYPASSRLS`, jobs only). Asserted by test.
- [x] 0.9 Seed: École Nour / Rissala / Salam, 200 students each, identical names across all three, one parent with children in two schools, full academic year, grades, finance.
- [~] 0.10 Vitest ✓ · Playwright configured (headed) but **not executed** — browsers not installed · `flutter test` written but **not executed** — no Flutter SDK · **Testcontainers not used**: embedded-postgres instead, because Docker is not installed on this machine. See ADR-0004.
- [x] 0.11 The isolation test, including the 100-operation pooling test. 30 tests passing.
- [x] 0.12 Ports fixed: API 3001, Web 3000, Flutter web 3002, Postgres 5432, Redis 6379, Mailpit 8025. `nour.localhost:3000`, `admin.localhost:3000`.
- [x] 0.13 Skills reported (none in catalogue matched). Authored `tenant-table`, `nest-module`, `flutter-feature`, `money-handling`, `parity-check`.
- [x] 0.14 `docs/TESTING.md` and all memory files.

**Exit criteria**

- [~] `pnpm dev` starts everything — API and Web verified; Flutter needs its SDK
- [x] `nour.localhost:3000` and `rissala.localhost:3000` load with different branding
- [ ] `localhost:3002` shows the Flutter app — **blocked: Flutter SDK not installed**
- [x] `pnpm test` passes, isolation test included
- [x] All memory files exist and are populated

---

## PHASE 1 — Identity and access (2 weeks)

**Status: complete in code and tested. 50 API tests passing.**

- [x] 1.1 `users` (global), `user_school_roles`, `roles`, `role_permissions`, `audit_log`, plus `refresh_tokens`, `login_attempts`, `password_resets` (migration `0002_auth.sql`).
- [x] 1.2 Argon2id hashing, **with bcrypt verification fallback** and transparent re-hash on login. Accepts PHP's `$2y$` as well as `$2a$`/`$2b$`.
- [x] 1.3 JWT access tokens, **ES256**, 15 min. Algorithm is pinned — `alg: none` and HS256-with-the-public-key are both tested and rejected.
- [x] 1.4 Opaque refresh tokens, SHA-256 at rest, 90 days, rotated every use, **reuse revokes the whole family**. Proven by test and observed live.
- [x] 1.5 Web: `httpOnly` `Secure` `SameSite=Lax` cookies via a Next BFF (ADR-0008). Mobile: `flutter_secure_storage` + silent background refresh — **written, not executed** (no Flutter SDK).
- [x] 1.6 Permission guard driven by `role_permissions` data. `@RequirePermission()` decorator; no hardcoded role checks anywhere.
- [x] 1.7 Rate limiting: 5 attempts / 15 min, keyed on account **and** IP. Real client IP from `CF-Connecting-IP`, honoured only when the peer is genuinely Cloudflare (ADR-0009).
- [x] 1.8 Audit log on login, failure, hash upgrade, logout, and cross-school refusal.
- [x] 1.9 Password reset by emailed link; Mailpit in development, link logged when SMTP is unreachable.
- [x] 1.10 Login screens: web (`/login`, `/forgot`) done. Flutter `AuthController` written, screen pending Phase 5.

**Exit criteria**

- [x] All roles log in; each receives exactly its own permissions
- [x] A bcrypt legacy user logs in and is silently upgraded to Argon2id
- [x] Refresh token reuse revokes the family — test proves it
- [ ] Flutter app restarts and remains logged in — **code written, cannot run without the SDK**
- [x] Cross-school access returns 403 and is audit-logged — **a real bug found and fixed here, see ADR-0007**
- [x] No hardcoded role checks: `grep -rn "role === '" apps/` finds only a comment

---

## PHASE 2 — Academic core (3 weeks)

- [ ] 2.1 `academic_years`, `levels`, `groups`, `subjects`, `teachings`.
- [ ] 2.2 `students`, `enrollments` — all fee fields, `gratuit`, and `statut` including `bloque_dette`.
- [ ] 2.3 `origin` field on every migrated table.
- [ ] 2.4 Uniques scoped `(school_id, …)`. Composite FKs so school A cannot reference school B.
- [ ] 2.5 Import script: El Ourwa MySQL → Postgres. Idempotent, re-runnable, logs every mapping decision.
- [ ] 2.6 Enrol, re-enrol, transfer, archive, expel.
- [ ] 2.7 Web UI: student list (cursor pagination), student detail, enrolment forms.
- [ ] 2.8 Reconciliation: student counts, enrolment counts, per level and per group.

**Exit criteria** — ~2,153 students and ~3,506 enrolments imported · reconciliation reports **zero discrepancy** · import twice changes nothing · Arabic and French intact, 10 names spot-checked · every academic table RLS enabled and forced

---

## PHASE 3 — Grades and report cards (3 weeks)

- [ ] 3.1 `grades`, `report_cards`, `report_card_lines`, `report_card_averages`.
- [ ] 3.2 Import ~139,000 grades (batch 1,000 per statement).
- [ ] 3.3 **Port the bulletin calculation.** Read `includes/bulletin.php` line by line first. Handle `bulletin_mode_calcul = 'examen_seul'` — **and if the consumption site cannot be found, ask rather than guess.** `note_absent = -1` is a marker, never a number.
- [ ] 3.4 Grade entry: teacher and admin (teacher gated behind `notes.saisir`, not granted by default).
- [ ] 3.5 Bulletin rendering — HTML, then PDF via a queued job. RTL must work in the PDF.
- [ ] 3.6 Class-wide generation as **one set-based query**, not per-student calls.
- [ ] 3.7 Attendance: entry, consultation, `note_absent` interaction.
- [ ] 3.8 Reconciliation: every average, every line, every student.

**Exit criteria** — every average matches El Ourwa exactly for all students and terms · 30 bulletins in under 3 s · absent markers never enter an average as −1 (explicit test) · Arabic renders in generated PDFs

---

## PHASE 4 — Finance (4 weeks) — highest risk

Read `ARCHITECTURE.md` §8 before writing a line.

- [ ] 4.1 `invoices`, `invoice_lines`, `payments`, `payment_lines`, `receipts`, `fee_schedules`, `discounts`, `exemptions`.
- [ ] 4.2 `debts`, `family_debts`, `debt_repayments` — honouring `dette_calculee_depuis` and `dette_mois_depuis_annee`.
- [ ] 4.3 `expenses`, `cash_days`, `annex_collections`.
- [ ] 4.4 Accounting: `ledger_accounts`, `journals`, `ledger_entries`, `ledger_lines`, `counterparties`.
- [ ] 4.5 HR: `staff`, `teachers`, `salary_payments`, `staff_loans`, `loan_installments`.
- [ ] 4.6 **Three-level fee resolution**: per-enrolment → per-year → global → 0.
- [ ] 4.7 Receipt sequences per school with `FOR UPDATE`. Keep the free-text paper reference.
- [ ] 4.8 **Append-only enforcement** — database-level rules if possible.
- [ ] 4.9 Import all finance data with `origin` preserved.
- [ ] 4.10 `finance_daily_rollup` + BullMQ worker + nightly rebuild-from-source.
- [ ] 4.11 Web UI: cash desk, invoicing, receipts, debts, unpaid, expenses, salaries, reports.
- [ ] 4.12 Reconciliation covering every figure, per day, per month, per year, per origin.

**Exit criteria** — every financial figure matches **exactly** · all five debt buckets reconcile per family · rollups rebuilt from ledger match live · no float anywhere · 100 concurrent receipts → 100 distinct numbers · ledger `UPDATE`/`DELETE` rejected by test

---

## PHASE 5 — Parent mobile app (4 weeks)

- [ ] 5.1 Flutter architecture: routing, state, theming, French + Arabic with RTL. **Set up the Apple Developer account and APNs key now, not in 5.6.**
- [ ] 5.2 Generated Dart API client from OpenAPI.
- [ ] 5.3 Persistent login, silent refresh.
- [ ] 5.4 Screens: dashboard, child detail, bulletin, results, absences, remarks, exercises, messages, change password.
- [ ] 5.5 Offline cache (Drift or Isar) — opens instantly with last-known data.
- [ ] 5.6 FCM: `device_tokens`, channels per category with sound and vibration.
- [ ] 5.7 **Push fan-out via BullMQ**, batched 500 per multicast, retry with backoff, prune invalid tokens.
- [ ] 5.8 Triggers: bulletin published, payment received, absence recorded, announcement.
- [ ] 5.9 Android and iOS builds.

**Exit criteria** — logs in once and stays logged in · cold start to content under 1.5 s · push within 5 s with sound and vibration · 2,000-student publish does not block the request · a parent with children in two schools sees both

---

## PHASE 6 — Web app, full parity (8 weeks)

Work `docs/FEATURES.md` row by row.

- [ ] 6.1 Shell: layout, permission-aware nav, French/Arabic, per-school branding
- [ ] 6.2 Dashboard, statistics, global search, history
- [ ] 6.3 Enrolment: enrol, bulk add, re-enrol, lists, expelled, requests
- [ ] 6.4 Academic setup: years, levels, groups, subjects, timetable
- [ ] 6.5 Grades and attendance (admin views)
- [ ] 6.6 Finance UI: cash desk, school fees, unpaid, debt, expenses, live revenue, report, staff payments
- [ ] 6.7 Accounts: administrators, create user, parent/teacher/staff accounts, reset, profile
- [ ] 6.8 Teacher views (6 pages), scoped to own teachings only
- [ ] 6.9 Messaging, exercises, evening classes (`cours_du_soir` — 8 tables, external enrollees; see DOMAIN.md Q6)
- [ ] 6.10 Responsive to phone width

**Exit criteria** — every `docs/FEATURES.md` row ☑ · a teacher sees only their own classes, **proven by test, not inspection** · p95 page load under 300 ms · Playwright covers every critical path

---

## PHASE 7 — Migration and cutover (2 weeks + rehearsal)

- [ ] 7.1 Weekly anonymised snapshot into `reference/snapshots/`. Scrub names, phones, addresses; **leave every financial and academic figure untouched**.
- [ ] 7.2 Nightly shadow reconciliation → `docs/reconciliation/YYYY-MM-DD.md`, failing loudly.
- [ ] 7.3 `docs/CUTOVER.md`: runbook plus rollback.
- [ ] 7.4 **Rehearse the rollback once, for real**, timed.
- [ ] 7.5 Production infra: VPS, Caddy wildcard TLS, Docker Compose, WAL archiving + nightly `pg_dump` to B2/S3, Sentry, uptime monitoring.
- [ ] 7.6 **Restore a backup into a scratch database and verify it.**
- [ ] 7.7 Cutover at an academic year boundary — **October 2027**, since 2026-2027 is already active.

**Exit criteria** — zero discrepancies for **four consecutive weeks** · rollback rehearsed under one hour · backup restored and verified · school admin has signed off a manual sample

---

## PHASE 8 — Platform layer (3 weeks)

Build **last** — worthless until branches exist.

- [ ] 8.1 Platform admin console at `admin.<domain>`.
- [ ] 8.2 Create a branch: insert row → live instantly via wildcard DNS + wildcard cert. **No provisioning step.**
- [ ] 8.3 Custom domains via Caddy on-demand TLS, validated against registered hostnames only.
- [ ] 8.4 Appoint a `school_admin` per branch.
- [ ] 8.5 **Impersonation**: 30-minute scoped token, full audit log, persistent UI banner. Runs through **normal RLS**, never `BYPASSRLS`.
- [ ] 8.6 Combined reporting from `finance_daily_rollup` as `app_reporter`.
- [ ] 8.7 Per-school branding management.

**Exit criteria** — branch live in under 10 s with zero manual steps · admin enters any school without re-auth, banner always visible · every impersonation session audit-logged · combined report across 3 schools under 200 ms · isolation test still passes
