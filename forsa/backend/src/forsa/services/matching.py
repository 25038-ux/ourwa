"""Persist match results (Phase 6). History is appended whenever a decision-relevant value changes."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from forsa.db.models import Company, Match, MatchHistory, Notification, Opportunity
from forsa.kernel.clock import utcnow
from forsa.kernel.hashing import content_hash
from forsa.matching.engine import MatchingEngine
from forsa.matching.profiles import OPEN_STATES, Lifecycle
from forsa.services.events import emit
from forsa.services.profiles import company_profile, opportunity_profile

RELEVANCE_MIN = 0.25  # minimum capability score to create a *new* match row
NOTIFY_FIT = 70
MATCHABLE = [s.value for s in OPEN_STATES] + [Lifecycle.PLANNED.value]


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
            session.execute(
                insert(Notification)
                .values(
                    id=uuid.uuid4(),
                    org_id=company.org_id,
                    category="high_fit_opportunity",
                    title=opp.title[:300],
                    body=None,
                    payload={
                        "opportunity_id": str(opp.id),
                        "match_id": str(match.id),
                        "fit": result.fit_score,
                        "recommendation": match.recommendation,
                    },
                    idempotency_key=f"notif:high_fit:{match.id}",
                )
                .on_conflict_do_nothing(index_elements=["idempotency_key"])
            )
        return match
    decision_changed = (
        existing.fit_score,
        existing.recommendation,
        existing.opportunity_version,
        existing.scoring_version,
    ) != (result.fit_score, result.recommendation.value, opp.current_version, result.scoring_version)
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
    if opp is None:
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
            or_(Opportunity.deadline_at.is_(None), Opportunity.deadline_at > now),
            Opportunity.analyzed_version.is_not(None),
        )
    ).all()
    return sum(1 for opp in opps if match_pair(session, engine, company, opp, now))
