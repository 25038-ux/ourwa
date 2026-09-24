"""Opportunity analysis: concepts, documents, requirements — all with citations (Phase 4/7)."""

from __future__ import annotations

import logging
import re
import uuid
from dataclasses import replace
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from forsa.ai.boundaries import detect_injection
from forsa.db.models import (
    Assertion,
    Document,
    DocumentChunk,
    DocumentVersion,
    Evidence,
    Opportunity,
    OpportunityVersion,
    Requirement,
    Signal,
)
from forsa.documents.deadlines import find_deadline
from forsa.documents.extract import OcrFn, Page, UnsupportedDocument, extract
from forsa.documents.requirements import ExtractedRequirement, extract_requirements
from forsa.documents.segment import segment_pages
from forsa.ingestion.storage import ObjectStore
from forsa.jobs.queue import enqueue
from forsa.taxonomy.ontology import Ontology

log = logging.getLogger("forsa.intelligence")

DEADLINE_METHOD = "rules:deadline-v1"
# Statuses whose extraction is final. NEEDS_OCR is retried once an OCR engine is available.
_FINAL = ("DONE", "OCR_DONE", "FAILED")


def derive_concepts(onto: Ontology, sources: list[tuple[str, float, str]]) -> list[dict]:
    """Aggregate concept hits from (text, weight, locator) sources into weighted needs with a citation each."""
    agg: dict[str, dict] = {}
    for text, weight, locator in sources:
        if not text:
            continue
        for hit in onto.find(text):
            entry = agg.get(hit.concept_id)
            if entry is None or weight > entry["weight"]:
                agg[hit.concept_id] = {
                    "concept_id": hit.concept_id,
                    "weight": weight,
                    "quote": hit.quote,
                    "locator": locator,
                    "term": hit.term,
                    "lang": hit.lang,
                }
    ids = set(agg)
    for cid, entry in agg.items():
        if any(onto.is_ancestor(cid, other) for other in ids if other != cid):
            entry["weight"] = 0.0  # the more specific concept carries the need
        elif onto.concepts[cid].parent is None and any(
            onto.concepts[o].parent is not None and not onto.is_ancestor(cid, o) for o in ids
        ):
            entry["weight"] = round(entry["weight"] * 0.25, 3)  # generic category word next to a specific need
    return sorted(agg.values(), key=lambda e: -e["weight"])


def _store_requirements(
    session: Session, opp: Opportunity, reqs: list[ExtractedRequirement], ev_kwargs: dict, dv: DocumentVersion | None
) -> int:
    count = 0
    for r in reqs:
        ev = Evidence(
            kind="document" if dv else "source_snapshot",
            page=r.page,
            section=r.locator,
            char_start=r.start,
            char_end=r.end,
            quote=r.text[:2000],
            extraction_method=r.extraction_method,
            document_version_id=dv.id if dv else None,
            **ev_kwargs,
        )
        session.add(ev)
        session.flush()
        params = {
            "credential_ids": r.credential_ids,
            "min_count": r.min_count,
            "min_amount": r.min_amount,
            "currency": r.currency,
            "notes": r.notes,
            "is_turnover": bool(re.search(r"chiffre d.affaires|turnover|رقم الأعمال", r.text, re.I)),
        }
        stmt = (
            insert(Requirement)
            .values(
                id=uuid.uuid4(),
                opportunity_id=opp.id,
                document_version_id=dv.id if dv else None,
                external_key=r.id,
                text=r.text,
                type=r.type,
                category=r.category,
                page=r.page,
                heading_path=list(r.heading_path),
                char_start=r.start,
                char_end=r.end,
                params=params,
                evidence_id=ev.id,
                extraction_method=r.extraction_method,
                confidence=r.confidence,
                verification="UNVERIFIED",
            )
            .on_conflict_do_nothing(index_elements=["opportunity_id", "external_key"])
            .returning(Requirement.id)
        )
        count += len(session.execute(stmt).scalars().all())
    return count


def process_document_version(
    session: Session,
    store: ObjectStore,
    onto: Ontology,
    opp: Opportunity,
    dv: DocumentVersion,
    ocr: OcrFn | None = None,
) -> tuple[str, int]:
    """Extract (OCR for scanned PDFs when available) → segment → chunk → requirements. Returns (text, #reqs)."""
    try:
        doc = extract(store.get(dv.storage_key), ocr=ocr)
    except (UnsupportedDocument, Exception) as exc:  # corrupt files must not stop the pipeline
        dv.extraction_status = "FAILED"
        dv.risk_flags = [*(dv.risk_flags or []), {"code": "extraction_failed", "detail": str(exc)[:300]}]
        log.warning("document extraction failed dv=%s: %s", dv.id, exc)
        return "", 0
    dv.page_count, dv.needs_ocr = len(doc.pages), doc.needs_ocr
    flags = detect_injection(doc.text)
    if flags:
        dv.risk_flags = [*(dv.risk_flags or []), *({"code": "prompt_injection_marker", "match": f} for f in flags)]
    session.execute(delete(DocumentChunk).where(DocumentChunk.document_version_id == dv.id))
    for i, seg in enumerate(segment_pages(doc.pages)):
        session.add(
            DocumentChunk(
                document_version_id=dv.id,
                chunk_index=i,
                page=seg.page,
                heading_path=list(seg.heading_path),
                kind=seg.kind,
                text=seg.text,
                char_start=seg.start,
                char_end=seg.end,
                content_hash=seg.content_hash,
            )
        )
    reqs = extract_requirements(doc.pages, onto)
    if doc.ocr_applied:  # OCR text is noisier: label the method and cap confidence
        reqs = [replace(r, extraction_method=f"{r.extraction_method}+ocr"[:60], confidence="LOW") for r in reqs]
    n = _store_requirements(session, opp, reqs, {"content_hash": dv.content_hash}, dv)
    dv.extraction_status = "NEEDS_OCR" if doc.needs_ocr else ("OCR_DONE" if doc.ocr_applied else "DONE")
    return doc.text, n


def _pages_of(session: Session, dv_id: uuid.UUID) -> list[Page]:
    """Rebuild page texts from stored chunks (chunks keep their page number)."""
    rows = session.execute(
        select(DocumentChunk.page, DocumentChunk.text)
        .where(DocumentChunk.document_version_id == dv_id)
        .order_by(DocumentChunk.chunk_index)
    ).all()
    pages: dict[int, list[str]] = {}
    for page, text in rows:
        pages.setdefault(page or 1, []).append(text)
    return [Page(n, "\n".join(parts)) for n, parts in sorted(pages.items())]


def derive_deadline(session: Session, opp: Opportunity, dvs: list[DocumentVersion]) -> bool:
    """When the source gave no deadline, look for it in the notice documents; store it with its quote.

    The value is DERIVED (read from the official document, possibly via OCR), never guessed.
    """
    if opp.deadline_at is not None or opp.kind in ("AWARD", "PLAN_ITEM") or opp.status == "PLANNED":
        return False
    for dv in dvs:
        hit = find_deadline(_pages_of(session, dv.id))
        if hit is None:
            continue
        ev = Evidence(
            kind="document",
            document_version_id=dv.id,
            page=hit.page,
            char_start=hit.start,
            char_end=hit.end,
            quote=hit.quote[:2000],
            content_hash=dv.content_hash,
            extraction_method=DEADLINE_METHOD + ("+ocr" if dv.extraction_status == "OCR_DONE" else ""),
        )
        session.add(ev)
        session.flush()
        session.add(
            Assertion(
                subject_type="opportunity",
                subject_id=opp.id,
                predicate="deadline_at",
                value={"v": hit.deadline.isoformat(), "time_stated": hit.has_time},
                epistemic="DERIVED",
                confidence="MEDIUM" if dv.extraction_status == "OCR_DONE" or not hit.has_time else "HIGH",
                verification="UNVERIFIED",
                evidence_id=ev.id,
                method=DEADLINE_METHOD,
                version=opp.current_version,
            )
        )
        opp.deadline_at = hit.deadline
        return True
    return False


def analyze_opportunity(
    session: Session,
    store: ObjectStore,
    onto: Ontology,
    opportunity_id: uuid.UUID,
    gateway: Any = None,
    features: frozenset[str] = frozenset(),
    ocr: OcrFn | None = None,
) -> dict:
    opp = session.get(Opportunity, opportunity_id)
    if opp is None:
        return {"skipped": "missing"}
    version = session.scalar(
        select(OpportunityVersion).where(
            OpportunityVersion.opportunity_id == opp.id, OpportunityVersion.version == opp.current_version
        )
    )
    stats = {"requirements": 0, "documents": 0}
    doc_sources: list[tuple[str, float, str]] = []
    fresh_docs: list[tuple[str, uuid.UUID]] = []
    dvs = session.scalars(
        select(DocumentVersion)
        .join(Document, Document.id == DocumentVersion.document_id)
        .where(Document.opportunity_id == opp.id)
    ).all()
    for dv in dvs:
        if dv.extraction_status in _FINAL or (dv.extraction_status == "NEEDS_OCR" and ocr is None):
            chunks = session.scalars(select(DocumentChunk.text).where(DocumentChunk.document_version_id == dv.id)).all()
            doc_sources.append(("\n".join(chunks), 0.5, f"document:{dv.document_id}"))
            continue
        text, n = process_document_version(session, store, onto, opp, dv, ocr)
        fresh_docs.append((text, dv.id))
        stats["requirements"] += n
        stats["documents"] += 1
        doc_sources.append((text, 0.5, f"document:{dv.document_id}"))

    # Requirements stated in the notice text itself (cited to the source snapshot).
    if opp.description:
        reqs = extract_requirements([Page(1, opp.description)], onto)
        ev_kwargs = {"snapshot_id": version.snapshot_id if version else None, "url": opp.url}
        stats["requirements"] += _store_requirements(session, opp, reqs, ev_kwargs, None)

    if gateway is not None and features:
        from forsa.services import ai_features

        if "ai_extraction" in features:
            for text, dv_id in fresh_docs:
                stats["ai_requirements"] = stats.get("ai_requirements", 0) + ai_features.propose_requirements(
                    session, gateway, opp, text, dv_id
                )
        if "ai_decisions" in features:
            stats["ai_flagged"] = ai_features.jev_crosscheck(session, gateway, opp)

    if derive_deadline(session, opp, list(dvs)):
        stats["deadline_from_document"] = 1
    opp.concepts = derive_concepts(
        onto, [(opp.title, 2.0, "title"), (opp.description or "", 1.0, "description"), *doc_sources]
    )
    opp.analyzed_version = opp.current_version
    if opp.status == "PLANNED":
        session.execute(
            insert(Signal)
            .values(
                id=uuid.uuid4(),
                opportunity_id=opp.id,
                type="EARLY_SIGNAL",
                code="procurement_plan_item",
                payload={"title": opp.title},
                idempotency_key=f"signal:plan:{opp.id}",
            )
            .on_conflict_do_nothing(index_elements=["idempotency_key"])
        )
    enqueue(
        session, "match_opportunity", {"opportunity_id": str(opp.id)}, key=f"match_opp:{opp.id}:v{opp.current_version}"
    )
    stats["concepts"] = len(opp.concepts)
    return stats
