"""OpenAI-compatible Chat Completions adapter.

One adapter serves every provider that exposes `POST {base_url}/chat/completions`: OpenAI, DeepSeek, Qwen
(Model Studio compatible mode), Moonshot Kimi, Zhipu GLM, MiniMax, NVIDIA NIM, Groq, OpenRouter, Gemini's
OpenAI endpoint, Mistral, Cerebras, Hugging Face router and local Ollama. Tool calling uses the standard
`tools` / `tool_calls` fields; providers without tool support simply return text.
"""

from __future__ import annotations

import json
import time
from typing import Any

import httpx

from forsa.ai.types import AICall, AIResult, ProviderConfig, ToolCall


def _messages(call: AICall) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = [{"role": "system", "content": call.system}]
    for m in call.conversation():
        msg = {k: v for k, v in m.items() if not k.startswith("_")}
        if msg.get("tool_calls"):
            msg["tool_calls"] = [
                {
                    **tc,
                    "function": {
                        **tc["function"],
                        "arguments": json.dumps(tc["function"]["arguments"], ensure_ascii=False),
                    },
                }
                if not isinstance(tc["function"]["arguments"], str)
                else tc
                for tc in msg["tool_calls"]
            ]
        out.append(msg)
    return out


class OpenAICompatibleProvider:
    def __init__(self, transport: httpx.BaseTransport | None = None, timeout_s: float = 60.0):
        self._transport = transport
        self._timeout = timeout_s

    def _client(self, cfg: ProviderConfig) -> httpx.Client:
        headers = {"Content-Type": "application/json"}
        if cfg.api_key:
            headers["Authorization"] = f"Bearer {cfg.api_key}"
        return httpx.Client(
            base_url=(cfg.base_url or "").rstrip("/") + "/",
            headers=headers,
            timeout=self._timeout,
            transport=self._transport,
        )

    def complete(self, cfg: ProviderConfig, call: AICall, model: str) -> AIResult:
        body: dict[str, Any] = {"model": model, "messages": _messages(call), cfg.max_tokens_param: call.max_tokens}
        if call.tools:
            body["tools"] = [
                {
                    "type": "function",
                    "function": {"name": t.name, "description": t.description, "parameters": t.parameters},
                }
                for t in call.tools
            ]
            body["tool_choice"] = "auto"
        if call.json_output:
            body["response_format"] = {"type": "json_object"}
        started = time.monotonic()
        with self._client(cfg) as client:
            resp = client.post("chat/completions", json=body)
        latency = int((time.monotonic() - started) * 1000)
        if resp.status_code >= 400:
            return AIResult(
                ok=False,
                provider=cfg.id,
                model=model,
                latency_ms=latency,
                error=f"HTTP {resp.status_code}: {resp.text[:300]}",
            )
        data = resp.json()
        choice = (data.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        calls: list[ToolCall] = []
        for tc in message.get("tool_calls") or []:
            fn = tc.get("function") or {}
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {"_invalid_json": fn.get("arguments")}
            calls.append(ToolCall(id=tc.get("id") or f"call_{len(calls)}", name=fn.get("name", ""), arguments=args))
        text = message.get("content") or ""
        usage = data.get("usage") or {}
        return AIResult(
            ok=bool(text or calls),
            text=text,
            provider=cfg.id,
            model=data.get("model") or model,
            tool_calls=calls,
            stop_reason=choice.get("finish_reason"),
            latency_ms=latency,
            input_tokens=usage.get("prompt_tokens"),
            output_tokens=usage.get("completion_tokens"),
            error=None if (text or calls) else "empty response",
        )

    def list_models(self, cfg: ProviderConfig) -> list[str]:
        with self._client(cfg) as client:
            resp = client.get("models")
        resp.raise_for_status()
        data = resp.json()
        items = data.get("data") if isinstance(data, dict) else data
        return sorted({str(m["id"]) for m in items or [] if isinstance(m, dict) and m.get("id")})
