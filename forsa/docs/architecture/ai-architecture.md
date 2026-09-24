# AI architecture

## Principles
1. **The product works with no model.** Matching, requirement extraction, explanations and briefings are
   deterministic. No provider is enabled by default.
2. **AI proposes, evidence decides.** Model output is INFERENCE: stored with provenance, never counted as
   evidence (`claim_weight = 0`) and never used to fail a gate.
3. **Documents are data.** Untrusted content is wrapped in escaped `<untrusted_document>` boundaries
   (`ai/boundaries.py`); injection phrasings (fr/en/ar) are flagged on ingestion as document risk flags.
4. **Re-wordings are validated.** `validate_rewording` rejects outputs that introduce numbers absent from the
   grounded text, echo injection phrases, or balloon in length.

## Providers (`ai/catalog.yaml`, `ai/catalog.py`) — ADR-011
| Group | Providers (catalog ids) | Adapter |
|---|---|---|
| Frontier | `anthropic`, `openai`, `gemini`, `mistral` | Anthropic SDK / OpenAI-compatible |
| Chinese | `deepseek`, `qwen` (DashScope), `moonshot` (Kimi), `zhipu` (GLM), `minimax` | OpenAI-compatible |
| Free / cheap hosted | `nvidia` (NIM), `groq`, `cerebras`, `openrouter`, `huggingface` | OpenAI-compatible |
| Local | `ollama` (default ceiling CONFIDENTIAL) | OpenAI-compatible |
| Decision model | `jev` (TypeSafe System One) | `providers/jev.py` (typesafe-sdk 0.7.1 wire format) |

* Effective config = catalog defaults ⊕ environment (keys, base URLs, `FORSA_AI_PROVIDERS` order) ⊕ admin
  overrides (`ai_provider_settings`: enabled, priority, pinned models, ceiling, DPA review).
* Keys only from env: the catalog's `api_key_env`, `FORSA_<ID>_API_KEY` or `FORSA_AI_KEY_<ID>`.
* Admin API: `GET /admin/ai/providers`, `PUT /admin/ai/providers/{id}`, `POST …/discover` (lists models from
  the provider), `POST …/test`. UI: *Settings → AI providers*.

## Gateway (`ai/gateway.py`)
* Tasks route to tiers (`fast`, `reasoning`, `decision`), never to a vendor. `ROUTES` is the routing table.
* **Sensitivity routing**: each call declares `public | internal | confidential`; candidates are the enabled
  providers whose ceiling allows it, in priority order, skipping open circuit breakers.
* Every call is recorded in `ai_requests`: provider, model, prompt_version, schema_version, input hash,
  tokens, latency, cost, status, output. Identical requests within 30 days are served from this cache.
* Per-tenant daily budget (`FORSA_AI_DAILY_BUDGET_USD_PER_ORG`); provider circuit breaker; ordered fallback.
* `complete()` supports tools and JSON output (OpenAI-style tool calls; the Anthropic adapter converts).
  `decide()` sends `state + questions` to a decision provider and returns calibrated choice probabilities.
* Anthropic: tier models `claude-opus-5` (reasoning) / `claude-haiku-4-5` (fast), server-side refusal fallback.
* Customer data is not used for training (spec §105); record each production provider's retention terms here
  and set `dpa_reviewed` before raising its ceiling.

## Assistant (`assistant/`) — ADR-013
Read-only tenant tools + `propose_action`; LLM tool loop (≤ 5 steps) or deterministic FR/EN/AR planner;
grounding guard rejects answers whose numbers are absent from tool results. SSE: `meta/tool/delta/final`.

## AI features (`services/ai_features.py`) — ADR-014
`ai_explanations`, `ai_extraction`, `ai_decisions`, `ai_triage`, `ai_drafting` — each behind `FORSA_FEATURES`,
each with a safety net (rewording validation, verbatim quotes + NEEDS_REVIEW, FORECAST-only triage).

## Agents (`ai/tools.py`)
Agents are explicit workflow steps with fixed tool allowlists and `MAX_AGENT_STEPS`. There is no generic
network tool. `submit_external` requires an APPROVED approval request.

## Model/version reproducibility (spec §69)
Matches store `scoring_version`; AI calls store model, prompt and schema versions; requirement rows store
`extraction_method` (e.g. `rules:req-v1`). Changing any of these ⇒ bump the version string.

## Evaluation
`forsa eval` runs golden suites in `evals/` (matching, extraction, multilingual, safety). Critical failures
fail CI. AI-backed extractors must be evaluated against the same suites before being enabled by a flag.
