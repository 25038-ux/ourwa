# ADR-002: PostgreSQL as the only stateful dependency in v1

**Status:** Accepted (2026-09-24)

## Context
The spec lists PostgreSQL, pgvector, Redis, a worker system and object storage.

## Decision
Use PostgreSQL for data, the job queue (SKIP LOCKED), the domain event log and trigram search. Defer Redis and embeddings. Object storage behind a port (local FS in dev, S3 adapter for prod).

## Alternatives considered
Redis/Celery queue; OpenSearch; pgvector columns from day one.

## Consequences
One system to back up and secure; transactional job enqueue. Embeddings are added (pgvector image already in compose) when evals show ontology + lexical recall is insufficient.
