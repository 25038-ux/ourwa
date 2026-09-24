"""Claude adapter for the AI gateway, using the official ``anthropic`` Python SDK.

Optional dependency (``pip install forsa[ai]``); imported lazily so the core
never requires it. Prices are per 1M tokens, cached from Anthropic's pricing
table on 2026-06-24 — verify before relying on cost reports.
"""

from __future__ import annotations

from forsa.ai.gateway import AICall, AIResult, Tier

PRICES_PER_MTOK: dict[str, tuple[float, float]] = {
    "claude-opus-5": (5.0, 25.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-haiku-4-5": (1.0, 5.0),
}


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str | None, models: dict[Tier, str], refusal_fallback_model: str | None = None):
        self._api_key = api_key
        self.models = models
        self.refusal_fallback_model = refusal_fallback_model
        self._client = None

    def available(self) -> bool:
        if not self._api_key:
            return False
        try:
            import anthropic  # noqa: F401
        except ImportError:
            return False
        return True

    def _get_client(self):
        if self._client is None:
            import anthropic

            self._client = anthropic.Anthropic(api_key=self._api_key, max_retries=2, timeout=60.0)
        return self._client

    def complete(self, call: AICall, tier: Tier) -> AIResult:
        model = self.models[tier]
        client = self._get_client()
        kwargs = {
            "model": model,
            "max_tokens": call.max_tokens,
            "system": call.system,
            "messages": [{"role": "user", "content": call.user}],
        }
        if model.startswith("claude-opus"):
            kwargs["output_config"] = {"effort": "low" if tier == Tier.FAST else "high"}
        if self.refusal_fallback_model and model.startswith("claude-opus-5"):
            response = client.beta.messages.create(
                betas=["server-side-fallback-2026-06-01"], fallbacks=[{"model": self.refusal_fallback_model}], **kwargs
            )
        else:
            response = client.messages.create(**kwargs)
        if response.stop_reason == "refusal":
            return AIResult(ok=False, provider=self.name, model=model, error="refusal")
        text = "".join(block.text for block in response.content if block.type == "text")
        usage = response.usage
        price = PRICES_PER_MTOK.get(model)
        cost = None
        if price:
            cost = (usage.input_tokens * price[0] + usage.output_tokens * price[1]) / 1_000_000
        return AIResult(
            ok=bool(text),
            text=text,
            provider=self.name,
            model=model,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cost_usd=cost,
            error=None if text else f"empty response ({response.stop_reason})",
        )


def build_gateway(settings):
    from forsa.ai.gateway import AIGateway, AIProvider, NullProvider

    providers: list[AIProvider] = []
    if settings.ai_provider == "anthropic":
        providers.append(
            AnthropicProvider(
                settings.anthropic_api_key,
                {Tier.FAST: settings.ai_fast_model, Tier.REASONING: settings.ai_reasoning_model},
                refusal_fallback_model=settings.ai_refusal_fallback_model,
            )
        )
    providers.append(NullProvider())
    return AIGateway(providers, settings.ai_daily_budget_usd_per_org)
