"""Adapters: database rows → matching-engine profiles."""

from __future__ import annotations

from datetime import UTC, datetime, time

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from forsa.db.models import (
    Bid,
    Company,
    CompanyCapability,
    CompanyCredential,
    CompanyProject,
    Opportunity,
    Requirement,
)
from forsa.kernel.epistemics import Epistemic, Verification
from forsa.matching.profiles import (
    CapabilityClaim,
    CompanyProfile,
    ConceptNeed,
    CredentialClaim,
    CredentialStatus,
    EvidenceRef,
    Lifecycle,
    OpportunityProfile,
    ProjectClaim,
    ReqKind,
    RequirementSpec,
)

ACTIVE_BID_STATES = ("QUALIFYING", "PURSUING", "IN_REVIEW", "APPROVED")


def _f(v: object) -> float | None:
    return float(v) if v is not None else None  # type: ignore[arg-type]


def requirement_specs(row: Requirement) -> list[RequirementSpec]:
    p = row.params or {}
    section = " › ".join(row.heading_path or []) or "—"
    ev = EvidenceRef(
        Epistemic.FACT,
        quote=row.text[:300],
        locator=f"p.{row.page} § {section}" if row.page else section,
        evidence_id=str(row.evidence_id) if row.evidence_id else None,
    )
    mandatory = row.type == "mandatory"
    verification = Verification(row.verification)
    specs = [
        RequirementSpec(
            f"{row.id}:{c}",
            ReqKind.CREDENTIAL,
            mandatory,
            row.text,
            credential_id=c,
            evidence=ev,
            verification=verification,
        )
        for c in p.get("credential_ids", [])
    ]
    if row.category == "experience" or p.get("min_count"):
        specs.append(
            RequirementSpec(
                str(row.id),
                ReqKind.EXPERIENCE,
                mandatory,
                row.text,
                min_count=p.get("min_count"),
                evidence=ev,
                verification=verification,
            )
        )
    if row.category == "financial" and p.get("min_amount") and p.get("is_turnover"):
        specs.append(
            RequirementSpec(
                str(row.id),
                ReqKind.FINANCIAL_TURNOVER,
                mandatory,
                row.text,
                min_amount=p["min_amount"],
                currency=p.get("currency"),
                evidence=ev,
                verification=verification,
            )
        )
    return specs


def opportunity_profile(session: Session, opp: Opportunity) -> OpportunityProfile:
    reqs = session.scalars(select(Requirement).where(Requirement.opportunity_id == opp.id)).all()
    specs = tuple(s for r in reqs for s in requirement_specs(r))
    concepts = tuple(
        ConceptNeed(
            c["concept_id"],
            float(c["weight"]),
            EvidenceRef(Epistemic.FACT, quote=c.get("quote"), locator=c.get("locator")),
        )
        for c in (opp.concepts or [])
    )
    return OpportunityProfile(
        id=str(opp.id),
        title=opp.title,
        status=Lifecycle(opp.status),
        category=opp.category,
        country=opp.country,
        region=opp.region,
        buyer_id=str(opp.buyer_id) if opp.buyer_id else None,
        estimated_value=_f(opp.estimated_value),
        currency=opp.currency,
        published_at=opp.published_at,
        deadline_at=opp.deadline_at,
        concepts=concepts,
        requirements=specs,
        consortium_allowed=opp.consortium_allowed,
        is_synthetic=opp.is_synthetic,
    )


def company_profile(session: Session, company: Company) -> CompanyProfile:
    caps = session.scalars(select(CompanyCapability).where(CompanyCapability.company_id == company.id)).all()
    creds = session.scalars(select(CompanyCredential).where(CompanyCredential.company_id == company.id)).all()
    projects = session.scalars(select(CompanyProject).where(CompanyProject.company_id == company.id)).all()
    active = (
        session.scalar(
            select(func.count()).select_from(Bid).where(Bid.company_id == company.id, Bid.status.in_(ACTIVE_BID_STATES))
        )
        or 0
    )
    return CompanyProfile(
        id=str(company.id),
        name=company.legal_name,
        country=company.country,
        regions_served=frozenset(company.regions_served or []),
        capabilities=tuple(
            CapabilityClaim(
                c.concept_id,
                Epistemic(c.epistemic),
                Verification(c.verification),
                tuple(map(str, c.evidence_ids or [])),
            )
            for c in caps
        ),
        credentials=tuple(
            CredentialClaim(
                c.credential_id,
                CredentialStatus(c.status),
                datetime.combine(c.valid_until, time.max, UTC) if c.valid_until else None,
                Epistemic(c.epistemic),
                Verification(c.verification),
                tuple(map(str, c.evidence_ids or [])),
            )
            for c in creds
        ),
        projects=tuple(
            ProjectClaim(
                str(p.id),
                p.title,
                tuple(p.concept_ids or []),
                str(p.buyer_id) if p.buyer_id else None,
                _f(p.value),
                p.currency,
                p.year,
                p.region,
                Epistemic(p.epistemic),
                Verification(p.verification),
                tuple(map(str, p.evidence_ids or [])),
            )
            for p in projects
        ),
        excluded_concepts=frozenset(company.excluded_concepts or []),
        excluded_regions=frozenset(company.excluded_regions or []),
        strategic_concepts=frozenset(company.strategic_concepts or []),
        max_project_value=_f(company.max_project_value),
        annual_turnover=_f(company.annual_turnover),
        currency=company.currency,
        staff_count=company.staff_count,
        active_bids=int(active),
        max_parallel_bids=company.max_parallel_bids,
        daily_bid_cost=_f(company.daily_bid_cost),
        gross_margin_pct=company.gross_margin_pct,
    )
