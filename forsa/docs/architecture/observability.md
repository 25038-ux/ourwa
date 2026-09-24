# Observability

* **Logs**: JSON lines on stdout (`logging_setup.py`); every HTTP request logs method, path, status, latency
  and `request_id` (also returned as `X-Request-Id`). Worker logs job kind, id, duration, result/error.
* **Health**: `/healthz` (process), `/readyz` (database).
* **Ingestion**: `ingestion_runs.stats` (discovered, fetched, created, updated, unchanged, unchanged_bytes,
  failed, empty_parse) + source health states + briefing source alerts.
* **Queue**: `/api/v1/admin/ingestion` (platform admins) — job counts by status, dead-lettered jobs with errors.
* **AI**: `ai_requests` (tokens, latency, cost, status); last-24 h summary in the admin endpoint.
* **Matching quality**: `feedback` labels + `match_history` across scoring versions; `forsa eval` pass rates.

Next: OpenTelemetry traces/metrics export (OTLP) and Sentry-equivalent error tracking — deferred until a
deployment target is chosen (keep it behind env configuration).
