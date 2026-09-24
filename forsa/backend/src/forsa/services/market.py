"""Market intelligence from public records: who wins what, who buys what, what is coming, who is excluded.

Everything here is aggregated from official notices (awards, procurement plans, red lists) with a link back to
each source record. Amounts are summed per currency — never converted with an invented exchange rate.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import Text, cast, func, or_, select
from sqlalchemy.orm import Session

from forsa.db.models import Buyer, Debarment, Opportunity, Source
from forsa.services.debarments import name_key


def _awards(session: Session, since: datetime, q: str | None = None) -> list[tuple[Opportunity, str | None, str]]:
    stmt = (
        select(Opportunity, Buyer.name, Source.name)
        .outerjoin(Buyer, Buyer.id == Opportunity.buyer_id)
        .join(Source, Source.id == Opportunity.source_id)
        .where(Opportunity.kind == "AWARD", Opportunity.is_synthetic.is_(False))
        .where(or_(Opportunity.published_at.is_(None), Opportunity.published_at >= since))
    )
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                Opportunity.title.ilike(like),
                Buyer.name.ilike(like),
                cast(Opportunity.attributes["winners"], Text).ilike(like),
            )
        )
    return [(o, b, s) for o, b, s in session.execute(stmt.order_by(Opportunity.published_at.desc().nulls_last()))]


def award_row(o: Opportunity, buyer: str | None, source: str) -> dict[str, Any]:
    attrs = o.attributes or {}
    return {
        "opportunity_id": str(o.id),
        "title": o.title,
        "buyer": buyer,
        "category": o.category,
        "method": o.method,
        "published_at": o.published_at,
        "award_date": attrs.get("award_date"),
        "winners": attrs.get("winners") or [],
        "other_bidders": attrs.get("other_bidders") or [],
        "value": float(o.estimated_value) if o.estimated_value is not None else None,
        "currency": o.currency,
        "source": source,
        "url": o.url,
    }


def _red_keys(session: Session) -> dict[str, Debarment]:
    return {d.name_key: d for d in session.scalars(select(Debarment)).all()}


def competitors(session: Session, since: datetime, q: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    """Firms that won awards, with counts, totals per currency, buyers served and red-list flag."""
    agg: dict[str, dict[str, Any]] = {}
    for o, buyer, _ in _awards(session, since):
        for w in (o.attributes or {}).get("winners") or []:
            if w.get("type") != "firm" or not w.get("name"):
                continue
            key = name_key(w["name"])
            if not key:
                continue
            e = agg.setdefault(
                key,
                {"name": w["name"], "country": w.get("country"), "wins": 0, "totals": Counter(), "buyers": Counter(),
                 "categories": Counter(), "last_win": None, "bids_lost": 0},
            )  # fmt: skip
            e["wins"] += 1
            if w.get("amount") and w.get("currency"):
                e["totals"][w["currency"]] += float(w["amount"])
            if buyer:
                e["buyers"][buyer] += 1
            if o.category:
                e["categories"][o.category] += 1
            e["last_win"] = max(filter(None, [e["last_win"], o.published_at]), default=None)
        for loser in (o.attributes or {}).get("other_bidders") or []:
            key = name_key(loser)
            if key in agg:
                agg[key]["bids_lost"] += 1
    red = _red_keys(session)
    rows = []
    for key, e in agg.items():
        if q and q.casefold() not in e["name"].casefold():
            continue
        rows.append(
            {
                "name": e["name"],
                "country": e["country"],
                "wins": e["wins"],
                "bids_lost": e["bids_lost"],
                "totals": [{"currency": c, "amount": round(v, 2)} for c, v in e["totals"].most_common()],
                "top_buyers": [b for b, _ in e["buyers"].most_common(3)],
                "categories": [c for c, _ in e["categories"].most_common()],
                "last_win": e["last_win"],
                "red_list": key in red,
            }
        )
    return sorted(rows, key=lambda r: (-r["wins"], r["name"]))[:limit]


def overview(session: Session, now: datetime, months: int = 24) -> dict[str, Any]:
    since = now - timedelta(days=30 * months)
    awards = _awards(session, since)
    by_month: Counter[str] = Counter()
    by_category: Counter[str] = Counter()
    buyers: Counter[str] = Counter()
    totals: defaultdict[str, float] = defaultdict(float)
    for o, buyer, _ in awards:
        if o.published_at:
            by_month[o.published_at.strftime("%Y-%m")] += 1
        by_category[o.category or "other"] += 1
        if buyer:
            buyers[buyer] += 1
        if o.estimated_value is not None and o.currency:
            totals[o.currency] += float(o.estimated_value)

    plan_rows = session.execute(
        select(Opportunity, Buyer.name)
        .outerjoin(Buyer, Buyer.id == Opportunity.buyer_id)
        .where(Opportunity.status == "PLANNED", Opportunity.is_synthetic.is_(False))
    ).all()
    pipeline_month: Counter[str] = Counter()
    pipeline_cat: Counter[str] = Counter()
    planners: Counter[str] = Counter()
    upcoming = []
    horizon = (now + timedelta(days=365)).date().isoformat()
    today = now.date().isoformat()
    for o, buyer in plan_rows:
        launch = (o.attributes or {}).get("planned_launch")
        if not launch or not (today <= launch <= horizon):
            continue
        pipeline_month[launch[:7]] += 1
        pipeline_cat[o.category or "other"] += 1
        if buyer:
            planners[buyer] += 1
        upcoming.append((launch, o, buyer))
    upcoming.sort(key=lambda t: t[0])
    firms = competitors(session, since, limit=10)
    red_count = session.scalar(select(func.count()).select_from(Debarment)) or 0
    months_axis = sorted(by_month)[-12:]
    return {
        "since": since,
        "awards": {
            "count": len(awards),
            "totals": [{"currency": c, "amount": round(v, 2)} for c, v in sorted(totals.items(), key=lambda t: -t[1])],
            "by_month": [{"month": m, "count": by_month[m]} for m in months_axis],
            "by_category": [{"category": c, "count": n} for c, n in by_category.most_common()],
            "top_buyers": [{"name": b, "count": n} for b, n in buyers.most_common(8)],
            "recent": [award_row(o, b, s) for o, b, s in awards[:8]],
        },
        "pipeline": {
            "count": len(upcoming),
            "by_month": [{"month": m, "count": pipeline_month[m]} for m in sorted(pipeline_month)[:12]],
            "by_category": [{"category": c, "count": n} for c, n in pipeline_cat.most_common()],
            "top_planners": [{"name": b, "count": n} for b, n in planners.most_common(8)],
            "next": [
                {
                    "opportunity_id": str(o.id),
                    "title": o.title,
                    "buyer": b,
                    "planned_launch": launch,
                    "category": o.category,
                    "method": o.method,
                }
                for launch, o, b in upcoming[:12]
            ],
        },
        "top_winners": firms,
        "red_list_count": red_count,
        "note": "Amounts are summed per currency as published; FORSA never converts with an assumed rate.",
    }


def awards_list(session: Session, since: datetime, q: str | None, limit: int, offset: int) -> dict[str, Any]:
    rows = _awards(session, since, q)
    return {"total": len(rows), "items": [award_row(o, b, s) for o, b, s in rows[offset : offset + limit]]}


def buyer_profile(session: Session, name: str, since: datetime) -> dict[str, Any]:
    """What a buyer has awarded (to whom) and what it plans next."""
    awards = [(o, b, s) for o, b, s in _awards(session, since) if b and b.casefold() == name.casefold()]
    winners: Counter[str] = Counter()
    for o, _, _ in awards:
        for w in (o.attributes or {}).get("winners") or []:
            if w.get("name"):
                winners[w["name"]] += 1
    plans = session.execute(
        select(Opportunity)
        .join(Buyer, Buyer.id == Opportunity.buyer_id)
        .where(Opportunity.status == "PLANNED", func.lower(Buyer.name) == name.casefold())
    ).scalars()
    by_cat: defaultdict[str, int] = defaultdict(int)
    for o, _, _ in awards:
        by_cat[o.category or "other"] += 1
    return {
        "name": name,
        "awards": [award_row(o, b, s) for o, b, s in awards[:20]],
        "frequent_winners": [{"name": n, "wins": c} for n, c in winners.most_common(8)],
        "categories": dict(by_cat),
        "planned": [
            {
                "opportunity_id": str(o.id),
                "title": o.title,
                "planned_launch": (o.attributes or {}).get("planned_launch"),
            }
            for o in plans
        ][:20],
    }
