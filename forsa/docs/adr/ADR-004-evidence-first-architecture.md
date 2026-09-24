# ADR-004: Evidence-first architecture: evidence + assertions

**Status:** Accepted (2026-09-24)

## Context
Spec §8, §9, §24, §71 describe lineage, confidence and fact/inference separately.

## Decision
One model: `evidence` (citable pointer) + `assertions` (subject–predicate–value with epistemic, confidence, verification). Missing evidence yields NOT_FOUND/UNKNOWN, never a negative fact.

## Alternatives considered
Plain text fields; a graph database.

## Consequences
Every fact answers 'why?'. Storage cost is a few rows per field per version — acceptable.
