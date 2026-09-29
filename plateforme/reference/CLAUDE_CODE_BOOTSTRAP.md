# Claude Code — Project Bootstrap Prompt

Paste this into Claude Code in an **empty directory**, with `el_ourwa_CODE_v13.zip`, `INSTALLATION_TOTALE_v13.sql`, and `ARCHITECTURE.md` placed in `./reference/`.

This prompt is for **session 1 only**. From session 2 onward, the memory system you build here takes over.

---

# PART 0 — What we are building

A multi-tenant school management platform, successor to **El Ourwa**, a PHP system running today in Nouakchott, Mauritania.

- **Web app (Next.js)** — must contain **every** feature of El Ourwa's direction and teacher interfaces.
- **Mobile app (Flutter)** — the parent experience, rebuilt: faster, better UI, push notifications, persistent login.
- **One backend (NestJS + Fastify), one Postgres database**, many school branches, strict tenant isolation.
- A **platform admin** above all branches: creates them, appoints their admins, enters any of them without re-login, sees combined financial reports.

`reference/ARCHITECTURE.md` is the authoritative technical design. Read it fully before doing anything. This prompt tells you how to *work*; that document tells you what to *build*.

**This is a financial system.** It holds fee records, debts and payroll for thousands of families. Correctness outranks speed of delivery at every decision point.

---

# PART 1 — Session protocol (build this first, use it forever)

You have no memory between sessions. These files are your memory. **This protocol is not optional and not negotiable.**

## At the start of every session

1. Read `CLAUDE.md` (you load this automatically).
2. Read `docs/STATE.md` — current phase, last session's work, next task.
3. Read the current phase's section in `docs/PHASES.md`.
4. Post a short orientation to me before touching code:
   > *Phase 3, task 3.4 (invoice generation). Last session completed 3.3 and left the rollup worker untested. Proceeding with 3.4 unless you'd rather I finish 3.3's tests.*
5. Wait for my confirmation.

## At the end of every session

Before your final message, **always**, even if the session was short or unproductive:

1. Update `docs/STATE.md`:
   - Mark completed tasks `[x]` in `docs/PHASES.md`
   - Set "Next task"
   - Append a dated session log entry: what was done, what was left unfinished, anything that surprised you
   - Record known-broken things under "Open issues"
2. Append to `docs/DECISIONS.md` any architectural decision made, in ADR form: context, decision, alternatives rejected, consequence.
3. Add any new French→English domain term to `docs/GLOSSARY.md`.
4. Update `docs/FEATURES.md` status for any El Ourwa feature that reached parity.
5. Tell me in one paragraph what changed and what to expect next session.

If a session ends abruptly, the next session must be able to resume from these files alone. Write them for a reader with **zero** context.

## Memory files to create now

| File | Purpose |
|---|---|
| `CLAUDE.md` | Permanent standing rules. Loaded automatically every session. Keep under 200 lines — it costs context every time. |
| `docs/STATE.md` | Current phase, next task, open issues, dated session log. **The single most important file.** |
| `docs/PHASES.md` | Full phase plan with checkbox task lists and per-phase exit criteria. |
| `docs/FEATURES.md` | Traceability matrix: every El Ourwa feature → its new home → status. |
| `docs/DECISIONS.md` | ADR log. Append-only. |
| `docs/GLOSSARY.md` | French domain term → English code term. Binding once written. |
| `docs/TESTING.md` | How to run everything: dev servers, tests, seeds, emulator. |

---

# PART 2 — Session 1 tasks, in order

Do these sequentially. Report after each. Do not skip ahead.

## 2.1 — Study the source material

Read `reference/ARCHITECTURE.md` in full. Then extract `el_ourwa_CODE_v13.zip` into `reference/elourwa/` and study it:

- All 57 pages under `pages/` (42 `super_admin/`, 9 `parent/`, 6 `professeur/`)
- The business logic in `includes/` — especially `bulletin.php`, `finance.php`, `paiements.php`, `permissions.php`, `annee_scolaire.php`, `encaissement_inscription.php`
- The 77-table schema in `reference/INSTALLATION_TOTALE_v13.sql`

Do **not** run, modify or deploy the PHP app. It is a specification, not a dependency.

Produce a written summary of the domain model as you understand it: the academic year cycle, how bulletins are computed, how fees and debts flow, what `origine` means, how permissions work. **I will correct you before you build on it.** Misunderstanding the domain now costs weeks later.

## 2.2 — Build `docs/GLOSSARY.md`

The source is French; the new codebase will be English. Inconsistent translation will cause real bugs — decide once, now, and treat it as binding.

Seed it with at least: `bulletin`, `scolarité`, `impayés`, `dette`, `réinscription`, `caisse`, `reprise`, `encaissement`, `niveau`, `groupe`, `matière`, `enseignement`, `remarque`, `demande`, `exemption`, `remise`, `moughataa`, `cours du soir`, `emploi du temps`, `moyenne`, `trimestre`, `effectif`, `retrait`, `prêt`, `échéance`.

For each: French term, English code term, definition, El Ourwa table/file where it appears.

Flag anything genuinely ambiguous rather than guessing.

## 2.3 — Build `docs/FEATURES.md` — the parity contract

**This file is how we guarantee nothing is lost.** One row per El Ourwa feature. Derive it from the actual pages, not from memory.

```markdown
| # | El Ourwa page | Feature | Target | Phase | Status |
|---|---|---|---|---|---|
| 1 | super_admin/inscrire_etudiant.php | Enrol a new student | Web | 2 | ☐ |
| 2 | super_admin/bulletins_classe.php | Print all bulletins for a class | Web | 4 | ☐ |
| 3 | parent/bulletin.php | View child's report card | Mobile | 5 | ☐ |
...
```

Cover all 57 pages. Where one page holds several distinct capabilities, give each its own row. Expect roughly 100–140 rows.

**Routing rules:**
- `super_admin/*` → Web
- `professeur/*` → Web
- `parent/*` → Mobile

The mobile app is **parents only**. Teachers work in the web app, on a role-scoped view — they see their own classes and subjects, never the finance or administration sections. Build the web app responsive enough that a teacher can enter grades from a phone browser, but do not build a teacher mobile app.

Mark `☐ Not started`, `◐ In progress`, `☑ Parity verified`. A feature reaches `☑` only when it works *and* its behaviour matches El Ourwa's on the same data.

## 2.4 — Produce the phase plan

Apply the algorithm in **Part 3** to generate `docs/PHASES.md`. Show me your dependency graph and your reasoning before writing the file. I want to see the thinking, not just the output.

## 2.5 — Development environment

Build it so that **one command starts everything and I can see both apps in my browser.**

**Monorepo:** pnpm workspaces + Turborepo, per `ARCHITECTURE.md` §12.

**`infra/docker-compose.dev.yml`:** Postgres 16, Redis 7, Mailpit (email capture). Named volumes, health checks.

**Runtime ports — keep these fixed:**

| Service | Port |
|---|---|
| NestJS API | 3001 |
| Next.js web | 3000 |
| Flutter web (mobile preview) | 3002 |
| Postgres | 5432 |
| Redis | 6379 |
| Mailpit UI | 8025 |

**Local multi-tenancy:** use `*.localhost` subdomains — `toujounine.localhost:3000`, `arafat.localhost:3000`. These resolve automatically on modern browsers with no hosts-file editing. The platform admin lives at `admin.localhost:3000`.

**Flutter, seen in the browser.** `flutter run -d web-server --web-port 3002` renders the app in Chrome with hot reload — no emulator needed for day-to-day UI work. Document how to add an Android emulator for testing push notifications, which do not work on Flutter web.

**Seed data — make it prove tenant isolation.** Write `pnpm seed` producing:
- 3 schools: Toujounine, Arafat, Ksar
- ~200 students each, with **deliberately identical names across schools** (there must be an "Ahmed Ould Mohamed" in all three)
- Parents, some with children in two different schools
- A full academic year: subjects, groups, grades, bulletins
- Realistic finance: invoices, payments, receipts, debts, expenses
- One platform admin, one admin per school, teachers, parents — all with documented test credentials in `docs/TESTING.md`

**Testing stack:**
- **Vitest** — unit tests
- **Testcontainers** — integration tests against a real ephemeral Postgres, because RLS cannot be tested against a mock
- **Playwright** — web E2E, configured `headed` so I can watch it run
- **`flutter test` + `integration_test`** — mobile
- **k6** — load testing from Phase 3 onward

**The first test you write, before any feature:**

```typescript
it('RLS blocks cross-tenant reads even without a WHERE clause', async () => {
  await seedStudent(schoolA, 'Ahmed Ould Mohamed');
  await seedStudent(schoolB, 'Ahmed Ould Mohamed');
  const rows = await runInTenantContext(schoolA, tx => tx.select().from(students));
  expect(rows).toHaveLength(1);
  expect(rows[0].schoolId).toBe(schoolA);
});
```

Wire it into CI. **If it ever fails, the build fails and all other work stops.**

**Write `docs/TESTING.md`** covering: starting the stack, seeding, running each test suite, test credentials, the emulator, and how to reset the database.

## 2.6 — Skills

Check which skills and plugins are available in this Claude Code installation. Install any that genuinely fit this project — database/SQL, backend API, frontend, Flutter/Dart, testing. **Report what you found and what you installed. Do not invent skills that don't exist**; if nothing relevant is available, say so plainly.

Then author project-specific skills in `.claude/skills/`, so repeated patterns are executed identically every time rather than reinvented:

| Skill | Encodes |
|---|---|
| `tenant-table` | Creating a tenant table: `school_id`, RLS enabled + forced, policy, composite index leading with `school_id`, scoped unique constraints |
| `nest-module` | Standard module layout: controller, service, DTOs with zod, OpenAPI decorators, tests |
| `flutter-feature` | Standard Flutter feature: screen, state, generated API client, offline cache, widget test |
| `money-handling` | `NUMERIC(14,2)`, `pg` string parser, `decimal.js`, rounding only at display |
| `parity-check` | Verifying a ported feature against El Ourwa on the same data |

## 2.7 — Verification

End session 1 by showing me a working system:

1. `pnpm dev` starts everything
2. `http://toujounine.localhost:3000` and `http://arafat.localhost:3000` both load and show **different school branding**
3. `http://localhost:3002` shows the Flutter app
4. `pnpm test` passes, including the RLS isolation test
5. Then run the session-end protocol from Part 1

Nothing needs real features yet. It needs to be **alive, seeded, tested and reproducible.**

---

# PART 3 — The phase division algorithm

Use this to generate the plan. Do not improvise a different method; show your work at each step.

## Step 1 — Build a capability DAG

From `docs/FEATURES.md`, list every capability as a node. Draw an edge A→B where B cannot work without A. *(Bulletins require grades; grades require enrolments; enrolments require academic years and groups; invoices require fee schedules; debts require invoices and payments.)*

## Step 2 — Score every node

| Axis | Scale | Meaning |
|---|---|---|
| **Risk** | 1–5 | Unknowns, novel tech, correctness danger. Tenant isolation = 5. Money = 5. A settings page = 1. |
| **Value** | 1–5 | Visible benefit to the school and to parents. |
| **Cost** | 1–5 | Implementation effort. |
| **Blocking** | count | How many nodes depend on this one. |

## Step 3 — Order

Topologically sort, breaking ties by:

```
priority = (Blocking × 3) + (Risk × 2) + Value − Cost
```

**Risk is weighted heavily on purpose.** Uncertainty must be resolved early, while changing course is still cheap. Tenant isolation and money handling belong in the first phases *because* they are dangerous, not despite it.

## Step 4 — Cut into phases

Walk the ordered list and start a new phase when any of these is true:

1. **Demoability** — the accumulated work forms something I can see and use. Every phase ends with a demo. No phase is purely internal plumbing.
2. **Vertical slices, never horizontal layers.** A phase delivers *"a parent can see their child's grades"* end-to-end — database, API, UI — not *"all the database tables."* Horizontal phases produce months of invisible work and no feedback.
3. **Size ceiling** — 10–15 tasks, or 2–4 weeks. Larger phases lose coherence across sessions.
4. **Single theme** — one sentence describes the phase. If it needs "and," split it.
5. **Risk isolation** — do not put two high-risk items in the same phase. If both fail you cannot tell which caused it.

## Step 5 — Define exit criteria

Every phase needs **objective, testable** exit criteria. Not "finance module built" but:

> *Every payment, invoice, receipt, debt and expense figure for the migrated Toujounine data matches El Ourwa's output exactly, verified by an automated reconciliation script.*

A phase is not done until its criteria pass. **No moving on with known-failing criteria** — in a financial system, deferred correctness compounds.

## Step 6 — Sanity checks

- Does phase 1 prove the riskiest assumption? *(Tenant isolation.)* If not, reorder.
- Can I see something after every phase? If not, re-slice.
- Is any phase over 4 weeks? Split it.
- Does the last phase contain something high-risk? If so, move it earlier.

## Expected shape

Applied to this project, the algorithm should produce roughly the phases in `ARCHITECTURE.md` §15 — foundation and isolation first, then school core with reconciliation, then finance, then the parent mobile app, then the full web dashboard, then platform admin. **If your analysis disagrees, say so and explain why.** I would rather see genuine reasoning than a rubber stamp.

---

# PART 4 — Standing rules

These go into `CLAUDE.md` and apply to every session forever.

## Tenant isolation

1. **Never disable, bypass, or work around RLS** to make a query work. Empty results mean the tenant context is wrong — fix that, not the policy.
2. **Never use bare `SET` for tenant context.** Always `set_config(..., true)` inside a transaction. A plain `SET` persists on the pooled connection and leaks the next request into the previous school's data. This is the single most dangerous bug available in this codebase.
3. `BYPASSRLS` belongs only to cross-school reporting jobs. Never in an HTTP request path.
4. Every tenant table: `school_id`, RLS enabled **and forced**, a policy, a composite index leading with `school_id`, and unique constraints scoped `(school_id, …)`.

## Money

5. **Never `float`, `double`, or JS `number` for money.** `NUMERIC(14,2)` in Postgres; `decimal.js` or string in TypeScript. Configure the `pg` type parser to return `NUMERIC` as a string — by default it produces a float and silently loses precision.
6. **Financial records are append-only.** Corrections are reversing entries, never `UPDATE`.
7. Round once, at display. Never mid-calculation.
8. Currency is per school, stored explicitly. Never assumed.

## Cryptography

9. **JWT signing: ES256 (ECDSA, P-256).** Smaller tokens than RSA at equivalent strength, faster verification, and mobile clients verify on every request. Keys in environment variables; rotation documented from day one.
10. Passwords: **Argon2id**. Never bcrypt-with-defaults, never SHA-anything.
11. Refresh tokens: opaque random, hashed at rest, **rotated on every use, with reuse detection**.
12. **Do not use elliptic-curve crypto for data at rest.** It is for signatures and key exchange. Field-level encryption, if ever needed, is AES-256-GCM.

## Process

13. **Write the test before the feature** for anything touching money, grades or tenant isolation.
14. **Stop and ask** before any change to money handling, database migrations, or tenant isolation.
15. **No `OFFSET` pagination.** Cursor-based only.
16. **Heavy or fan-out work goes to BullMQ**, never inline in a request.
17. **Update the memory files at the end of every session.** No exceptions.
18. When porting a feature, **read the El Ourwa source first.** Its behaviour is the specification, including behaviour that looks odd — odd behaviour usually encodes a real requirement. Ask before "improving" it.
19. Keep diffs small and reviewable. Prefer several focused commits over one large one.
20. If you are unsure whether something is a bug or intentional, **ask**. Do not guess in a financial system.
21. **El Ourwa is read-only, forever.** Never write to it, never deploy to it, never propose syncing data back into it. It is the specification and the system of record until cutover — see Part 6.
22. **Never cut over a branch with a failing reconciliation.** A discrepancy in a financial total is a blocking defect, not a rounding curiosity to investigate later.

---

# PART 5 — El Ourwa feature reference

The 57 pages to inventory in `docs/FEATURES.md`.

**Direction — `pages/super_admin/` (42):**
`tableau_bord`, `statistiques`, `recherche`, `historique`, `inscrire_etudiant`, `ajouter_etudiants`, `reinscrire_etudiant`, `reinscriptions`, `expelled`, `demandes`, `annee_scolaire`, `annees_scolaires`, `gerer_niveaux`, `creer_groupe`, `gestion_groupes`, `creer_matiere`, `emploi_du_temps`, `saisir_notes`, `notes_etudiants`, `bulletins_classe`, `gerer_absence`, `finance`, `scolarite`, `impayes`, `dette`, `depenses`, `gestion_caisse`, `revenue_live`, `rapport_financier`, `paiement_staff`, `gerer_professeurs`, `ajouter_staff`, `cours_du_soir`, `administrateurs`, `creer_utilisateur`, `comptes_parents`, `comptes_profs`, `comptes_staffs`, `reinitialiser_mdp`, `modifier_profil`, `messagerie`, `envoyer_exercice`

**Parent — `pages/parent/` (9):**
`tableau_bord`, `enfant`, `bulletin`, `resultats`, `absences`, `remarques`, `exercices`, `messages`, `changer_mdp`

**Teacher — `pages/professeur/` (6):**
`tableau_bord`, `mes_classes`, `saisir_notes`, `remarques`, `emploi`, `envoyer_exercice`

**Cross-cutting logic in `includes/`:** authentication (staff and parent, separately), permissions, CSRF, security headers, i18n (French + Arabic), academic year handling, bulletin computation, finance and payment logic, enrolment collection, pagination, uploads, caching.

---

# PART 6 — El Ourwa during the build

El Ourwa is **live in production** and stays that way for the whole build. It is the system of record until each branch is formally cut over. Treat the following as binding.

## 6.1 — Never write to El Ourwa

The new platform is **read-only with respect to El Ourwa** at all times. No dual-write, no partial migration, no "just this one table synced back."

Dual-writing two systems is the classic way to lose a financial dataset. The moment both accept writes, they diverge — a payment recorded in one and not the other — and because both look authoritative, reconciliation stops being possible. One system owns the truth at any given moment. Before cutover that is El Ourwa; after cutover it is the new platform. There is no in-between state.

## 6.2 — Feature freeze on El Ourwa

From today, El Ourwa receives **security and data-correctness fixes only**. No new features.

The reason is mechanical: `docs/FEATURES.md` is a parity contract against a fixed target. If El Ourwa keeps growing, parity recedes as fast as you approach it and the project never converges.

If the school genuinely needs a new capability mid-build, it goes into the new platform's backlog — not into the PHP app. If it cannot wait, that is a decision for me to make explicitly, and it must be recorded in `docs/DECISIONS.md` along with its cost to the parity contract.

## 6.3 — Production snapshots as reconciliation fixtures

Set up a **weekly** anonymised snapshot of the live El Ourwa database into `reference/snapshots/`. Anonymise names, phone numbers and addresses; **leave every financial and academic figure untouched**, because those are what reconciliation checks.

This snapshot is the fixture for every parity test. Testing against invented data proves nothing about a system whose whole job is reproducing years of accumulated real records.

Add a `pnpm snapshot:refresh` task and document it in `docs/TESTING.md`.

## 6.4 — Shadow running

From Phase 3 onward, the new platform runs **in parallel** on real imported data without serving anyone. A nightly job:

1. Imports the latest El Ourwa snapshot
2. Recomputes every financial total, debt balance, and bulletin average
3. Diffs against El Ourwa's own figures
4. Writes a report to `docs/reconciliation/YYYY-MM-DD.md`
5. **Fails loudly on any discrepancy**

Zero discrepancies across several consecutive weeks is the only acceptable evidence that the new system is ready. Not "the tests pass" — the two systems agreeing on real money, repeatedly.

## 6.5 — Cutover at an academic year boundary

**Cut over between school years, never mid-year.**

Mid-year cutover splits a single academic year's grades, invoices and debts across two systems. Bulletins would need data from both, term averages would be computed from partial records, and a family's balance would be the sum of two half-truths. The reconciliation job could not verify any of it, because there would no longer be a single correct answer to compare against.

At a year boundary the split is clean: closed years stay whole in El Ourwa, the new year begins whole in the new platform.

**Sequence, one branch at a time:**

1. Freeze data entry in El Ourwa for that branch, at end of year
2. Final full import into the new platform
3. Run reconciliation — **any discrepancy aborts the cutover**
4. Have the branch's admin verify a sample by hand: a few families' balances, a few bulletins
5. Switch the branch's domain to the new platform
6. Set El Ourwa to read-only for that branch
7. Keep it read-only and reachable for **at least one full academic year**

Never cut over more than one branch at a time, and never in the same week as another. If something is wrong, you need to know which branch and which change caused it.

## 6.6 — Rollback

Until the branch has run one full term on the new platform, rollback must remain possible: El Ourwa stays deployed, its database intact, its domain reassignable within an hour. Document the exact rollback steps in `docs/CUTOVER.md` and **rehearse them once** before the first real cutover. An untested rollback plan is a wish, not a plan.

## 6.7 — After cutover

El Ourwa becomes a **read-only historical archive**. Staff and parents keep access to closed years' records — bulletins, receipts, payment history — through the old interface, which costs nothing beyond leaving it running.

Do not attempt to import a decade of history into the new platform. Import the current and immediately preceding year; leave older records where they already are, correct and intact. Migrating historical data carries real risk of corrupting it and delivers little that the archive does not already provide.

Once every branch has been live on the new platform for a full academic year, revisit whether to export the archive to flat files (PDF bulletins, CSV ledgers) and retire the PHP app entirely. That is a decision for then, not now.

---

# Begin

Start with **2.1**. Read everything, then give me your domain summary before writing any code.
