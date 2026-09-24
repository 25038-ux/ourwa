"""Company Business Twin (Phase 5): what FORSA believes the company can do — and the company can correct it."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from forsa.db.models import (
    Company,
    CompanyCapability,
    CompanyCredential,
    CompanyProject,
    Document,
    DocumentChunk,
    DocumentVersion,
    Evidence,
    Organization,
)
from forsa.identity.rbac import TenantContext
from forsa.jobs.queue import enqueue
from forsa.kernel.clock import utcnow
from forsa.kernel.errors import ForsaError, NotFound
from forsa.services.events import audit, emit
from forsa.taxonomy import default_ontology

EDITABLE = (
    "legal_name",
    "trade_name",
    "registration_number",
    "legal_form",
    "country",
    "address",
    "regions_served",
    "excluded_concepts",
    "excluded_regions",
    "strategic_concepts",
    "max_project_value",
    "annual_turnover",
    "currency",
    "staff_count",
    "max_parallel_bids",
    "daily_bid_cost",
    "gross_margin_pct",
    "matchmaking_consent",
)


def _check_concept(concept_id: str, kind: str) -> None:
    concept = default_ontology().concepts.get(concept_id)
    if concept is None or concept.kind != kind:
        raise ForsaError(f"unknown {kind} {concept_id!r}")


def get_twin(session: Session, ctx: TenantContext, create: bool = True) -> Company:
    company = session.scalar(select(Company).where(Company.org_id == ctx.org_id))
    if company is None:
        if not create:
            raise NotFound("company profile not found")
        org = session.get(Organization, ctx.org_id)
        company = Company(
            org_id=ctx.org_id,
            legal_name=org.name if org else "Company",
            country=org.country if org else None,
            regions_served=[],
            excluded_concepts=[],
            excluded_regions=[],
            strategic_concepts=[],
        )
        session.add(company)
        session.flush()
    return company


def _changed(session: Session, ctx: TenantContext, company: Company, what: str) -> None:
    emit(
        session,
        "CompanyProfileUpdated",
        "company",
        company.id,
        {"what": what},
        key=f"company-updated:{company.id}:{uuid.uuid4()}",
        org_id=ctx.org_id,
    )
    audit(
        session,
        f"company.{what}",
        org_id=ctx.org_id,
        actor=ctx.user_id,
        subject_type="company",
        subject_id=company.id,
        request_id=ctx.request_id,
        ip=ctx.ip,
    )
    # Debounced re-match: one job per company per minute.
    enqueue(
        session,
        "match_company",
        {"company_id": str(company.id)},
        org_id=ctx.org_id,
        key=f"match_company:{company.id}:{utcnow():%Y%m%d%H%M}",
        delay_s=5,
    )


def update_twin(session: Session, ctx: TenantContext, fields: dict[str, Any]) -> Company:
    ctx.require("company.edit")
    company = get_twin(session, ctx)
    for concept in [*fields.get("excluded_concepts", []), *fields.get("strategic_concepts", [])]:
        _check_concept(concept, "capability")
    for key, value in fields.items():
        if key in EDITABLE:
            setattr(company, key, value)
    _changed(session, ctx, company, "updated")
    return company


def set_capability(session: Session, ctx: TenantContext, concept_id: str, note: str | None = None) -> CompanyCapability:
    ctx.require("company.edit")
    _check_concept(concept_id, "capability")
    company = get_twin(session, ctx)
    row = session.scalar(
        select(CompanyCapability).where(
            CompanyCapability.company_id == company.id, CompanyCapability.concept_id == concept_id
        )
    )
    if row is None:
        row = CompanyCapability(
            org_id=ctx.org_id,
            company_id=company.id,
            concept_id=concept_id,
            epistemic="USER_CLAIM",
            verification="UNVERIFIED",
            evidence_ids=[],
        )
        session.add(row)
    row.note = note
    session.flush()
    _changed(session, ctx, company, "capability_set")
    return row


def remove_capability(session: Session, ctx: TenantContext, capability_id: uuid.UUID) -> None:
    ctx.require("company.edit")
    row = session.get(CompanyCapability, capability_id)
    if row is None or row.org_id != ctx.org_id:
        raise NotFound("capability not found")
    company = get_twin(session, ctx)
    session.delete(row)
    _changed(session, ctx, company, "capability_removed")


def set_credential(
    session: Session, ctx: TenantContext, credential_id: str, status: str, valid_until: date | None
) -> CompanyCredential:
    ctx.require("company.edit")
    _check_concept(credential_id, "credential")
    if status not in ("HELD", "IN_PROGRESS", "ABSENT"):
        raise ForsaError("invalid credential status")
    company = get_twin(session, ctx)
    row = session.scalar(
        select(CompanyCredential).where(
            CompanyCredential.company_id == company.id, CompanyCredential.credential_id == credential_id
        )
    )
    if row is None:
        row = CompanyCredential(org_id=ctx.org_id, company_id=company.id, credential_id=credential_id, evidence_ids=[])
        session.add(row)
    row.status, row.valid_until = status, valid_until
    row.verification, row.epistemic = "UNVERIFIED", "USER_CLAIM"  # any edit re-opens verification
    session.flush()
    _changed(session, ctx, company, "credential_set")
    return row


def add_project(session: Session, ctx: TenantContext, data: dict[str, Any]) -> CompanyProject:
    ctx.require("company.edit")
    for c in data.get("concept_ids", []):
        _check_concept(c, "capability")
    company = get_twin(session, ctx)
    row = CompanyProject(
        org_id=ctx.org_id,
        company_id=company.id,
        epistemic="USER_CLAIM",
        verification="UNVERIFIED",
        evidence_ids=[],
        **{
            k: data.get(k)
            for k in ("title", "client_name", "concept_ids", "value", "currency", "year", "region", "description")
        },
    )
    session.add(row)
    session.flush()
    _changed(session, ctx, company, "project_added")
    return row


_CLAIM_MODELS: dict[str, Any] = {
    "capability": CompanyCapability,
    "credential": CompanyCredential,
    "project": CompanyProject,
}


def verify_claim(
    session: Session, ctx: TenantContext, claim_type: str, claim_id: uuid.UUID, evidence_ids: list[uuid.UUID]
) -> Any:
    """A claim becomes VERIFIED only when a human with company.verify links a document as evidence."""
    ctx.require("company.verify")
    model = _CLAIM_MODELS.get(claim_type)
    if model is None:
        raise ForsaError("unknown claim type")
    row = session.get(model, claim_id)
    if row is None or row.org_id != ctx.org_id:
        raise NotFound("claim not found")
    if not evidence_ids:
        raise ForsaError("verification requires at least one evidence document")
    for ev_id in evidence_ids:
        ev = session.get(Evidence, ev_id)
        if ev is None or ev.org_id != ctx.org_id:
            raise NotFound(f"evidence {ev_id} not found")
    row.evidence_ids = [str(e) for e in evidence_ids]
    row.verification, row.epistemic = "VERIFIED", "FACT"
    company = get_twin(session, ctx)
    _changed(session, ctx, company, f"{claim_type}_verified")
    return row


def register_company_document(
    session: Session,
    ctx: TenantContext,
    title: str,
    storage_key: str,
    digest: str,
    kind: str,
    size: int,
    pages_text: list[tuple[int, str]],
    needs_ocr: bool,
    risk_flags: list[dict],
) -> tuple[Document, Evidence]:
    ctx.require("document.upload")
    doc = Document(org_id=ctx.org_id, title=title[:500], kind="company_evidence")
    session.add(doc)
    session.flush()
    dv = DocumentVersion(
        org_id=ctx.org_id,
        document_id=doc.id,
        version=1,
        content_hash=digest,
        storage_key=storage_key,
        content_type=kind,
        byte_size=size,
        page_count=len(pages_text),
        needs_ocr=needs_ocr,
        risk_flags=risk_flags,
        extraction_status="NEEDS_OCR" if needs_ocr else "DONE",
    )
    session.add(dv)
    session.flush()
    for i, (page, text) in enumerate(pages_text):
        session.add(
            DocumentChunk(
                document_version_id=dv.id,
                chunk_index=i,
                page=page,
                heading_path=[],
                kind="page",
                text=text,
                char_start=0,
                char_end=len(text),
                content_hash=digest,
            )
        )
    ev = Evidence(
        org_id=ctx.org_id,
        kind="document",
        document_version_id=dv.id,
        content_hash=digest,
        retrieved_at=utcnow(),
        extraction_method="upload",
        quote=title[:300],
    )
    session.add(ev)
    session.flush()
    audit(
        session,
        "document.uploaded",
        org_id=ctx.org_id,
        actor=ctx.user_id,
        subject_type="document",
        subject_id=doc.id,
        data={"size": size, "risk_flags": risk_flags},
        request_id=ctx.request_id,
        ip=ctx.ip,
    )
    return doc, ev


def capability_suggestions(session: Session, ctx: TenantContext) -> list[dict[str, Any]]:
    """AI-free suggestions from uploaded documents. INFERENCE only — the company must confirm (spec §7)."""
    company = get_twin(session, ctx)
    have = set(
        session.scalars(select(CompanyCapability.concept_id).where(CompanyCapability.company_id == company.id)).all()
    )
    rows = session.execute(
        select(DocumentChunk.text, DocumentChunk.page, Document.title, Document.id)
        .join(DocumentVersion, DocumentVersion.id == DocumentChunk.document_version_id)
        .join(Document, Document.id == DocumentVersion.document_id)
        .where(Document.org_id == ctx.org_id, Document.kind == "company_evidence")
    ).all()
    onto = default_ontology()
    found: dict[str, dict[str, Any]] = {}
    for text, page, title, doc_id in rows:
        for hit in onto.find(text):
            if hit.concept_id in have or hit.concept_id in found:
                continue
            found[hit.concept_id] = {
                "concept_id": hit.concept_id,
                "label": onto.concepts[hit.concept_id].labels,
                "quote": hit.quote,
                "document": title,
                "document_id": str(doc_id),
                "page": page,
                "epistemic": "INFERENCE",
                "status": "SUGGESTED",
            }
    return list(found.values())
