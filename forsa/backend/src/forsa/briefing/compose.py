"""Daily briefing — the product's daily habit (spec §41). Built only from stored, explainable matches."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from forsa.db.models import ApprovalRequest, Briefing, Match, Notification, Opportunity, OpportunityEvent
from forsa.kernel.clock import utcnow
from forsa.matching.messages import render
from forsa.taxonomy import default_ontology

PURSUE = ("BID", "BID_WITH_CONDITIONS")
BLOCKER_CODES = (
    "condition.obtain",
    "condition.renew",
    "condition.add_credential",
    "condition.upload_evidence",
    "condition.complete_credential",
    "condition.partner",
)


def _days(deadline: datetime | None, now: datetime) -> float | None:
    return None if deadline is None else round((deadline - now).total_seconds() / 86400, 1)


def compose_briefing(
    session: Session, org_id: uuid.UUID, now: datetime | None = None, lang: str = "fr"
) -> dict[str, Any]:
    now = now or utcnow()
    onto = default_ontology()
    since = now - timedelta(days=1)
    rows = session.execute(
        select(Match, Opportunity)
        .join(Opportunity, Opportunity.id == Match.opportunity_id)
        .where(Match.org_id == org_id, Match.status != "DISMISSED")
    ).all()
    live = [(m, o) for m, o in rows if o.deadline_at is None or o.deadline_at > now]
    items = []
    for m, o in live:
        conditions = m.result.get("conditions", [])
        blockers = [render(c["code"], c.get("params"), lang, onto) for c in conditions if c["code"] in BLOCKER_CODES]
        items.append(
            {
                "opportunity_id": str(o.id),
                "match_id": str(m.id),
                "title": o.title,
                "fit": m.fit_score,
                "recommendation": m.recommendation,
                "deadline_days": _days(o.deadline_at, now),
                "status": o.status,
                "is_new": m.created_at >= since,
                "blockers": blockers,
                "is_synthetic": o.is_synthetic,
            }
        )
    pursue = sorted(
        [i for i in items if i["recommendation"] in PURSUE and i["status"] != "PLANNED"],
        key=lambda i: (-i["fit"], i["deadline_days"] if i["deadline_days"] is not None else 999),
    )
    deadlines = sorted(
        [
            i
            for i in items
            if i["deadline_days"] is not None and i["deadline_days"] <= 7 and i["recommendation"] != "NO_BID"
        ],
        key=lambda i: i["deadline_days"],
    )
    early = [i for i in items if i["status"] == "PLANNED"]
    missing = sorted({b for i in pursue for b in i["blockers"]})
    opp_ids = [uuid.UUID(i["opportunity_id"]) for i in items]
    changes = (
        session.execute(
            select(OpportunityEvent, Opportunity.title)
            .join(Opportunity, Opportunity.id == OpportunityEvent.opportunity_id)
            .where(
                OpportunityEvent.opportunity_id.in_(opp_ids),
                OpportunityEvent.occurred_at >= since,
                OpportunityEvent.event_type != "NEW",
            )
        ).all()
        if opp_ids
        else []
    )
    pending_approvals = session.scalars(
        select(ApprovalRequest).where(ApprovalRequest.org_id == org_id, ApprovalRequest.status == "PENDING")
    ).all()
    top = pursue[0] if pursue else None
    return {
        "date": now.date().isoformat(),
        "generated_at": now.isoformat(),
        "counts": {
            "new_signals": sum(1 for i in items if i["is_new"]),
            "high_fit": sum(1 for i in pursue if i["fit"] >= 70),
            "deadlines": len(deadlines),
            "missing_items": len(missing),
            "early_signals": len(early),
            "changes": len(changes),
            "approvals_pending": len(pending_approvals),
        },
        "top_action": top and {**top, "blocker": top["blockers"][0] if top["blockers"] else None},
        "pursue": pursue[:5],
        "deadlines": deadlines[:5],
        "early_signals": early[:5],
        "missing_items": missing[:10],
        "changes": [
            {"opportunity_id": str(e.opportunity_id), "title": t, "type": e.event_type, "changes": e.changes}
            for e, t in changes[:10]
        ],
        "note": "Scores are Opportunity Fit estimates based on available evidence — not win probabilities.",
    }


def store_briefing(session: Session, org_id: uuid.UUID, payload: dict[str, Any], day: date) -> None:
    stmt = insert(Briefing).values(id=uuid.uuid4(), org_id=org_id, briefing_date=day, payload=payload)
    session.execute(stmt.on_conflict_do_update(index_elements=["org_id", "briefing_date"], set_={"payload": payload}))
    if payload["counts"]["high_fit"] or payload["counts"]["deadlines"]:
        session.execute(
            insert(Notification)
            .values(
                id=uuid.uuid4(),
                org_id=org_id,
                category="daily_briefing",
                title=f"Briefing {day.isoformat()}",
                payload={"counts": payload["counts"]},
                idempotency_key=f"notif:briefing:{org_id}:{day.isoformat()}",
            )
            .on_conflict_do_nothing(index_elements=["idempotency_key"])
        )
