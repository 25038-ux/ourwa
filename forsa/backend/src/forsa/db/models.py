"""Canonical relational schema (spec §88, ADR-002/004/007).

Conventions
* UUID primary keys, ``created_at``/``updated_at`` everywhere.
* ``org_id`` marks tenant-owned rows. Tables listed in ``TENANT_TABLES`` get
  Postgres row-level security in the migrations (fail-closed); tables in
  ``SHARED_OR_TENANT_TABLES`` allow ``org_id IS NULL`` for public data.
* Public intelligence (sources, opportunities, requirements…) has no org_id.
* History is never overwritten: opportunity_versions / opportunity_events /
  match_history / audit_events / domain_events are append-only.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from forsa.db.base import Base, Timestamps, uuid_pk

FK = ForeignKey

TENANT_TABLES = (
    "companies",
    "company_capabilities",
    "company_credentials",
    "company_projects",
    "matches",
    "match_history",
    "feedback",
    "bids",
    "bid_decisions",
    "compliance_items",
    "approval_requests",
    "notifications",
    "briefings",
    "tasks",
)
SHARED_OR_TENANT_TABLES = (
    "documents",
    "document_versions",
    "evidence",
    "assertions",
    "audit_events",
    "signals",
    "ai_requests",
)


# ── Identity & tenancy ──────────────────────────────────────────────────────
class Organization(Base, Timestamps):
    __tablename__ = "organizations"
    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    country: Mapped[str] = mapped_column(String(2), default="MR")
    plan: Mapped[str] = mapped_column(String(30), default="pilot")


class User(Base, Timestamps):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(320), unique=True)
    full_name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(300))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_platform_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    locale: Mapped[str] = mapped_column(String(5), default="fr")


class Membership(Base, Timestamps):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("org_id", "user_id"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(FK("organizations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(FK("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(30))


# ── Sources & ingestion ─────────────────────────────────────────────────────
class Source(Base, Timestamps):
    __tablename__ = "sources"
    id: Mapped[uuid.UUID] = uuid_pk()
    key: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    country: Mapped[str | None] = mapped_column(String(2))
    category: Mapped[str] = mapped_column(String(40))
    official_url: Mapped[str | None] = mapped_column(String(500))
    access_type: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(30))  # active | pending_verification | disabled
    connector: Mapped[str] = mapped_column(String(60))
    expected_frequency_hours: Mapped[int] = mapped_column(Integer, default=24)
    registry_entry: Mapped[dict[str, Any]] = mapped_column(default=dict)


class IngestionRun(Base):
    __tablename__ = "ingestion_runs"
    id: Mapped[uuid.UUID] = uuid_pk()
    source_id: Mapped[uuid.UUID] = mapped_column(FK("sources.id"), index=True)
    status: Mapped[str] = mapped_column(String(20))  # running | succeeded | partial | failed | blocked
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stats: Mapped[dict[str, Any]] = mapped_column(default=dict)
    error: Mapped[str | None] = mapped_column(Text)


class SourceSnapshot(Base):
    __tablename__ = "source_snapshots"
    __table_args__ = (UniqueConstraint("source_id", "canonical_url", "content_hash"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    source_id: Mapped[uuid.UUID] = mapped_column(FK("sources.id"), index=True)
    run_id: Mapped[uuid.UUID | None] = mapped_column(FK("ingestion_runs.id"))
    canonical_url: Mapped[str] = mapped_column(String(1000))
    external_ref: Mapped[str | None] = mapped_column(String(200))
    content_hash: Mapped[str] = mapped_column(String(64))
    content_type: Mapped[str | None] = mapped_column(String(120))
    storage_key: Mapped[str] = mapped_column(String(300))
    byte_size: Mapped[int] = mapped_column(BigInteger)
    etag: Mapped[str | None] = mapped_column(String(200))
    last_modified: Mapped[str | None] = mapped_column(String(100))
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


# ── Opportunities (public intelligence) ─────────────────────────────────────
class Buyer(Base, Timestamps):
    __tablename__ = "buyers"
    __table_args__ = (UniqueConstraint("country", "name_key"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(300))
    name_key: Mapped[str] = mapped_column(String(300))
    country: Mapped[str | None] = mapped_column(String(2))


class Opportunity(Base, Timestamps):
    """Projection of the latest OpportunityVersion. Core entity — not "Tender" (spec §5, Phase 15)."""

    __tablename__ = "opportunities"
    __table_args__ = (
        UniqueConstraint("source_id", "external_ref"),
        Index("ix_opportunities_status_deadline", "status", "deadline_at"),
        Index("ix_opportunities_title_trgm", "title", postgresql_using="gin", postgresql_ops={"title": "gin_trgm_ops"}),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    source_id: Mapped[uuid.UUID] = mapped_column(FK("sources.id"), index=True)
    external_ref: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(30))  # TENDER | RFQ | EOI | RFP | PLAN_ITEM | AWARD | GRANT | …
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    buyer_id: Mapped[uuid.UUID | None] = mapped_column(FK("buyers.id"), index=True)
    country: Mapped[str | None] = mapped_column(String(2))
    region: Mapped[str | None] = mapped_column(String(120))
    category: Mapped[str | None] = mapped_column(String(30))
    method: Mapped[str | None] = mapped_column(String(80))
    funding_source: Mapped[str | None] = mapped_column(String(200))
    currency: Mapped[str | None] = mapped_column(String(3))
    estimated_value: Mapped[float | None] = mapped_column(Numeric(20, 2))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(30))
    language: Mapped[str | None] = mapped_column(String(5))
    url: Mapped[str | None] = mapped_column(String(1000))
    consortium_allowed: Mapped[bool | None] = mapped_column(Boolean)
    concepts: Mapped[list[Any]] = mapped_column(default=list)  # [{concept_id, weight, quote, locator}]
    current_version: Mapped[int] = mapped_column(Integer, default=1)
    content_hash: Mapped[str] = mapped_column(String(64))
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    analyzed_version: Mapped[int | None] = mapped_column(Integer)


class OpportunityVersion(Base):
    __tablename__ = "opportunity_versions"
    __table_args__ = (UniqueConstraint("opportunity_id", "version"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    opportunity_id: Mapped[uuid.UUID] = mapped_column(FK("opportunities.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict[str, Any]] = mapped_column()
    snapshot_id: Mapped[uuid.UUID | None] = mapped_column(FK("source_snapshots.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OpportunityEvent(Base):
    __tablename__ = "opportunity_events"
    id: Mapped[uuid.UUID] = uuid_pk()
    opportunity_id: Mapped[uuid.UUID] = mapped_column(FK("opportunities.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    event_type: Mapped[str] = mapped_column(String(40))
    changes: Mapped[dict[str, Any]] = mapped_column(default=dict)
    idempotency_key: Mapped[str] = mapped_column(String(200), unique=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Requirement(Base):
    __tablename__ = "requirements"
    __table_args__ = (UniqueConstraint("opportunity_id", "external_key"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    opportunity_id: Mapped[uuid.UUID] = mapped_column(FK("opportunities.id", ondelete="CASCADE"), index=True)
    document_version_id: Mapped[uuid.UUID | None] = mapped_column(FK("document_versions.id"))
    external_key: Mapped[str] = mapped_column(String(80))
    text: Mapped[str] = mapped_column(Text)
    type: Mapped[str] = mapped_column(String(20))
    category: Mapped[str] = mapped_column(String(30))
    page: Mapped[int | None] = mapped_column(Integer)
    heading_path: Mapped[list[Any]] = mapped_column(default=list)
    char_start: Mapped[int | None] = mapped_column(Integer)
    char_end: Mapped[int | None] = mapped_column(Integer)
    params: Mapped[dict[str, Any]] = mapped_column(default=dict)
    evidence_id: Mapped[uuid.UUID | None] = mapped_column(FK("evidence.id"))
    extraction_method: Mapped[str] = mapped_column(String(40))
    confidence: Mapped[str] = mapped_column(String(20))
    verification: Mapped[str] = mapped_column(String(20), default="UNVERIFIED")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ── Documents & evidence ────────────────────────────────────────────────────
class Document(Base, Timestamps):
    __tablename__ = "documents"
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID | None] = mapped_column(FK("organizations.id", ondelete="CASCADE"), index=True)
    opportunity_id: Mapped[uuid.UUID | None] = mapped_column(FK("opportunities.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(500))
    kind: Mapped[str] = mapped_column(String(40))  # tender_document | company_evidence | …
    source_url: Mapped[str | None] = mapped_column(String(1000))


class DocumentVersion(Base):
    __tablename__ = "document_versions"
    __table_args__ = (UniqueConstraint("document_id", "content_hash"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID | None] = mapped_column(FK("organizations.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[uuid.UUID] = mapped_column(FK("documents.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(String(64))
    storage_key: Mapped[str] = mapped_column(String(300))
    content_type: Mapped[str] = mapped_column(String(40))
    byte_size: Mapped[int] = mapped_column(BigInteger)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    scan_status: Mapped[str] = mapped_column(String(20), default="NOT_SCANNED")
    extraction_status: Mapped[str] = mapped_column(String(20), default="PENDING")
    needs_ocr: Mapped[bool] = mapped_column(Boolean, default=False)
    risk_flags: Mapped[list[Any]] = mapped_column(default=list)  # e.g. prompt-injection markers
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DocumentChunk(Base):
    __tablename__ = "document_chunks"
    __table_args__ = (UniqueConstraint("document_version_id", "chunk_index"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    document_version_id: Mapped[uuid.UUID] = mapped_column(FK("document_versions.id", ondelete="CASCADE"), index=True)
    chunk_index: Mapped[int] = mapped_column(Integer)
    page: Mapped[int] = mapped_column(Integer)
    heading_path: Mapped[list[Any]] = mapped_column(default=list)
    kind: Mapped[str] = mapped_column(String(20))
    text: Mapped[str] = mapped_column(Text)
    char_start: Mapped[int] = mapped_column(Integer)
    char_end: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(String(64))


class Evidence(Base):
    """A citable pointer into a source (spec §9). Every external fact links here."""

    __tablename__ = "evidence"
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID | None] = mapped_column(FK("organizations.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30))  # source_snapshot | document | company_statement | human
    snapshot_id: Mapped[uuid.UUID | None] = mapped_column(FK("source_snapshots.id"))
    document_version_id: Mapped[uuid.UUID | None] = mapped_column(FK("document_versions.id"))
    url: Mapped[str | None] = mapped_column(String(1000))
    page: Mapped[int | None] = mapped_column(Integer)
    section: Mapped[str | None] = mapped_column(String(500))
    char_start: Mapped[int | None] = mapped_column(Integer)
    char_end: Mapped[int | None] = mapped_column(Integer)
    bbox: Mapped[dict[str, Any] | None] = mapped_column()
    quote: Mapped[str | None] = mapped_column(Text)
    content_hash: Mapped[str | None] = mapped_column(String(64))
    retrieved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    extraction_method: Mapped[str] = mapped_column(String(60))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Assertion(Base):
    """One edge of the evidence graph: (subject) –predicate→ value, with epistemic status (spec §8, §71)."""

    __tablename__ = "assertions"
    __table_args__ = (Index("ix_assertions_subject", "subject_type", "subject_id"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID | None] = mapped_column(FK("organizations.id", ondelete="CASCADE"), index=True)
    subject_type: Mapped[str] = mapped_column(String(40))
    subject_id: Mapped[uuid.UUID] = mapped_column()
    predicate: Mapped[str] = mapped_column(String(60))
    value: Mapped[dict[str, Any]] = mapped_column()
    epistemic: Mapped[str] = mapped_column(String(20))
    confidence: Mapped[str] = mapped_column(String(20))
    verification: Mapped[str] = mapped_column(String(20), default="UNVERIFIED")
    evidence_id: Mapped[uuid.UUID | None] = mapped_column(FK("evidence.id"))
    method: Mapped[str] = mapped_column(String(60))
    version: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ── Company Business Twin (tenant) ──────────────────────────────────────────
class Company(Base, Timestamps):
    __tablename__ = "companies"
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(FK("organizations.id", ondelete="CASCADE"), unique=True)
    legal_name: Mapped[str] = mapped_column(String(300))
    trade_name: Mapped[str | None] = mapped_column(String(300))
    registration_number: Mapped[str | None] = mapped_column(String(100))
    legal_form: Mapped[str | None] = mapped_column(String(60))
    country: Mapped[str | None] = mapped_column(String(2))
    address: Mapped[str | None] = mapped_column(Text)
    regions_served: Mapped[list[Any]] = mapped_column(default=list)
    excluded_concepts: Mapped[list[Any]] = mapped_column(default=list)
    excluded_regions: Mapped[list[Any]] = mapped_column(default=list)
    strategic_concepts: Mapped[list[Any]] = mapped_column(default=list)
    max_project_value: Mapped[float | None] = mapped_column(Numeric(20, 2))
    annual_turnover: Mapped[float | None] = mapped_column(Numeric(20, 2))
    currency: Mapped[str | None] = mapped_column(String(3))
    staff_count: Mapped[int | None] = mapped_column(Integer)
    max_parallel_bids: Mapped[int | None] = mapped_column(Integer)
    daily_bid_cost: Mapped[float | None] = mapped_column(Numeric(14, 2))
    gross_margin_pct: Mapped[float | None] = mapped_column(Float)
    matchmaking_consent: Mapped[bool] = mapped_column(Boolean, default=False)


class CompanyCapability(Base, Timestamps):
    __tablename__ = "company_capabilities"
    __table_args__ = (UniqueConstraint("company_id", "concept_id"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(FK("organizations.id", ondelete="CASCADE"), index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(FK("companies.id", ondelete="CASCADE"), index=True)
    concept_id: Mapped[str] = mapped_column(String(80))
    epistemic: Mapped[str] = mapped_column(String(20), default="USER_CLAIM")
    verification: Mapped[str] = mapped_column(String(20), default="UNVERIFIED")
    evidence_ids: Mapped[list[Any]] = mapped_column(default=list)
    note: Mapped[str | None] = mapped_column(Text)


class CompanyCredential(Base, Timestamps):
    __tablename__ = "company_credentials"
    __table_args__ = (UniqueConstraint("company_id", "credential_id"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(FK("organizations.id", ondelete="CASCADE"), index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(FK("companies.id", ondelete="CASCADE"), index=True)
    credential_id: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(20), default="HELD")
    valid_until: Mapped[date | None] = mapped_column(Date)
    epistemic: Mapped[str] = mapped_column(String(20), default="USER_CLAIM")
    verification: Mapped[str] = mapped_column(String(20), default="UNVERIFIED")
    evidence_ids: Mapped[list[Any]] = mapped_column(default=list)


class CompanyProject(Base, Timestamps):
    __tablename__ = "company_projects"
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(FK("organizations.id", ondelete="CASCADE"), index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(FK("companies.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(500))
    client_name: Mapped[str | None] = mapped_column(String(300))
    buyer_id: Mapped[uuid.UUID | None] = mapped_column(FK("buyers.id"))
    concept_ids: Mapped[list[Any]] = mapped_column(default=list)
    value: Mapped[float | None] = mapped_column(Numeric(20, 2))
    currency: Mapped[str | None] = mapped_column(String(3))
    year: Mapped[int | None] = mapped_column(Integer)
    region: Mapped[str | None] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    epistemic: Mapped[str] = mapped_column(String(20), default="USER_CLAIM")
    verification: Mapped[str] = mapped_column(String(20), default="UNVERIFIED")
    evidence_ids: Mapped[list[Any]] = mapped_column(default=list)


# ── Matching (tenant) ───────────────────────────────────────────────────────
class Match(Base, Timestamps):
    __tablename__ = "matches"
    __table_args__ = (
        UniqueConstraint("company_id", "opportunity_id"),
        Index("ix_matches_org_score", "org_id", "fit_score"),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(FK("organizations.id", ondelete="CASCADE"))
    company_id: Mapped[uuid.UUID] = mapped_column(FK("companies.id", ondelete="CASCADE"))
    opportunity_id: Mapped[uuid.UUID] = mapped_column(FK("opportunities.id", ondelete="CASCADE"), index=True)
    opportunity_version: Mapped[int] = mapped_column(Integer)
    scoring_version: Mapped[str] = mapped_column(String(30))
    fit_score: Mapped[int] = mapped_column(Integer)
    recommendation: Mapped[str] = mapped_column(String(30))
    data_completeness: Mapped[float] = mapped_column(Float)
    result: Mapped[dict[str, Any]] = mapped_column()
    result_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), default="NEW")  # NEW | VIEWED | DISMISSED | PURSUED
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class MatchHistory(Base):
    __tablename__ = "match_history"
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(FK("organizations.id", ondelete="CASCADE"), index=True)
    match_id: Mapped[uuid.UUID] = mapped_column(FK("matches.id", ondelete="CASCADE"), index=True)
    opportunity_version: Mapped[int] = mapped_column(Integer)
    scoring_version: Mapped[str] = mapped_column(String(30))
    fit_score: Mapped[int] = mapped_column(Integer)
    recommendation: Mapped[str] = mapped_column(String(30))
    result: Mapped[dict[str, Any]] = mapped_column()
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Feedback(Base):
    __tablename__ = "feedback"
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(FK("organizations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(FK("users.id"))
    subject_type: Mapped[str] = mapped_column(String(30))
    subject_id: Mapped[uuid.UUID] = mapped_column()
    label: Mapped[str] = mapped_column(String(40))
    comment: Mapped[str | None] = mapped_column(Text)
    context: Mapped[dict[str, Any]] = mapped_column(default=dict)  # e.g. scoring_version, fit at the time
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ── Bids (tenant) ───────────────────────────────────────────────────────────
class Bid(Base, Timestamps):
    __tablename__ = "bids"
    __table_args__ = (UniqueConstraint("org_id", "opportunity_id"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(FK("organizations.id", ondelete="CASCADE"), index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(FK("companies.id", ondelete="CASCADE"))
    opportunity_id: Mapped[uuid.UUID] = mapped_column(FK("opportunities.id", ondelete="CASCADE"))
    match_id: Mapped[uuid.UUID | None] = mapped_column(FK("matches.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(30))
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(FK("users.id"))
    outcome: Mapped[str | None] = mapped_column(String(30))
    outcome_note: Mapped[str | None] = mapped_column(Text)


class BidDecision(Base):
    __tablename__ = "bid_decisions"
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(FK("organizations.id", ondelete="CASCADE"), index=True)
    bid_id: Mapped[uuid.UUID] = mapped_column(FK("bids.id", ondelete="CASCADE"), index=True)
    system_recommendation: Mapped[str | None] = mapped_column(String(30))
    fit_score: Mapped[int | None] = mapped_column(Integer)
    scoring_version: Mapped[str | None] = mapped_column(String(30))
    decision: Mapped[str] = mapped_column(String(20))  # BID | NO_BID
    rationale: Mapped[str | None] = mapped_column(Text)
    decided_by: Mapped[uuid.UUID] = mapped_column(FK("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ComplianceItem(Base, Timestamps):
    __tablename__ = "compliance_items"
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(FK("organizations.id", ondelete="CASCADE"), index=True)
    bid_id: Mapped[uuid.UUID] = mapped_column(FK("bids.id", ondelete="CASCADE"), index=True)
    requirement_id: Mapped[uuid.UUID | None] = mapped_column(FK("requirements.id", ondelete="SET NULL"))
    text: Mapped[str] = mapped_column(Text)
    requirement_type: Mapped[str | None] = mapped_column(String(20))
    category: Mapped[str | None] = mapped_column(String(30))
    source_locator: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(30), default="NOT_STARTED")
    response: Mapped[str | None] = mapped_column(Text)
    evidence_ids: Mapped[list[Any]] = mapped_column(default=list)
    risk: Mapped[str | None] = mapped_column(String(10))
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(FK("users.id"))
    reviewer_user_id: Mapped[uuid.UUID | None] = mapped_column(FK("users.id"))


class ApprovalRequest(Base, Timestamps):
    __tablename__ = "approval_requests"
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(FK("organizations.id", ondelete="CASCADE"), index=True)
    bid_id: Mapped[uuid.UUID | None] = mapped_column(FK("bids.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="PENDING")
    requested_by: Mapped[uuid.UUID] = mapped_column(FK("users.id"))
    decided_by: Mapped[uuid.UUID | None] = mapped_column(FK("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(default=dict)


# ── Signals, notifications, briefings, tasks ────────────────────────────────
class Signal(Base):
    __tablename__ = "signals"
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID | None] = mapped_column(FK("organizations.id", ondelete="CASCADE"), index=True)
    opportunity_id: Mapped[uuid.UUID | None] = mapped_column(FK("opportunities.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(30))  # OPPORTUNITY | EARLY_SIGNAL | RISK_SIGNAL | MARKET_SIGNAL
    code: Mapped[str] = mapped_column(String(60))
    payload: Mapped[dict[str, Any]] = mapped_column(default=dict)
    idempotency_key: Mapped[str] = mapped_column(String(200), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(FK("organizations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(FK("users.id"))
    category: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(default=dict)
    idempotency_key: Mapped[str] = mapped_column(String(200), unique=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Briefing(Base):
    __tablename__ = "briefings"
    __table_args__ = (UniqueConstraint("org_id", "briefing_date"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(FK("organizations.id", ondelete="CASCADE"))
    briefing_date: Mapped[date] = mapped_column(Date)
    payload: Mapped[dict[str, Any]] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Task(Base, Timestamps):
    __tablename__ = "tasks"
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(FK("organizations.id", ondelete="CASCADE"), index=True)
    bid_id: Mapped[uuid.UUID | None] = mapped_column(FK("bids.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="OPEN")
    assignee_user_id: Mapped[uuid.UUID | None] = mapped_column(FK("users.id"))
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ── Platform: audit, events, jobs, AI ───────────────────────────────────────
class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID | None] = mapped_column(FK("organizations.id", ondelete="CASCADE"), index=True)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(FK("users.id"))
    action: Mapped[str] = mapped_column(String(80))
    subject_type: Mapped[str | None] = mapped_column(String(40))
    subject_id: Mapped[str | None] = mapped_column(String(80))
    data: Mapped[dict[str, Any]] = mapped_column(default=dict)
    request_id: Mapped[str | None] = mapped_column(String(64))
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class DomainEvent(Base):
    __tablename__ = "domain_events"
    id: Mapped[uuid.UUID] = uuid_pk()
    event_type: Mapped[str] = mapped_column(String(60), index=True)
    aggregate_type: Mapped[str] = mapped_column(String(40))
    aggregate_id: Mapped[str] = mapped_column(String(80))
    org_id: Mapped[uuid.UUID | None] = mapped_column()
    payload: Mapped[dict[str, Any]] = mapped_column(default=dict)
    idempotency_key: Mapped[str] = mapped_column(String(200), unique=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (Index("ix_jobs_claim", "status", "run_after"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    kind: Mapped[str] = mapped_column(String(60))
    payload: Mapped[dict[str, Any]] = mapped_column(default=dict)
    org_id: Mapped[uuid.UUID | None] = mapped_column()
    idempotency_key: Mapped[str | None] = mapped_column(String(200), unique=True)
    status: Mapped[str] = mapped_column(String(20), default="QUEUED")  # QUEUED | RUNNING | SUCCEEDED | DEAD
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5)
    run_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    locked_by: Mapped[str | None] = mapped_column(String(100))
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AIRequest(Base):
    """Every model call: provider, model, versions, tokens, latency, cost (spec §23, §69)."""

    __tablename__ = "ai_requests"
    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID | None] = mapped_column(FK("organizations.id", ondelete="CASCADE"), index=True)
    task: Mapped[str] = mapped_column(String(60))
    provider: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(80))
    prompt_version: Mapped[str] = mapped_column(String(40))
    schema_version: Mapped[str | None] = mapped_column(String(40))
    input_hash: Mapped[str] = mapped_column(String(64), index=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    cost_usd: Mapped[float | None] = mapped_column(Numeric(12, 6))
    status: Mapped[str] = mapped_column(String(20))
    error: Mapped[str | None] = mapped_column(Text)
    output: Mapped[dict[str, Any] | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
