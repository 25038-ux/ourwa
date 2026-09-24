# AI architecture

## Principles
1. **The product works with no model.** Matching, requirement extraction, explanations and briefings are
   deterministic. `FORSA_AI_PROVIDER=none` is the default.
2. **AI proposes, evidence decides.** Model output is INFERENCE: stored with provenance, never counted as
   evidence (`claim_weight = 0`) and never used to fail a gate.
3. **Documents are data.** Untrusted content is wrapped in escaped `<untrusted_document>` boundaries
   (`ai/boundaries.py`); injection phrasings (fr/en/ar) are flagged on ingestion as document risk flags.
4. **Re-wordings are validated.** `validate_rewording` rejects outputs that introduce numbers absent from the
   grounded text, echo injection phrases, or balloon in length.

## Gateway (`ai/gateway.py`)
* Tasks route to tiers (`fast`, `reasoning`), never to a vendor. `ROUTES` is the single routing table.
* Every call is recorded in `ai_requests`: provider, model, prompt_version, schema_version, input hash,
  tokens, latency, cost, status, output. Identical requests within 30 days are served from this cache.
* Per-tenant daily budget (`FORSA_AI_DAILY_BUDGET_USD_PER_ORG`); provider circuit breaker; ordered fallback.
* `AnthropicProvider` uses the official `anthropic` SDK (optional extra `forsa[ai]`), tier models
  `claude-opus-5` (reasoning) and `claude-haiku-4-5` (fast), with server-side refusal fallback to
  `claude-opus-4-8` enabled for Opus 5 calls. Prices in the adapter are cached (2026-06-24) — verify.
* Customer data is not used for training (spec §105); keep provider data-retention settings documented here
  when a provider is enabled in production.

## Agents (`ai/tools.py`)
Agents are explicit workflow steps with fixed tool allowlists and `MAX_AGENT_STEPS`. There is no generic
network tool. `submit_external` requires an APPROVED approval request.

## Model/version reproducibility (spec §69)
Matches store `scoring_version`; AI calls store model, prompt and schema versions; requirement rows store
`extraction_method` (e.g. `rules:req-v1`). Changing any of these ⇒ bump the version string.

## Evaluation
`forsa eval` runs golden suites in `evals/` (matching, extraction, multilingual, safety). Critical failures
fail CI. AI-backed extractors must be evaluated against the same suites before being enabled by a flag.
