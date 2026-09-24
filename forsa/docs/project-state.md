# Project state

_Last updated: 2026-09-24 — update after every meaningful work session._

## Current phase
**Phase 1–2 foundation + MVP loop (§91) on synthetic data, plus: multi-provider AI (incl. Jev), tool-using
assistant (text + voice), instant notifications, team/tasks/onboarding, and the full web + mobile PWA UI.**
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
- **AI providers (ADR-011)**: catalog of 15 providers — Anthropic, OpenAI, Gemini, Mistral, DeepSeek, Qwen, Kimi,
  GLM, MiniMax, NVIDIA NIM, Groq, Cerebras, OpenRouter, Hugging Face, Ollama — plus **Jev** (TypeSafe decision
  model, `decide()`); tiers fast/reasoning/decision; data-sensitivity ceilings + DPA review; admin discovery/test.
- **Assistant (ADR-013)**: 10 tenant tools, proposed-action cards, LLM tool loop or deterministic FR/EN/AR
  planner, grounding guard, SSE streaming, stored conversations; browser voice (dictation + speech).
- **Instant notifications (ADR-012)**: NOTIFY trigger → LiveHub → `/api/v1/live` SSE (measured: toast ~20 ms
  after commit, < 1 s through the Next proxy); Web Push outbox job; per-category preferences.
- **AI features (ADR-014)** behind `FORSA_FEATURES`: explanations, requirement proposals (verbatim quotes,
  NEEDS_REVIEW), Jev cross-check and triage (FORECAST only), draft polishing (CONFIDENTIAL).
- **Workspace**: team + one-time invitations, roles (last-owner protection), tasks (manual, assistant-proposed,
  auto-created from bid conditions), guided onboarding, profile/password, notification preferences.
- **Web/PWA**: 17 routes — login, onboarding (voice), today, opportunities (+swipe triage), opportunity
  intelligence (AI summary), assistant, bids, bid workspace (stepper, compliance, drafts), tasks (drag-and-drop
  kanban / swipe on phones), company twin (profile strength, drag-drop evidence), team, invite, notifications,
  settings (profile, notifications, appearance, voice, AI providers), sources, more. Light/dark, ⌘K palette,
  bottom tab bar + assistant orb on phones, manifest + service worker + icons (installable).
- API: 65 paths / 74 operations. Data model: 40 tables. Migration `0002` adds AI settings, assistant,
  invites, push subscriptions, task sources and the NOTIFY trigger (+ RLS on the new tenant tables).

## Test status (2026-09-24, local)
- `make check` green: `ruff` + `ruff format` clean; `mypy` clean (95 files); `tsc --noEmit` clean; `next build` OK.
- `pytest`: **87 passed** (unit + PostgreSQL integration). New: provider catalog/adapters (incl. Jev wire
  format), gateway routing/sensitivity/budget, assistant (planner FR/EN/AR, tools, grounding guard, SSE),
  notifications (real uvicorn SSE end-to-end, tenant isolation, push delivery), workspace (invites, roles,
  tasks, onboarding), AI features safety nets, settings parsing.
- `forsa eval`: matching 9/9, extraction 4/4, multilingual 7/7, safety 6/6 (all synthetic golden cases).
- UI verified with Playwright at 390 px (touch, iPhone UA) and 1360 px, light and dark: no console errors.
- The CI workflow is written but has **not run on GitHub yet**.

## Blockers
1. **Source access/verification**: marchespublics.gov.mr, search.worldbank.org and UNGM were unreachable
   (egress policy). Needed: allow these hosts in the environment network settings, or do the inspection
   manually, then fill `docs/research/source-registry.md`.
2. No real procurement documents yet → extraction accuracy on real DAOs is unmeasured (Phase 4 gate).

## Known limitations / bugs
- Provider endpoints/model ids marked `verified: false` in `ai/catalog.yaml` were not reachable from the build
  environment; model ids are pinned via *Discover* after keys are added. Jev paths follow typesafe-sdk 0.7.1.
- Voice depends on the browser's Web Speech API (not Firefox); Arabic speech output depends on installed voices.
- Web Push needs VAPID keys + `forsa[push]`; iOS delivers push only to installed (home-screen) PWAs.
- Credential `obtainable_days` and effort estimates are uncalibrated estimates (labelled as such in UI).
- Login rate limiter is per-process; OCR and malware scanning are no-op ports; local-FS object storage only.
- Requirement extraction is rule-based; clauses spanning line breaks may be split.
- Concept matching needs curated synonyms; no embeddings yet (ADR-003).
- `match_company` jobs are debounced by 5 s delay; `forsa worker --once` skips jobs not yet due.

## Next tasks (in order)
1. Phase 0 (still blocked by egress): allow `marchespublics.gov.mr`, `search.worldbank.org`,
   `datacatalog.worldbank.org`, `www.ungm.org` in the environment network settings, then inspect portals,
   robots.txt, terms; fill `docs/research/source-registry.md`; activate connectors.
2. Add provider keys as environment secrets; Discover + pin models; run `forsa eval` with AI features on.
3. Real-document benchmark (≥ 100 DAOs) and extraction measurement (Phase 4 gate), incl. `ai_extraction`.
4. Concierge MVP with 5 pilot companies (§93); collect feedback labels.
5. S3 storage, malware scanning adapter, OTel export; deploy staging; run CI on GitHub.

## Migrations
`0001_initial_schema`, `0002_ai_providers_assistant_live` (not yet deployed — may still be amended; frozen after first deployment). Up/down/up tested.

## Deployment state
Not deployed. Local dev only. See `infra/deployment/README.md`.
