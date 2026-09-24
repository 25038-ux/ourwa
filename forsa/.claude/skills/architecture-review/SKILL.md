---
name: architecture-review
description: Review a proposed change or design against FORSA's architecture (modular monolith, evidence-first, RLS, deterministic engine). Use before structural changes, new modules, new dependencies or data-model changes.
---

# architecture-review

1. Read `docs/architecture/system-overview.md`, the relevant ADRs in `docs/adr/`, and `docs/project-state.md`.
2. Check the import direction and purity rules in `CLAUDE.md`.
3. Ask: does this need a new stateful dependency? (Default no — ADR-002.) A new service? (Default no — ADR-001.)
4. Ask: does every new fact carry evidence? Does missing data stay UNKNOWN? Is tenant data under RLS?
5. Ask: is any consequential external action possible without an APPROVED approval?
6. If the answer changes an ADR decision, write a new ADR (Context/Decision/Alternatives/Consequences/Status)
   and add a decision-log line. Never change architecture silently.
