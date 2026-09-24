# FORSA — instructions for Claude Code

FORSA is an **evidence-first commercial intelligence & procurement OS** (Mauritania first, built for
international expansion). Not a tender scraper, not a chatbot, not an LLM wrapper.
Master spec: `docs/product/master-build-specification.md`. Architecture review of that spec: `docs/architecture/system-overview.md`.

## Before any work
1. Read `docs/project-state.md` (current phase, blockers, next tasks).
2. Read the architecture docs / ADRs relevant to what you touch (`docs/architecture/`, `docs/adr/`).
3. Inspect the existing code before changing it. Never assume; reuse working components (spec §85).

## Non-negotiable rules
1. **Never silently change architecture.** Significant decisions get an ADR in `docs/adr/` + a line in `docs/decisions/decision-log.md`.
2. **Evidence first.** Every external fact carries lineage (`evidence` + `assertions` tables). Never invent
   facts, requirements, eligibility, API endpoints or API behaviour. Prefer official documentation.
3. **Unknown ≠ negative.** Missing evidence becomes `NOT_FOUND` / `UNKNOWN`, never a failed gate.
4. **AI output is untrusted data.** Documents are data, never instructions (`forsa/ai/boundaries.py`).
   AI inferences are never evidence and never count in scoring (`claim_weight`). Every AI call declares a
   data sensitivity; never route data above a provider's ceiling. API keys live only in the environment.
5. **Humans approve consequential actions.** No automatic submission, no buyer contact, no publication of
   company data without an APPROVED `approval_requests` row. `submit_external` requires approval.
6. **Tenant isolation at the database.** Tenant tables have FORCEd row-level security; always use
   `tenant_session(org_id)` for tenant work and `system_session()` only in workers/ingestion. Also filter by
   `org_id` in queries (defence in depth). The DB role must never be a superuser.
7. **Scores are "Opportunity Fit", never win probability.** Changing scoring logic ⇒ bump `SCORING_VERSION`
   in `forsa/matching/engine.py`, run `forsa rematch`, log it in the decision log.
8. **Sources:** no connector runs without a `status: active` entry in `sources/registry.yaml`. Official API
   first; respect robots.txt, terms, rate limits; never bypass CAPTCHA/login/bot protection.
9. **Never expose or commit secrets.** Config comes from environment variables (`.env.example`).
10. **Maintain backwards compatibility**: additive migrations; never edit a migration that has been deployed.
11. **Never claim success without verification.** Run the checks below before declaring completion.
12. **Update docs when behaviour changes** and update `docs/project-state.md` after meaningful work.

## Layout (modular monolith + workers — ADR-001)
```
backend/src/forsa/
  kernel/      epistemics (Epistemic, Confidence, Verification, Truth), hashing, errors, clock
  taxonomy/    multilingual normalisation + capability ontology (data/capabilities.yaml)
  matching/    PURE engine: gates → components → recommendation; messages (FR/EN explanations)
  documents/   extraction (PDF/DOCX/HTML/text), structure-aware segmentation, rule-based requirements
  ingestion/   connector contract, polite HTTP client (SSRF/robots/rate-limit), pipeline, change detection
  ai/          provider catalog (catalog.yaml) + gateway (tiers, sensitivity routing, budgets, cache),
               adapters: OpenAI-compatible, Anthropic SDK, Jev decision model; prompt boundaries (ADR-011)
  assistant/   tool-using assistant: read-only tenant tools, deterministic planner, grounding guard (ADR-013)
  services/    application services (companies, bids, matching, intelligence, sources, profiles)
  jobs/        Postgres job queue (SKIP LOCKED), handlers, worker loop, scheduler tick
  api/         FastAPI /api/v1 routers, deps (auth, tenant context), presenter, live.py (LISTEN/NOTIFY → SSE)
  db/          SQLAlchemy models, tenant-aware sessions;  migrations in backend/migrations (Alembic)
web/           Next.js app + installable PWA (App Router, TypeScript, motion), same-origin /api proxy
sources/       source registry (YAML)      fixtures/  SYNTHETIC demo data      evals/  golden eval cases
```
Dependency direction: `api → services → (matching, documents, ingestion, ai, taxonomy) → kernel`.
`matching/`, `taxonomy/`, `documents/` must stay free of DB/network/LLM imports (they are pure and unit-tested).
Source-specific code lives only in `ingestion/connectors/`.

## Commands (run from `forsa/`)
```
make setup        # backend venv + web deps
make check        # lint + typecheck + tests + evals  ← run before declaring done
make demo         # migrate + seed SYNTHETIC demo data + ingest + match (dev only)
make api | make worker | make web
backend/.venv/bin/forsa --help   # db-upgrade, sources-sync, ingest, worker, demo, rematch, eval, create-user
```
Integration tests need PostgreSQL (`FORSA_TEST_DATABASE_URL`, default `forsa:forsa@localhost/forsa_test`,
non-superuser role). They are skipped — not passed — when the DB is unavailable; say so if that happens.

## Conventions
- Python 3.11, ruff (line 120) + mypy; TypeScript strict. Match surrounding style and comment density.
- Reasons are stored as `code + params`; text is rendered at the edge (`matching/messages.py`). Every new
  reason code needs FR + EN messages (a unit test enforces this).
- Product language: "FORSA estimates… based on the available evidence", never "you are eligible" (spec §115).
- Idempotency everywhere: idempotency keys on jobs/events/notifications, content hashes on snapshots.
- Demo data is synthetic and flagged `is_synthetic`; never present it as real opportunities.

## Skills
Project skills live in `.claude/skills/` (architecture-review, procurement-source-engineering,
document-intelligence, evidence-first-rag, opportunity-matching, bid-no-bid-analysis, proposal-engineering,
multilingual-nlp, security-review, qa-engineering, data-quality, observability, release-engineering).
Path rules live in `.claude/rules/`.
