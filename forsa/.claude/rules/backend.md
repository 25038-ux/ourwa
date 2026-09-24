---
paths:
  - "backend/**/*.py"
---
# Backend rules
- Keep the import direction: `api → services → {matching, documents, ingestion, ai, taxonomy, briefing} → kernel`.
  `matching/`, `taxonomy/`, `documents/` must not import `db`, `api`, `httpx` or AI providers.
- Tenant work uses `tenant_session(org_id)` / the `tenant_db` dependency; `system_session()` only in workers,
  ingestion and platform-admin paths. Still filter by `org_id` explicitly.
- Every state change that should trigger work enqueues a job in the same transaction with an idempotency key.
- Raise `ForsaError` subclasses for expected errors; never swallow exceptions silently — log and count them.
- Run `make check` (lint, mypy, pytest incl. PostgreSQL integration, evals) before declaring completion.
