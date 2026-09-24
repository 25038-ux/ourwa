"""Assistant tools (spec §43): the ONLY way the assistant learns anything.

Every tool is read-only, tenant-scoped (runs in the caller's RLS session and filters by org_id), returns
compact JSON-able data with `href`s for citations, and never exposes other tenants' data. Consequential
actions are never executed here: `propose_action` returns an action card the human confirms in the UI.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from forsa.ai.types import ToolSpec
from forsa.briefing.compose import compose_briefing
from forsa.country import get_pack
from forsa.db.models import (
    Buyer,
    Company,
    CompanyCapability,
    CompanyCredential,
    CompanyProject,
    Match,
    Opportunity,
    Requirement,
)
from forsa.db.session import system_session
from forsa.identity.rbac import TenantContext
from forsa.kernel.clock import utcnow
from forsa.matching.render import concept_label, render_match
from forsa.services.matching import still_open
from forsa.taxonomy import default_ontology

OPEN = ["PUBLISHED", "CLARIFICATION", "EXTENDED", "PLANNED"]
PURSUE = ("BID", "BID_WITH_CONDITIONS")


@dataclass
class ToolContext:
    session: Session
    ctx: TenantContext
    lang: str
    focus_opportunity_id: str | None = None


def _days(dt: Any) -> float | None:
    return None if dt is None else round((dt - utcnow()).total_seconds() / 86400, 1)


def _opp_row(o: Opportunity, m: Match | None, buyer: str | None) -> dict[str, Any]:
    return {
        "id": str(o.id),
        "ref": o.external_ref,
        "title": o.title,
        "buyer": buyer,
        "region": o.region,
        "status": o.status,
        "value": float(o.estimated_value) if o.estimated_value is not None else None,
        "currency": o.currency,
        "days_left": _days(o.deadline_at),
        "is_synthetic": o.is_synthetic,
        "fit": m.fit_score if m else None,
        "recommendation": m.recommendation if m else None,
        "href": f"/opportunities/{o.id}",
    }


def _resolve_opportunity(tc: ToolContext, ref: str | None) -> Opportunity | None:
    ref = (ref or tc.focus_opportunity_id or "").strip()
    if not ref:
        return None
    try:
        opp = tc.session.get(Opportunity, uuid.UUID(ref))
        if opp:
            return opp
    except ValueError:
        pass
    return tc.session.scalar(
        select(Opportunity)
        .where(or_(Opportunity.external_ref.ilike(ref), Opportunity.title.ilike(f"%{ref}%")))
        .limit(1)
    )


def _regions(name: str | None) -> list[str]:
    if not name:
        return []
    pack = get_pack("MR")
    for alias, members in (pack.get("region_aliases") or {}).items():
        if alias.lower() == name.lower():
            return [*members, alias]
    return [r for r in pack["regions"] if r.lower() == name.lower()] or [name]


# ── tools ───────────────────────────────────────────────────────────────────
def search_opportunities(
    tc: ToolContext,
    query: str | None = None,
    concepts: list[str] | None = None,
    region: str | None = None,
    category: str | None = None,
    max_value: float | None = None,
    max_days_left: float | None = None,
    min_fit: int | None = None,
    exclude_no_bid: bool = False,
    limit: int = 5,
) -> dict[str, Any]:
    s, org = tc.session, tc.ctx.org_id
    stmt = (
        select(Opportunity, Match, Buyer.name)
        .outerjoin(Match, and_(Match.opportunity_id == Opportunity.id, Match.org_id == org))
        .outerjoin(Buyer, Buyer.id == Opportunity.buyer_id)
        .where(Opportunity.status.in_(OPEN), Opportunity.kind != "AWARD", still_open(utcnow()))
    )
    if query:
        like = f"%{query}%"
        stmt = stmt.where(or_(Opportunity.title.ilike(like), Opportunity.description.ilike(like)))
    regions = _regions(region)
    if regions:
        stmt = stmt.where(Opportunity.region.in_(regions))
    if category:
        stmt = stmt.where(Opportunity.category == category)
    if max_value is not None:
        stmt = stmt.where(Opportunity.estimated_value <= max_value)
    if max_days_left is not None:
        stmt = stmt.where(Opportunity.deadline_at <= utcnow() + timedelta(days=max_days_left))
    if min_fit is not None:
        stmt = stmt.where(Match.fit_score >= min_fit)
    if exclude_no_bid:
        stmt = stmt.where(or_(Match.recommendation.is_(None), Match.recommendation != "NO_BID"))
    rows = s.execute(
        stmt.order_by(Match.fit_score.desc().nulls_last(), Opportunity.deadline_at.asc().nulls_last()).limit(100)
    ).all()
    items = [(o, m, b) for o, m, b in rows]
    if concepts:
        onto = default_ontology()
        wanted = set(concepts)
        items = [
            (o, m, b)
            for o, m, b in items
            if any(
                any(
                    onto.similarity(c.get("concept_id"), w) >= 0.6 or onto.similarity(w, c.get("concept_id")) >= 0.6
                    for w in wanted
                )
                for c in (o.concepts or [])
                if c.get("weight", 0) > 0
            )
        ]
    return {"total": len(items), "items": [_opp_row(o, m, b) for o, m, b in items[: max(1, min(limit, 10))]]}


def top_recommendations(tc: ToolContext, limit: int = 5) -> dict[str, Any]:
    rows = tc.session.execute(
        select(Opportunity, Match, Buyer.name)
        .join(Match, Match.opportunity_id == Opportunity.id)
        .outerjoin(Buyer, Buyer.id == Opportunity.buyer_id)
        .where(
            Match.org_id == tc.ctx.org_id,
            Match.status != "DISMISSED",
            Opportunity.status.in_(OPEN),
            still_open(utcnow()),
        )
        .order_by(Match.fit_score.desc())
        .limit(20)
    ).all()
    items = [_opp_row(o, m, b) for o, m, b in rows if m.recommendation in PURSUE or o.status == "PLANNED"]
    return {"items": items[: max(1, min(limit, 10))]}


def upcoming_deadlines(tc: ToolContext, days: int = 14) -> dict[str, Any]:
    res = search_opportunities(tc, max_days_left=days, exclude_no_bid=True, limit=10)
    items = sorted(
        [i for i in res["items"] if i["days_left"] is not None and i["fit"] is not None], key=lambda i: i["days_left"]
    )
    return {"days": days, "items": items}


def get_opportunity(tc: ToolContext, opportunity: str | None = None) -> dict[str, Any]:
    opp = _resolve_opportunity(tc, opportunity)
    if opp is None:
        return {"error": "not_found"}
    m = tc.session.scalar(select(Match).where(Match.opportunity_id == opp.id, Match.org_id == tc.ctx.org_id))
    buyer = tc.session.get(Buyer, opp.buyer_id) if opp.buyer_id else None
    out = _opp_row(opp, m, buyer.name if buyer else None)
    out["description"] = (opp.description or "")[:600]
    if m:
        r = render_match(m.result, tc.lang)
        out["explanation"] = r["explanation"]
        out["conditions"] = [c["message"] for c in r["conditions"]]
        out["blocking_or_unknown"] = [g["reason"]["message"] for g in r["gates"] if g["outcome"] != "PASS"][:6]
        out["why_now"] = [w["message"] for w in r["why_now"]]
        out["scoring_version"] = m.scoring_version
    return out


def explain_recommendation(tc: ToolContext, opportunity: str | None = None) -> dict[str, Any]:
    opp = _resolve_opportunity(tc, opportunity)
    if opp is None:
        return {"error": "not_found"}
    m = tc.session.scalar(select(Match).where(Match.opportunity_id == opp.id, Match.org_id == tc.ctx.org_id))
    if m is None:
        return {
            "id": str(opp.id),
            "title": opp.title,
            "error": "no_match_for_company",
            "href": f"/opportunities/{opp.id}",
        }
    r = render_match(m.result, tc.lang)
    return {
        "id": str(opp.id),
        "title": opp.title,
        "href": f"/opportunities/{opp.id}",
        "fit": m.fit_score,
        "recommendation": m.recommendation,
        "headline": r["headline"],
        "reasons": [x["message"] for x in r["recommendation_reasons"]],
        "conditions": [c["message"] for c in r["conditions"]],
        "gates": [
            {
                "outcome": g["outcome"],
                "message": g["reason"]["message"],
                "evidence": [
                    e.get("quote") or e.get("locator")
                    for e in g["reason"]["evidence"]
                    if e.get("quote") or e.get("locator")
                ][:2],
            }
            for g in r["gates"]
        ],
        "components": {c["name"]: c["score"] for c in r["components"]},
        "data_completeness": round(m.data_completeness * 100),
        "note": "Opportunity Fit estimate based on available evidence — not a win probability.",
    }


def list_requirements(tc: ToolContext, opportunity: str | None = None) -> dict[str, Any]:
    opp = _resolve_opportunity(tc, opportunity)
    if opp is None:
        return {"error": "not_found"}
    reqs = tc.session.scalars(
        select(Requirement)
        .where(Requirement.opportunity_id == opp.id)
        .order_by(Requirement.page, Requirement.char_start)
    ).all()
    return {
        "title": opp.title,
        "href": f"/opportunities/{opp.id}",
        "items": [
            {
                "text": r.text[:240],
                "type": r.type,
                "category": r.category,
                "page": r.page,
                "section": " › ".join(r.heading_path or []),
                "verification": r.verification,
                "source": r.extraction_method,
            }
            for r in reqs[:15]
        ],
    }


def get_company_profile(tc: ToolContext) -> dict[str, Any]:
    s = tc.session
    c = s.scalar(select(Company).where(Company.org_id == tc.ctx.org_id))
    if c is None:
        return {"error": "no_profile"}
    caps = s.scalars(select(CompanyCapability).where(CompanyCapability.company_id == c.id)).all()
    creds = s.scalars(select(CompanyCredential).where(CompanyCredential.company_id == c.id)).all()
    projects = s.scalars(select(CompanyProject).where(CompanyProject.company_id == c.id)).all()
    return {
        "name": c.legal_name,
        "regions": c.regions_served,
        "capabilities": [
            {"label": concept_label(x.concept_id, tc.lang), "verified": x.verification == "VERIFIED"} for x in caps
        ],
        "credentials": [
            {
                "label": concept_label(x.credential_id, tc.lang),
                "status": x.status,
                "verified": x.verification == "VERIFIED",
            }
            for x in creds
        ],
        "projects": len(projects),
        "verified_projects": sum(p.verification == "VERIFIED" for p in projects),
        "annual_turnover": float(c.annual_turnover) if c.annual_turnover is not None else None,
        "currency": c.currency,
        "href": "/company",
    }


def get_briefing(tc: ToolContext) -> dict[str, Any]:
    b = compose_briefing(tc.session, tc.ctx.org_id, utcnow(), tc.lang)
    top = b["top_action"]
    return {
        "counts": b["counts"],
        "missing_items": b["missing_items"][:5],
        "top_action": top
        and {
            "title": top["title"],
            "fit": top["fit"],
            "days_left": top["deadline_days"],
            "blocker": top["blocker"],
            "href": f"/opportunities/{top['opportunity_id']}",
        },
    }


def find_partners(tc: ToolContext, opportunity: str | None = None) -> dict[str, Any]:
    """Capability gaps for an opportunity, and companies that CONSENTED to matchmaking which cover them."""
    opp = _resolve_opportunity(tc, opportunity)
    if opp is None:
        return {"error": "not_found"}
    onto = default_ontology()
    mine = set(
        tc.session.scalars(select(CompanyCapability.concept_id).where(CompanyCapability.org_id == tc.ctx.org_id)).all()
    )
    needs = [c["concept_id"] for c in (opp.concepts or []) if c.get("weight", 0) > 0]
    gaps = [n for n in needs if not any(onto.similarity(n, m) >= 0.6 for m in mine)]
    partners: list[dict[str, Any]] = []
    if gaps:
        # Cross-tenant read limited to consenting companies and to capability labels only (spec §32).
        with system_session() as sys:
            rows = sys.execute(
                select(Company.trade_name, Company.legal_name, CompanyCapability.concept_id)
                .join(CompanyCapability, CompanyCapability.company_id == Company.id)
                .where(Company.matchmaking_consent.is_(True), Company.org_id != tc.ctx.org_id)
            ).all()
        found: dict[str, set[str]] = {}
        for trade, legal, concept in rows:
            if any(onto.similarity(g, concept) >= 0.6 for g in gaps):
                found.setdefault(trade or legal, set()).add(concept_label(concept, tc.lang))
        partners = [{"name": k, "covers": sorted(v)} for k, v in found.items()][:5]
    return {
        "title": opp.title,
        "href": f"/opportunities/{opp.id}",
        "gaps": [concept_label(g, tc.lang) for g in gaps],
        "partners": partners,
        "note": "Only companies that opted in to matchmaking are shown; introductions require their consent.",
    }


def market_winners(tc: ToolContext, query: str | None = None, months: int = 36) -> dict[str, Any]:
    """Firms that won public contracts (official award notices), optionally about a subject (e.g. "solaire")."""
    from forsa.services import market

    since = utcnow() - timedelta(days=30 * max(1, min(months, 120)))
    awards = market._awards(tc.session, since, query)
    firms: dict[str, dict[str, Any]] = {}
    for o, buyer, _ in awards:
        for w in (o.attributes or {}).get("winners") or []:
            if w.get("type") != "firm" or not w.get("name"):
                continue
            e = firms.setdefault(w["name"], {"name": w["name"], "wins": 0, "buyers": set()})
            e["wins"] += 1
            if buyer:
                e["buyers"].add(buyer)
    top = sorted(firms.values(), key=lambda e: -e["wins"])[:6]
    return {
        "query": query,
        "awards": len(awards),
        "items": [
            {"name": e["name"], "wins": e["wins"], "buyers": sorted(e["buyers"])[:2], "href": "/market"} for e in top
        ],
        "recent": [
            {
                "title": o.title,
                "buyer": b,
                "winners": [w.get("name") for w in (o.attributes or {}).get("winners") or []],
            }
            for o, b, _ in awards[:3]
        ],
        "note": "From official award notices (World Bank, ARMP).",
    }


def check_red_list(tc: ToolContext, name: str | None = None) -> dict[str, Any]:
    """Is a company on the ARMP red list (excluded from public procurement)? A match is a signal to verify."""
    from forsa.services import debarments

    if not name:
        from forsa.db.models import Debarment

        rows = tc.session.scalars(select(Debarment).order_by(Debarment.effective_date.desc().nulls_last())).all()
        return {
            "name": None,
            "count": len(rows),
            "items": [{"name": d.entity_name, "href": "/market"} for d in rows[:5]],
        }
    return {"name": name, "matches": debarments.check(tc.session, name), "href": "/market"}


ACTIONS = {"start_bid", "mark_irrelevant", "create_task", "open_opportunity"}


def propose_action(
    tc: ToolContext, action: str, opportunity: str | None = None, title: str | None = None
) -> dict[str, Any]:
    """Never executes anything: returns a card that the human must confirm in the UI (spec §39)."""
    if action not in ACTIONS:
        return {"error": "unknown_action"}
    opp = _resolve_opportunity(tc, opportunity)
    card: dict[str, Any] = {"type": action, "requires_confirmation": True}
    if opp is not None:
        card.update({"opportunity_id": str(opp.id), "opportunity_title": opp.title, "href": f"/opportunities/{opp.id}"})
    if action == "create_task":
        card["title"] = (title or (f"Préparer : {opp.title}" if opp else "Nouvelle tâche"))[:200]
    return {"action": card}


def _p(**props: Any) -> dict[str, Any]:
    return {"type": "object", "properties": props, "additionalProperties": False}


_OPP = {
    "type": "string",
    "description": "Opportunity id, reference (e.g. DEMO-2026-002) or part of its title. "
    "Omit to use the opportunity the user is currently viewing.",
}

TOOLS: dict[str, tuple[Callable[..., dict[str, Any]], ToolSpec]] = {
    "search_opportunities": (
        search_opportunities,
        ToolSpec(
            "search_opportunities",
            "Search open opportunities (tenders, RFQs, EOIs, plan items) with the company's fit.",
            _p(
                query={"type": "string"},
                concepts={
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Capability concept ids from the FORSA ontology",
                },
                region={"type": "string"},
                category={"type": "string", "enum": ["works", "goods", "services", "consulting"]},
                max_value={"type": "number"},
                max_days_left={"type": "number"},
                min_fit={"type": "integer"},
                exclude_no_bid={"type": "boolean"},
                limit={"type": "integer"},
            ),
        ),
    ),
    "top_recommendations": (
        top_recommendations,
        ToolSpec(
            "top_recommendations",
            "The company's best current opportunities (BID / BID WITH CONDITIONS / early signals).",
            _p(limit={"type": "integer"}),
        ),
    ),
    "upcoming_deadlines": (
        upcoming_deadlines,
        ToolSpec("upcoming_deadlines", "Relevant opportunities closing within N days.", _p(days={"type": "integer"})),
    ),
    "get_opportunity": (
        get_opportunity,
        ToolSpec("get_opportunity", "Details, fit, conditions and why-now for one opportunity.", _p(opportunity=_OPP)),
    ),
    "explain_recommendation": (
        explain_recommendation,
        ToolSpec(
            "explain_recommendation",
            "Why FORSA recommends BID / NO-BID etc.: reasons, gates, evidence quotes.",
            _p(opportunity=_OPP),
        ),
    ),
    "list_requirements": (
        list_requirements,
        ToolSpec(
            "list_requirements", "Extracted requirements of an opportunity with page citations.", _p(opportunity=_OPP)
        ),
    ),
    "get_company_profile": (
        get_company_profile,
        ToolSpec("get_company_profile", "The company's Business Twin: capabilities, credentials, references.", _p()),
    ),
    "get_briefing": (
        get_briefing,
        ToolSpec("get_briefing", "Today's briefing: counts, top action, missing items.", _p()),
    ),
    "find_partners": (
        find_partners,
        ToolSpec(
            "find_partners",
            "Capability gaps for an opportunity and consenting partner companies that cover them.",
            _p(opportunity=_OPP),
        ),
    ),
    "market_winners": (
        market_winners,
        ToolSpec(
            "market_winners",
            "Firms that won public contracts (official award notices), optionally about a subject such as 'solaire'.",
            _p(query={"type": "string"}, months={"type": "integer"}),
        ),
    ),
    "check_red_list": (
        check_red_list,
        ToolSpec(
            "check_red_list",
            "Check whether a company is on the ARMP red list (excluded from public procurement), or list it.",
            _p(name={"type": "string"}),
        ),
    ),
    "propose_action": (
        propose_action,
        ToolSpec(
            "propose_action",
            "Propose (never execute) an action the user can confirm: start_bid, mark_irrelevant, "
            "create_task, open_opportunity.",
            _p(action={"type": "string", "enum": sorted(ACTIONS)}, opportunity=_OPP, title={"type": "string"}),
        ),
    ),
}


def run_tool(tc: ToolContext, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    entry = TOOLS.get(name)
    if entry is None:
        return {"error": f"unknown tool {name}"}
    fn, spec = entry
    allowed = set(spec.parameters.get("properties", {}))
    args = {k: v for k, v in (arguments or {}).items() if k in allowed}
    try:
        return fn(tc, **args)
    except (TypeError, ValueError) as exc:
        return {"error": f"invalid arguments: {exc}"}


def citations_from(result: dict[str, Any]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    raw_items = result.get("items")
    items: list[Any] = raw_items if isinstance(raw_items, list) else []
    for it in [result, *items]:
        if isinstance(it, dict) and it.get("href") and (it.get("title") or it.get("name")):
            out.append({"label": str(it.get("title") or it.get("name"))[:120], "href": it["href"]})
    return out


def numbers(text: str) -> set[str]:
    return {
        n.replace(",", ".").rstrip("0").rstrip(".") if "." in n else n
        for n in re.findall(r"\d+(?:[.,]\d+)?", re.sub(r"(?<=\d)[\s  ](?=\d{3})", "", text or ""))
    }
