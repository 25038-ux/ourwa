---
name: observability
description: Logs, metrics, health endpoints, AI cost tracking, queue monitoring.
---

# observability

1. JSON logs with request_id; never log secrets or document contents.
2. Health: `/healthz`, `/readyz`; queue and dead jobs via `/api/v1/admin/ingestion`.
3. AI: every call recorded in `ai_requests` (tokens, latency, cost).
4. Add OTel export behind env configuration only; keep local dev dependency-free.
