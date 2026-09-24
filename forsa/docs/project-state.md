# Project state

_Last updated: 2026-09-24 — update after every meaningful work session._

## Current phase
**Phase 1–2 foundation complete + first vertical slice of the MVP loop (§91) on synthetic data.**
Phase 0 (discovery) is **partially blocked**: official sources could not be reached from the build
environment (egress policy). Phase 3 (real ingestion) cannot start until Phase 0 source verification is done.

## Completed
- Monorepo layout under `forsa/` (backend, web, sources, fixtures, evals, docs, `.claude/`).
- Canonical data model (35 tables) + Alembic migration `0001` with FORCEd row-level security.
- Kernel epistemics (Epistemic / Confidence / Verification / Truth).
- Multilingual ontology (41 concepts FR/AR/EN, 7 credentials) with offset-preserving normalisation.
- Matching engine `fit-v1.1`: hard gates (status, deadline, exclusions, credentials incl. per-bid
  instruments, experience, turnover, registration), 8 weighted components, recommendation, why-now, risks,
  economics ranges; FR/EN explanations from reason codes.
- Document intelligence: PDF/DOCX/HTML/text extraction, OCR-needed detection, section-aware segmentation,
  rule-based requirement extraction (`rules:req-v1`) with page/section/char citations.
- Ingestion framework: registry, connector contract, polite HTTP client, fixture + declarative HTML-table
  connectors, idempotent pipeline, versioning, change events, lineage (evidence + assertions).
- Postgres job queue + worker + scheduler tick; analysis, matching, briefing jobs.
- AI gateway (provider-neutral, budgets, cache, recording) + Anthropic SDK adapter (off by default),
  prompt-injection boundaries, tool permissions.
- API `/api/v1` (37 paths): auth, opportunities (+intelligence, requirements, evidence), company twin
  (capabilities, credentials, projects, documents, verification, suggestions), matches, bids (decision,
  compliance, approvals four-eyes, submission record, outcome, draft skeleton), briefing, notifications,
  feedback, sources, admin.
- Web app: login, command center, explorer, opportunity intelligence page, company twin, bid workspace,
  source health — responsive (verified at 390 px and 1360 px, no console errors).
- Docker compose, CI workflow (`.github/workflows/forsa-ci.yml`), Makefile, docs, ADRs, rules, skills.

## Test status (2026-09-24, local)
- `ruff` + `ruff format` clean; `mypy` clean (74 files); `tsc --noEmit` clean; `next build` OK.
- `pytest`: 53 passed (unit + PostgreSQL integration: idempotent ingestion, versioning, blocked sources,
  failure isolation, cited requirements, injection flags, RLS isolation incl. WITH CHECK, queue dead-letter,
  full API bid workflow with four-eyes, RBAC, uploads).
- `forsa eval`: matching 9/9, extraction 4/4, multilingual 7/7, safety 6/6 (all synthetic golden cases).
- The CI workflow is written but has **not run on GitHub yet**.

## Blockers
1. **Source access/verification**: marchespublics.gov.mr, search.worldbank.org and UNGM were unreachable
   (egress policy). Needed: allow these hosts in the environment network settings, or do the inspection
   manually, then fill `docs/research/source-registry.md`.
2. No real procurement documents yet → extraction accuracy on real DAOs is unmeasured (Phase 4 gate).

## Known limitations / bugs
- Credential `obtainable_days` and effort estimates are uncalibrated estimates (labelled as such in UI).
- Login rate limiter is per-process; OCR and malware scanning are no-op ports; local-FS object storage only.
- Requirement extraction is rule-based; clauses spanning line breaks may be split.
- Concept matching needs curated synonyms; no embeddings yet (ADR-003).
- `match_company` jobs are debounced by 5 s delay; `forsa worker --once` skips jobs not yet due.

## Next tasks (in order)
1. Phase 0: inspect ARMP portal (listing/detail/plans/awards), robots.txt, terms; study ≥ 50 notices and
   ≥ 20 procurement plans; record in `docs/research/source-registry.md`; fill the `mr-armp-portal` config;
   add real-page parser tests; activate.
2. Build the real-document benchmark (≥ 100 docs, annotated sample) and measure extraction (Phase 4 gate).
3. UNGM / World Bank connectors against official API docs.
4. Onboarding flow (guided twin creation) + concierge MVP with 5 pilot companies (§93).
5. S3 storage adapter, malware scanning adapter, OTel export; deploy staging.

## Migrations
`0001_initial_schema` (not yet deployed — may still be amended; frozen after first deployment).

## Deployment state
Not deployed. Local dev only. See `infra/deployment/README.md`.
