# ADR-011: AI provider catalog, sensitivity routing and a decision-model tier (Jev)

**Status:** Accepted (2026-09-24) — extends ADR-005 (deterministic engine stays authoritative)

## Context
Users want to run FORSA with many models: frontier (Anthropic, OpenAI, Gemini, Mistral), Chinese
(DeepSeek, Qwen, Kimi/Moonshot, GLM/Zhipu, MiniMax), free/cheap hosted tiers (NVIDIA NIM, Groq, Cerebras,
OpenRouter, Hugging Face), local models (Ollama), and Jev — TypeSafe's "System One" decision model, which
returns calibrated choices/probabilities instead of text. Tenders and company profiles are business data;
not every provider is acceptable for every piece of data.

## Decision
1. **Catalog, not code** — `ai/catalog.yaml` lists providers (kind, base URL, key env var, tier models,
   default data ceiling, free tier, docs, `verified`). Most use one OpenAI-compatible adapter
   (`providers/openai_compat.py`); Anthropic uses its official SDK; Jev has its own adapter built from the
   official `typesafe-sdk` wire format (`providers/jev.py`).
2. **Three tiers** — `fast`, `reasoning`, `decision`. Tasks route to tiers (`ai/types.py::ROUTES`), never to a
   vendor. Only decision-kind providers (Jev) serve the `decision` tier via `AIGateway.decide()`.
3. **Sensitivity routing** — every call declares `public < internal < confidential`. A provider only receives
   calls at or below its ceiling. Cloud providers default to `internal`; Ollama (on-prem) to `confidential`.
   Platform admins can raise a ceiling only after recording a DPA review (`ai_provider_settings.dpa_reviewed`).
   Bid drafting is `confidential` ⇒ it runs only on a DPA-reviewed or local provider.
4. **Enablement** — a provider is used only if requested (admin setting or `FORSA_AI_PROVIDERS`) **and** it has
   credentials. Keys come only from the environment (`<catalog api_key_env>`, `FORSA_<ID>_API_KEY` or
   `FORSA_AI_KEY_<ID>`); they are never stored in the database or shown in the UI.
5. **Discovery over guessing** — model ids that we could not verify are left empty in the catalog; admins pin
   them from `GET /models` via *Settings → AI providers → Discover*.
6. Everything in ADR-005 still holds: the product works with no provider; AI output is INFERENCE.

## Alternatives considered
One SDK per vendor (large surface, slow to add providers); LiteLLM (extra dependency and proxy semantics we
don't need); letting users paste API keys in the UI (secrets in the DB — rejected).

## Consequences
Adding an OpenAI-compatible provider is a YAML entry. Endpoints/model names marked `verified: false` must be
checked against official docs once network egress allows it. Jev's REST paths follow the SDK source (0.7.1);
re-verify on SDK upgrades.
