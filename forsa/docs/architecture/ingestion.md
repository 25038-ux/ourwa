# Ingestion architecture

## Contract (`ingestion/contracts.py`)
`discover() → SourceRef*`, `fetch(ref) → RawRecord`, `parse(raw) → NormalizedOpportunity*`, `health_check()`.
Connectors never touch the database. Change detection, deduplication, versioning and lineage are done once,
generically, by `IngestionPipeline`.

## Guarantees (`ingestion/pipeline.py`)
* Only `status: active` registry entries run; others produce a `blocked` run (visible in source health).
* Identical bytes for a URL → one snapshot (`unchanged_bytes`), no reprocessing.
* Identical normalised payload → no new version (`unchanged`).
* Each record runs in a SAVEPOINT; a bad record is counted (`failed`), logged, and surfaced — it never
  aborts the run or leaves partial rows. Run status: `succeeded | partial | failed | blocked`.
* Every projected field gets an `evidence` row (snapshot, locator, quote, hash, retrieved_at) and an
  `assertions` row (FACT, HIGH, UNVERIFIED, method `connector:<key>:<version>`).
* Changes produce typed `opportunity_events` and `domain_events`, then an `analyze_opportunity` job.

## Network policy (`ingestion/http.py`)
HTTPS only · host allowlist from the registry · refuses hosts resolving to private/loopback/link-local
addresses (SSRF) · robots.txt honoured (5xx/unreachable ⇒ disallow, per RFC 9309) · per-host minimum interval
· bounded retries with exponential backoff and `Retry-After` · circuit breaker · response size cap · no
redirects followed automatically · no cookies/JS/CAPTCHA handling, ever.

## Connectors
| Connector | Status | Notes |
|---|---|---|
| `fixture` | active (`forsa-demo`) | Synthetic JSON notices; dates relative to `FORSA_DEMO_ANCHOR`; records flagged `is_synthetic`. |
| `html_table` | implemented, **not enabled** | Declarative column mapping from the registry. Intended for the ARMP portal once inspected. |
| `ungm_api`, `worldbank_api` | not implemented | Must be written against the official API docs (Phase 3). |

## Activating a real source (checklist)
1. Inspect the official site/API manually; record structure, terms URL, robots.txt, licence and rate limits
   in `docs/research/source-registry.md` (with date).
2. Fill the registry entry (`allowed_hosts`, `config`, `rate_limit`); keep `status: pending_verification`.
3. Save 3+ real pages as test fixtures; write parser tests against them.
4. Get review, then set `status: active`. Watch source health for 48 h.

## Source health (`services/sources.py`)
`UP · DEGRADED · STALE · DOWN · BLOCKED · AUTH_REQUIRED · UNVERIFIED`. STALE when the last successful run is
older than max(12 h, 2× expected frequency). The briefing shows source alerts — stale intelligence is never
shown silently.
