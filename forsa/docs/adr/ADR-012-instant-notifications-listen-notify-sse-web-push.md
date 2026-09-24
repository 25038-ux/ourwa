# ADR-012: Instant notifications — Postgres LISTEN/NOTIFY → SSE, plus Web Push

**Status:** Accepted (2026-09-24) — consistent with ADR-002 (Postgres is the only stateful dependency)

## Context
Notifications (high-fit opportunity, deadline, approval request, task assignment…) must appear instantly in
open tabs and on phones, without adding Redis/Kafka/a websocket service in v1.

## Decision
* `services/notifications.notify()` inserts the row (idempotent key). An `AFTER INSERT` trigger on
  `notifications` calls `pg_notify('forsa_live', {id, org_id, user_id, category, priority, title})`.
* `api/live.py::LiveHub` holds **one** psycopg `LISTEN` connection per API process (reconnects with backoff)
  and fans events out to per-connection asyncio queues, filtered by org and user.
* `GET /api/v1/live` is a Server-Sent Events stream (15 s heartbeat, `no-store, no-transform` so the
  Next.js proxy does not compress/buffer it). The browser uses `EventSource`, which reconnects on its own.
* Phones and closed tabs: `notify()` enqueues a `deliver_notification` job (outbox pattern) that sends Web Push
  (VAPID, optional `pywebpush` extra) to the user's subscriptions, honouring per-category preferences
  (`memberships.notification_prefs`), and prunes expired subscriptions (404/410).

## Alternatives considered
WebSockets (bidirectional not needed; harder through proxies); polling (not instant, wasteful);
Redis pub/sub (new stateful dependency).

## Consequences
Measured locally: < 1 s from commit to SSE event through the Next proxy; the browser toast renders ~20 ms after
commit. NOTIFY payloads are capped at 8 kB — only ids and titles travel; details are fetched through the API
with RLS. Horizontal scaling works (each API process LISTENs). Push requires VAPID keys in the environment.
