"""Claude adapter using the official `anthropic` SDK (optional extra `forsa[ai]`).

Prices per 1M tokens cached from Anthropic's pricing table (2026-06-24) — verify before relying on costs.
Tool use is translated from the internal OpenAI-shaped conversation; the provider-native assistant content
is replayed unchanged on the next turn (required when thinking blocks are present).
"""

from __future__ import annotations

import json
import time
from typing import Any

from forsa.ai.types import AICall, AIResult, ProviderConfig, ToolCall

PRICES_PER_MTOK: dict[str, tuple[float, float]] = {
    "claude-opus-5": (5.0, 25.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-haiku-4-5": (1.0, 5.0),
}


def _to_anthropic(call: AICall) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    pending_results: list[dict[str, Any]] = []
    for m in call.conversation():
        role = m["role"]
        if role == "tool":
            pending_results.append(
                {"type": "tool_result", "tool_use_id": m["tool_call_id"], "content": m.get("content") or ""}
            )
            continue
        if pending_results:
            out.append({"role": "user", "content": pending_results})
            pending_results = []
        if role == "assistant":
            native = (m.get("_native") or {}).get("anthropic")
            if native is not None:
                out.append({"role": "assistant", "content": native})
                continue
            blocks: list[dict[str, Any]] = []
            if m.get("content"):
                blocks.append({"type": "text", "text": m["content"]})
            for tc in m.get("tool_calls") or []:
                args = tc["function"]["arguments"]
                blocks.append(
                    {
                        "type": "tool_use",
                        "id": tc["id"],
                        "name": tc["function"]["name"],
                        "input": json.loads(args) if isinstance(args, str) else args,
                    }
                )
            out.append({"role": "assistant", "content": blocks or [{"type": "text", "text": ""}]})
        else:
            out.append({"role": "user", "content": m.get("content") or ""})
    if pending_results:
        out.append({"role": "user", "content": pending_results})
    return out


class AnthropicProvider:
    def __init__(self) -> None:
        self._clients: dict[str, Any] = {}

    def _client(self, cfg: ProviderConfig) -> Any:
        key = cfg.api_key or ""
        if key not in self._clients:
            import anthropic

            self._clients[key] = anthropic.Anthropic(api_key=cfg.api_key, max_retries=2, timeout=60.0)
        return self._clients[key]

    @staticmethod
    def installed() -> bool:
        try:
            import anthropic  # noqa: F401
        except ImportError:
            return False
        return True

    def complete(self, cfg: ProviderConfig, call: AICall, model: str) -> AIResult:
        client = self._client(cfg)
        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": call.max_tokens,
            "system": call.system,
            "messages": _to_anthropic(call),
        }
        if call.tools:
            kwargs["tools"] = [
                {"name": t.name, "description": t.description, "input_schema": t.parameters} for t in call.tools
            ]
        if model.startswith("claude-opus"):
            kwargs["output_config"] = {"effort": "low" if call.max_tokens <= 1024 else "high"}
        started = time.monotonic()
        fallback = cfg.extra.get("refusal_fallback_model")
        if fallback and model.startswith("claude-opus-5"):
            response = client.beta.messages.create(
                betas=["server-side-fallback-2026-06-01"], fallbacks=[{"model": fallback}], **kwargs
            )
        else:
            response = client.messages.create(**kwargs)
        latency = int((time.monotonic() - started) * 1000)
        if response.stop_reason == "refusal":
            return AIResult(ok=False, provider=cfg.id, model=model, error="refusal", latency_ms=latency)
        text = "".join(b.text for b in response.content if b.type == "text")
        calls = [
            ToolCall(id=b.id, name=b.name, arguments=dict(b.input)) for b in response.content if b.type == "tool_use"
        ]
        usage = response.usage
        price = PRICES_PER_MTOK.get(model)
        cost = (usage.input_tokens * price[0] + usage.output_tokens * price[1]) / 1_000_000 if price else None
        native = [b.model_dump(exclude_none=True) for b in response.content]
        return AIResult(
            ok=bool(text or calls),
            text=text,
            provider=cfg.id,
            model=model,
            tool_calls=calls,
            stop_reason=response.stop_reason,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cost_usd=cost,
            latency_ms=latency,
            raw={"native": native},
            error=None if (text or calls) else "empty response",
        )
