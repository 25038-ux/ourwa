"""Job handlers. Long-running and AI work lives here, never in web requests (spec §64)."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from forsa.briefing.compose import compose_briefing, store_briefing
from forsa.db.models import Bid, Document, DocumentVersion, Match, Opportunity, Organization, Source
from forsa.documents.extract import sniff_kind
from forsa.ingestion.connectors.factory import build_connector, http_client
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


def _ocr_fn(settings: Any) -> Any:
    from forsa.documents import ocr

    if not settings.ocr_enabled or not ocr.available():
        return None
    cfg = ocr.OcrConfig(langs=settings.ocr_langs, max_pages=settings.ocr_max_pages)
    return lambda content: ocr.ocr_pdf(content, cfg)


def analyze(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    rt = get_runtime()
    return analyze_opportunity(
        session,
        rt.store,
        rt.ontology,
        uuid.UUID(payload["opportunity_id"]),
        rt.gateway,
        frozenset(rt.settings.features),
        ocr=_ocr_fn(rt.settings),
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
        if not rec.runnable or rec.missing_env:  # credential-gated sources wait for their keys (AUTH_REQUIRED)
            continue
        period = max(1, rec.update_frequency_hours) * 3600
        bucket = int(now.timestamp() // period)
        enqueue(session, "ingest_source", {"source_key": rec.id}, key=f"ingest:{rec.id}:{bucket}")
        queued += 1
        if rec.config.get("red_list_path"):
            enqueue(session, "sync_red_list", {"source_key": rec.id}, key=f"redlist:{rec.id}:{now.date().isoformat()}")
            queued += 1
    enqueue(session, "deadline_reminders", {}, key=f"reminders:{now:%Y%m%d%H}")
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


def sync_red_list(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    """Refresh a source's list of companies excluded from public procurement (e.g. ARMP « liste rouge »)."""
    from forsa.ingestion.connectors.armp import parse_red_list
    from forsa.services import debarments

    rec = get_runtime().registry[payload["source_key"]]
    if not rec.runnable:
        return {"skipped": "source not active"}
    base = str(rec.config.get("base_url", "")).rstrip("/")
    client = http_client(rec)
    try:
        res = client.get(f"{base}{rec.config['red_list_path']}")
    finally:
        client.close()
    if res.status != 200:
        raise RuntimeError(f"red list returned HTTP {res.status}")
    return debarments.upsert(session, rec.id, parse_red_list(res.content, base), rec.country)


REMINDER_DAYS = (7, 3, 1)
ACTIVE_BIDS = ("QUALIFYING", "PURSUING", "IN_REVIEW", "APPROVED")


def deadline_reminders(session: Session, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """J-7 / J-3 / J-1 reminders for opportunities an organisation pursues or bids on (idempotent per threshold)."""
    from forsa.services.notifications import notify

    now = utcnow()
    horizon = now + timedelta(days=max(REMINDER_DAYS))
    rows = session.execute(
        select(Match.org_id, Opportunity.id)
        .join(Opportunity, Opportunity.id == Match.opportunity_id)
        .where(Match.status == "PURSUED", Opportunity.deadline_at > now, Opportunity.deadline_at <= horizon)
        .union_all(
            select(Bid.org_id, Opportunity.id)
            .join(Opportunity, Opportunity.id == Bid.opportunity_id)
            .where(Bid.status.in_(ACTIVE_BIDS), Opportunity.deadline_at > now, Opportunity.deadline_at <= horizon)
        )
    ).all()
    sent = 0
    for org_id, opp_id in {(r[0], r[1]) for r in rows}:
        opp = session.get(Opportunity, opp_id)
        if opp is None or opp.deadline_at is None:
            continue
        days_left = (opp.deadline_at - now).total_seconds() / 86400
        threshold = min((d for d in REMINDER_DAYS if days_left <= d), default=None)
        if threshold is None:
            continue
        label = "demain" if threshold == 1 else f"dans {threshold} jours"
        created = notify(
            session,
            org_id,
            "deadline",
            f"Échéance {label} : {opp.title[:180]}",
            key=f"reminder:{org_id}:{opp.id}:{threshold}d",
            body=f"Date limite : {opp.deadline_at:%d/%m/%Y %H:%M} UTC",
            payload={"opportunity_id": str(opp.id), "days": threshold},
        )
        sent += 1 if created else 0
    return {"reminders": sent}


HANDLERS: dict[str, Handler] = {
    "sync_red_list": sync_red_list,
    "deadline_reminders": deadline_reminders,
    "deliver_notification": deliver_notification,
    "ingest_source": ingest_source,
    "fetch_document": fetch_document,
    "analyze_opportunity": analyze,
    "match_opportunity": match_opportunity,
    "match_company": match_company,
    "daily_briefing": daily_briefing,
    "schedule_tick": schedule_tick,
}
