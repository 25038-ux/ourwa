---
name: procurement-source-engineering
description: Add or change a procurement source connector (ARMP portal, UNGM, World Bank, others). Use for registry entries, parsers, HTTP policy, change detection.
---

# procurement-source-engineering

1. Verify the source first: official API/docs, terms, robots.txt, licence, rate limits → record with date in
   `docs/research/source-registry.md`. Never invent endpoints or fields.
2. Add/update the entry in `sources/registry.yaml` with `status: pending_verification` and `allowed_hosts`.
3. Implement `discover/fetch/parse/health_check` in `backend/src/forsa/ingestion/connectors/` (DB-free),
   or configure the declarative `html_table` connector.
4. Capture real pages as fixtures; write parser tests; add field-level `FieldEvidence` locators.
5. Run the pipeline twice: second run must be `unchanged_bytes`/`unchanged` (idempotency).
6. Activate only after review; watch source health (`/sources`).
