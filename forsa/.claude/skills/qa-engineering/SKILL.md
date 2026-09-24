---
name: qa-engineering
description: Plan and write tests: unit, PostgreSQL integration, evals, browser smoke.
---

# qa-engineering

1. Pure logic → unit tests; DB/RLS/queue/API → integration tests (`backend/tests/integration`).
2. Every bug fix gets a regression test; never delete or skip tests to go green.
3. Integration tests are skipped without PostgreSQL — report that explicitly, it is not a pass.
4. Browser smoke: Playwright login → command center → explorer → opportunity page at 1360 px and 390 px.
5. Update `docs/testing/qa-strategy.md` when coverage changes.
