from __future__ import annotations

import secrets
from datetime import date
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_ROOT = Path(__file__).resolve().parents[3]  # forsa/


class Settings(BaseSettings):
    """Runtime configuration. Secrets come from the environment only — never from code or memory files."""

    model_config = SettingsConfigDict(env_prefix="FORSA_", env_file=".env", extra="ignore")

    env: str = "dev"  # dev | test | prod
    database_url: str = "postgresql+psycopg://forsa:forsa@localhost:5432/forsa"
    jwt_secret: str = Field(default_factory=lambda: secrets.token_urlsafe(32))
    jwt_ttl_minutes: int = 12 * 60
    cookie_secure: bool = False
    cors_origins: list[str] = ["http://localhost:3000"]
    storage_dir: Path = _ROOT / "var" / "storage"
    source_registry: Path = _ROOT / "sources" / "registry.yaml"
    fixtures_dir: Path = _ROOT / "fixtures"
    default_country: str = "MR"
    demo_anchor: date = date(2026, 9, 21)  # synthetic fixture dates are relative to this fixed day
    http_user_agent: str = "FORSA-bot/0.1 (+https://forsa.example/bot; contact: ops@forsa.example)"

    ai_provider: str = "none"  # none | anthropic
    anthropic_api_key: str | None = None
    ai_reasoning_model: str = "claude-opus-5"
    ai_fast_model: str = "claude-haiku-4-5"
    ai_refusal_fallback_model: str | None = "claude-opus-4-8"
    ai_daily_budget_usd_per_org: float = 2.0

    features: set[str] = set()  # e.g. {"ai_explanations"}
    login_rate_limit_per_minute: int = 10

    def feature(self, name: str) -> bool:
        return name in self.features

    def validate_for_prod(self) -> None:
        if self.env == "prod":
            if "FORSA_JWT_SECRET" not in __import__("os").environ:
                raise RuntimeError("FORSA_JWT_SECRET must be set explicitly in prod")
            if not self.cookie_secure:
                raise RuntimeError("FORSA_COOKIE_SECURE must be true in prod")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    s = Settings()
    s.validate_for_prod()
    return s
