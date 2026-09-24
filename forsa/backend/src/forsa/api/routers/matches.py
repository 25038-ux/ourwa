from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from forsa.api.deps import tenant_context, tenant_db
from forsa.api.presenter import render_match
from forsa.api.schemas import MatchPatch
from forsa.db.models import Match, MatchHistory, Opportunity
from forsa.identity.rbac import TenantContext
from forsa.jobs.queue import enqueue
from forsa.kernel.clock import utcnow
from forsa.kernel.errors import NotFound
from forsa.services.companies import get_twin

router = APIRouter(prefix="/matches", tags=["matches"])


@router.get("")
def list_matches(
    recommendation: str | None = None,
    min_fit: int | None = Query(default=None, ge=0, le=100),
    limit: int = Query(default=50, ge=1, le=200),
    ctx: TenantContext = Depends(tenant_context),
    db: Session = Depends(tenant_db),
) -> dict:
    ctx.require("match.read")
    stmt = (
        select(Match, Opportunity)
        .join(Opportunity, Opportunity.id == Match.opportunity_id)
        .where(Match.org_id == ctx.org_id)
    )
    if recommendation:
        stmt = stmt.where(Match.recommendation == recommendation)
    if min_fit is not None:
        stmt = stmt.where(Match.fit_score >= min_fit)
    rows = db.execute(stmt.order_by(Match.fit_score.desc()).limit(limit)).all()
    return {
        "items": [
            {
                "id": str(m.id),
                "opportunity_id": str(o.id),
                "title": o.title,
                "fit_score": m.fit_score,
                "recommendation": m.recommendation,
                "data_completeness": m.data_completeness,
                "status": m.status,
                "scoring_version": m.scoring_version,
                "deadline_at": o.deadline_at,
                "is_synthetic": o.is_synthetic,
            }
            for m, o in rows
        ]
    }


@router.get("/{match_id}")
def get_match(
    match_id: uuid.UUID,
    lang: str = "fr",
    ctx: TenantContext = Depends(tenant_context),
    db: Session = Depends(tenant_db),
) -> dict:
    ctx.require("match.read")
    m = db.get(Match, match_id)
    if m is None or m.org_id != ctx.org_id:
        raise NotFound("match not found")
    history = db.scalars(
        select(MatchHistory).where(MatchHistory.match_id == m.id).order_by(MatchHistory.computed_at.desc())
    ).all()
    return {
        "id": str(m.id),
        "opportunity_id": str(m.opportunity_id),
        "status": m.status,
        **render_match(m.result, lang),
        "history": [
            {
                "fit_score": h.fit_score,
                "recommendation": h.recommendation,
                "scoring_version": h.scoring_version,
                "opportunity_version": h.opportunity_version,
                "computed_at": h.computed_at,
            }
            for h in history
        ],
    }


@router.patch("/{match_id}")
def patch_match(
    match_id: uuid.UUID,
    body: MatchPatch,
    ctx: TenantContext = Depends(tenant_context),
    db: Session = Depends(tenant_db),
) -> dict:
    ctx.require("match.update")
    m = db.get(Match, match_id)
    if m is None or m.org_id != ctx.org_id:
        raise NotFound("match not found")
    m.status = body.status
    db.commit()
    return {"ok": True}


@router.post("/recompute")
def recompute(ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)) -> dict:
    """Queues re-matching; never runs expensive work inside the web request (spec §64)."""
    ctx.require("match.recompute")
    company = get_twin(db, ctx)
    enqueue(
        db,
        "match_company",
        {"company_id": str(company.id)},
        org_id=ctx.org_id,
        key=f"match_company:{company.id}:{utcnow():%Y%m%d%H%M}",
    )
    db.commit()
    return {"queued": True}
