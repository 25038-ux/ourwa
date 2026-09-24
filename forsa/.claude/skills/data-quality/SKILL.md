---
name: data-quality
description: Ingestion reliability and source health: duplicates, staleness, parse failures, schema drift.
---

# data-quality

1. Check `ingestion_runs.stats` and `/sources` health; STALE after max(12 h, 2× frequency).
2. Duplicates: `(source_id, external_ref)` is unique; investigate any external_ref instability.
3. Parse failures > 10 % ⇒ DEGRADED: capture the new page as a fixture and fix the mapping.
4. Never hide stale data — the briefing must show source alerts.
