# ADR-010: Reason codes rendered at the edge

**Status:** Accepted (2026-09-24)

## Context
Explanations must be multilingual, testable and stable across UI changes.

## Decision
Engine outputs `code + params + evidence`; `matching/messages.py` renders FR/EN (AR next). A unit test fails if a code lacks a message.

## Alternatives considered
Storing rendered prose.

## Consequences
Language switch is free; evals can assert on codes; wording can improve without rescoring.
