from __future__ import annotations

import json
import secrets
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

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

    # Ordered provider ids from forsa/ai/catalog.yaml, e.g. ["deepseek", "groq", "anthropic"]. Keys come from each
    # provider's env var (see catalog) or FORSA_AI_KEY_<ID>. Admins can also enable/prioritise in Settings → AI.
    ai_providers: Annotated[list[str], NoDecode] = []
    ai_provider: str = "none"  # deprecated single-provider switch, still honoured
    ai_daily_budget_usd_per_org: float = 2.0
    vapid_public_key: str | None = None  # Web Push (optional; pip install forsa[push])
    vapid_private_key: str | None = None
    vapid_subject: str = "mailto:ops@forsa.example"

    features: Annotated[set[str], NoDecode] = set()  # e.g. FORSA_FEATURES=ai_explanations,ai_triage
    login_rate_limit_per_minute: int = 10
    # Android app (Trusted Web Activity): package + SHA-256 signing-certificate fingerprints (comma list), served at
    # /.well-known/assetlinks.json so Chrome opens FORSA full-screen inside the app.
    android_package: str = "mr.forsa.app"
    android_sha256: Annotated[list[str], NoDecode] = []
    # OCR for scanned PDFs (needs `tesseract` + `pdftoppm` on the PATH; the Docker image installs them).
    ocr_enabled: bool = True
    ocr_langs: str = "fra+ara"
    ocr_max_pages: int = 40

    @field_validator("ai_providers", "features", "android_sha256", mode="before")
    @classmethod
    def _split_list(cls, v: Any) -> Any:
        """Accept `a,b,c` (what people type in env files) as well as a JSON array."""
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("["):
                return json.loads(v)
            return [x.strip() for x in v.split(",") if x.strip()]
        return v

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
