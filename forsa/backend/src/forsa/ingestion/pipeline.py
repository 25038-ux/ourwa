"""Generic ingestion pipeline: dedupe → snapshot → version → events → lineage (spec §25–28, §65).

Idempotency guarantees
* identical bytes for a URL are stored once (``source_snapshots`` unique key);
* an unchanged normalised payload creates no new version or event;
* each record is processed inside a SAVEPOINT, so a failure never leaves a
  half-written opportunity, and a retried run never duplicates one;
* ``(source_id, external_ref)`` is unique at the database level.
"""

from __future__ import annotations

import logging
import traceback
from collections import Counter
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from forsa.db.models import (
    Assertion,
    Buyer,
    Document,
    DocumentVersion,
    Evidence,
    IngestionRun,
    Opportunity,
    OpportunityEvent,
    OpportunityVersion,
    Source,
    SourceSnapshot,
)
from forsa.documents.extract import sniff_kind
from forsa.ingestion.changes import diff_payload
from forsa.ingestion.contracts import NormalizedOpportunity, RawRecord, SourceConnector
from forsa.ingestion.storage import ObjectStore
from forsa.jobs.queue import enqueue
from forsa.kernel.clock import utcnow
from forsa.kernel.hashing import content_hash
from forsa.services.events import emit
from forsa.taxonomy.normalize import normalize_key

log = logging.getLogger("forsa.ingestion")

PROJECTED = (
    "kind",
    "title",
    "description",
    "country",
    "region",
    "category",
    "method",
    "funding_source",
    "currency",
    "estimated_value",
    "published_at",
    "deadline_at",
    "status",
    "language",
    "url",
    "consortium_allowed",
)


class IngestionPipeline:
    def __init__(self, session: Session, store: ObjectStore):
        self.session = session
        self.store = store

    def run(self, source: Source, connector: SourceConnector, *, synthetic: bool = False) -> IngestionRun:
        run = IngestionRun(source_id=source.id, status="running", stats={})
        self.session.add(run)
        self.session.flush()
        if source.status != "active":
            run.status, run.finished_at = "blocked", utcnow()
            run.error = f"source status is {source.status!r}; only 'active' registry entries may run"
            return run
        stats: Counter[str] = Counter()
        errors: list[str] = []
        try:
            refs = list(connector.discover())
        except Exception as exc:
            run.status, run.finished_at, run.error = "failed", utcnow(), f"discover failed: {exc}"
            log.exception("discover failed for %s", source.key)
            return run
        for ref in refs:
            stats["discovered"] += 1
            try:
                with self.session.begin_nested():
                    raw = connector.fetch(ref)
                    stats["fetched"] += 1
                    snapshot, is_new = self._snapshot(source, run, raw)
                    if not is_new:
                        stats["unchanged_bytes"] += 1
                        continue
                    records = connector.parse(raw)
                    if not records:
                        stats["empty_parse"] += 1
                    for norm in records:
                        stats[self.apply(source, connector, norm, snapshot, synthetic)] += 1
            except Exception as exc:  # recorded, counted, surfaced in source health — never swallowed silently
                stats["failed"] += 1
                errors.append(f"{ref.url}: {type(exc).__name__}: {exc}")
                log.warning(
                    "ingestion record failed source=%s ref=%s\n%s", source.key, ref.url, traceback.format_exc(limit=3)
                )
        processed = stats["created"] + stats["updated"] + stats["unchanged"] + stats["unchanged_bytes"]
        run.status = "succeeded" if not stats["failed"] else ("partial" if processed else "failed")
        run.stats, run.finished_at = dict(stats), utcnow()
        run.error = "\n".join(errors[:20]) or None
        return run

    # ── internals ───────────────────────────────────────────────────────────
    def _snapshot(self, source: Source, run: IngestionRun, raw: RawRecord) -> tuple[SourceSnapshot, bool]:
        key, digest = self.store.put(raw.content, f"snapshots/{source.key}")
        existing = self.session.scalar(
            select(SourceSnapshot).where(
                SourceSnapshot.source_id == source.id,
                SourceSnapshot.canonical_url == raw.canonical_url,
                SourceSnapshot.content_hash == digest,
            )
        )
        if existing:
            return existing, False
        snap = SourceSnapshot(
            source_id=source.id,
            run_id=run.id,
            canonical_url=raw.canonical_url,
            external_ref=raw.ref.external_ref,
            content_hash=digest,
            content_type=raw.content_type,
            storage_key=key,
            byte_size=len(raw.content),
            etag=raw.etag,
            last_modified=raw.last_modified,
            retrieved_at=raw.retrieved_at,
        )
        self.session.add(snap)
        self.session.flush()
        return snap, True

    def _buyer(self, name: str | None, country: str | None) -> Buyer | None:
        if not name:
            return None
        key = normalize_key(name)
        buyer = self.session.scalar(select(Buyer).where(Buyer.name_key == key, Buyer.country == country))
        if buyer is None:
            buyer = Buyer(name=name.strip(), name_key=key, country=country)
            self.session.add(buyer)
            self.session.flush()
        return buyer

    def _lineage(
        self, opp: Opportunity, version: int, norm: NormalizedOpportunity, snapshot: SourceSnapshot, method: str
    ) -> None:
        payload = norm.payload()
        for field in NormalizedOpportunity.TRACKED:
            value = payload.get(field)
            if value is None:
                continue
            fe = norm.evidence.get(field)
            ev = Evidence(
                kind="source_snapshot",
                snapshot_id=snapshot.id,
                url=snapshot.canonical_url,
                section=fe.locator if fe else None,
                quote=(fe.quote if fe and fe.quote else str(value))[:2000],
                content_hash=snapshot.content_hash,
                retrieved_at=snapshot.retrieved_at,
                extraction_method=method,
            )
            self.session.add(ev)
            self.session.flush()
            self.session.add(
                Assertion(
                    subject_type="opportunity",
                    subject_id=opp.id,
                    predicate=field,
                    value={"v": value},
                    epistemic="FACT",
                    confidence="HIGH",
                    verification="UNVERIFIED",
                    evidence_id=ev.id,
                    method=method,
                    version=version,
                )
            )

    def _documents(self, opp: Opportunity, norm: NormalizedOpportunity) -> None:
        for ref in norm.documents:
            doc = self.session.scalar(
                select(Document).where(Document.opportunity_id == opp.id, Document.source_url == ref.url)
            )
            if doc is None:
                doc = Document(opportunity_id=opp.id, title=ref.title[:500], kind="tender_document", source_url=ref.url)
                self.session.add(doc)
                self.session.flush()
            if ref.content is None:
                enqueue(self.session, "fetch_document", {"document_id": str(doc.id)}, key=f"fetch_doc:{doc.id}")
                continue
            key, digest = self.store.put(ref.content, "documents/public")
            exists = self.session.scalar(
                select(DocumentVersion).where(
                    DocumentVersion.document_id == doc.id, DocumentVersion.content_hash == digest
                )
            )
            if exists:
                continue
            n = len(self.session.scalars(select(DocumentVersion.id).where(DocumentVersion.document_id == doc.id)).all())
            self.session.add(
                DocumentVersion(
                    document_id=doc.id,
                    version=n + 1,
                    content_hash=digest,
                    storage_key=key,
                    content_type=sniff_kind(ref.content),
                    byte_size=len(ref.content),
                )
            )

    def apply(
        self,
        source: Source,
        connector: SourceConnector,
        norm: NormalizedOpportunity,
        snapshot: SourceSnapshot,
        synthetic: bool,
    ) -> str:
        method = f"connector:{connector.key}:{connector.version}"
        payload = norm.payload()
        digest = content_hash(payload)
        opp = self.session.scalar(
            select(Opportunity)
            .where(Opportunity.source_id == source.id, Opportunity.external_ref == norm.external_ref)
            .with_for_update()
        )
        buyer = self._buyer(norm.buyer_name, norm.country or source.country)

        if opp is None:
            opp = Opportunity(
                source_id=source.id,
                external_ref=norm.external_ref,
                buyer_id=buyer.id if buyer else None,
                current_version=1,
                content_hash=digest,
                is_synthetic=synthetic,
                concepts=[],
                **{k: getattr(norm, k) for k in PROJECTED},
            )
            opp.country = opp.country or source.country
            self.session.add(opp)
            self.session.flush()
            self.session.add(
                OpportunityVersion(
                    opportunity_id=opp.id, version=1, content_hash=digest, payload=payload, snapshot_id=snapshot.id
                )
            )
            self.session.add(
                OpportunityEvent(
                    opportunity_id=opp.id, version=1, event_type="NEW", changes={}, idempotency_key=f"{opp.id}:1:NEW"
                )
            )
            self._lineage(opp, 1, norm, snapshot, method)
            self._documents(opp, norm)
            emit(
                self.session,
                "OpportunityDiscovered",
                "opportunity",
                opp.id,
                {"source": source.key, "external_ref": norm.external_ref},
                key=f"opp-discovered:{opp.id}",
            )
            enqueue(
                self.session,
                "analyze_opportunity",
                {"opportunity_id": str(opp.id), "version": 1},
                key=f"analyze:{opp.id}:1",
            )
            return "created"

        if opp.content_hash == digest:
            return "unchanged"

        previous = self.session.scalar(
            select(OpportunityVersion).where(
                OpportunityVersion.opportunity_id == opp.id, OpportunityVersion.version == opp.current_version
            )
        )
        changes = diff_payload(previous.payload if previous else {}, payload)
        version = opp.current_version + 1
        for k in PROJECTED:
            setattr(opp, k, getattr(norm, k))
        opp.buyer_id = buyer.id if buyer else None
        opp.current_version, opp.content_hash = version, digest
        self.session.add(
            OpportunityVersion(
                opportunity_id=opp.id, version=version, content_hash=digest, payload=payload, snapshot_id=snapshot.id
            )
        )
        for i, change in enumerate(changes):
            self.session.add(
                OpportunityEvent(
                    opportunity_id=opp.id,
                    version=version,
                    event_type=change["type"],
                    changes=_jsonable(change),
                    idempotency_key=f"{opp.id}:{version}:{i}:{change['type']}",
                )
            )
        self._lineage(opp, version, norm, snapshot, method)
        self._documents(opp, norm)
        emit(
            self.session,
            "OpportunityUpdated",
            "opportunity",
            opp.id,
            {"version": version, "changes": [c["type"] for c in changes]},
            key=f"opp-updated:{opp.id}:{version}",
        )
        if any(c["type"].startswith("DEADLINE") for c in changes):
            emit(
                self.session,
                "OpportunityDeadlineChanged",
                "opportunity",
                opp.id,
                {"version": version},
                key=f"opp-deadline:{opp.id}:{version}",
            )
        enqueue(
            self.session,
            "analyze_opportunity",
            {"opportunity_id": str(opp.id), "version": version},
            key=f"analyze:{opp.id}:{version}",
        )
        return "updated"


def _jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    if isinstance(value, datetime):
        return value.isoformat()
    return value
