from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from forsa.api.deps import runtime, tenant_context, tenant_db
from forsa.api.schemas import ApprovalDecisionIn, ApprovalIn, BidIn, CompliancePatch, DecisionIn, OutcomeIn
from forsa.db.models import ApprovalRequest, Bid, BidDecision, ComplianceItem, Evidence, Match, Opportunity
from forsa.identity.rbac import TenantContext
from forsa.runtime import Runtime
from forsa.services import bids as svc
from forsa.services.ai_features import polish_section

router = APIRouter(tags=["bids"])


def _bid(db: Session, bid: Bid) -> dict:
    opp = db.get(Opportunity, bid.opportunity_id)
    items = db.scalars(
        select(ComplianceItem)
        .where(ComplianceItem.bid_id == bid.id)
        .order_by(ComplianceItem.requirement_type, ComplianceItem.created_at)
    ).all()
    decisions = db.scalars(
        select(BidDecision).where(BidDecision.bid_id == bid.id).order_by(BidDecision.created_at.desc())
    ).all()
    approvals = db.scalars(
        select(ApprovalRequest).where(ApprovalRequest.bid_id == bid.id).order_by(ApprovalRequest.created_at.desc())
    ).all()
    return {
        "id": str(bid.id),
        "status": bid.status,
        "outcome": bid.outcome,
        "opportunity_id": str(bid.opportunity_id),
        "opportunity": opp
        and {
            "title": opp.title,
            "deadline_at": opp.deadline_at,
            "status": opp.status,
            "is_synthetic": opp.is_synthetic,
        },
        "match_id": str(bid.match_id) if bid.match_id else None,
        "allowed_transitions": sorted(svc.TRANSITIONS.get(bid.status, set())),
        "compliance": [
            {
                "id": str(i.id),
                "text": i.text,
                "type": i.requirement_type,
                "category": i.category,
                "source": i.source_locator,
                "status": i.status,
                "response": i.response,
                "risk": i.risk,
                "evidence_ids": i.evidence_ids,
                "owner_user_id": str(i.owner_user_id) if i.owner_user_id else None,
            }
            for i in items
        ],
        "decisions": [
            {
                "decision": d.decision,
                "system_recommendation": d.system_recommendation,
                "fit_score": d.fit_score,
                "rationale": d.rationale,
                "at": d.created_at,
            }
            for d in decisions
        ],
        "approvals": [
            {
                "id": str(a.id),
                "action": a.action,
                "status": a.status,
                "note": a.note,
                "requested_by": str(a.requested_by),
                "decided_by": str(a.decided_by) if a.decided_by else None,
                "payload": a.payload,
                "at": a.created_at,
            }
            for a in approvals
        ],
    }


@router.get("/bids")
def list_bids(ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)) -> dict:
    ctx.require("bid.read")
    rows = db.execute(
        select(Bid, Opportunity, Match)
        .join(Opportunity, Opportunity.id == Bid.opportunity_id)
        .outerjoin(Match, Match.id == Bid.match_id)
        .where(Bid.org_id == ctx.org_id)
        .order_by(Bid.updated_at.desc())
    ).all()
    progress: dict = {}
    for bid_id, status, n in db.execute(
        select(ComplianceItem.bid_id, ComplianceItem.status, func.count())
        .where(ComplianceItem.org_id == ctx.org_id)
        .group_by(ComplianceItem.bid_id, ComplianceItem.status)
    ).all():
        entry = progress.setdefault(bid_id, {"total": 0, "complete": 0})
        entry["total"] += n
        entry["complete"] += n if status == "COMPLETE" else 0
    return {
        "items": [
            {
                "id": str(b.id),
                "status": b.status,
                "outcome": b.outcome,
                "title": o.title,
                "deadline_at": o.deadline_at,
                "opportunity_id": str(o.id),
                "is_synthetic": o.is_synthetic,
                "fit_score": m.fit_score if m else None,
                "recommendation": m.recommendation if m else None,
                "compliance": progress.get(b.id, {"total": 0, "complete": 0}),
            }
            for b, o, m in rows
        ]
    }


@router.post("/bids")
def create_bid(body: BidIn, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)) -> dict:
    bid = svc.create_bid(db, ctx, body.opportunity_id)
    db.commit()
    return _bid(db, bid)


@router.get("/bids/{bid_id}")
def get_bid(bid_id: uuid.UUID, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)) -> dict:
    ctx.require("bid.read")
    return _bid(db, svc.get_bid(db, ctx, bid_id))


@router.post("/bids/{bid_id}/decision")
def decide(
    bid_id: uuid.UUID, body: DecisionIn, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    bid = svc.decide(db, ctx, bid_id, body.decision, body.rationale)
    db.commit()
    return _bid(db, bid)


@router.patch("/bids/{bid_id}/compliance/{item_id}")
def patch_compliance(
    bid_id: uuid.UUID,
    item_id: uuid.UUID,
    body: CompliancePatch,
    ctx: TenantContext = Depends(tenant_context),
    db: Session = Depends(tenant_db),
) -> dict:
    svc.get_bid(db, ctx, bid_id)
    svc.update_compliance_item(db, ctx, item_id, body.model_dump(exclude_unset=True))
    db.commit()
    return {"ok": True}


@router.post("/bids/{bid_id}/approvals")
def request_approval(
    bid_id: uuid.UUID, body: ApprovalIn, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    req = svc.request_approval(db, ctx, bid_id, body.action, body.note)
    db.commit()
    return {"id": str(req.id), "status": req.status, "open_mandatory_items": req.payload["open_mandatory_items"]}


@router.post("/approvals/{approval_id}/decision")
def decide_approval(
    approval_id: uuid.UUID,
    body: ApprovalDecisionIn,
    ctx: TenantContext = Depends(tenant_context),
    db: Session = Depends(tenant_db),
) -> dict:
    req = svc.decide_approval(db, ctx, approval_id, body.approve, body.note)
    db.commit()
    return {"id": str(req.id), "status": req.status}


@router.post("/bids/{bid_id}/submitted")
def mark_submitted(
    bid_id: uuid.UUID, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    bid = svc.mark_submitted(db, ctx, bid_id)
    db.commit()
    return _bid(db, bid)


@router.post("/bids/{bid_id}/outcome")
def outcome(
    bid_id: uuid.UUID, body: OutcomeIn, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    bid = svc.record_outcome(db, ctx, bid_id, body.outcome, body.note)
    db.commit()
    return _bid(db, bid)


@router.post("/bids/{bid_id}/generate-draft")
def generate_draft(
    bid_id: uuid.UUID,
    ctx: TenantContext = Depends(tenant_context),
    db: Session = Depends(tenant_db),
    rt: Runtime = Depends(runtime),
) -> dict:
    """Evidence-classified response skeleton (spec §18). Nothing is invented: every section is either backed by
    linked evidence or explicitly marked as requiring user input."""
    ctx.require("bid.edit")
    bid = svc.get_bid(db, ctx, bid_id)
    ai_on = rt.settings.feature("ai_drafting")
    sections = []
    for item in db.scalars(select(ComplianceItem).where(ComplianceItem.bid_id == bid.id)).all():
        found = [db.get(Evidence, uuid.UUID(e)) for e in item.evidence_ids or []]
        evidence = [e for e in found if e is not None and e.org_id == ctx.org_id]
        polished = False
        if item.response and evidence:
            cls, text = "EVIDENCE_BACKED", item.response
            if ai_on:
                better = polish_section(
                    db, rt.gateway, ctx.org_id, item.text, item.response, [e.quote or "" for e in evidence]
                )
                if better:
                    text, polished = better, True
        elif item.response:
            cls, text = "USER_INPUT_REQUIRED", item.response
        else:
            cls, text = "PLACEHOLDER", "[À compléter — réponse et justificatif requis]"
        sections.append(
            {
                "compliance_item_id": str(item.id),
                "requirement": item.text,
                "source": item.source_locator,
                "classification": cls,
                "text": text,
                "ai_polished": polished,
                "evidence": [{"id": str(e.id), "quote": e.quote} for e in evidence],
            }
        )
    return {
        "bid_id": str(bid.id),
        "sections": sections,
        "generator": "skeleton-v1+ai-polish" if ai_on else "skeleton-v1",
        "note": "Draft skeleton. AI drafting (Phase 10) will only fill EVIDENCE_BACKED sections.",
    }
