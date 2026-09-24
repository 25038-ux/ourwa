# ADR-006: Source connector abstraction + registry gate

**Status:** Accepted (2026-09-24)

## Context
Sources change and have legal constraints.

## Decision
Connectors implement discover/fetch/parse/health and never touch the DB. No connector runs without an `active` registry entry. HTML table layouts are declared in the registry.

## Alternatives considered
Per-site scrapers writing directly to the DB.

## Consequences
Layout changes are config; legal review is a precondition. Real sources wait for Phase 0 verification.
