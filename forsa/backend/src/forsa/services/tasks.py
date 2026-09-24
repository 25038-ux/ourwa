"""Tasks: manual, generated from bid conditions, or proposed by the assistant (confirmed by a human)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from forsa.db.models import Bid, Match, Membership, Opportunity, Task, User
from forsa.identity.rbac import TenantContext
from forsa.kernel.errors import ForsaError, NotFound
from forsa.matching.messages import render
from forsa.services.notifications import notify
from forsa.taxonomy import default_ontology

STATUSES = ("OPEN", "IN_PROGRESS", "DONE")


def _check_assignee(session: Session, ctx: TenantContext, user_id: uuid.UUID | None) -> None:
    if user_id and not session.scalar(
        select(Membership).where(Membership.org_id == ctx.org_id, Membership.user_id == user_id)
    ):
        raise ForsaError("assignee is not a member of this organisation")


def serialize(t: Task, users: dict[uuid.UUID, str], bids: dict[uuid.UUID, str]) -> dict[str, Any]:
    return {
        "id": str(t.id),
        "title": t.title,
        "description": t.description,
        "status": t.status,
        "source": t.source,
        "due_at": t.due_at,
        "assignee_user_id": str(t.assignee_user_id) if t.assignee_user_id else None,
        "assignee": users.get(t.assignee_user_id) if t.assignee_user_id else None,
        "bid_id": str(t.bid_id) if t.bid_id else None,
        "bid_title": bids.get(t.bid_id) if t.bid_id else None,
        "created_at": t.created_at,
        "updated_at": t.updated_at,
    }


def list_tasks(session: Session, ctx: TenantContext, mine: bool = False) -> list[dict[str, Any]]:
    q = select(Task).where(Task.org_id == ctx.org_id)
    if mine:
        q = q.where(Task.assignee_user_id == ctx.user_id)
    tasks = session.scalars(q.order_by(Task.status, Task.due_at.asc().nulls_last(), Task.created_at)).all()
    users: dict[uuid.UUID, str] = dict(
        session.execute(  # type: ignore[arg-type]
            select(User.id, User.full_name)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.org_id == ctx.org_id)
        ).all()
    )
    bids: dict[uuid.UUID, str] = dict(
        session.execute(  # type: ignore[arg-type]
            select(Bid.id, Opportunity.title)
            .join(Opportunity, Opportunity.id == Bid.opportunity_id)
            .where(Bid.org_id == ctx.org_id)
        ).all()
    )
    return [serialize(t, users, bids) for t in tasks]


def create_task(
    session: Session,
    ctx: TenantContext,
    title: str,
    *,
    description: str | None = None,
    due_at: datetime | None = None,
    assignee_user_id: uuid.UUID | None = None,
    bid_id: uuid.UUID | None = None,
    source: str = "manual",
) -> Task:
    ctx.require("bid.read")
    _check_assignee(session, ctx, assignee_user_id)
    if bid_id and (b := session.get(Bid, bid_id)) is not None and b.org_id != ctx.org_id:
        raise NotFound("bid not found")
    t = Task(
        org_id=ctx.org_id,
        title=title.strip()[:500],
        description=description,
        due_at=due_at,
        assignee_user_id=assignee_user_id,
        bid_id=bid_id,
        source=source,
        created_by=ctx.user_id,
        status="OPEN",
    )
    session.add(t)
    session.flush()
    if assignee_user_id and assignee_user_id != ctx.user_id:
        notify(
            session,
            ctx.org_id,
            "task_assignment",
            t.title,
            key=f"notif:task:{t.id}:{assignee_user_id}",
            user_id=assignee_user_id,
            payload={"task_id": str(t.id)},
        )
    return t


def update_task(session: Session, ctx: TenantContext, task_id: uuid.UUID, fields: dict[str, Any]) -> Task:
    t = session.get(Task, task_id)
    if t is None or t.org_id != ctx.org_id:
        raise NotFound("task not found")
    if "status" in fields and fields["status"] not in STATUSES:
        raise ForsaError("invalid status")
    if "assignee_user_id" in fields:
        _check_assignee(session, ctx, fields["assignee_user_id"])
    previous_assignee = t.assignee_user_id
    for key in ("title", "description", "status", "due_at", "assignee_user_id"):
        if key in fields:
            setattr(t, key, fields[key])
    if t.assignee_user_id and t.assignee_user_id != previous_assignee and t.assignee_user_id != ctx.user_id:
        notify(
            session,
            ctx.org_id,
            "task_assignment",
            t.title,
            key=f"notif:task:{t.id}:{t.assignee_user_id}",
            user_id=t.assignee_user_id,
            payload={"task_id": str(t.id)},
        )
    return t


def delete_task(session: Session, ctx: TenantContext, task_id: uuid.UUID) -> None:
    t = session.get(Task, task_id)
    if t is None or t.org_id != ctx.org_id:
        raise NotFound("task not found")
    session.delete(t)


def tasks_from_conditions(session: Session, ctx: TenantContext, bid: Bid, lang: str = "fr") -> int:
    """When a team decides to BID, turn the engine's conditions into owned, dated tasks (idempotent)."""
    match = session.get(Match, bid.match_id) if bid.match_id else None
    opp = session.get(Opportunity, bid.opportunity_id)
    if match is None or opp is None:
        return 0
    due = opp.deadline_at - timedelta(days=2) if opp.deadline_at else None
    created = 0
    for i, cond in enumerate(match.result.get("conditions", [])):
        title = render(cond["code"], cond.get("params"), lang, default_ontology())
        new = session.execute(
            insert(Task)
            .values(
                id=uuid.uuid4(),
                org_id=ctx.org_id,
                bid_id=bid.id,
                title=title[:500],
                status="OPEN",
                source="condition",
                source_key=f"cond:{bid.id}:{cond['code']}:{i}",
                due_at=due,
                assignee_user_id=ctx.user_id,
                created_by=ctx.user_id,
                description=opp.title,
            )
            .on_conflict_do_nothing(index_elements=["source_key"])
            .returning(Task.id)
        ).scalar()
        created += new is not None
    return created
