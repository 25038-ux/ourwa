from __future__ import annotations

import uuid
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(min_length=1, max_length=200)


class CompanyUpdate(BaseModel):
    legal_name: str | None = Field(default=None, max_length=300)
    trade_name: str | None = Field(default=None, max_length=300)
    registration_number: str | None = Field(default=None, max_length=100)
    legal_form: str | None = Field(default=None, max_length=60)
    country: str | None = Field(default=None, min_length=2, max_length=2)
    address: str | None = Field(default=None, max_length=2000)
    regions_served: list[str] | None = None
    excluded_concepts: list[str] | None = None
    excluded_regions: list[str] | None = None
    strategic_concepts: list[str] | None = None
    max_project_value: float | None = Field(default=None, ge=0)
    annual_turnover: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    staff_count: int | None = Field(default=None, ge=0)
    max_parallel_bids: int | None = Field(default=None, ge=1)
    daily_bid_cost: float | None = Field(default=None, ge=0)
    gross_margin_pct: float | None = Field(default=None, ge=-100, le=100)
    matchmaking_consent: bool | None = None


class CapabilityIn(BaseModel):
    concept_id: str = Field(max_length=80)
    note: str | None = Field(default=None, max_length=2000)


class CredentialIn(BaseModel):
    credential_id: str = Field(max_length=80)
    status: Literal["HELD", "IN_PROGRESS", "ABSENT"] = "HELD"
    valid_until: date | None = None


class ProjectIn(BaseModel):
    title: str = Field(max_length=500)
    client_name: str | None = Field(default=None, max_length=300)
    concept_ids: list[str] = []
    value: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    year: int | None = Field(default=None, ge=1950, le=2100)
    region: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=5000)


class VerifyIn(BaseModel):
    claim_type: Literal["capability", "credential", "project"]
    claim_id: uuid.UUID
    evidence_ids: list[uuid.UUID]


class MatchPatch(BaseModel):
    status: Literal["NEW", "VIEWED", "DISMISSED"]


class BidIn(BaseModel):
    opportunity_id: uuid.UUID


class DecisionIn(BaseModel):
    decision: Literal["BID", "NO_BID"]
    rationale: str | None = Field(default=None, max_length=5000)


class CompliancePatch(BaseModel):
    status: Literal["NOT_STARTED", "IN_PROGRESS", "COMPLETE", "MISSING", "NEEDS_VERIFICATION", "BLOCKED"] | None = None
    response: str | None = Field(default=None, max_length=20000)
    owner_user_id: uuid.UUID | None = None
    reviewer_user_id: uuid.UUID | None = None
    risk: Literal["LOW", "MEDIUM", "HIGH"] | None = None


class ApprovalIn(BaseModel):
    action: Literal[
        "FINAL_SUBMISSION", "CONTACT_BUYER", "CONSORTIUM_REQUEST", "PUBLISH_COMPANY_INFO", "SEND_OFFICIAL_DOCUMENTS"
    ] = "FINAL_SUBMISSION"
    note: str | None = Field(default=None, max_length=5000)


class ApprovalDecisionIn(BaseModel):
    approve: bool
    note: str | None = Field(default=None, max_length=5000)


class OutcomeIn(BaseModel):
    outcome: Literal["WON", "LOST", "CANCELLED"]
    note: str | None = Field(default=None, max_length=5000)


class FeedbackIn(BaseModel):
    subject_type: Literal["match", "requirement", "opportunity"]
    subject_id: uuid.UUID
    label: Literal["correct", "incorrect", "irrelevant", "missing_information", "outdated", "wrong_capability"]
    comment: str | None = Field(default=None, max_length=5000)
