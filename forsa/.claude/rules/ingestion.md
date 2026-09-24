---
paths:
  - "backend/src/forsa/ingestion/**"
  - "sources/**"
---
# Ingestion rules
- No connector runs without an `active` entry in `sources/registry.yaml` and a dated verification in
  `docs/research/source-registry.md`.
- Network access only through `PoliteHttpClient` (allowlist, robots.txt, rate limit, no redirects). Never
  bypass CAPTCHA, logins, bot protection or robots.txt. Official APIs first.
- Connectors are source-specific and DB-free; do not put source logic in the pipeline or core.
- Parser changes need fixtures captured from the real source and tests against them.
- Never invent endpoints, fields or page structures — write "unknown / to verify" instead.
