"""TypeSafe Jev — a "System One" decision model (typed answers with calibrated probabilities).

Wire format mirrored from the official `typesafe-sdk` 0.7.1 (`_schemas/models.py`, `_core/endpoints.py`):
    POST {base}/v1/systemone   {"state": <str|obj|list>, "model": "jev-latest", "questions": {name: question}}
    question  = {"type": "noul"|"choice"|"score", "instructions"?: ..., "criteria"?: ...}
    answers   = {name: {"type":"noul","noul":p} | {"type":"choice","choice":label,"confidence":c,
                 "probabilities":{label:p}} | {"type":"score","score":x,"confidence":c,"legend":{...},
                 "probabilities":{...}}}
    GET  {base}/v1/models  → {"models": [{"name", "description", "release_date"}]}
Auth: `Authorization: Bearer <TYPESAFE_API_KEY>`.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from forsa.ai.types import ProviderConfig


@dataclass(frozen=True)
class Noul:
    instructions: str
    yes: str | None = None
    no: str | None = None

    def wire(self) -> dict[str, Any]:
        q: dict[str, Any] = {"type": "noul", "instructions": self.instructions}
        if self.yes or self.no:
            q["criteria"] = {"true": self.yes, "false": self.no}
        return q


@dataclass(frozen=True)
class Choice:
    instructions: str
    criteria: dict[str, str | None]

    def wire(self) -> dict[str, Any]:
        return {"type": "choice", "instructions": self.instructions, "criteria": dict(self.criteria)}


@dataclass(frozen=True)
class Score:
    instructions: str
    levels: tuple[str, ...]

    def wire(self) -> dict[str, Any]:
        return {"type": "score", "instructions": self.instructions, "criteria": list(self.levels)}


Question = Noul | Choice | Score


@dataclass
class Decision:
    ok: bool
    answers: dict[str, dict[str, Any]] = field(default_factory=dict)
    model: str = ""
    input_tokens: int | None = None
    output_tokens: int | None = None
    latency_ms: int | None = None
    error: str | None = None

    def probability(self, name: str) -> float | None:
        a = self.answers.get(name) or {}
        return a.get("noul") if a.get("type") == "noul" else None

    def choice(self, name: str) -> tuple[str | None, float | None]:
        a = self.answers.get(name) or {}
        return (a.get("choice"), a.get("confidence")) if a.get("type") == "choice" else (None, None)


class JevProvider:
    def __init__(self, transport: httpx.BaseTransport | None = None, timeout_s: float = 10.0):
        self._transport = transport
        self._timeout = timeout_s

    def _client(self, cfg: ProviderConfig) -> httpx.Client:
        return httpx.Client(
            base_url=(cfg.base_url or "https://api.typesafe.ai").rstrip("/"),
            headers={
                "Authorization": f"Bearer {cfg.api_key}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            timeout=self._timeout,
            transport=self._transport,
        )

    def decide(self, cfg: ProviderConfig, state: Any, questions: dict[str, Question], model: str) -> Decision:
        body = {"state": state, "model": model, "questions": {k: q.wire() for k, q in questions.items()}}
        started = time.monotonic()
        with self._client(cfg) as client:
            resp = client.post("/v1/systemone", json=body)
        latency = int((time.monotonic() - started) * 1000)
        if resp.status_code >= 400:
            return Decision(ok=False, latency_ms=latency, error=f"HTTP {resp.status_code}: {resp.text[:200]}")
        data = resp.json()
        answers = {
            k: v
            for k, v in (data.get("answers") or {}).items()
            if isinstance(v, dict) and v.get("type") in ("noul", "choice", "score")
        }
        usage = data.get("usage") or {}
        return Decision(
            ok=bool(answers),
            answers=answers,
            model=data.get("model", model),
            latency_ms=latency,
            input_tokens=usage.get("input_tokens"),
            output_tokens=usage.get("output_tokens"),
            error=None if answers else "no answers",
        )

    def list_models(self, cfg: ProviderConfig) -> list[str]:
        with self._client(cfg) as client:
            resp = client.get("/v1/models")
        resp.raise_for_status()
        return sorted(m["name"] for m in resp.json().get("models", []) if m.get("name"))
