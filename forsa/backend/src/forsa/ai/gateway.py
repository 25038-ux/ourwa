"""Provider-neutral AI gateway (spec §23, ADR-005, ADR-011).

* Routes each task to a *tier* (fast / reasoning / decision), never to a hard-coded vendor.
* Chooses providers by admin priority, **data sensitivity** (a provider only receives data at or below its
  ceiling) and health (circuit breaker), then falls back in order.
* Records every call in ``ai_requests`` (provider, model, prompt/schema version, tokens, latency, cost,
  status) for audit, replay and cost tracking; identical requests are served from that record.
* Enforces per-tenant daily budgets.
* When no provider is usable, callers keep their deterministic output — the product never depends on a model.
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Callable
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from forsa.ai.providers.anthropic import AnthropicProvider
from forsa.ai.providers.jev import Decision, JevProvider, Question
from forsa.ai.providers.openai_compat import OpenAICompatibleProvider
from forsa.ai.types import (
    ROUTES,
    AICall,
    AIResult,
    AITask,
    LLMProvider,
    ProviderConfig,
    Sensitivity,
    Tier,
)
from forsa.db.models import AIRequest
from forsa.kernel.clock import utcnow
from forsa.kernel.hashing import content_hash

log = logging.getLogger("forsa.ai")

__all__ = ["ROUTES", "AICall", "AIGateway", "AIResult", "AITask", "Sensitivity", "Tier"]

ConfigLoader = Callable[[Session | None], list[ProviderConfig]]


class AIGateway:
    def __init__(
        self,
        load_configs: ConfigLoader,
        daily_budget_usd: float,
        breaker_threshold: int = 3,
        adapters: dict[str, Any] | None = None,
    ):
        self._load = load_configs
        self.daily_budget_usd = daily_budget_usd
        self.breaker_threshold = breaker_threshold
        self._failures: dict[str, int] = {}
        self.adapters: dict[str, Any] = adapters or {
            "openai_compatible": OpenAICompatibleProvider(),
            "anthropic": AnthropicProvider(),
            "typesafe_system_one": JevProvider(),
        }

    # ── discovery ───────────────────────────────────────────────────────────
    def configs(self, session: Session | None) -> list[ProviderConfig]:
        return self._load(session)

    def _usable(self, cfg: ProviderConfig) -> bool:
        if not cfg.enabled or self._failures.get(cfg.id, 0) >= self.breaker_threshold:
            return False
        return not (cfg.kind == "anthropic" and not AnthropicProvider.installed())

    def candidates(
        self, session: Session | None, tier: Tier, sensitivity: Sensitivity
    ) -> list[tuple[ProviderConfig, str]]:
        out = []
        for cfg in self.configs(session):
            is_decision = cfg.kind == "typesafe_system_one"
            if (tier == Tier.DECISION) != is_decision:
                continue
            model = cfg.model_for(tier)
            if model and self._usable(cfg) and cfg.allows(sensitivity):
                out.append((cfg, model))
        return out

    def enabled(
        self, session: Session | None = None, tier: Tier = Tier.FAST, sensitivity: Sensitivity = Sensitivity.INTERNAL
    ) -> bool:
        return bool(self.candidates(session, tier, sensitivity))

    def list_models(self, cfg: ProviderConfig) -> list[str]:
        adapter = self.adapters[cfg.kind]
        if not hasattr(adapter, "list_models"):
            return []
        return list(adapter.list_models(cfg))

    # ── budget / cache ──────────────────────────────────────────────────────
    def _spent_today(self, session: Session, org_id: uuid.UUID | None) -> float:
        since = utcnow() - timedelta(days=1)
        q = select(func.coalesce(func.sum(AIRequest.cost_usd), 0)).where(AIRequest.created_at >= since)
        q = q.where(AIRequest.org_id == org_id) if org_id else q.where(AIRequest.org_id.is_(None))
        return float(session.scalar(q) or 0)

    def _cached(self, session: Session, input_hash: str) -> AIRequest | None:
        return session.scalar(
            select(AIRequest)
            .where(
                AIRequest.input_hash == input_hash,
                AIRequest.status == "ok",
                AIRequest.created_at >= utcnow() - timedelta(days=30),
            )
            .order_by(AIRequest.created_at.desc())
            .limit(1)
        )

    # ── language models ─────────────────────────────────────────────────────
    def complete(self, session: Session, call: AICall, *, use_cache: bool = True) -> AIResult:
        tier = ROUTES[call.task]
        input_hash = content_hash(
            [
                call.task,
                call.prompt_version,
                call.schema_version,
                call.system,
                call.conversation(),
                [t.name for t in call.tools],
            ]
        )
        if use_cache and not call.tools:
            cached = self._cached(session, input_hash)
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
        for cfg, model in self.candidates(session, tier, call.sensitivity):
            adapter: LLMProvider = self.adapters[cfg.kind]
            started = time.monotonic()
            try:
                result = adapter.complete(cfg, call, model)
            except Exception as exc:  # recorded; triggers fallback to the next provider
                result = AIResult(ok=False, provider=cfg.id, model=model, error=f"{type(exc).__name__}: {exc}"[:500])
            result.latency_ms = result.latency_ms or int((time.monotonic() - started) * 1000)
            self._failures[cfg.id] = 0 if result.ok else self._failures.get(cfg.id, 0) + 1
            last = self._record(session, call, input_hash, result)
            if result.ok:
                return last
            log.warning("ai provider %s failed for %s: %s", cfg.id, call.task, result.error)
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
            output={"text": result.text, "tool_calls": [c.name for c in result.tool_calls]} if result.ok else None,
        )
        session.add(row)
        session.flush()
        result.request_id = row.id
        return result

    # ── decision models (Jev) ───────────────────────────────────────────────
    def decide(
        self,
        session: Session,
        task: str,
        state: Any,
        questions: dict[str, Question],
        *,
        org_id: uuid.UUID | None = None,
        sensitivity: Sensitivity = Sensitivity.PUBLIC,
        prompt_version: str = "v1",
    ) -> Decision | None:
        """Typed decision with probabilities, or None when no decision model is usable (caller falls back)."""
        wire = {k: q.wire() for k, q in questions.items()}
        input_hash = content_hash(["decide", task, prompt_version, state, wire])
        cached = self._cached(session, input_hash)
        if cached and cached.output and "answers" in cached.output:
            return Decision(ok=True, answers=cached.output["answers"], model=cached.model)
        if self._spent_today(session, org_id) >= self.daily_budget_usd:
            return None
        for cfg, model in self.candidates(session, Tier.DECISION, sensitivity):
            try:
                decision = self.adapters[cfg.kind].decide(cfg, state, questions, model)
            except Exception as exc:
                decision = Decision(ok=False, error=f"{type(exc).__name__}: {exc}"[:500])
            self._failures[cfg.id] = 0 if decision.ok else self._failures.get(cfg.id, 0) + 1
            session.add(
                AIRequest(
                    org_id=org_id,
                    task=f"decide:{task}",
                    provider=cfg.id,
                    model=decision.model or model,
                    prompt_version=prompt_version,
                    schema_version="systemone-v1",
                    input_hash=input_hash,
                    input_tokens=decision.input_tokens,
                    output_tokens=decision.output_tokens,
                    latency_ms=decision.latency_ms,
                    cost_usd=None,
                    status="ok" if decision.ok else "error",
                    error=decision.error,
                    output={"answers": decision.answers} if decision.ok else None,
                )
            )
            session.flush()
            if decision.ok:
                return decision
        return None
