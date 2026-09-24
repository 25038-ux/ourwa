"""Bid workspace, bid/no-bid decisions and human approvals (spec §14–17, §39).

FORSA never submits anything externally. ``mark_submitted`` records that a
human submitted the bid, and is only allowed after an APPROVED
FINAL_SUBMISSION approval (four-eyes whenever the organisation has more than
one eligible approver).
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from forsa.db.models import (
    ApprovalRequest,
    Bid,
    BidDecision,
    ComplianceItem,
    Match,
    Membership,
    Opportunity,
    Requirement,
)
from forsa.identity.rbac import PERMISSIONS, Role, TenantContext
from forsa.kernel.clock import utcnow
from forsa.kernel.errors import Conflict, Forbidden, ForsaError, InvalidTransition, NotFound
from forsa.services.companies import get_twin
from forsa.services.events import audit, emit

TRANSITIONS: dict[str, set[str]] = {
    "QUALIFYING": {"PURSUING", "NO_BID"},
    "NO_BID": {"QUALIFYING"},
    "PURSUING": {"IN_REVIEW", "WITHDRAWN"},
    "IN_REVIEW": {"PURSUING", "APPROVED", "WITHDRAWN"},
    "APPROVED": {"SUBMITTED", "PURSUING", "WITHDRAWN"},
    "SUBMITTED": {"WON", "LOST", "CANCELLED"},
    "WITHDRAWN": set(),
    "WON": set(),
    "LOST": set(),
    "CANCELLED": set(),
}
APPROVAL_ACTIONS = {
    "FINAL_SUBMISSION",
    "CONTACT_BUYER",
    "CONSORTIUM_REQUEST",
    "PUBLISH_COMPANY_INFO",
    "SEND_OFFICIAL_DOCUMENTS",
}
COMPLIANCE_STATUSES = {"NOT_STARTED", "IN_PROGRESS", "COMPLETE", "MISSING", "NEEDS_VERIFICATION", "BLOCKED"}


def _transition(bid: Bid, target: str) -> None:
    if target not in TRANSITIONS.get(bid.status, set()):
        raise InvalidTransition(f"cannot move bid from {bid.status} to {target}")
    bid.status = target


def get_bid(session: Session, ctx: TenantContext, bid_id: uuid.UUID) -> Bid:
    bid = session.get(Bid, bid_id)
    if bid is None or bid.org_id != ctx.org_id:
        raise NotFound("bid not found")
    return bid


def create_bid(session: Session, ctx: TenantContext, opportunity_id: uuid.UUID) -> Bid:
    ctx.require("bid.create")
    opp = session.get(Opportunity, opportunity_id)
    if opp is None:
        raise NotFound("opportunity not found")
    if session.scalar(select(Bid).where(Bid.org_id == ctx.org_id, Bid.opportunity_id == opp.id)):
        raise Conflict("a bid workspace already exists for this opportunity")
    company = get_twin(session, ctx)
    match = session.scalar(select(Match).where(Match.org_id == ctx.org_id, Match.opportunity_id == opp.id))
    if match is None:
        # Snapshot the system recommendation now, so the human decision is always recorded next to it.
        from forsa.runtime import get_runtime
        from forsa.services.matching import match_pair

        match = match_pair(session, get_runtime().engine, company, opp, force=True)
    bid = Bid(
        org_id=ctx.org_id,
        company_id=company.id,
        opportunity_id=opp.id,
        match_id=match.id if match else None,
        status="QUALIFYING",
        owner_user_id=ctx.user_id,
    )
    session.add(bid)
    session.flush()
    for req in session.scalars(select(Requirement).where(Requirement.opportunity_id == opp.id)).all():
        if req.type not in ("mandatory", "scored"):
            continue
        section = " › ".join(req.heading_path or [])
        session.add(
            ComplianceItem(
                org_id=ctx.org_id,
                bid_id=bid.id,
                requirement_id=req.id,
                text=req.text,
                requirement_type=req.type,
                category=req.category,
                source_locator=f"p.{req.page} § {section}" if req.page else section or None,
                status="NOT_STARTED",
                risk="HIGH" if req.type == "mandatory" else "MEDIUM",
                evidence_ids=[],
            )
        )
    if match:
        match.status = "PURSUED"
    emit(
        session,
        "BidStarted",
        "bid",
        bid.id,
        {"opportunity_id": str(opp.id)},
        key=f"bid-started:{bid.id}",
        org_id=ctx.org_id,
    )
    audit(
        session,
        "bid.created",
        org_id=ctx.org_id,
        actor=ctx.user_id,
        subject_type="bid",
        subject_id=bid.id,
        request_id=ctx.request_id,
        ip=ctx.ip,
    )
    return bid


def decide(session: Session, ctx: TenantContext, bid_id: uuid.UUID, decision: str, rationale: str | None) -> Bid:
    """Record the *human* bid/no-bid decision next to the system recommendation it may override."""
    ctx.require("bid.decide")
    if decision not in ("BID", "NO_BID"):
        raise ForsaError("decision must be BID or NO_BID")
    bid = get_bid(session, ctx, bid_id)
    match = session.get(Match, bid.match_id) if bid.match_id else None
    _transition(bid, "PURSUING" if decision == "BID" else "NO_BID")
    session.add(
        BidDecision(
            org_id=ctx.org_id,
            bid_id=bid.id,
            decision=decision,
            rationale=rationale,
            decided_by=ctx.user_id,
            system_recommendation=match.recommendation if match else None,
            fit_score=match.fit_score if match else None,
            scoring_version=match.scoring_version if match else None,
        )
    )
    emit(
        session,
        "BidDecisionChanged",
        "bid",
        bid.id,
        {"decision": decision, "system": match.recommendation if match else None},
        key=f"bid-decision:{bid.id}:{uuid.uuid4()}",
        org_id=ctx.org_id,
    )
    audit(
        session,
        "bid.decided",
        org_id=ctx.org_id,
        actor=ctx.user_id,
        subject_type="bid",
        subject_id=bid.id,
        data={
            "decision": decision,
            "overrides_system": bool(
                match and ((decision == "BID") != (match.recommendation in ("BID", "BID_WITH_CONDITIONS")))
            ),
        },
        request_id=ctx.request_id,
        ip=ctx.ip,
    )
    return bid


def update_compliance_item(
    session: Session, ctx: TenantContext, item_id: uuid.UUID, fields: dict[str, Any]
) -> ComplianceItem:
    ctx.require("bid.edit")
    item = session.get(ComplianceItem, item_id)
    if item is None or item.org_id != ctx.org_id:
        raise NotFound("compliance item not found")
    if "status" in fields and fields["status"] not in COMPLIANCE_STATUSES:
        raise ForsaError("invalid compliance status")
    for key in ("status", "response", "owner_user_id", "reviewer_user_id", "evidence_ids", "risk"):
        if key in fields:
            setattr(item, key, fields[key])
    return item


def request_approval(
    session: Session, ctx: TenantContext, bid_id: uuid.UUID, action: str, note: str | None
) -> ApprovalRequest:
    ctx.require("approval.request")
    if action not in APPROVAL_ACTIONS:
        raise ForsaError("unknown approval action")
    bid = get_bid(session, ctx, bid_id)
    if session.scalar(
        select(ApprovalRequest).where(
            ApprovalRequest.bid_id == bid.id, ApprovalRequest.action == action, ApprovalRequest.status == "PENDING"
        )
    ):
        raise Conflict("an approval request is already pending")
    open_mandatory = session.scalars(
        select(ComplianceItem.text).where(
            ComplianceItem.bid_id == bid.id,
            ComplianceItem.requirement_type == "mandatory",
            ComplianceItem.status != "COMPLETE",
        )
    ).all()
    if action == "FINAL_SUBMISSION":
        _transition(bid, "IN_REVIEW")
    req = ApprovalRequest(
        org_id=ctx.org_id,
        bid_id=bid.id,
        action=action,
        status="PENDING",
        requested_by=ctx.user_id,
        note=note,
        payload={"open_mandatory_items": [t[:200] for t in open_mandatory]},
    )
    session.add(req)
    session.flush()
    emit(
        session,
        "ApprovalRequested",
        "approval",
        req.id,
        {"action": action, "bid_id": str(bid.id)},
        key=f"approval-requested:{req.id}",
        org_id=ctx.org_id,
    )
    audit(
        session,
        "approval.requested",
        org_id=ctx.org_id,
        actor=ctx.user_id,
        subject_type="approval",
        subject_id=req.id,
        data={"action": action},
        request_id=ctx.request_id,
        ip=ctx.ip,
    )
    return req


def _eligible_approvers(session: Session, org_id: uuid.UUID) -> int:
    roles = [r.value for r in Role if "approval.decide" in PERMISSIONS[r]]
    return (
        session.scalar(
            select(func.count()).select_from(Membership).where(Membership.org_id == org_id, Membership.role.in_(roles))
        )
        or 0
    )


def decide_approval(
    session: Session, ctx: TenantContext, approval_id: uuid.UUID, approve: bool, note: str | None
) -> ApprovalRequest:
    ctx.require("approval.decide")
    req = session.get(ApprovalRequest, approval_id)
    if req is None or req.org_id != ctx.org_id:
        raise NotFound("approval request not found")
    if req.status != "PENDING":
        raise Conflict("approval request already decided")
    self_approval = req.requested_by == ctx.user_id
    if self_approval and _eligible_approvers(session, ctx.org_id) > 1:
        raise Forbidden("four-eyes rule: another approver must decide this request")
    req.status = "APPROVED" if approve else "REJECTED"
    req.decided_by, req.decided_at, req.note = ctx.user_id, utcnow(), note or req.note
    bid = get_bid(session, ctx, req.bid_id) if req.bid_id else None
    if bid and req.action == "FINAL_SUBMISSION":
        _transition(bid, "APPROVED" if approve else "PURSUING")
    if approve and req.action == "FINAL_SUBMISSION":
        emit(
            session,
            "SubmissionApproved",
            "approval",
            req.id,
            {"bid_id": str(req.bid_id)},
            key=f"submission-approved:{req.id}",
            org_id=ctx.org_id,
        )
    audit(
        session,
        f"approval.{req.status.lower()}",
        org_id=ctx.org_id,
        actor=ctx.user_id,
        subject_type="approval",
        subject_id=req.id,
        data={"self_approval": self_approval},
        request_id=ctx.request_id,
        ip=ctx.ip,
    )
    return req


def mark_submitted(session: Session, ctx: TenantContext, bid_id: uuid.UUID) -> Bid:
    ctx.require("bid.submit")
    bid = get_bid(session, ctx, bid_id)
    approved = session.scalar(
        select(ApprovalRequest).where(
            ApprovalRequest.bid_id == bid.id,
            ApprovalRequest.action == "FINAL_SUBMISSION",
            ApprovalRequest.status == "APPROVED",
        )
    )
    if approved is None:
        raise Forbidden("final submission requires an approved FINAL_SUBMISSION request")
    _transition(bid, "SUBMITTED")
    audit(
        session,
        "bid.submitted_recorded",
        org_id=ctx.org_id,
        actor=ctx.user_id,
        subject_type="bid",
        subject_id=bid.id,
        data={"approval_id": str(approved.id)},
        request_id=ctx.request_id,
        ip=ctx.ip,
    )
    return bid


def record_outcome(session: Session, ctx: TenantContext, bid_id: uuid.UUID, outcome: str, note: str | None) -> Bid:
    """Outcome labels feed the learning system (Phase 16) — only human-entered, never inferred."""
    ctx.require("bid.outcome")
    if outcome not in ("WON", "LOST", "CANCELLED"):
        raise ForsaError("outcome must be WON, LOST or CANCELLED")
    bid = get_bid(session, ctx, bid_id)
    _transition(bid, outcome)
    bid.outcome, bid.outcome_note = outcome, note
    emit(
        session,
        "BidOutcomeRecorded",
        "bid",
        bid.id,
        {"outcome": outcome},
        key=f"bid-outcome:{bid.id}",
        org_id=ctx.org_id,
    )
    audit(
        session,
        "bid.outcome",
        org_id=ctx.org_id,
        actor=ctx.user_id,
        subject_type="bid",
        subject_id=bid.id,
        data={"outcome": outcome},
        request_id=ctx.request_id,
        ip=ctx.ip,
    )
    return bid
