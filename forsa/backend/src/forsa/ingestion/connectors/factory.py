"""Build a connector from its registry record. Source-specific code stays in connectors/ (ADR-006)."""

from __future__ import annotations

from pathlib import Path

from forsa.ingestion.connectors.fixture import FixtureConnector
from forsa.ingestion.connectors.html_table import HtmlTableConnector
from forsa.ingestion.contracts import SourceConnector
from forsa.ingestion.http import HttpPolicy, PoliteHttpClient
from forsa.ingestion.registry import SourceRecord
from forsa.settings import get_settings


def build_connector(rec: SourceRecord) -> SourceConnector:
    settings = get_settings()
    if rec.connector == "fixture":
        directory = Path(rec.config["directory"])
        if not directory.is_absolute():
            directory = settings.fixtures_dir.parent / directory
        return FixtureConnector(rec.id, directory, settings.demo_anchor)
    if rec.connector == "html_table":
        rate = rec.raw.get("rate_limit", {}) or {}
        policy = HttpPolicy(
            allowed_hosts=frozenset(h.lower() for h in rec.allowed_hosts),
            min_interval_s=float(rate.get("min_interval_s", 3.0)),
        )
        return HtmlTableConnector(rec.id, rec.config, PoliteHttpClient(policy, settings.http_user_agent), rec.country)
    raise ValueError(f"no connector implementation {rec.connector!r} for source {rec.id}")
