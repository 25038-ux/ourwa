"""Market intelligence: awards, competitors, buyers, procurement pipeline, red list (public records)."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from forsa.api.deps import tenant_context, tenant_db
from forsa.db.models import Debarment
from forsa.identity.rbac import TenantContext
from forsa.kernel.clock import utcnow
from forsa.services import debarments, market

router = APIRouter(prefix="/market", tags=["market"])


@router.get("/overview")
def overview(
    months: int = Query(default=24, ge=1, le=120),
    ctx: TenantContext = Depends(tenant_context),
    db: Session = Depends(tenant_db),
) -> dict:
    ctx.require("opportunity.read")
    return market.overview(db, utcnow(), months)


@router.get("/awards")
def awards(
    q: str | None = Query(default=None, max_length=200),
    months: int = Query(default=36, ge=1, le=120),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    ctx: TenantContext = Depends(tenant_context),
    db: Session = Depends(tenant_db),
) -> dict:
    ctx.require("opportunity.read")
    return market.awards_list(db, utcnow() - timedelta(days=30 * months), q, limit, offset)


@router.get("/competitors")
def competitors(
    q: str | None = Query(default=None, max_length=200),
    months: int = Query(default=36, ge=1, le=120),
    ctx: TenantContext = Depends(tenant_context),
    db: Session = Depends(tenant_db),
) -> dict:
    ctx.require("opportunity.read")
    return {"items": market.competitors(db, utcnow() - timedelta(days=30 * months), q, limit=100)}


@router.get("/buyer")
def buyer(
    name: str = Query(min_length=2, max_length=300),
    ctx: TenantContext = Depends(tenant_context),
    db: Session = Depends(tenant_db),
) -> dict:
    ctx.require("opportunity.read")
    return market.buyer_profile(db, name, utcnow() - timedelta(days=30 * 60))


@router.get("/red-list")
def red_list(ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)) -> dict:
    ctx.require("opportunity.read")
    rows = db.scalars(select(Debarment).order_by(Debarment.effective_date.desc().nulls_last())).all()
    return {
        "items": [debarments.serialize(d) for d in rows],
        "note": "Official exclusion list. A name match is a signal to verify (check the NRC), not a verdict.",
    }


@router.get("/red-list/check")
def red_list_check(
    name: str = Query(min_length=2, max_length=300),
    ctx: TenantContext = Depends(tenant_context),
    db: Session = Depends(tenant_db),
) -> dict:
    ctx.require("opportunity.read")
    return {"query": name, "matches": debarments.check(db, name)}
