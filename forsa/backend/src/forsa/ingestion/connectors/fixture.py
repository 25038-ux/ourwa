"""Local JSON fixture connector — dev, demos, tests and the concierge MVP.

Records it produces are flagged ``is_synthetic`` by the pipeline when the
registry says ``access_type: synthetic_fixture`` so they can never be shown as
real opportunities.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path

from forsa.ingestion.contracts import (
    DocumentRef,
    FieldEvidence,
    NormalizedOpportunity,
    RawRecord,
    SourceHealth,
    SourceRef,
)
from forsa.kernel.clock import ensure_aware, utcnow

_ANCHOR = re.compile(r"^@anchor(?:([+-])(\d+)d)?$")


def resolve_date(value: str | None, anchor: date) -> datetime | None:
    """Fixture dates are ISO strings or ``@anchor±Nd`` (relative to a *fixed* configurable anchor, so runs stay
    idempotent; bump FORSA_DEMO_ANCHOR to refresh demo deadlines)."""
    if not value:
        return None
    m = _ANCHOR.match(value)
    if m:
        days = int(m.group(2) or 0) * (-1 if m.group(1) == "-" else 1)
        return datetime.combine(anchor + timedelta(days=days), time(12, 0), UTC)
    return ensure_aware(datetime.fromisoformat(value))


class FixtureConnector:
    version = "fixture-v1"

    def __init__(self, key: str, directory: Path, anchor: date | None = None):
        self.key = key
        self.directory = Path(directory)
        self.anchor = anchor or utcnow().date()

    def discover(self) -> Iterable[SourceRef]:
        for path in sorted(self.directory.glob("*.json")):
            yield SourceRef(url=path.resolve().as_uri(), external_ref=path.stem)

    def fetch(self, ref: SourceRef) -> RawRecord:
        path = Path(ref.url.removeprefix("file://"))
        if self.directory.resolve() not in path.resolve().parents:
            raise ValueError("fixture path escapes fixture directory")
        return RawRecord(
            ref=ref,
            content=path.read_bytes(),
            content_type="application/json",
            retrieved_at=utcnow(),
            canonical_url=f"fixture://{self.key}/{path.name}",
        )

    def parse(self, raw: RawRecord) -> list[NormalizedOpportunity]:
        data = json.loads(raw.content)
        items = data if isinstance(data, list) else [data]
        return [self._normalize(item) for item in items]

    def _normalize(self, d: dict) -> NormalizedOpportunity:
        def dt(key: str) -> datetime | None:
            return resolve_date(d.get(key), self.anchor)

        docs = [
            DocumentRef(
                url=doc["url"],
                title=doc.get("title", doc["url"]),
                content=doc["text"].encode("utf-8") if doc.get("text") else None,
                content_type="text/plain" if doc.get("text") else None,
            )
            for doc in d.get("documents", [])
        ]
        norm = NormalizedOpportunity(
            external_ref=d["reference"],
            title=d["title"],
            kind=d.get("kind", "TENDER"),
            description=d.get("description"),
            buyer_name=d.get("buyer"),
            country=d.get("country"),
            region=d.get("region"),
            category=d.get("category"),
            method=d.get("method"),
            funding_source=d.get("funding_source"),
            currency=d.get("currency"),
            estimated_value=d.get("estimated_value"),
            published_at=dt("published_at"),
            deadline_at=dt("deadline_at"),
            status=d.get("status", "PUBLISHED"),
            language=d.get("language"),
            url=d.get("url"),
            consortium_allowed=d.get("consortium_allowed"),
            documents=docs,
        )
        norm.evidence = {k: FieldEvidence(quote=str(d[k]), locator=f"json:$.{k}") for k in d if k != "documents"}
        return norm

    def health_check(self) -> SourceHealth:
        return SourceHealth.UP if self.directory.is_dir() else SourceHealth.DOWN
