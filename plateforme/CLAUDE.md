# El Ourwa successor — standing rules

Multi-tenant school platform replacing El Ourwa, a live PHP system in Nouakchott.
**This is a financial system.** It holds fee records, debts and payroll for ~1,372
families. Correctness outranks speed of delivery at every decision point.

## Authority

`PROJECT.md`, `ARCHITECTURE.md` and the root `PHASES.md` are the specification.
Where anything in this repository disagrees with them, they win.

## Every session

1. Read `docs/STATE.md` — phase, last session, next task, open issues.
2. Read the current phase in `docs/PHASES.md`.
3. Post a short orientation and **wait for confirmation** before touching code.
4. **Before finishing**: update `docs/STATE.md`, append any ADR to
   `docs/DECISIONS.md`, add new terms to `docs/GLOSSARY.md`, update
   `docs/FEATURES.md` status. Write for a reader with zero context.

## Ground truth — do not contradict from memory

- **One school today. Zero branches.** No branch/school/site concept exists in
  El Ourwa's 77 tables.
- **Toujounine, Arafat and Ksar are NOT branches.** They are moughataas
  (districts) of Nouakchott appearing as student **place-of-birth**
  (`lieu_naissance`) values — corrected 2026-09-02: this note previously said
  *address*, and `etudiants` has no address column at all. Counted in the
  reference database: nkt 112 · Arafat 73 · Ksar 48 · Toujounine 43 ·
  **Guerou 27** — Guerou is in Assaba, 300 km away, which is sensible as a
  birthplace and impossible as the address of a child attending here. Never use
  any of them as school names. Test schools are **École Nour, École Rissala,
  École Salam**.
- Multi-tenancy is for **future** branches. School #1 imports under one
  `school_id`; every later branch starts clean. There is no merge problem.
- ~2,153 students · ~1,372 parents · ~3,506 enrolments · `notes` ~139,000 rows ·
  6 roles · **24** permissions · 57 pages to port.

## Tenant isolation

1. **Never disable, bypass or work around RLS.** Empty results mean the tenant
   context is wrong — fix that, not the policy.
2. **Never bare `SET`** for tenant context. Always `set_config(..., true)` inside a
   transaction, via `withTenant()`. A plain `SET` persists on the pooled
   connection and leaks the next request into the previous school's data. This is
   the single most dangerous bug available here.
3. `BYPASSRLS` (`app_reporter`) only in reporting jobs. **Never in a request path.**
4. Every tenant table: `school_id`, RLS enabled **and forced**, a policy with both
   `USING` and `WITH CHECK`, a composite index **leading with `school_id`**, and
   uniques scoped `(school_id, …)`. See the `tenant-table` skill.
5. Foreign keys are **composite** — `FOREIGN KEY (school_id, group_id) REFERENCES
   groups (school_id, id)` — so a cross-tenant reference is structurally
   impossible, not merely unlikely.

## Money

6. **Never `float`, `double` or JS `number`.** `NUMERIC(14,2)` in Postgres,
   `decimal.js` or string in TypeScript. The `pg` type parser is configured to
   return NUMERIC as a string; a test asserts it. See the `money-handling` skill.
7. Financial records are **append-only**. Corrections are reversing entries, never
   `UPDATE`.
8. Round **once**, at display. Never mid-calculation.
9. Currency is **per school**, stored explicitly. Never assumed.
10. Receipt numbers come from `receipt_sequences` with `SELECT … FOR UPDATE`,
    inside the payment's transaction. **Never `MAX()+1`** — it races.

## Grades

11. **`note_absent = -1` is a MARKER, not a grade.** Exclude it before averaging.
    If it enters an average as a number, every affected student's result is wrong
    and the error is silent. Use `NOTE_ABSENT` / `countedScores` from
    `@elourwa/shared`.

## Crypto

12. JWT: **ES256**. Passwords: **Argon2id**, with **bcrypt verification fallback**
    for legacy hashes and transparent re-hash on login — forcing a reset would
    lock out 1,372 parents at once.
13. Refresh tokens: opaque, hashed at rest, rotated every use, **reuse revokes the
    whole family**.
14. ECC is for signatures, not data at rest. Field encryption is AES-256-GCM.

## Process

15. **Write the test before the feature** for anything touching money, grades or
    tenant isolation.
16. **Stop and ask** before changes to money, migrations or tenant isolation.
17. **No `OFFSET` pagination.** Cursor-based only.
18. Heavy or fan-out work goes to **BullMQ**, never inline in a request.
19. **Read the El Ourwa source before porting a feature.** Its behaviour is the
    specification, including behaviour that looks odd — odd behaviour usually
    encodes a real requirement. Ask before "improving" it.
20. Small, reviewable diffs. Several focused commits over one large one.
21. Unsure whether something is a bug or intentional? **Ask.** Guessing in a
    financial system is worse than pausing.
22. **El Ourwa is read-only, forever.** Never write to it, never sync back, never
    dual-write. The moment both systems accept writes they diverge and
    reconciliation becomes impossible.
23. **Never cut over with a failing reconciliation.** A discrepancy in a financial
    figure is a blocking defect, not a rounding curiosity.
24. **Never invent facts about the school.** If the documents don't state it and
    the code doesn't show it, ask.

## Reconciliation

25. A mismatch is a **blocking defect**. Compare as strings or decimals, never as
    JS numbers.
26. When they differ, **El Ourwa is right until proven otherwise.** It has been
    reconciled against reality for years; new code has not.
27. If El Ourwa is genuinely wrong, record it in `docs/DECISIONS.md` with evidence
    and **ask before fixing** — the school may have been working around it for
    years. See the `parity-check` skill.

## Project skills

`.claude/skills/` — `tenant-table`, `nest-module`, `flutter-feature`,
`money-handling`, `parity-check`. Use them; they encode the rules above as
executable checklists.

## Commands

```bash
pnpm db:dev      # Postgres without Docker    pnpm infra:up   # with Docker
pnpm seed        # 3 schools, 600 students    pnpm dev        # API + web
pnpm test        # everything                 pnpm test:rls   # isolation only
```

Ports: web 3000 · API 3001 · Flutter 3002 · Postgres 5432 · Redis 6379 · Mailpit 8025.
Full detail in `docs/TESTING.md`.
