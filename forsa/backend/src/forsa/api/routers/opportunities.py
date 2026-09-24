from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from forsa.api.deps import runtime, tenant_context, tenant_db
from forsa.api.presenter import concept_label, render_match
from forsa.db.models import (
    Assertion,
    Buyer,
    Company,
    Document,
    DocumentVersion,
    Evidence,
    Match,
    Opportunity,
    OpportunityEvent,
    Requirement,
    Source,
)
from forsa.identity.rbac import TenantContext
from forsa.kernel.clock import utcnow
from forsa.kernel.errors import NotFound
from forsa.runtime import Runtime
from forsa.services.profiles import company_profile, opportunity_profile

router = APIRouter(prefix="/opportunities", tags=["opportunities"])
Lang = Literal["fr", "en", "ar"]


def _summary(o: Opportunity, m: Match | None, buyer: str | None, source: str | None, lang: str) -> dict:
    now = utcnow()
    return {
        "id": str(o.id),
        "external_ref": o.external_ref,
        "kind": o.kind,
        "title": o.title,
        "buyer": buyer,
        "source": source,
        "region": o.region,
        "category": o.category,
        "status": o.status,
        "currency": o.currency,
        "estimated_value": float(o.estimated_value) if o.estimated_value is not None else None,
        "published_at": o.published_at,
        "deadline_at": o.deadline_at,
        "days_left": round((o.deadline_at - now).total_seconds() / 86400, 1) if o.deadline_at else None,
        "language": o.language,
        "is_synthetic": o.is_synthetic,
        "concepts": [
            {"concept_id": c["concept_id"], "label": concept_label(c["concept_id"], lang)}
            for c in (o.concepts or [])
            if c.get("weight", 0) > 0
        ][:4],
        "match": m
        and {
            "id": str(m.id),
            "fit_score": m.fit_score,
            "recommendation": m.recommendation,
            "data_completeness": m.data_completeness,
            "status": m.status,
        },
    }


def _get(db: Session, opportunity_id: uuid.UUID) -> Opportunity:
    opp = db.get(Opportunity, opportunity_id)
    if opp is None:
        raise NotFound("opportunity not found")
    return opp


@router.get("")
def list_opportunities(
    q: str | None = Query(default=None, max_length=200),
    status: str | None = None,
    category: str | None = None,
    region: str | None = None,
    kind: str | None = None,
    recommendation: str | None = None,
    min_fit: int | None = Query(default=None, ge=0, le=100),
    include_closed: bool = False,
    matched_only: bool = False,
    sort: Literal["fit", "deadline", "recent"] = "fit",
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    lang: Lang = "fr",
    ctx: TenantContext = Depends(tenant_context),
    db: Session = Depends(tenant_db),
) -> dict:
    ctx.require("opportunity.read")
    stmt = (
        select(Opportunity, Match, Buyer.name, Source.name)
        .outerjoin(Match, and_(Match.opportunity_id == Opportunity.id, Match.org_id == ctx.org_id))
        .outerjoin(Buyer, Buyer.id == Opportunity.buyer_id)
        .join(Source, Source.id == Opportunity.source_id)
    )
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                Opportunity.title.ilike(like),
                Opportunity.description.ilike(like),
                Opportunity.external_ref.ilike(like),
                Buyer.name.ilike(like),
            )
        )
    if not include_closed:
        stmt = stmt.where(
            Opportunity.status.in_(["PUBLISHED", "CLARIFICATION", "EXTENDED", "PLANNED"]),
            or_(Opportunity.deadline_at.is_(None), Opportunity.deadline_at > utcnow()),
        )
    for col, val in (
        (Opportunity.status, status),
        (Opportunity.category, category),
        (Opportunity.region, region),
        (Opportunity.kind, kind),
        (Match.recommendation, recommendation),
    ):
        if val:
            stmt = stmt.where(col == val)
    if min_fit is not None:
        stmt = stmt.where(Match.fit_score >= min_fit)
    if matched_only:
        stmt = stmt.where(Match.id.is_not(None), Match.status != "DISMISSED")
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    order = {
        "fit": (Match.fit_score.desc().nulls_last(), Opportunity.deadline_at.asc().nulls_last()),
        "deadline": (Opportunity.deadline_at.asc().nulls_last(),),
        "recent": (Opportunity.published_at.desc().nulls_last(),),
    }[sort]
    rows = db.execute(stmt.order_by(*order).limit(limit).offset(offset)).all()
    return {"total": total, "items": [_summary(o, m, b, s, lang) for o, m, b, s in rows]}


@router.get("/{opportunity_id}")
def get_opportunity(
    opportunity_id: uuid.UUID,
    lang: Lang = "fr",
    ctx: TenantContext = Depends(tenant_context),
    db: Session = Depends(tenant_db),
) -> dict:
    ctx.require("opportunity.read")
    o = _get(db, opportunity_id)
    m = db.scalar(select(Match).where(Match.opportunity_id == o.id, Match.org_id == ctx.org_id))
    buyer = db.get(Buyer, o.buyer_id) if o.buyer_id else None
    source = db.get(Source, o.source_id)
    docs = db.execute(
        select(Document, DocumentVersion)
        .outerjoin(DocumentVersion, DocumentVersion.document_id == Document.id)
        .where(Document.opportunity_id == o.id)
    ).all()
    events = db.scalars(
        select(OpportunityEvent)
        .where(OpportunityEvent.opportunity_id == o.id)
        .order_by(OpportunityEvent.occurred_at.desc())
    ).all()
    out = _summary(o, m, buyer.name if buyer else None, source.name if source else None, lang)
    out.update(
        {
            "description": o.description,
            "method": o.method,
            "funding_source": o.funding_source,
            "url": o.url,
            "country": o.country,
            "consortium_allowed": o.consortium_allowed,
            "version": o.current_version,
            "buyer_id": str(o.buyer_id) if o.buyer_id else None,
            "source_detail": source and {"key": source.key, "name": source.name, "access_type": source.access_type},
            "documents": [
                {
                    "id": str(d.id),
                    "title": d.title,
                    "source_url": d.source_url,
                    "extraction_status": v.extraction_status if v else "PENDING_FETCH",
                    "needs_ocr": bool(v and v.needs_ocr),
                    "risk_flags": v.risk_flags if v else [],
                    "pages": v.page_count if v else None,
                }
                for d, v in docs
            ],
            "events": [
                {"type": e.event_type, "version": e.version, "changes": e.changes, "at": e.occurred_at} for e in events
            ],
            "concepts": [{**c, "label": concept_label(c["concept_id"], lang)} for c in (o.concepts or [])],
        }
    )
    return out


@router.get("/{opportunity_id}/intelligence")
def intelligence(
    opportunity_id: uuid.UUID,
    lang: Lang = "fr",
    ctx: TenantContext = Depends(tenant_context),
    db: Session = Depends(tenant_db),
    rt: Runtime = Depends(runtime),
) -> dict:
    """The structured "why should I care?" page: fit breakdown, gates, unknowns, risks, why-now, economics."""
    ctx.require("match.read")
    o = _get(db, opportunity_id)
    m = db.scalar(select(Match).where(Match.opportunity_id == o.id, Match.org_id == ctx.org_id))
    if m is not None:
        return {"persisted": True, "match_id": str(m.id), **render_match(m.result, lang)}
    company = db.scalar(select(Company).where(Company.org_id == ctx.org_id))
    if company is None:
        return {"persisted": False, "available": False, "reason": "company_profile_missing"}
    result = rt.engine.evaluate(opportunity_profile(db, o), company_profile(db, company), utcnow())
    return {"persisted": False, "available": True, **render_match(result.as_dict(), lang)}


@router.get("/{opportunity_id}/requirements")
def requirements(
    opportunity_id: uuid.UUID, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    ctx.require("opportunity.read")
    _get(db, opportunity_id)
    rows = db.execute(
        select(Requirement, Evidence)
        .outerjoin(Evidence, Evidence.id == Requirement.evidence_id)
        .where(Requirement.opportunity_id == opportunity_id)
        .order_by(Requirement.page.nulls_first(), Requirement.char_start)
    ).all()
    return {
        "items": [
            {
                "id": str(r.id),
                "text": r.text,
                "type": r.type,
                "category": r.category,
                "page": r.page,
                "heading_path": r.heading_path,
                "params": r.params,
                "extraction_method": r.extraction_method,
                "confidence": r.confidence,
                "verification": r.verification,
                "evidence": e
                and {
                    "id": str(e.id),
                    "kind": e.kind,
                    "page": e.page,
                    "section": e.section,
                    "quote": e.quote,
                    "char_start": e.char_start,
                    "char_end": e.char_end,
                    "url": e.url,
                    "document_version_id": str(e.document_version_id) if e.document_version_id else None,
                },
            }
            for r, e in rows
        ]
    }


@router.get("/{opportunity_id}/evidence")
def why(
    opportunity_id: uuid.UUID,
    field: str | None = Query(default=None, max_length=60),
    ctx: TenantContext = Depends(tenant_context),
    db: Session = Depends(tenant_db),
) -> dict:
    """ "Why do you say this?" — the source lineage of each opportunity fact (spec §9)."""
    ctx.require("opportunity.read")
    o = _get(db, opportunity_id)
    stmt = (
        select(Assertion, Evidence)
        .join(Evidence, Evidence.id == Assertion.evidence_id)
        .where(
            Assertion.subject_type == "opportunity",
            Assertion.subject_id == o.id,
            Assertion.version == o.current_version,
        )
    )
    if field:
        stmt = stmt.where(Assertion.predicate == field)
    return {
        "version": o.current_version,
        "items": [
            {
                "field": a.predicate,
                "value": a.value.get("v"),
                "epistemic": a.epistemic,
                "confidence": a.confidence,
                "verification": a.verification,
                "method": a.method,
                "evidence": {
                    "source_url": e.url,
                    "locator": e.section,
                    "quote": e.quote,
                    "retrieved_at": e.retrieved_at,
                    "content_hash": e.content_hash,
                },
            }
            for a, e in db.execute(stmt.order_by(Assertion.predicate)).all()
        ],
    }
