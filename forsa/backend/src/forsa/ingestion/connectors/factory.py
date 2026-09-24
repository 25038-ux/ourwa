"""Build a connector from its registry record. Source-specific code stays in connectors/ (ADR-006)."""

from __future__ import annotations

from pathlib import Path

from forsa.ingestion.connectors.armp import ArmpApiConnector
from forsa.ingestion.connectors.fixture import FixtureConnector
from forsa.ingestion.connectors.html_table import HtmlTableConnector
from forsa.ingestion.connectors.ungm import UngmApiConnector
from forsa.ingestion.connectors.worldbank import WorldBankConnector
from forsa.ingestion.contracts import SourceConnector
from forsa.ingestion.http import HttpPolicy, PoliteHttpClient
from forsa.ingestion.registry import SourceRecord
from forsa.settings import get_settings


def http_client(rec: SourceRecord) -> PoliteHttpClient:
    """The only way connectors reach the network: registry allowlist, robots.txt, per-source rate limit."""
    rate = rec.raw.get("rate_limit", {}) or {}
    policy = HttpPolicy(
        allowed_hosts=frozenset(h.lower() for h in rec.allowed_hosts),
        min_interval_s=float(rate.get("min_interval_s", 3.0)),
    )
    return PoliteHttpClient(policy, get_settings().http_user_agent)


def build_connector(rec: SourceRecord) -> SourceConnector:
    settings = get_settings()
    if rec.connector == "fixture":
        directory = Path(rec.config["directory"])
        if not directory.is_absolute():
            directory = settings.fixtures_dir.parent / directory
        return FixtureConnector(rec.id, directory, settings.demo_anchor)
    client = http_client(rec)
    if rec.connector == "html_table":
        return HtmlTableConnector(rec.id, rec.config, client, rec.country)
    if rec.connector == "armp_api":
        return ArmpApiConnector(rec.id, rec.config, client)
    if rec.connector == "worldbank_api":
        return WorldBankConnector(rec.id, rec.config, client)
    if rec.connector == "ungm_api":
        return UngmApiConnector(rec.id, rec.config, client, settings.storage_dir / "secrets")
    raise ValueError(f"no connector implementation {rec.connector!r} for source {rec.id}")
