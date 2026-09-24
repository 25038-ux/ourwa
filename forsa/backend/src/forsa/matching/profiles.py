"""Typed inputs and outputs of the matching engine.

The engine is a *pure function* of (OpportunityProfile, CompanyProfile, now,
ScoringConfig). Persistence adapters build these profiles; the engine never
touches the database, the network or an LLM (ADR-004, ADR-005).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any

from forsa.kernel.epistemics import Epistemic, Truth, Verification


class Lifecycle(StrEnum):
    PLANNED = "PLANNED"
    PUBLISHED = "PUBLISHED"
    CLARIFICATION = "CLARIFICATION"
    EXTENDED = "EXTENDED"
    CLOSED = "CLOSED"
    EVALUATION = "EVALUATION"
    PROVISIONAL_AWARD = "PROVISIONAL_AWARD"
    FINAL_AWARD = "FINAL_AWARD"
    CANCELLED = "CANCELLED"


OPEN_STATES = frozenset({Lifecycle.PUBLISHED, Lifecycle.CLARIFICATION, Lifecycle.EXTENDED})


class ReqKind(StrEnum):
    CREDENTIAL = "CREDENTIAL"
    EXPERIENCE = "EXPERIENCE"
    FINANCIAL_TURNOVER = "FINANCIAL_TURNOVER"
    REGISTRATION_COUNTRY = "REGISTRATION_COUNTRY"
    OTHER = "OTHER"


class GateOutcome(StrEnum):
    PASS = "PASS"
    GAP = "GAP"  # not met today, but remediable (obtain / partner / confirm)
    FAIL = "FAIL"  # disqualifying
    UNKNOWN = "UNKNOWN"  # insufficient evidence either way


class CredentialStatus(StrEnum):
    HELD = "HELD"
    IN_PROGRESS = "IN_PROGRESS"
    ABSENT = "ABSENT"  # explicitly declared absent by the company


class Recommendation(StrEnum):
    BID = "BID"
    BID_WITH_CONDITIONS = "BID_WITH_CONDITIONS"
    REVIEW = "REVIEW"
    NO_BID = "NO_BID"


@dataclass(frozen=True, slots=True)
class EvidenceRef:
    """Pointer to *why* we believe something. ``evidence_id`` links to the evidence table."""

    epistemic: Epistemic
    quote: str | None = None
    locator: str | None = None
    evidence_id: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "epistemic": self.epistemic.value,
            "quote": self.quote,
            "locator": self.locator,
            "evidence_id": self.evidence_id,
        }


# ── Opportunity side ─────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class ConceptNeed:
    concept_id: str
    weight: float
    evidence: EvidenceRef | None = None


@dataclass(frozen=True, slots=True)
class RequirementSpec:
    id: str
    kind: ReqKind
    mandatory: bool
    text: str
    credential_id: str | None = None
    min_count: int | None = None
    concept_ids: tuple[str, ...] = ()
    min_amount: float | None = None
    currency: str | None = None
    country: str | None = None
    evidence: EvidenceRef | None = None
    verification: Verification = Verification.UNVERIFIED


@dataclass(frozen=True, slots=True)
class OpportunityProfile:
    id: str
    title: str
    status: Lifecycle
    category: str | None = None  # works | goods | services | consulting
    country: str | None = None
    region: str | None = None
    buyer_id: str | None = None
    estimated_value: float | None = None
    currency: str | None = None
    published_at: datetime | None = None
    deadline_at: datetime | None = None
    concepts: tuple[ConceptNeed, ...] = ()
    requirements: tuple[RequirementSpec, ...] = ()
    consortium_allowed: bool | None = None
    is_synthetic: bool = False


# ── Company side (the "Business Twin" projection used for matching) ─────────


@dataclass(frozen=True, slots=True)
class CapabilityClaim:
    concept_id: str
    epistemic: Epistemic = Epistemic.USER_CLAIM
    verification: Verification = Verification.UNVERIFIED
    evidence_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class CredentialClaim:
    credential_id: str
    status: CredentialStatus = CredentialStatus.HELD
    valid_until: datetime | None = None
    epistemic: Epistemic = Epistemic.USER_CLAIM
    verification: Verification = Verification.UNVERIFIED
    evidence_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ProjectClaim:
    id: str
    title: str
    concept_ids: tuple[str, ...]
    buyer_id: str | None = None
    value: float | None = None
    currency: str | None = None
    year: int | None = None
    region: str | None = None
    epistemic: Epistemic = Epistemic.USER_CLAIM
    verification: Verification = Verification.UNVERIFIED
    evidence_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class CompanyProfile:
    id: str
    name: str
    country: str | None = None
    regions_served: frozenset[str] = frozenset()  # empty = unknown, "*" = nationwide
    capabilities: tuple[CapabilityClaim, ...] = ()
    credentials: tuple[CredentialClaim, ...] = ()
    projects: tuple[ProjectClaim, ...] = ()
    excluded_concepts: frozenset[str] = frozenset()
    excluded_regions: frozenset[str] = frozenset()
    strategic_concepts: frozenset[str] = frozenset()
    max_project_value: float | None = None
    annual_turnover: float | None = None
    currency: str | None = None
    staff_count: int | None = None
    active_bids: int = 0
    max_parallel_bids: int | None = None
    daily_bid_cost: float | None = None
    gross_margin_pct: float | None = None

    def credential(self, credential_id: str) -> CredentialClaim | None:
        return next((c for c in self.credentials if c.credential_id == credential_id), None)


# ── Outputs ──────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class Reason:
    code: str
    polarity: str  # "+" supports, "-" against, "?" uncertainty
    params: dict[str, Any] = field(default_factory=dict)
    evidence: list[EvidenceRef] = field(default_factory=list)
    epistemic: Epistemic = Epistemic.DERIVED

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "polarity": self.polarity,
            "params": self.params,
            "evidence": [e.as_dict() for e in self.evidence],
            "epistemic": self.epistemic.value,
        }


@dataclass(slots=True)
class GateResult:
    gate: str
    outcome: GateOutcome
    truth: Truth
    mandatory: bool
    reason: Reason
    remediation: str | None = None  # code of the remediation (obtain, partner, confirm, renew, …)
    requirement_id: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "gate": self.gate,
            "outcome": self.outcome.value,
            "truth": self.truth.value,
            "mandatory": self.mandatory,
            "reason": self.reason.as_dict(),
            "remediation": self.remediation,
            "requirement_id": self.requirement_id,
        }


@dataclass(slots=True)
class Component:
    name: str
    weight: float
    score: float  # 0..1 (prior used when unknown)
    known: float  # 0..1 — share of this component backed by data
    reasons: list[Reason] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "weight": self.weight,
            "score": round(self.score * 100),
            "known": round(self.known, 2),
            "reasons": [r.as_dict() for r in self.reasons],
        }


@dataclass(slots=True)
class Risk:
    category: str  # legal | commercial | delivery | capacity | deadline | documentation | ambiguity | pricing
    level: str  # LOW | MEDIUM | HIGH
    reason: Reason

    def as_dict(self) -> dict[str, Any]:
        return {"category": self.category, "level": self.level, "reason": self.reason.as_dict()}


@dataclass(slots=True)
class Range:
    low: float
    high: float

    def as_dict(self) -> dict[str, float]:
        return {"low": round(self.low, 2), "high": round(self.high, 2)}


@dataclass(slots=True)
class Economics:
    currency: str | None
    effort_days: Range
    bid_cost: Range | None
    contract_value: Range | None
    contribution: Range | None
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "currency": self.currency,
            "effort_days": self.effort_days.as_dict(),
            "bid_cost": self.bid_cost.as_dict() if self.bid_cost else None,
            "contract_value": self.contract_value.as_dict() if self.contract_value else None,
            "contribution": self.contribution.as_dict() if self.contribution else None,
            "notes": self.notes,
            "epistemic": Epistemic.DERIVED.value,
        }


@dataclass(slots=True)
class MatchResult:
    scoring_version: str
    fit_score: int
    data_completeness: float
    recommendation: Recommendation
    recommendation_reasons: list[Reason]
    conditions: list[Reason]
    gates: list[GateResult]
    components: list[Component]
    risks: list[Risk]
    why_now: list[Reason]
    economics: Economics
    computed_at: datetime
    requires_human_decision: bool = True

    def as_dict(self) -> dict[str, Any]:
        return {
            "scoring_version": self.scoring_version,
            "fit_score": self.fit_score,
            "data_completeness": round(self.data_completeness, 2),
            "recommendation": self.recommendation.value,
            "recommendation_reasons": [r.as_dict() for r in self.recommendation_reasons],
            "conditions": [r.as_dict() for r in self.conditions],
            "gates": [g.as_dict() for g in self.gates],
            "components": [c.as_dict() for c in self.components],
            "risks": [r.as_dict() for r in self.risks],
            "why_now": [r.as_dict() for r in self.why_now],
            "economics": self.economics.as_dict(),
            "computed_at": self.computed_at.isoformat(),
            "requires_human_decision": self.requires_human_decision,
        }
