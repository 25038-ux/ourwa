"""Deadlines as iCalendar (.ics): import into Google Calendar, Outlook or Apple Calendar with alarms."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from forsa.api.deps import tenant_context, tenant_db
from forsa.db.models import Bid, Buyer, Match, Opportunity
from forsa.identity.rbac import TenantContext
from forsa.kernel.clock import utcnow
from forsa.kernel.errors import NotFound

router = APIRouter(tags=["calendar"])
ACTIVE_BIDS = ("QUALIFYING", "PURSUING", "IN_REVIEW", "APPROVED")


def _esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", r"\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line: str) -> str:
    """RFC 5545 §3.1: lines longer than 75 octets are folded with CRLF + space."""
    out, cur = [], b""
    for ch in line:
        enc = ch.encode()
        if len(cur) + len(enc) > 75:
            out.append(cur.decode())
            cur = b" "
        cur += enc
    out.append(cur.decode())
    return "\r\n".join(out)


def _ts(dt: datetime) -> str:
    return dt.strftime("%Y%m%dT%H%M%SZ")


def ics(events: list[tuple[Opportunity, str | None]], name: str) -> str:
    now = utcnow()
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FORSA//Deadlines//FR", "CALSCALE:GREGORIAN",
             "METHOD:PUBLISH", f"X-WR-CALNAME:{_esc(name)}"]  # fmt: skip
    for opp, buyer in events:
        if opp.deadline_at is None:
            continue
        desc = "\n".join(filter(None, [buyer, opp.url, "FORSA — vérifiez la date sur l'avis officiel."]))
        lines += [
            "BEGIN:VEVENT",
            f"UID:{opp.id}@forsa",
            f"DTSTAMP:{_ts(now)}",
            f"DTSTART:{_ts(opp.deadline_at)}",
            f"DTEND:{_ts(opp.deadline_at + timedelta(minutes=30))}",
            f"SUMMARY:{_esc('Date limite — ' + opp.title[:200])}",
            f"DESCRIPTION:{_esc(desc)}",
            *([f"URL:{opp.url}"] if opp.url else []),
            "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-P3D", f"DESCRIPTION:{_esc('J-3 : ' + opp.title[:120])}",
            "END:VALARM",
            "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-P1D", f"DESCRIPTION:{_esc('Demain : ' + opp.title[:120])}",
            "END:VALARM",
            "END:VEVENT",
        ]  # fmt: skip
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"


def _response(body: str, filename: str) -> Response:
    return Response(
        body,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/calendar.ics")
def my_deadlines(ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)) -> Response:
    """Deadlines of opportunities the organisation pursues or bids on."""
    ctx.require("opportunity.read")
    now = utcnow()
    ids = set(
        db.scalars(select(Match.opportunity_id).where(Match.org_id == ctx.org_id, Match.status == "PURSUED")).all()
    ) | set(db.scalars(select(Bid.opportunity_id).where(Bid.org_id == ctx.org_id, Bid.status.in_(ACTIVE_BIDS))).all())
    rows = db.execute(
        select(Opportunity, Buyer.name)
        .outerjoin(Buyer, Buyer.id == Opportunity.buyer_id)
        .where(Opportunity.id.in_(ids), Opportunity.deadline_at > now - timedelta(days=1))
        .order_by(Opportunity.deadline_at)
    ).all()
    return _response(ics([(o, b) for o, b in rows], "FORSA — échéances"), "forsa-echeances.ics")


@router.get("/opportunities/{opportunity_id}/calendar.ics")
def one_deadline(
    opportunity_id: uuid.UUID, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> Response:
    ctx.require("opportunity.read")
    row = db.execute(
        select(Opportunity, Buyer.name)
        .outerjoin(Buyer, Buyer.id == Opportunity.buyer_id)
        .where(Opportunity.id == opportunity_id)
    ).first()
    if row is None or row[0].deadline_at is None:
        raise NotFound("no deadline for this opportunity")
    return _response(ics([(row[0], row[1])], "FORSA"), f"forsa-{str(opportunity_id)[:8]}.ics")
