# System overview & architecture review

## 1. What we are building
The first usable loop (spec §91): **source → ingest → parse documents → company twin → match → explain →
show evidence → daily briefing**, with a bid workspace and human approvals on top. Everything is designed
so that the core intelligence (ontology, matching, evidence) is country- and source-agnostic.

```
                ┌──────────────── web (Next.js) ────────────────┐
                │ command center · explorer · intelligence page │
                │ company twin · bid workspace · source health  │
                └───────────────┬───────────────────────────────┘
                                │ same-origin /api/v1 (cookie + CSRF header)
┌───────────────────────────────▼──────────────────────────────────────────┐
│ FastAPI (api/)  auth · RBAC · tenant context · presenter (codes → FR/EN) │
├──────────────────────────────────────────────────────────────────────────┤
│ services/  companies · bids · matching · intelligence · sources · events │
├───────────────┬───────────────┬───────────────┬───────────────┬──────────┤
│ matching/     │ documents/    │ ingestion/    │ ai/           │taxonomy/ │
│ PURE engine   │ extract·seg·  │ registry·http │ gateway·      │ ontology │
│ gates→score   │ requirements  │ pipeline·diff │ boundaries    │ FR/AR/EN │
├───────────────┴───────────────┴───────────────┴───────────────┴──────────┤
│ kernel/  epistemics · hashing · errors · clock                           │
└──────────────────────────────────────────────────────────────────────────┘
        ▲ jobs enqueued in the same transaction            │
┌───────┴──────── worker (jobs/) ─────────┐        ┌───────▼────────────────┐
│ ingest_source · analyze_opportunity ·   │◄──────►│ PostgreSQL 16          │
│ match_* · daily_briefing · schedule_tick│        │ data · RLS · jobs ·    │
└─────────────────────────────────────────┘        │ events · FTS/trigram   │
                                                   └────────────────────────┘
```

## 2. Architecture review of the master spec — what was changed and why
The spec's direction is sound. These refinements make it simpler to operate, easier to test and harder to
get wrong. Each is recorded as an ADR.

| # | Spec said | Built | Why |
|---|---|---|---|
| 1 | Next.js + TS + Python/FastAPI monorepo with `packages/{ui,types,config,validation}` and `services/*` | **One Python modular monolith** (API + worker share code) + one Next.js app. No shared TS packages yet. | Domain logic exists once (Python). Split packages only when a second consumer appears. OpenAPI (`/api/v1/openapi.json`) is the contract; TS types can be generated from it. (ADR-001) |
| 2 | PostgreSQL + pgvector + Redis + worker system + object storage | **PostgreSQL is the only stateful dependency in v1**: job queue (`FOR UPDATE SKIP LOCKED`), domain event log, trigram search. Redis and embeddings deferred; the compose image is pgvector-ready. | One thing to back up, secure and monitor — important for a small team operating in Mauritania. Jobs are enqueued in the same transaction as the state change (no dual write). (ADR-002, ADR-008) |
| 3 | Evidence graph (§8), source lineage (§9), evidence confidence (§24), facts vs inference (§71) as separate ideas | **One evidence model**: `evidence` (citable pointer: snapshot/document, page, section, char span, quote, hash) + `assertions` (subject –predicate→ value, with `epistemic`, `confidence`, `verification`). | A single, queryable graph answers "why do you say this?" for any fact. Graph DB deferred (spec §100). (ADR-004) |
| 4 | Multi-stage matching with an AI explanation stage | **Deterministic engine, AI only at the edges.** Stages A–F are a pure function; explanations are templated from reason codes; an LLM may only re-word them, and re-wordings that add numbers are rejected. | Reproducible, unit-testable, backtestable (`scoring_version`), works with no model, and cannot hallucinate eligibility. (ADR-005) |
| 5 | Confirmed / Not found / Conflicting / Unknown / Needs verification | **`Truth` (5 values) + `GateOutcome` PASS / GAP / FAIL / UNKNOWN.** GAP = remediable (obtain, renew, partner, upload evidence). | Separates "disqualifying" from "fixable", which is exactly what BID-WITH-CONDITIONS needs. Missing data is never negative. |
| 6 | Tenant isolation "at the data-access layer" | **FORCEd Postgres row-level security, fail-closed**, set per transaction (`set_config('forsa.org_id', …, true)`), plus explicit `org_id` filters. | A forgotten `WHERE` cannot leak another company's data. Tested explicitly. (ADR-007) |
| 7 | Event sourcing "where useful" | **Append-only versions + typed change events**, `opportunities` is a projection of the latest version. | History is never overwritten; idempotent re-ingestion; deadline extensions/cancellations become events. (ADR-008) |
| 8 | One connector class per source | **Registry-gated connector contract** + a *declarative* HTML-table connector whose column mapping lives in the registry. | Portal layout changes become reviewed config changes. Nothing runs without a verified registry entry. (ADR-006) |
| 9 | Never hard-code Mauritania / MRU / French / ARMP | **Country packs** (`country/packs/mr.yaml`) + ontology as versioned data + reason codes rendered per language. | Adding Senegal = a pack + connectors, no engine change. |
| 10 | Human approval for consequential actions | **Approval state machine with four-eyes** (self-approval refused when another approver exists) and a tool policy where `submit_external` requires APPROVED. FORSA never submits; it records a human submission. | Spec §39, §54 enforced in code, not policy text. (ADR-009) |

Deliberately **not** built yet (spec §86, §100, §101): microservices, graph DB, OpenSearch, Redis,
embeddings/pgvector columns, WhatsApp/email/CRM connectors, forecasting, partner graph.

## 3. Request & data flows
* **Ingestion** (worker): `schedule_tick` → `ingest_source` → connector `discover/fetch/parse` → snapshot
  (content-addressed) → version/diff → events → `analyze_opportunity` job → documents extracted, segmented,
  requirements cited → concepts derived → `match_opportunity` job → matches + notifications.
* **Company change** (API): write via `services/companies.py` → `CompanyProfileUpdated` event →
  debounced `match_company` job.
* **Read** (API): tenant session (RLS) → stored match result (reason codes) → presenter renders FR/EN.
* **Bid**: create (snapshots the system recommendation) → human decision → compliance matrix →
  approval request → approval by another authorised user → human records submission → outcome (learning data).

## 4. Module boundaries
`api → services → {matching, documents, ingestion, ai, taxonomy, briefing} → kernel`. `matching`,
`taxonomy` and `documents` have no DB/network/LLM dependencies. Connectors never touch the DB.
