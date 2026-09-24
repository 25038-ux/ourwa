# Decision log

Newest first. Significant decisions link to an ADR.

| Date | Decision | Ref |
|---|---|---|
| 2026-09-24 | Real sources activated: ARMP portal JSON API (notices + procurement plans + red list), World Bank Search API (CC BY 4.0), UNGM official API (credential-gated, AUTH_REQUIRED until keys). Field allow-lists; no personal data stored. | ADR-015 |
| 2026-09-24 | OCR (Tesseract fra+ara, single-threaded pages in parallel) + deadline extraction from notice documents as DERIVED assertions with quotes; undated notices >90 days presumed closed. | ADR-015 |
| 2026-09-24 | Awards feed Market intelligence (winners, buyers, pipeline, red list), never matching. Amounts per currency, no FX assumptions. | ADR-015 |
| 2026-09-24 | Android = Trusted Web Activity + WebView fallback, server chosen at first launch; production = single-server Compose with Caddy, non-superuser DB role enforced at startup. | ADR-016 |
| 2026-09-24 | AI provider catalog (frontier, Chinese, free-tier, local, Jev) with tiers fast/reasoning/decision and per-provider data-sensitivity ceilings; keys env-only; model ids pinned via discovery, not guessed. | ADR-011 |
| 2026-09-24 | Instant notifications via Postgres LISTEN/NOTIFY → SSE (`/api/v1/live`) + Web Push outbox job; no new infrastructure. API `Cache-Control` is now `no-store, no-transform` so proxies never buffer streams. | ADR-012 |
| 2026-09-24 | Assistant answers only through tenant-scoped tools, proposes (never executes) actions, falls back to a deterministic FR/EN/AR planner; LLM answers with ungrounded numbers are discarded. Voice via the browser Web Speech API. | ADR-013 |
| 2026-09-24 | AI features behind `FORSA_FEATURES` flags (explanations, extraction, decisions, triage, drafting); AI-proposed requirements are NEEDS_REVIEW and excluded from hard gates until verified. | ADR-014 |
| 2026-09-24 | Mobile = installable PWA (manifest, service worker, push, bottom tab bar, sheets, swipe triage) sharing one codebase with desktop; native shells can wrap it later. Web rules now allow purposeful motion (springs, reduced-motion respected). | .claude/rules/web.md |
| 2026-09-24 | Onboarding: describe → confirm ontology-backed suggestions (AI suggestions limited to catalogue ids) → capacity; nothing saved without confirmation. | services/onboarding.py |
| 2026-09-24 | Scoring `fit-v1.0 → fit-v1.1`: credentials/per-bid instruments are obtained *in parallel* with bid preparation (need ≥1 day margin), no longer after it. Found while reviewing live demo output (a 5-day bank guarantee with 6 days left was a false NO-BID). Run `forsa rematch` after scoring changes. | engine.py |
| 2026-09-24 | Planned (procurement-plan) items recommend REVIEW + "prepare now, decide at publication", never BID. | engine.py |
| 2026-09-24 | Per-bid instruments (bid security) are GAP "obtain" when absent from the profile, not UNKNOWN. | ontology `per_bid` |
| 2026-09-24 | FORSA lives in `forsa/` inside the `ourwa` repository; the existing PHP school app (El OURWA) is untouched. | — |
| 2026-09-24 | Phase 0 could not complete: official portals (marchespublics.gov.mr, search.worldbank.org, UNGM) were blocked by the build environment's egress policy. Decision: build the source-independent foundation and MVP loop on **synthetic** data; keep all real-source connectors `pending_verification` (they refuse to run). | ADR-006 |
| 2026-09-24 | Modular monolith, Postgres-only v1, evidence+assertions, deterministic engine, RLS, append-only history, approvals, reason codes. | ADR-001…010 |
| 2026-09-24 | AI adapter uses the official `anthropic` SDK (optional extra), tiers `claude-opus-5` / `claude-haiku-4-5`, provider off by default. | ADR-005 |
