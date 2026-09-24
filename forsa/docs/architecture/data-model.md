# Data model

Source of truth: `backend/src/forsa/db/models.py` and `backend/migrations/versions/`. Every table has a UUID
primary key and timestamps. `org_id` marks tenant-owned rows (row-level security, ADR-007).

| Group | Tables | Notes |
|---|---|---|
| Identity | organizations, users, memberships | Roles are per membership (`OWNER, ADMIN, BID_MANAGER, SALES, TECHNICAL, FINANCE, LEGAL, REVIEWER`). |
| Sources | sources, ingestion_runs, source_snapshots | Snapshots are content-addressed; unique `(source_id, canonical_url, content_hash)`. |
| Opportunities (public) | buyers, opportunities, opportunity_versions, opportunity_events, requirements, signals | `opportunities` = projection of latest version. Unique `(source_id, external_ref)`. Generic `kind` (TENDER, RFQ, EOI, RFP, PLAN_ITEM, AWARD, GRANT…). |
| Documents & evidence | documents, document_versions, document_chunks, evidence, assertions | `org_id NULL` = public. Chunks keep page, heading path, char offsets. |
| Business Twin (tenant) | companies, company_capabilities, company_credentials, company_projects | Claims carry `epistemic` + `verification` + `evidence_ids`. VERIFIED only via a human with `company.verify` linking a document. |
| Matching (tenant) | matches, match_history, feedback | `result` JSON = full explainable output (gates, components, reasons, economics) + `scoring_version`. |
| Bids (tenant) | bids, bid_decisions, compliance_items, approval_requests, tasks | Decisions store the system recommendation next to the human decision. |
| Platform | notifications, briefings, audit_events, domain_events, jobs, ai_requests | Idempotency keys on jobs/events/notifications. |

## Epistemic vocabulary (`forsa/kernel/epistemics.py`)
* `Epistemic`: FACT · DERIVED · INFERENCE · FORECAST · USER_CLAIM
* `Confidence`: VERIFIED · HIGH · MEDIUM · LOW · UNKNOWN · CONFLICTING
* `Verification`: UNVERIFIED · VERIFIED · REJECTED · NEEDS_REVIEW
* `Truth` (checked conditions): CONFIRMED · NOT_FOUND · CONFLICTING · UNKNOWN · NEEDS_HUMAN

`claim_weight()` — verified facts 1.0, unverified user claims 0.8, inferences/forecasts 0.0.

## Lifecycle
`PLANNED → PUBLISHED → CLARIFICATION → EXTENDED → CLOSED → EVALUATION → PROVISIONAL_AWARD → FINAL_AWARD`,
`CANCELLED` from anywhere. Change events: NEW, MODIFIED, DEADLINE_EXTENDED/SHORTENED/CHANGED, CANCELLED,
AWARDED, CLOSED, EXTENDED, CLARIFICATION, DOCUMENTS_CHANGED, STATUS_CHANGED.

## Bid state machine
`QUALIFYING → PURSUING | NO_BID`; `PURSUING → IN_REVIEW | WITHDRAWN`; `IN_REVIEW → APPROVED | PURSUING`;
`APPROVED → SUBMITTED` (requires APPROVED FINAL_SUBMISSION); `SUBMITTED → WON | LOST | CANCELLED`.

## Migrations
Alembic, additive only once deployed. `0001` creates the schema, `pg_trgm`, RLS functions and policies.
Not yet deployed anywhere — `0001` may still be amended until the first deployment (then it is frozen).
