# Source registry — verification log

Machine-readable registry: `sources/registry.yaml`. This file records **what has been verified, when and how**.
No connector may be activated without a dated verification entry here (spec §106).

| Source | Registry id | Status | Verified facts | Open questions |
|---|---|---|---|---|
| Portail national des marchés publics (MR) | `mr-armp-portal` | pending_verification | None yet — site unreachable from build environment (egress policy, 2026-09-24). Spec states it publishes notices, documents, annual procurement plans and email alerts. | Listing/detail URL structure, pagination, document links, plan and award pages, robots.txt, terms of use, licence, update frequency, languages (FR/AR). |
| UNGM notices | `ungm-notices` | pending_verification | Spec cites a developer API (developer.ungm.org). Not verified. | Authorization model, endpoints, rate limits, licence, Mauritania filtering. |
| World Bank procurement notices | `worldbank-procurement-notices` | pending_verification | Spec cites the World Bank data catalog dataset 0037795. Not verified. | Access method (API vs dataset download), fields, licence, country filter. |
| FORSA demo | `forsa-demo` | active | Synthetic, hand-written notices. | — |

## Verification procedure
1. Open the official site/API docs; save the terms and robots.txt (date + URL).
2. Record structure: listing URL + pagination, detail pages, document links, plans, awards, languages.
3. Capture ≥ 3 real pages as parser fixtures (respect copyright; store only what is needed for tests).
4. Record rate limits and polite interval; choose `update_frequency_hours`.
5. Legal checkpoint (spec §108): commercial reuse rights, attribution, personal data.
6. Only then set `status: active`.
