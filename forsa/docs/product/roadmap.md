# Roadmap

Follows the spec's phases and execution tiers (§51, §121). A phase advances only when its gate passes.

| Phase | Scope | Status |
|---|---|---|
| 0 Discovery | Repo/tooling audit ✔; official sources ✘ (egress blocked) | **Blocked on source access** |
| 1 Foundation | Monorepo, lint/type/test, CI, Docker, migrations, auth, orgs, audit, logging | ✔ (CI not yet run on GitHub) |
| 2 Canonical model | 35 tables, evidence graph, versions, RLS | ✔ |
| 3 Ingestion | Framework ✔, synthetic source ✔, ARMP/UNGM/World Bank ✘ | In progress |
| 4 Document intelligence | Extraction, segmentation, rule-based requirements ✔; OCR, tables, real benchmark ✘ | In progress |
| 5 Company twin | Profile, capabilities, credentials, projects, evidence upload, verification, suggestions ✔; guided onboarding / AI interview ✘ | In progress |
| 6 Matching v1 | Gates, ontology, scoring, explanations ✔; embeddings, human-labelled benchmark ✘ | In progress |
| 7 Opportunity intelligence | Intelligence page, why-now, risks, change events ✔ | MVP ✔ |
| 8 Bid/no-bid | Gates, weighted score, economics ranges, human decision ✔ | MVP ✔ |
| 9 Bid workspace | Compliance matrix, approvals, outcomes ✔; tasks UI, comments ✘ | MVP |
| 10 Proposal copilot | Evidence-classified skeleton ✔; AI drafting ✘ | Not started |
| 11–17 | Partner graph, buyer/market intelligence, forecasting, daily agent, beyond tenders, learning, internationalisation | Data model hooks only |

## Next 4 weeks (proposal)
1. Unblock source access; complete Phase 0 for ARMP; activate the connector with real-page tests.
2. Real DAO benchmark (≥ 100 docs) → extraction metrics → improve rules / add AI proposals behind a flag.
3. Concierge pilot with 5 companies; collect feedback labels; first matching benchmark.
4. Staging deployment (managed Postgres, S3, TLS), OTel, malware scanning.
