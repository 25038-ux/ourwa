"""Source health (spec §56, §107). Stale intelligence is never shown silently."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from forsa.db.models import IngestionRun, Source
from forsa.ingestion.contracts import SourceHealth
from forsa.kernel.clock import utcnow

STALE_ALERT_HOURS = 12


def source_health(source: Source, runs: list[IngestionRun], now: datetime) -> tuple[SourceHealth, str]:
    if source.status == "pending_verification":
        return SourceHealth.UNVERIFIED, "registry entry not verified — connector disabled"
    if source.status != "active":
        return SourceHealth.BLOCKED, f"source status {source.status}"
    if not runs:
        return SourceHealth.STALE, "no ingestion run yet"
    last = runs[0]
    if last.status == "blocked":
        return SourceHealth.BLOCKED, last.error or "blocked"
    ok = next((r for r in runs if r.status in ("succeeded", "partial") and r.finished_at), None)
    if ok is None:
        return SourceHealth.DOWN, last.error or "no successful run"
    age = now - ok.finished_at  # type: ignore[operator]
    limit = timedelta(hours=max(STALE_ALERT_HOURS, 2 * source.expected_frequency_hours))
    if age > limit:
        return SourceHealth.STALE, f"last successful run {age.total_seconds() / 3600:.1f}h ago"
    if last.status == "failed":
        return SourceHealth.DOWN, last.error or "last run failed"
    stats = last.stats or {}
    fetched = max(1, int(stats.get("fetched", 0)) + int(stats.get("failed", 0)))
    if last.status == "partial" or int(stats.get("failed", 0)) / fetched > 0.1:
        return SourceHealth.DEGRADED, f"{stats.get('failed', 0)} record(s) failed in last run"
    return SourceHealth.UP, "ok"


def sources_overview(session: Session) -> list[dict[str, Any]]:
    now = utcnow()
    out = []
    for src in session.scalars(select(Source).order_by(Source.key)).all():
        runs = session.scalars(
            select(IngestionRun)
            .where(IngestionRun.source_id == src.id)
            .order_by(IngestionRun.started_at.desc())
            .limit(10)
        ).all()
        health, detail = source_health(src, list(runs), now)
        last = runs[0] if runs else None
        out.append(
            {
                "key": src.key,
                "name": src.name,
                "country": src.country,
                "category": src.category,
                "access_type": src.access_type,
                "status": src.status,
                "official_url": src.official_url,
                "health": health.value,
                "health_detail": detail,
                "last_run": last
                and {
                    "status": last.status,
                    "started_at": last.started_at,
                    "finished_at": last.finished_at,
                    "stats": last.stats,
                },
                "notes": (src.registry_entry or {}).get("notes"),
            }
        )
    return out
