---
name: opportunity-matching
description: Change the matching engine, weights, gates or explanations (backend/src/forsa/matching).
---

# opportunity-matching

1. Read `.claude/rules/matching.md`.
2. Write/adjust golden cases in `evals/matching/` and unit tests first.
3. Keep the engine pure; `now` is an argument.
4. Bump `SCORING_VERSION`; run `make check`; then `forsa rematch` where data exists; log the decision.
5. Every new reason code gets FR+EN text in `messages.py`.
6. Report the effect: which demo/eval recommendations changed and why.
