"""Provider-neutral AI types. Messages use the OpenAI chat shape internally; adapters translate."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Protocol


class Tier(StrEnum):
    FAST = "fast"
    REASONING = "reasoning"
    DECISION = "decision"  # typed decision models (Jev)


class Sensitivity(StrEnum):
    """Data classification of what a prompt contains (spec §23 'data sensitivity')."""

    PUBLIC = "public"  # public tender text, registry data
    INTERNAL = "internal"  # company profile summaries, match results, tasks
    CONFIDENTIAL = "confidential"  # raw company documents, financials, CVs

    @property
    def rank(self) -> int:
        return {"public": 0, "internal": 1, "confidential": 2}[self.value]


class AITask(StrEnum):
    EXPLAIN_MATCH = "explain_match"
    CLASSIFY = "classify"
    EXTRACT_REQUIREMENTS = "extract_requirements"
    ASSISTANT = "assistant"
    DRAFT_SECTION = "draft_section"
    ONBOARDING = "onboarding"


ROUTES: dict[AITask, Tier] = {
    AITask.EXPLAIN_MATCH: Tier.FAST,
    AITask.CLASSIFY: Tier.FAST,
    AITask.EXTRACT_REQUIREMENTS: Tier.REASONING,
    AITask.ASSISTANT: Tier.FAST,
    AITask.DRAFT_SECTION: Tier.REASONING,
    AITask.ONBOARDING: Tier.FAST,
}


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]  # JSON schema


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class AICall:
    task: AITask
    system: str
    prompt_version: str
    user: str = ""
    messages: list[dict[str, Any]] | None = None  # multi-turn (OpenAI shape); `user` ignored when set
    tools: list[ToolSpec] = field(default_factory=list)
    schema_version: str | None = None
    max_tokens: int = 1024
    org_id: uuid.UUID | None = None
    sensitivity: Sensitivity = Sensitivity.INTERNAL
    json_output: bool = False

    def conversation(self) -> list[dict[str, Any]]:
        return self.messages if self.messages is not None else [{"role": "user", "content": self.user}]


@dataclass
class AIResult:
    ok: bool
    text: str = ""
    provider: str = "none"
    model: str = "none"
    tool_calls: list[ToolCall] = field(default_factory=list)
    stop_reason: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    latency_ms: int | None = None
    cost_usd: float | None = None
    error: str | None = None
    request_id: uuid.UUID | None = None
    cached: bool = False
    raw: dict[str, Any] = field(default_factory=dict)  # provider-native assistant content, for replay

    def assistant_message(self) -> dict[str, Any]:
        """The assistant turn to append to the conversation (OpenAI shape + provider-native payload)."""
        msg: dict[str, Any] = {"role": "assistant", "content": self.text or None}
        if self.tool_calls:
            msg["tool_calls"] = [
                {"id": c.id, "type": "function", "function": {"name": c.name, "arguments": c.arguments}}
                for c in self.tool_calls
            ]
        if self.raw.get("native"):
            msg["_native"] = {self.provider: self.raw["native"]}
        return msg


@dataclass(frozen=True)
class ProviderConfig:
    """Effective configuration of one provider (catalog ⊕ environment ⊕ admin settings)."""

    id: str
    name: str
    kind: str
    region: str
    base_url: str | None
    api_key: str | None
    models: dict[str, str]
    max_sensitivity: Sensitivity
    enabled: bool
    priority: int
    max_tokens_param: str = "max_tokens"
    extra: dict[str, Any] = field(default_factory=dict)

    def model_for(self, tier: Tier) -> str | None:
        return self.models.get(tier.value) or (self.models.get("fast") if tier == Tier.REASONING else None)

    def allows(self, sensitivity: Sensitivity) -> bool:
        return sensitivity.rank <= self.max_sensitivity.rank


class LLMProvider(Protocol):
    def complete(self, cfg: ProviderConfig, call: AICall, model: str) -> AIResult: ...
