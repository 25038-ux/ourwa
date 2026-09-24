# FORSA

**Evidence-first commercial intelligence & procurement OS** — helps companies (starting in Mauritania)
discover the opportunities they can realistically win, understand requirements and risks, decide bid/no-bid
with explainable evidence, and run the bid with human approval at every consequential step.

> Status: MVP loop (§91) on synthetic data — ingest → analyse → company twin → match → explain → evidence →
> briefing → bid — plus a multi-provider AI layer (incl. Jev), a voice-capable assistant, instant
> notifications and an installable mobile PWA. See `docs/project-state.md`.

## Quick start (local)
Requirements: Python 3.11+, [uv](https://docs.astral.sh/uv/), Node 22, PostgreSQL 16 (or Docker).

```bash
cd forsa
make setup
# PostgreSQL with a NON-superuser owner role (row-level security must apply):
#   CREATE ROLE forsa LOGIN PASSWORD 'forsa' CREATEDB; CREATE DATABASE forsa OWNER forsa;
make demo      # migrate + seed synthetic demo orgs/users + ingest demo notices + match
make api       # http://localhost:8000/api/v1/docs
make web       # http://localhost:3000  (login: owner@sahel-solaire.demo / forsa-demo-2026)
make worker    # background jobs + scheduler
make check     # lint, typecheck, tests (unit + PostgreSQL integration), evals
```
Or: `cp .env.example .env && docker compose up --build`.

## What is in the box
| Area | Where | Notes |
|---|---|---|
| Canonical data model (35 tables, RLS) | `backend/src/forsa/db/models.py`, `backend/migrations/` | UUIDs, versions, append-only history |
| Evidence graph | `evidence` + `assertions` tables | FACT / DERIVED / INFERENCE / FORECAST / USER_CLAIM |
| Multilingual ontology (FR/AR/EN) | `backend/src/forsa/taxonomy/` | 41 concepts (34 capabilities, 7 credentials); offsets preserved for citations |
| Matching engine `fit-v1.1` | `backend/src/forsa/matching/` | Hard gates → 8 components → BID / BID WITH CONDITIONS / REVIEW / NO-BID |
| Document intelligence | `backend/src/forsa/documents/` | PDF/DOCX/HTML/text, section-aware segmentation, cited requirements |
| Ingestion | `backend/src/forsa/ingestion/` | Registry-gated connectors, polite HTTP, dedupe, versioning, change events |
| AI providers | `backend/src/forsa/ai/catalog.yaml` | 15 LLM providers (frontier, Chinese, free, local) + Jev decision model; sensitivity routing; budgets; cache |
| Assistant | `backend/src/forsa/assistant/` | Tool-using, grounded, FR/EN/AR, voice in the browser, works without any model |
| Live notifications | `backend/src/forsa/api/live.py` | Postgres NOTIFY → SSE + Web Push |
| Bid workspace | `backend/src/forsa/services/bids.py` | Compliance matrix, four-eyes approvals, outcomes |
| Web app + mobile PWA | `web/` | 17 routes, light/dark, motion, ⌘K, swipe triage, kanban, onboarding, installable |
| Evals | `evals/` + `forsa eval` | matching, extraction, multilingual, safety |

## Honest limitations (today)
- The ARMP, UNGM and World Bank connectors are **not active**: their structure, terms and robots.txt could
  not be verified from the build environment. Only synthetic demo data flows end-to-end.
- OCR, malware scanning, S3 storage and embeddings are ports with honest no-op adapters (documents are
  flagged `NEEDS_OCR` / `NOT_SCANNED`, never silently treated as fine).
- No AI provider is on by default; everything works deterministically without one. To enable: set
  `FORSA_AI_PROVIDERS` + the provider's key (see `.env.example`), then *Settings → AI providers*.
