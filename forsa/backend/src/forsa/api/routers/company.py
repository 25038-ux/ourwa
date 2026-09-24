from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from forsa.ai.boundaries import detect_injection
from forsa.api.deps import runtime, tenant_context, tenant_db
from forsa.api.presenter import concept_label
from forsa.api.schemas import CapabilityIn, CompanyUpdate, CredentialIn, ProjectIn, VerifyIn
from forsa.db.models import (
    CompanyCapability,
    CompanyCredential,
    CompanyProject,
    Document,
    DocumentVersion,
    Evidence,
)
from forsa.documents.extract import MAX_BYTES, UnsupportedDocument, extract
from forsa.identity.rbac import TenantContext
from forsa.kernel.errors import ForsaError
from forsa.runtime import Runtime
from forsa.services import companies as svc

router = APIRouter(prefix="/companies/me", tags=["companies"])


def _claim(row: Any, extra: dict) -> dict:
    return {
        "id": str(row.id),
        "epistemic": row.epistemic,
        "verification": row.verification,
        "evidence_ids": row.evidence_ids,
        **extra,
    }


@router.get("")
def get_company(
    lang: str = "fr", ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    ctx.require("company.read")
    c = svc.get_twin(db, ctx)
    db.commit()
    caps = db.scalars(select(CompanyCapability).where(CompanyCapability.company_id == c.id)).all()
    creds = db.scalars(select(CompanyCredential).where(CompanyCredential.company_id == c.id)).all()
    projects = db.scalars(
        select(CompanyProject)
        .where(CompanyProject.company_id == c.id)
        .order_by(CompanyProject.year.desc().nulls_last())
    ).all()
    docs = db.execute(
        select(Document, DocumentVersion, Evidence)
        .join(DocumentVersion, DocumentVersion.document_id == Document.id)
        .outerjoin(Evidence, Evidence.document_version_id == DocumentVersion.id)
        .where(Document.org_id == ctx.org_id, Document.kind == "company_evidence")
    ).all()
    fields = {k: getattr(c, k) for k in svc.EDITABLE}
    for k in ("max_project_value", "annual_turnover", "daily_bid_cost"):
        fields[k] = float(fields[k]) if fields[k] is not None else None
    return {
        "id": str(c.id),
        **fields,
        "capabilities": [
            _claim(x, {"concept_id": x.concept_id, "label": concept_label(x.concept_id, lang), "note": x.note})
            for x in caps
        ],
        "credentials": [
            _claim(
                x,
                {
                    "credential_id": x.credential_id,
                    "label": concept_label(x.credential_id, lang),
                    "status": x.status,
                    "valid_until": x.valid_until,
                },
            )
            for x in creds
        ],
        "projects": [
            _claim(
                p,
                {
                    "title": p.title,
                    "client_name": p.client_name,
                    "concept_ids": p.concept_ids,
                    "value": float(p.value) if p.value is not None else None,
                    "currency": p.currency,
                    "year": p.year,
                    "region": p.region,
                },
            )
            for p in projects
        ],
        "documents": [
            {
                "id": str(d.id),
                "title": d.title,
                "evidence_id": str(e.id) if e else None,
                "pages": v.page_count,
                "needs_ocr": v.needs_ocr,
                "risk_flags": v.risk_flags,
                "scan_status": v.scan_status,
                "uploaded_at": d.created_at,
            }
            for d, v, e in docs
        ],
    }


@router.put("")
def update_company(
    body: CompanyUpdate, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    svc.update_twin(db, ctx, body.model_dump(exclude_unset=True))
    db.commit()
    return {"ok": True}


@router.post("/capabilities")
def add_capability(
    body: CapabilityIn, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    row = svc.set_capability(db, ctx, body.concept_id, body.note)
    db.commit()
    return {"id": str(row.id)}


@router.delete("/capabilities/{capability_id}")
def delete_capability(
    capability_id: uuid.UUID, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    svc.remove_capability(db, ctx, capability_id)
    db.commit()
    return {"ok": True}


@router.put("/credentials")
def put_credential(
    body: CredentialIn, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    row = svc.set_credential(db, ctx, body.credential_id, body.status, body.valid_until)
    db.commit()
    return {"id": str(row.id)}


@router.post("/projects")
def add_project(
    body: ProjectIn, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    row = svc.add_project(db, ctx, body.model_dump())
    db.commit()
    return {"id": str(row.id)}


@router.post("/verify")
def verify(body: VerifyIn, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)) -> dict:
    svc.verify_claim(db, ctx, body.claim_type, body.claim_id, body.evidence_ids)
    db.commit()
    return {"ok": True}


@router.get("/suggestions")
def suggestions(ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)) -> dict:
    ctx.require("company.read")
    return {
        "items": svc.capability_suggestions(db, ctx),
        "note": "Suggestions are inferences from your documents. Confirm them to add them to your profile.",
    }


@router.post("/documents")
async def upload_document(
    file: UploadFile = File(...),
    ctx: TenantContext = Depends(tenant_context),
    db: Session = Depends(tenant_db),
    rt: Runtime = Depends(runtime),
) -> dict:
    ctx.require("document.upload")
    content = await file.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise ForsaError("file too large")
    try:
        doc = extract(content, file.content_type)  # validates type by magic bytes
    except UnsupportedDocument as exc:
        raise ForsaError(str(exc)) from exc
    key, digest = rt.store.put(content, f"documents/org/{ctx.org_id}")
    flags = [{"code": "prompt_injection_marker", "match": f} for f in detect_injection(doc.text)]
    document, evidence = svc.register_company_document(
        db,
        ctx,
        file.filename or "document",
        key,
        digest,
        doc.kind,
        len(content),
        [(p.number, p.text) for p in doc.pages],
        doc.needs_ocr,
        flags,
    )
    db.commit()
    return {
        "document_id": str(document.id),
        "evidence_id": str(evidence.id),
        "pages": len(doc.pages),
        "needs_ocr": doc.needs_ocr,
        "risk_flags": flags,
        "scan_status": "NOT_SCANNED",
    }
