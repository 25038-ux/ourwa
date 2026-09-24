# QA strategy

| Layer | Where | Runs in CI |
|---|---|---|
| Unit (pure) | `backend/tests/unit` — normalisation, ontology, matching gates/scores/recommendations, messages, extraction, segmentation, file sniffing | yes |
| Integration (PostgreSQL) | `backend/tests/integration` — ingestion idempotency & versioning, blocked sources, failure isolation, cited requirements, injection flags, RLS isolation, queue dead-letter, API workflows, RBAC, uploads | yes (service container) |
| Evals (golden) | `evals/{matching,extraction,multilingual,safety}` via `forsa eval`; critical failures fail CI | yes |
| End-to-end (browser) | Playwright smoke: login → command center → explorer → opportunity page (desktop + 390 px) | manual today |
| Web static | `tsc --noEmit`, `next build` | yes |

Rules: never delete or skip a test to get green; every bug fix gets a regression test (see the tests added
for clause numbering, per-bid instruments, parallel document timing, warranty ≠ financial).

## Phase gates (spec §82)
- **Phase 3**: real-source connector runs reliably, zero duplicates, lineage verified on real pages.
- **Phase 4**: benchmark of ≥ 100 real documents with annotated sample; extraction precision/recall reported
  per category; scanned PDFs handled.
- **Phase 6**: matching benchmark with human labels; report precision@K, recall@K, FP/FN rates, agreement.
- **Phase 10**: proposal generation citation coverage; unsupported-claim detection.

## Red-team scenarios (spec §110) — status
| Scenario | Covered by |
|---|---|
| Malicious document (prompt injection) | safety evals; document risk flags (integration test) |
| Tenant escape | RLS + API cross-tenant tests |
| AI hallucinated requirement | AI output is INFERENCE only; rewording validator eval |
| Conflicting documents / expired certification / fake credentials / source poisoning | expired credential unit test; others **TODO** |
