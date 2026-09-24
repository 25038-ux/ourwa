# Decision log

Newest first. Significant decisions link to an ADR.

| Date | Decision | Ref |
|---|---|---|
| 2026-09-24 | Scoring `fit-v1.0 → fit-v1.1`: credentials/per-bid instruments are obtained *in parallel* with bid preparation (need ≥1 day margin), no longer after it. Found while reviewing live demo output (a 5-day bank guarantee with 6 days left was a false NO-BID). Run `forsa rematch` after scoring changes. | engine.py |
| 2026-09-24 | Planned (procurement-plan) items recommend REVIEW + "prepare now, decide at publication", never BID. | engine.py |
| 2026-09-24 | Per-bid instruments (bid security) are GAP "obtain" when absent from the profile, not UNKNOWN. | ontology `per_bid` |
| 2026-09-24 | FORSA lives in `forsa/` inside the `ourwa` repository; the existing PHP school app (El OURWA) is untouched. | — |
| 2026-09-24 | Phase 0 could not complete: official portals (marchespublics.gov.mr, search.worldbank.org, UNGM) were blocked by the build environment's egress policy. Decision: build the source-independent foundation and MVP loop on **synthetic** data; keep all real-source connectors `pending_verification` (they refuse to run). | ADR-006 |
| 2026-09-24 | Modular monolith, Postgres-only v1, evidence+assertions, deterministic engine, RLS, append-only history, approvals, reason codes. | ADR-001…010 |
| 2026-09-24 | AI adapter uses the official `anthropic` SDK (optional extra), tiers `claude-opus-5` / `claude-haiku-4-5`, provider off by default. | ADR-005 |
