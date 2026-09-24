# ADR-008: Append-only versions, events and a Postgres job queue

**Status:** Accepted (2026-09-24)

## Context
Spec §27–28, §63–65: history, idempotency, retries.

## Decision
Opportunities are projections of `opportunity_versions`; changes become `opportunity_events`; domain events are logged with idempotency keys; jobs have idempotency keys, backoff and a DEAD state.

## Alternatives considered
Full event sourcing; external broker.

## Consequences
History is preserved and retries are safe. Events are not yet published to external consumers (add an outbox relay when needed).
