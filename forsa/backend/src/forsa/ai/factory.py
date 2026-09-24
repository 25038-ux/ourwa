"""Build the process-wide AI gateway from settings + catalog (+ admin settings read per call)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from forsa.ai.catalog import effective_configs
from forsa.ai.gateway import AIGateway
from forsa.ai.types import ProviderConfig
from forsa.settings import Settings


def configured_order(settings: Settings) -> list[str]:
    order = list(settings.ai_providers)
    if not order and settings.ai_provider not in ("", "none"):
        order = [settings.ai_provider]  # backwards compatibility with FORSA_AI_PROVIDER
    return order


def build_gateway(settings: Settings) -> AIGateway:
    order = configured_order(settings)

    def load(session: Session | None) -> list[ProviderConfig]:
        return effective_configs(session, order)

    return AIGateway(load, settings.ai_daily_budget_usd_per_org)
