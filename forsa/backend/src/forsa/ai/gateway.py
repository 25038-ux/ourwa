"""Provider-neutral AI gateway (spec §23, ADR-005).

* Routes each task to a *tier* (fast / reasoning), never to a hard-coded vendor.
* Records every call in ``ai_requests`` (provider, model, prompt/schema version,
  tokens, latency, cost, status) for audit, replay and cost tracking.
* Enforces per-tenant daily budgets and de-duplicates identical requests.
* Falls back across providers; when none is available callers keep their
  deterministic output — the product never depends on a model being up.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import timedelta
from enum import StrEnum
from typing import Any, Protocol

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from forsa.db.models import AIRequest
from forsa.kernel.clock import utcnow
from forsa.kernel.hashing import content_hash

log = logging.getLogger("forsa.ai")


class Tier(StrEnum):
    FAST = "fast"
    REASONING = "reasoning"


class AITask(StrEnum):
    EXPLAIN_MATCH = "explain_match"
    CLASSIFY = "classify"
    EXTRACT_REQUIREMENTS = "extract_requirements"


ROUTES: dict[AITask, Tier] = {
    AITask.EXPLAIN_MATCH: Tier.FAST,
    AITask.CLASSIFY: Tier.FAST,
    AITask.EXTRACT_REQUIREMENTS: Tier.REASONING,
}


@dataclass
class AICall:
    task: AITask
    system: str
    user: str
    prompt_version: str
    schema_version: str | None = None
    max_tokens: int = 1024
    org_id: uuid.UUID | None = None


@dataclass
class AIResult:
    ok: bool
    text: str = ""
    provider: str = "none"
    model: str = "none"
    input_tokens: int | None = None
    output_tokens: int | None = None
    latency_ms: int | None = None
    cost_usd: float | None = None
    error: str | None = None
    request_id: uuid.UUID | None = None
    cached: bool = False
    raw: dict[str, Any] = field(default_factory=dict)


class AIProvider(Protocol):
    name: str

    def available(self) -> bool: ...

    def complete(self, call: AICall, tier: Tier) -> AIResult: ...


class NullProvider:
    """Default provider: no model. Every caller must have a deterministic fallback."""

    name = "none"

    def available(self) -> bool:
        return False

    def complete(self, call: AICall, tier: Tier) -> AIResult:
        return AIResult(ok=False, error="no_provider_configured")


class AIGateway:
    def __init__(self, providers: list[AIProvider], daily_budget_usd: float, breaker_threshold: int = 3):
        self.providers = providers
        self.daily_budget_usd = daily_budget_usd
        self.breaker_threshold = breaker_threshold
        self._failures: dict[str, int] = {}

    def enabled(self) -> bool:
        return any(p.available() for p in self.providers)

    def _spent_today(self, session: Session, org_id: uuid.UUID | None) -> float:
        since = utcnow() - timedelta(days=1)
        q = select(func.coalesce(func.sum(AIRequest.cost_usd), 0)).where(AIRequest.created_at >= since)
        q = q.where(AIRequest.org_id == org_id) if org_id else q.where(AIRequest.org_id.is_(None))
        return float(session.scalar(q) or 0)

    def complete(self, session: Session, call: AICall) -> AIResult:
        tier = ROUTES[call.task]
        input_hash = content_hash([call.task, call.prompt_version, call.schema_version, call.system, call.user])
        cached = session.scalar(
            select(AIRequest)
            .where(
                AIRequest.input_hash == input_hash,
                AIRequest.status == "ok",
                AIRequest.created_at >= utcnow() - timedelta(days=30),
            )
            .order_by(AIRequest.created_at.desc())
            .limit(1)
        )
        if cached and cached.output:
            return AIResult(
                ok=True,
                text=cached.output.get("text", ""),
                provider=cached.provider,
                model=cached.model,
                request_id=cached.id,
                cached=True,
            )
        if self._spent_today(session, call.org_id) >= self.daily_budget_usd:
            return self._record(session, call, input_hash, AIResult(ok=False, error="budget_exceeded"))
        last = AIResult(ok=False, error="no_provider_available")
        for provider in self.providers:
            if not provider.available() or self._failures.get(provider.name, 0) >= self.breaker_threshold:
                continue
            started = time.monotonic()
            try:
                result = provider.complete(call, tier)
            except Exception as exc:  # provider errors are recorded and trigger fallback
                result = AIResult(ok=False, provider=provider.name, error=f"{type(exc).__name__}: {exc}"[:500])
            result.latency_ms = result.latency_ms or int((time.monotonic() - started) * 1000)
            self._failures[provider.name] = 0 if result.ok else self._failures.get(provider.name, 0) + 1
            last = self._record(session, call, input_hash, result)
            if result.ok:
                return last
            log.warning("ai provider %s failed for %s: %s", provider.name, call.task, result.error)
        return last

    def _record(self, session: Session, call: AICall, input_hash: str, result: AIResult) -> AIResult:
        row = AIRequest(
            org_id=call.org_id,
            task=call.task.value,
            provider=result.provider,
            model=result.model,
            prompt_version=call.prompt_version,
            schema_version=call.schema_version,
            input_hash=input_hash,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            latency_ms=result.latency_ms,
            cost_usd=result.cost_usd,
            status="ok" if result.ok else "error",
            error=result.error,
            output={"text": result.text} if result.ok else None,
        )
        session.add(row)
        session.flush()
        result.request_id = row.id
        return result
