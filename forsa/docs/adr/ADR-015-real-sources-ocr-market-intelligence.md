# ADR-015: Real sources, OCR and market intelligence

**Status:** Accepted (2026-09-24) — builds on ADR-004 (evidence), ADR-006 (connectors), ADR-008 (versions)

## Context
With network access granted, the three official sources were inspected (docs/research/source-registry.md). Findings
that shape the design: the Mauritanian portal's notices are **scanned PDFs** with no deadline field; the World Bank
feed is 77 % **contract awards**; UNGM's Notice API needs **OAuth credentials** issued to UN users.

## Decision
1. **Connectors** `armp_api`, `worldbank_api`, `ungm_api` (all through `PoliteHttpClient`). Records are built from an
   **allow-list of fields**; personal data (portal staff, contact persons, individual consultants) is never stored.
2. **`attributes`** (JSONB, tracked + versioned) carries source-specific structure: award winners, other bidders,
   planned launch dates, plan references. No per-source columns.
3. **OCR port** (`documents/ocr.py`): Tesseract `fra+ara`, pages in parallel with `OMP_THREAD_LIMIT=1` (93 s → 2.6 s
   per page measured). OCR text is labelled (`OCR_DONE`, method `+ocr`) and requirements from it are LOW confidence.
4. **Deadlines from documents** (`documents/deadlines.py`, pure, FR/AR/EN): only a date next to a submission anchor
   and away from opening/publication phrases; stored as a DERIVED assertion with the exact quote. Undated notices
   older than 90 days are presumed closed (`services.matching.still_open`).
5. **Awards are not opportunities**: kind `AWARD` is excluded from matching, lists and reminders, and powers
   **Market intelligence** (who wins, who buys, what is planned, red list). Amounts are summed per currency, never
   converted with an assumed rate.
6. **Red list** (`debarments`): synced daily; name matches are *signals to verify* (registry number shown).
7. **Credential-gated sources** declare `requires_env`; health shows AUTH_REQUIRED and the scheduler skips them.
8. `forsa reparse <source>` re-applies improved parsers to stored snapshots without network access.

## Consequences
Deadline recall on real ARMP notices is partial (33/79 found; many misses are result/addendum notices, now
classified). OCR quality depends on scan quality — surfaced to users ("lue dans l'avis", "texte lu par OCR").
