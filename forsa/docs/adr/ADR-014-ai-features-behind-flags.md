# ADR-014: AI features behind flags, with evidence-preserving safety nets

**Status:** Accepted (2026-09-24)

## Decision
Each AI feature is off unless listed in `FORSA_FEATURES` and a suitable provider is enabled:

| Flag | What it does | Safety net |
|---|---|---|
| `ai_explanations` | Plain-language summary of a match | `validate_rewording`: no new numbers, no injection echoes; INTERNAL sensitivity |
| `ai_extraction` | Proposes requirements the rules missed | Quote must appear verbatim in the document (offsets recomputed on the original text); rows are `NEEDS_REVIEW` and excluded from hard gates until a human verifies them |
| `ai_decisions` | Jev cross-checks rule classifications | Disagreement ⇒ `NEEDS_REVIEW`; never overrides |
| `ai_triage` | Jev "worth reviewing?" probability on matches | Stored as FORECAST next to the fit; never changes the fit score |
| `ai_drafting` | Polishes evidence-backed draft sections | CONFIDENTIAL sensitivity; rewording validation; placeholders stay placeholders |

Scoring (`fit-v1.1`) is unchanged: AI output has zero claim weight.

## Consequences
Features can be rolled out per deployment and evaluated before enabling (`forsa eval`).
