"""Persist match results (Phase 6). History is appended whenever a decision-relevant value changes."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import ColumnElement, and_, or_, select
from sqlalchemy.orm import Session

from forsa.db.models import Company, Match, MatchHistory, Opportunity, OpportunityEvent
from forsa.kernel.clock import utcnow
from forsa.kernel.hashing import content_hash
from forsa.matching.engine import MatchingEngine
from forsa.matching.profiles import OPEN_STATES, Lifecycle
from forsa.services.events import emit
from forsa.services.notifications import notify
from forsa.services.profiles import company_profile, opportunity_profile

RELEVANCE_MIN = 0.25  # minimum capability score to create a *new* match row
NOTIFY_FIT = 70
MATCHABLE = [s.value for s in OPEN_STATES] + [Lifecycle.PLANNED.value]
# A notice whose deadline could not be read is presumed closed once it is this old (shown again with filters).
UNDATED_MAX_AGE = timedelta(days=90)


def still_open(now: datetime) -> ColumnElement[bool]:
    """Deadline in the future, or unknown deadline on a recent notice (never an old undated one)."""
    return or_(
        Opportunity.deadline_at > now,
        and_(
            Opportunity.deadline_at.is_(None),
            or_(
                Opportunity.status == Lifecycle.PLANNED.value,
                Opportunity.published_at.is_(None),
                Opportunity.published_at > now - UNDATED_MAX_AGE,
            ),
        ),
    )


def match_pair(
    session: Session,
    engine: MatchingEngine,
    company: Company,
    opp: Opportunity,
    now: datetime | None = None,
    force: bool = False,
) -> Match | None:
    now = now or utcnow()
    result = engine.evaluate(opportunity_profile(session, opp), company_profile(session, company), now)
    capability = next(c for c in result.components if c.name == "capability")
    existing = session.scalar(select(Match).where(Match.company_id == company.id, Match.opportunity_id == opp.id))
    if existing is None and not force and (capability.known == 0 or capability.score < RELEVANCE_MIN):
        return None
    data = result.as_dict()
    stable = {k: v for k, v in data.items() if k != "computed_at"}
    digest = content_hash(stable)
    if existing is None:
        match = Match(
            org_id=company.org_id,
            company_id=company.id,
            opportunity_id=opp.id,
            opportunity_version=opp.current_version,
            scoring_version=result.scoring_version,
            fit_score=result.fit_score,
            recommendation=result.recommendation.value,
            data_completeness=result.data_completeness,
            result=data,
            result_hash=digest,
            computed_at=now,
        )
        session.add(match)
        session.flush()
        emit(
            session,
            "MatchCreated",
            "match",
            match.id,
            {"opportunity_id": str(opp.id), "fit": result.fit_score, "recommendation": match.recommendation},
            key=f"match-created:{match.id}",
            org_id=company.org_id,
        )
        if result.fit_score >= NOTIFY_FIT and match.recommendation != "NO_BID":
            notify(
                session,
                company.org_id,
                "high_fit_opportunity",
                opp.title,
                key=f"notif:high_fit:{match.id}",
                payload={
                    "opportunity_id": str(opp.id),
                    "match_id": str(match.id),
                    "fit": result.fit_score,
                    "recommendation": match.recommendation,
                },
            )
        elif opp.status == "PLANNED" and match.recommendation != "NO_BID":
            notify(
                session,
                company.org_id,
                "early_signal",
                opp.title,
                key=f"notif:early:{match.id}",
                payload={"opportunity_id": str(opp.id), "match_id": str(match.id), "fit": result.fit_score},
            )
        return match
    decision_changed = (
        existing.fit_score,
        existing.recommendation,
        existing.opportunity_version,
        existing.scoring_version,
    ) != (result.fit_score, result.recommendation.value, opp.current_version, result.scoring_version)
    if existing.opportunity_version != opp.current_version and existing.status != "DISMISSED":
        changes = sorted(
            set(
                session.scalars(
                    select(OpportunityEvent.event_type).where(
                        OpportunityEvent.opportunity_id == opp.id, OpportunityEvent.version == opp.current_version
                    )
                ).all()
            )
        )
        urgent = {"CANCELLED", "DEADLINE_SHORTENED", "AWARDED"} & set(changes)
        notify(
            session,
            company.org_id,
            "tender_change",
            opp.title,
            key=f"notif:change:{existing.id}:v{opp.current_version}",
            payload={
                "opportunity_id": str(opp.id),
                "match_id": str(existing.id),
                "changes": changes,
                "version": opp.current_version,
            },
            priority="high" if urgent else "normal",
        )
    if decision_changed:
        session.add(
            MatchHistory(
                org_id=existing.org_id,
                match_id=existing.id,
                opportunity_version=existing.opportunity_version,
                scoring_version=existing.scoring_version,
                fit_score=existing.fit_score,
                recommendation=existing.recommendation,
                result=existing.result,
                computed_at=existing.computed_at,
            )
        )
    existing.opportunity_version, existing.scoring_version = opp.current_version, result.scoring_version
    existing.fit_score, existing.recommendation = result.fit_score, result.recommendation.value
    existing.data_completeness, existing.result, existing.result_hash = result.data_completeness, data, digest
    existing.computed_at = now
    return existing


def rematch_opportunity(session: Session, engine: MatchingEngine, opportunity_id: uuid.UUID) -> int:
    """System context: evaluate one opportunity against every company twin."""
    opp = session.get(Opportunity, opportunity_id)
    if opp is None or opp.kind == "AWARD":  # awards are market intelligence, not something to bid on
        return 0
    count = 0
    for company in session.scalars(select(Company)).all():
        if match_pair(session, engine, company, opp):
            count += 1
    return count


def rematch_company(session: Session, engine: MatchingEngine, company_id: uuid.UUID) -> int:
    company = session.get(Company, company_id)
    if company is None:
        return 0
    now = utcnow()
    opps = session.scalars(
        select(Opportunity).where(
            Opportunity.status.in_(MATCHABLE),
            Opportunity.kind != "AWARD",
            still_open(now),
            Opportunity.analyzed_version.is_not(None),
        )
    ).all()
    return sum(1 for opp in opps if match_pair(session, engine, company, opp, now))
