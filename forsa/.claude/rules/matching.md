---
paths:
  - "backend/src/forsa/matching/**"
  - "evals/matching/**"
---
# Matching rules
- The engine is a pure function. No I/O, no clock reads (take `now` as an argument), no randomness.
- Any change that can alter a score or recommendation ⇒ bump `SCORING_VERSION`, add/adjust golden cases in
  `evals/matching/`, add a decision-log line, and run `forsa rematch` on environments with data.
- Missing evidence must yield `UNKNOWN`/`NOT_FOUND`, never `FAIL`. `FAIL` only for confirmed disqualifiers.
- Inferences (`Epistemic.INFERENCE/FORECAST`) never count (`claim_weight`).
- New reason codes need FR and EN messages in `messages.py` (a test enforces this).
- Never call the score a probability of winning.
