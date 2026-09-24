"""Job handlers. Long-running and AI work lives here, never in web requests (spec §64)."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from forsa.briefing.compose import compose_briefing, store_briefing
from forsa.db.models import Document, DocumentVersion, Opportunity, Organization, Source
from forsa.documents.extract import sniff_kind
from forsa.ingestion.connectors.factory import build_connector
from forsa.ingestion.http import HttpPolicy, PoliteHttpClient
from forsa.ingestion.pipeline import IngestionPipeline
from forsa.ingestion.registry import sync_registry
from forsa.jobs.queue import enqueue
from forsa.kernel.clock import utcnow
from forsa.runtime import get_runtime
from forsa.services.intelligence import analyze_opportunity
from forsa.services.matching import rematch_company, rematch_opportunity

Handler = Callable[[Session, dict[str, Any]], dict[str, Any] | None]


def ingest_source(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    rt = get_runtime()
    rec = rt.registry[payload["source_key"]]
    sync_registry(session, {rec.id: rec})
    source = session.scalar(select(Source).where(Source.key == rec.id))
    assert source is not None
    connector = build_connector(rec) if rec.runnable else None
    run = IngestionPipeline(session, rt.store).run(
        source,
        connector,  # type: ignore[arg-type]
        synthetic=rec.access_type == "synthetic_fixture",
    )
    return {"run_id": str(run.id), "status": run.status, "stats": run.stats}


def fetch_document(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    rt = get_runtime()
    doc = session.get(Document, uuid.UUID(payload["document_id"]))
    if doc is None or not doc.source_url or doc.opportunity_id is None:
        return {"skipped": "no url"}
    opp = session.get(Opportunity, doc.opportunity_id)
    source = session.get(Source, opp.source_id) if opp else None
    rec = rt.registry.get(source.key) if source else None
    if rec is None or not rec.runnable or not rec.allowed_hosts:
        return {"skipped": "source does not permit document retrieval"}
    client = PoliteHttpClient(HttpPolicy(allowed_hosts=frozenset(rec.allowed_hosts)), rt.settings.http_user_agent)
    try:
        res = client.get(doc.source_url)
    finally:
        client.close()
    if res.status != 200:
        raise RuntimeError(f"document fetch returned HTTP {res.status}")
    key, digest = rt.store.put(res.content, "documents/public")
    if not session.scalar(
        select(DocumentVersion).where(DocumentVersion.document_id == doc.id, DocumentVersion.content_hash == digest)
    ):
        session.add(
            DocumentVersion(
                document_id=doc.id,
                version=1,
                content_hash=digest,
                storage_key=key,
                content_type=sniff_kind(res.content),
                byte_size=len(res.content),
            )
        )
    enqueue(
        session,
        "analyze_opportunity",
        {"opportunity_id": str(doc.opportunity_id)},
        key=f"analyze:{doc.opportunity_id}:doc:{digest[:16]}",
    )
    return {"stored": key}


def analyze(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    rt = get_runtime()
    return analyze_opportunity(
        session,
        rt.store,
        rt.ontology,
        uuid.UUID(payload["opportunity_id"]),
        rt.gateway,
        frozenset(rt.settings.features),
    )


def match_opportunity(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    rt = get_runtime()
    opp_id = uuid.UUID(payload["opportunity_id"])
    out: dict[str, Any] = {"matches": rematch_opportunity(session, rt.engine, opp_id)}
    if "ai_triage" in rt.settings.features:
        from forsa.db.models import Match
        from forsa.services.ai_features import jev_triage

        opp = session.get(Opportunity, opp_id)
        triaged = 0
        for m in session.scalars(select(Match).where(Match.opportunity_id == opp_id)).all():
            if opp is not None and "ai_triage" not in (m.result or {}) and jev_triage(session, rt.gateway, m, opp):
                triaged += 1
        out["ai_triaged"] = triaged
    return out


def match_company(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    return {"matches": rematch_company(session, get_runtime().engine, uuid.UUID(payload["company_id"]))}


def daily_briefing(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    org_id = uuid.UUID(payload["org_id"])
    now = utcnow()
    briefing = compose_briefing(session, org_id, now)
    store_briefing(session, org_id, briefing, now.date())
    return {"counts": briefing["counts"]}


def schedule_tick(session: Session, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """Idempotent scheduler: safe to call every minute from any number of workers."""
    rt = get_runtime()
    now = utcnow()
    queued = 0
    for rec in rt.registry.values():
        if not rec.runnable:
            continue
        period = max(1, rec.update_frequency_hours) * 3600
        bucket = int(now.timestamp() // period)
        enqueue(session, "ingest_source", {"source_key": rec.id}, key=f"ingest:{rec.id}:{bucket}")
        queued += 1
    briefing_at = datetime.combine(now.date(), datetime.min.time(), UTC) + timedelta(hours=6)
    if now >= briefing_at:
        for org_id in session.scalars(select(Organization.id)).all():
            enqueue(
                session,
                "daily_briefing",
                {"org_id": str(org_id)},
                org_id=org_id,
                key=f"briefing:{org_id}:{now.date().isoformat()}",
            )
            queued += 1
    return {"queued": queued}


def deliver_notification(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    from forsa.services.notifications import deliver

    s = get_runtime().settings
    return deliver(
        session, uuid.UUID(payload["notification_id"]), private_key=s.vapid_private_key, subject=s.vapid_subject
    )


HANDLERS: dict[str, Handler] = {
    "deliver_notification": deliver_notification,
    "ingest_source": ingest_source,
    "fetch_document": fetch_document,
    "analyze_opportunity": analyze,
    "match_opportunity": match_opportunity,
    "match_company": match_company,
    "daily_briefing": daily_briefing,
    "schedule_tick": schedule_tick,
}
