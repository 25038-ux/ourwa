"""Connector contract (spec §25, ADR-006).

Connectors know *one source*. They never touch the database, the ontology or
tenants: they turn bytes from an allowed source into NormalizedOpportunity
records with field-level evidence. Everything else (dedup, versioning, change
detection, lineage) is done once, generically, by the pipeline.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any, Protocol


class SourceHealth(StrEnum):
    UP = "UP"
    DEGRADED = "DEGRADED"
    STALE = "STALE"
    DOWN = "DOWN"
    BLOCKED = "BLOCKED"
    AUTH_REQUIRED = "AUTH_REQUIRED"
    UNVERIFIED = "UNVERIFIED"  # registry entry not yet verified (Phase 0 gate)


@dataclass(frozen=True, slots=True)
class SourceRef:
    url: str
    external_ref: str | None = None
    kind: str = "notice"  # notice | listing | document
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RawRecord:
    ref: SourceRef
    content: bytes
    content_type: str | None
    retrieved_at: datetime
    canonical_url: str
    etag: str | None = None
    last_modified: str | None = None


@dataclass(frozen=True, slots=True)
class FieldEvidence:
    quote: str | None = None
    locator: str | None = None  # e.g. "json:$.deadline", "table row 3 › col 'Date limite'"


@dataclass(slots=True)
class DocumentRef:
    url: str
    title: str
    content: bytes | None = None  # inline bytes (fixtures); otherwise fetched later by a job
    content_type: str | None = None


@dataclass(slots=True)
class NormalizedOpportunity:
    external_ref: str
    title: str
    kind: str = "TENDER"
    description: str | None = None
    buyer_name: str | None = None
    country: str | None = None
    region: str | None = None
    category: str | None = None  # works | goods | services | consulting
    method: str | None = None
    funding_source: str | None = None
    currency: str | None = None
    estimated_value: float | None = None
    published_at: datetime | None = None
    deadline_at: datetime | None = None
    status: str = "PUBLISHED"
    language: str | None = None
    url: str | None = None
    consortium_allowed: bool | None = None
    # Source-specific structure that has no dedicated column (e.g. award winners, planned launch dates).
    # Tracked and versioned like every other field; keep it JSON-serialisable and free of personal data.
    attributes: dict[str, Any] = field(default_factory=dict)
    documents: list[DocumentRef] = field(default_factory=list)
    evidence: dict[str, FieldEvidence] = field(default_factory=dict)

    TRACKED = (
        "title",
        "kind",
        "description",
        "buyer_name",
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
        "attributes",
    )

    def payload(self) -> dict[str, Any]:
        data = asdict(self)
        out = {k: data[k] for k in self.TRACKED}
        for k in ("published_at", "deadline_at"):
            if out[k] is not None:
                out[k] = out[k].isoformat()
        out["documents"] = sorted({d.url for d in self.documents})
        return out


class SourceConnector(Protocol):
    key: str
    version: str

    def discover(self) -> Iterable[SourceRef]: ...

    def fetch(self, ref: SourceRef) -> RawRecord: ...

    def parse(self, raw: RawRecord) -> list[NormalizedOpportunity]: ...

    def health_check(self) -> SourceHealth: ...
