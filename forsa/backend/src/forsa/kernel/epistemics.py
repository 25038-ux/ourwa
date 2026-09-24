"""Epistemic vocabulary shared by every module.

These enums are the backbone of the evidence-first architecture (ADR-004):
every intelligence output says *what kind of knowledge* it is, *how sure* we
are, and *who has verified it*. Missing evidence is never silently converted
into a negative fact — it becomes ``Truth.NOT_FOUND`` or ``Truth.UNKNOWN``.
"""

from __future__ import annotations

from enum import StrEnum


class Epistemic(StrEnum):
    """What kind of statement this is (spec §71)."""

    FACT = "FACT"  # directly supported by a source
    DERIVED = "DERIVED"  # calculated deterministically from facts
    INFERENCE = "INFERENCE"  # AI / heuristic interpretation — never evidence
    FORECAST = "FORECAST"  # model prediction
    USER_CLAIM = "USER_CLAIM"  # provided by the company, not yet verified


class Confidence(StrEnum):
    """Evidence confidence (spec §24)."""

    VERIFIED = "VERIFIED"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    UNKNOWN = "UNKNOWN"
    CONFLICTING = "CONFLICTING"


class Verification(StrEnum):
    UNVERIFIED = "UNVERIFIED"
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"
    NEEDS_REVIEW = "NEEDS_REVIEW"


class Truth(StrEnum):
    """Status of a checked condition (spec §4.3 "Unknowns")."""

    CONFIRMED = "CONFIRMED"
    NOT_FOUND = "NOT_FOUND"  # we looked and found nothing — NOT "does not exist"
    CONFLICTING = "CONFLICTING"
    UNKNOWN = "UNKNOWN"
    NEEDS_HUMAN = "NEEDS_HUMAN"


def claim_weight(epistemic: Epistemic, verification: Verification) -> float:
    """How much a company claim counts in scoring.

    Verified facts count fully, unverified user claims partially, AI inferences
    not at all (spec §7: "Never treat AI inference as evidence").
    """
    if verification == Verification.REJECTED:
        return 0.0
    if epistemic in (Epistemic.INFERENCE, Epistemic.FORECAST):
        return 0.0
    if verification == Verification.VERIFIED:
        return 1.0
    return 0.8
