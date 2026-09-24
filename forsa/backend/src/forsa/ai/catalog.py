"""Provider catalog + effective configuration resolution (ADR-011).

Effective config = catalog defaults ⊕ environment (keys, base URLs, FORSA_AI_PROVIDERS order)
⊕ admin settings in `ai_provider_settings` (enable, priority, pinned models, data ceiling).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from forsa.ai.types import ProviderConfig, Sensitivity
from forsa.db.models import AIProviderSetting

_CATALOG = Path(__file__).parent / "catalog.yaml"


@dataclass(frozen=True)
class CatalogEntry:
    id: str
    name: str
    kind: str
    region: str
    base_url: str | None
    base_url_env: str | None
    api_key_env: str | None
    models: dict[str, str]
    max_sensitivity: Sensitivity
    free_tier: bool
    docs_url: str | None
    verified: bool
    max_tokens_param: str = "max_tokens"
    extra: dict[str, Any] = field(default_factory=dict)

    def api_key(self) -> str | None:
        for name in (f"FORSA_AI_KEY_{self.id.upper()}", f"FORSA_{self.id.upper()}_API_KEY"):
            if os.environ.get(name):
                return os.environ[name]
        return os.environ.get(self.api_key_env) if self.api_key_env else None

    def resolved_base_url(self) -> str | None:
        if self.base_url_env and os.environ.get(self.base_url_env):
            return os.environ[self.base_url_env]
        return self.base_url

    @property
    def needs_key(self) -> bool:
        return self.api_key_env is not None


@lru_cache(maxsize=1)
def catalog() -> dict[str, CatalogEntry]:
    raw = yaml.safe_load(_CATALOG.read_text(encoding="utf-8"))
    out: dict[str, CatalogEntry] = {}
    for p in raw["providers"]:
        known = {
            "id",
            "name",
            "kind",
            "region",
            "base_url",
            "base_url_env",
            "api_key_env",
            "models",
            "max_sensitivity",
            "free_tier",
            "docs_url",
            "verified",
            "max_tokens_param",
        }
        out[p["id"]] = CatalogEntry(
            id=p["id"],
            name=p["name"],
            kind=p["kind"],
            region=p.get("region", "?"),
            base_url=p.get("base_url"),
            base_url_env=p.get("base_url_env"),
            api_key_env=p.get("api_key_env"),
            models=dict(p.get("models") or {}),
            max_sensitivity=Sensitivity(p.get("max_sensitivity", "internal")),
            free_tier=bool(p.get("free_tier")),
            docs_url=p.get("docs_url"),
            verified=bool(p.get("verified")),
            max_tokens_param=p.get("max_tokens_param", "max_tokens"),
            extra={k: v for k, v in p.items() if k not in known},
        )
    return out


def env_order(configured: list[str]) -> dict[str, int]:
    return {pid: i for i, pid in enumerate(configured)}


def effective_configs(session: Session | None, configured: list[str]) -> list[ProviderConfig]:
    """All providers with their effective settings, sorted by priority (enabled first)."""
    settings: dict[str, AIProviderSetting] = {}
    if session is not None:
        settings = {s.provider_id: s for s in session.scalars(select(AIProviderSetting)).all()}
    order = env_order(configured)
    out = []
    for entry in catalog().values():
        s = settings.get(entry.id)
        models = dict(entry.models)
        if s is not None:
            for tier in ("fast", "reasoning", "decision"):
                pinned = getattr(s, f"{tier}_model")
                if pinned:
                    models[tier] = pinned
        key = entry.api_key()
        has_credentials = key is not None or not entry.needs_key
        wanted = (s.enabled if s is not None else False) or entry.id in order
        out.append(
            ProviderConfig(
                id=entry.id,
                name=entry.name,
                kind=entry.kind,
                region=entry.region,
                base_url=entry.resolved_base_url(),
                api_key=key,
                models=models,
                max_sensitivity=Sensitivity(s.max_sensitivity)
                if s is not None and s.max_sensitivity
                else entry.max_sensitivity,
                enabled=bool(wanted and has_credentials),
                priority=s.priority if s is not None and s.priority is not None else order.get(entry.id, 100),
                max_tokens_param=entry.max_tokens_param,
                extra=entry.extra,
            )
        )
    return sorted(out, key=lambda c: (not c.enabled, c.priority, c.id))
