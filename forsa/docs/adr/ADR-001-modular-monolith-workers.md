# ADR-001: Modular monolith + workers, one backend language

**Status:** Accepted (2026-09-24)

## Context
The spec proposes Next.js + TypeScript + Python/FastAPI with shared TS packages and separate service folders. A small team needs one place for domain logic and minimal deployment surface.

## Decision
Build one Python package (`forsa`) that runs as API and worker, plus one Next.js app. No shared TS packages until a second consumer exists; OpenAPI is the contract.

## Alternatives considered
Python+TS domain duplication; microservices per domain; separate `services/*` packages.

## Consequences
Simple deploys and refactors. Module boundaries are enforced by convention and review (documented import direction), not by packaging. Revisit when a team or scaling boundary appears.
