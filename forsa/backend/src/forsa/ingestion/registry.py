"""Source registry (spec §106): no connector runs without a registry record."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from forsa.db.models import Source

REQUIRED = ("id", "name", "category", "access_type", "status", "connector")


@dataclass(frozen=True)
class SourceRecord:
    id: str
    name: str
    country: str | None
    category: str
    official_url: str | None
    access_type: str
    status: str  # active | pending_verification | disabled
    connector: str
    update_frequency_hours: int = 24
    allowed_hosts: tuple[str, ...] = ()
    config: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def runnable(self) -> bool:
        return self.status == "active"

    @property
    def missing_env(self) -> list[str]:
        """Credentials the source needs (``requires_env`` in the registry) that are not set in the environment."""
        return missing_env(self.raw)


def missing_env(entry: dict[str, Any] | None) -> list[str]:
    import os

    return [name for name in (entry or {}).get("requires_env", []) or [] if not os.environ.get(name)]


def load_registry(path: Path) -> dict[str, SourceRecord]:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    out: dict[str, SourceRecord] = {}
    for item in data.get("sources", []):
        missing = [k for k in REQUIRED if not item.get(k)]
        if missing:
            raise ValueError(f"source {item.get('id')!r} missing registry fields {missing}")
        rec = SourceRecord(
            id=item["id"],
            name=item["name"],
            country=item.get("country"),
            category=item["category"],
            official_url=item.get("official_url"),
            access_type=item["access_type"],
            status=item["status"],
            connector=item["connector"],
            update_frequency_hours=int(item.get("update_frequency_hours", 24)),
            allowed_hosts=tuple(item.get("allowed_hosts", []) or ()),
            config=item.get("config", {}) or {},
            raw=item,
        )
        if rec.id in out:
            raise ValueError(f"duplicate source id {rec.id}")
        out[rec.id] = rec
    return out


def sync_registry(session: Session, records: dict[str, SourceRecord]) -> list[Source]:
    """Upsert registry records into the ``sources`` table (registry file is the source of truth)."""
    rows = []
    for rec in records.values():
        row = session.scalar(select(Source).where(Source.key == rec.id))
        if row is None:
            row = Source(key=rec.id)
            session.add(row)
        row.name, row.country, row.category = rec.name, rec.country, rec.category
        row.official_url, row.access_type, row.status = rec.official_url, rec.access_type, rec.status
        row.connector, row.expected_frequency_hours, row.registry_entry = (
            rec.connector,
            rec.update_frequency_hours,
            rec.raw,
        )
        rows.append(row)
    session.flush()
    return rows
