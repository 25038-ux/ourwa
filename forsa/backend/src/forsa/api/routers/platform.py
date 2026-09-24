from __future__ import annotations

import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from forsa.api.deps import platform_admin, runtime, tenant_context, tenant_db
from forsa.api.schemas import FeedbackIn
from forsa.briefing.compose import compose_briefing
from forsa.country import available_packs, get_pack
from forsa.db.models import AIRequest, Feedback, IngestionRun, Job, Match, Notification, Source, User
from forsa.db.session import system_session
from forsa.identity.rbac import TenantContext
from forsa.jobs.queue import enqueue
from forsa.kernel.clock import utcnow
from forsa.kernel.errors import NotFound
from forsa.runtime import Runtime
from forsa.services.sources import sources_overview

router = APIRouter(tags=["platform"])


@router.get("/meta/taxonomy")
def taxonomy(
    q: str | None = Query(default=None, max_length=100),
    kind: str = "capability",
    lang: str = "fr",
    rt: Runtime = Depends(runtime),
) -> dict:
    onto = rt.ontology
    concepts = onto.search(q, limit=20) if q else list(onto.concepts.values())
    return {
        "version": onto.version,
        "items": [
            {"id": c.id, "label": c.label(lang), "labels": c.labels, "parent": c.parent, "kind": c.kind}
            for c in concepts
            if c.kind == kind
        ],
    }


@router.get("/meta/countries")
def countries() -> dict:
    return {"items": [get_pack(code) for code in available_packs()]}


@router.get("/sources")
def sources(ctx: TenantContext = Depends(tenant_context)) -> dict:
    ctx.require("source.read")
    with system_session() as s:
        return {"items": sources_overview(s)}


@router.get("/briefing/today")
def briefing_today(
    lang: str = "fr", ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    ctx.require("briefing.read")
    briefing = compose_briefing(db, ctx.org_id, utcnow(), lang)
    with system_session() as s:
        stale = [x for x in sources_overview(s) if x["status"] == "active" and x["health"] != "UP"]
    briefing["source_alerts"] = [
        {"key": x["key"], "name": x["name"], "health": x["health"], "detail": x["health_detail"]} for x in stale
    ]
    return briefing


@router.get("/notifications")
def notifications(
    unread_only: bool = False, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    ctx.require("notification.read")
    stmt = select(Notification).where(
        Notification.org_id == ctx.org_id, (Notification.user_id.is_(None)) | (Notification.user_id == ctx.user_id)
    )
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    rows = db.scalars(stmt.order_by(Notification.created_at.desc()).limit(100)).all()
    return {
        "items": [
            {
                "id": str(n.id),
                "category": n.category,
                "title": n.title,
                "body": n.body,
                "payload": n.payload,
                "priority": n.priority,
                "read": n.read_at is not None,
                "at": n.created_at,
            }
            for n in rows
        ]
    }


@router.post("/notifications/{notification_id}/read")
def mark_read(
    notification_id: uuid.UUID, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    n = db.get(Notification, notification_id)
    if n is None or n.org_id != ctx.org_id:
        raise NotFound("notification not found")
    n.read_at = utcnow()
    db.commit()
    return {"ok": True}


@router.post("/feedback")
def feedback(body: FeedbackIn, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)) -> dict:
    """Every recommendation can be challenged; labels become evaluation data (spec §116–117)."""
    ctx.require("feedback.write")
    context: dict = {}
    if body.subject_type == "match":
        m = db.get(Match, body.subject_id)
        if m is None or m.org_id != ctx.org_id:
            raise NotFound("match not found")
        context = {
            "fit_score": m.fit_score,
            "recommendation": m.recommendation,
            "scoring_version": m.scoring_version,
            "opportunity_version": m.opportunity_version,
        }
    db.add(
        Feedback(
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            subject_type=body.subject_type,
            subject_id=body.subject_id,
            label=body.label,
            comment=body.comment,
            context=context,
        )
    )
    db.commit()
    return {"ok": True}


@router.get("/admin/ingestion")
def admin_ingestion(_: User = Depends(platform_admin)) -> dict:
    with system_session() as s:
        runs = s.execute(
            select(IngestionRun, Source.key)
            .join(Source, Source.id == IngestionRun.source_id)
            .order_by(IngestionRun.started_at.desc())
            .limit(50)
        ).all()
        jobs = {st: n for st, n in s.execute(select(Job.status, func.count()).group_by(Job.status)).all()}
        dead = s.scalars(select(Job).where(Job.status == "DEAD").order_by(Job.finished_at.desc()).limit(20)).all()
        since = utcnow() - timedelta(days=1)
        ai = s.execute(
            select(AIRequest.status, func.count(), func.coalesce(func.sum(AIRequest.cost_usd), 0))
            .where(AIRequest.created_at >= since)
            .group_by(AIRequest.status)
        ).all()
        return {
            "sources": sources_overview(s),
            "runs": [
                {
                    "source": key,
                    "status": r.status,
                    "started_at": r.started_at,
                    "finished_at": r.finished_at,
                    "stats": r.stats,
                    "error": r.error,
                }
                for r, key in runs
            ],
            "queue": jobs,
            "dead_jobs": [
                {"id": str(j.id), "kind": j.kind, "attempts": j.attempts, "error": (j.last_error or "")[:500]}
                for j in dead
            ],
            "ai_last_24h": [{"status": st, "calls": n, "cost_usd": float(c)} for st, n, c in ai],
        }


@router.post("/admin/sources/{key}/run")
def admin_run_source(key: str, _: User = Depends(platform_admin), rt: Runtime = Depends(runtime)) -> dict:
    if key not in rt.registry:
        raise NotFound("unknown source")
    with system_session() as s:
        enqueue(s, "ingest_source", {"source_key": key}, key=f"ingest:{key}:manual:{utcnow():%Y%m%d%H%M}")
    return {"queued": True}
