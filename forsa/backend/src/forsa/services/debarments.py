"""Excluded-company lists (e.g. ARMP « liste rouge »): sync + due-diligence lookups.

A match is a *signal to verify*, not a verdict: names are compared after normalisation, and registry numbers
(NRC) are shown so a human can confirm it is the same legal entity.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from forsa.db.models import Debarment
from forsa.kernel.clock import utcnow
from forsa.kernel.hashing import content_hash
from forsa.taxonomy.normalize import normalize_key

_LEGAL_FORMS = r"\b(sarl|sa|sas|sasu|suarl|eurl|ets|etablissements?|ste|societe|company|co|ltd|llc|gie|groupe?)\b"


def name_key(name: str) -> str:
    key = normalize_key(name)
    key = re.sub(_LEGAL_FORMS, " ", key)
    return re.sub(r"[^a-z0-9؀-ۿ]+", "", key)


def upsert(session: Session, source_key: str, rows: list[dict[str, Any]], country: str | None) -> dict[str, int]:
    now = utcnow()
    stats = {"seen": 0, "new": 0}
    for r in rows:
        digest = content_hash({k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in r.items()})
        existing = session.scalar(
            select(Debarment).where(Debarment.source_key == source_key, Debarment.external_ref == r["external_ref"])
        )
        stats["seen"] += 1
        if existing is None:
            stats["new"] += 1
        stmt = insert(Debarment).values(
            source_key=source_key,
            name_key=name_key(r["entity_name"]),
            country=country,
            content_hash=digest,
            last_seen_at=now,
            **r,
        )
        session.execute(
            stmt.on_conflict_do_update(
                index_elements=["source_key", "external_ref"],
                set_={
                    "entity_name": stmt.excluded.entity_name,
                    "name_key": stmt.excluded.name_key,
                    "registry_number": stmt.excluded.registry_number,
                    "nature": stmt.excluded.nature,
                    "reference": stmt.excluded.reference,
                    "effective_date": stmt.excluded.effective_date,
                    "document_url": stmt.excluded.document_url,
                    "content_hash": stmt.excluded.content_hash,
                    "last_seen_at": now,
                },
            )
        )
    return stats


def serialize(d: Debarment) -> dict[str, Any]:
    return {
        "id": str(d.id),
        "entity_name": d.entity_name,
        "registry_number": d.registry_number,
        "nature": d.nature,
        "reference": d.reference,
        "effective_date": d.effective_date,
        "document_url": d.document_url,
        "source": d.source_key,
        "last_seen_at": d.last_seen_at,
    }


def check(session: Session, name: str) -> list[dict[str, Any]]:
    """Possible matches for a company name (exact normalised key, or one key containing the other)."""
    key = name_key(name)
    if len(key) < 3:
        return []
    rows = session.scalars(select(Debarment)).all()
    hits = [d for d in rows if d.name_key == key or (len(d.name_key) >= 4 and (d.name_key in key or key in d.name_key))]
    return [{**serialize(d), "match": "exact" if d.name_key == key else "partial"} for d in hits]
