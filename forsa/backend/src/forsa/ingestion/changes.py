"""Change detection between two normalised payloads (spec §27–28).

Produces typed lifecycle events; history is appended, never overwritten.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

_STATUS_EVENTS = {
    "CANCELLED": "CANCELLED",
    "PROVISIONAL_AWARD": "AWARDED",
    "FINAL_AWARD": "AWARDED",
    "CLOSED": "CLOSED",
    "EXTENDED": "EXTENDED",
    "CLARIFICATION": "CLARIFICATION",
    "PUBLISHED": "PUBLISHED",
}


def _dt(value: Any) -> datetime | None:
    return datetime.fromisoformat(value) if isinstance(value, str) else None


def diff_payload(old: dict[str, Any], new: dict[str, Any]) -> list[dict[str, Any]]:
    """Return a list of ``{"type": …, "field": …, "old": …, "new": …}`` change events."""
    events: list[dict[str, Any]] = []
    changed = {k for k in set(old) | set(new) if old.get(k) != new.get(k)}
    if "deadline_at" in changed:
        before, after = _dt(old.get("deadline_at")), _dt(new.get("deadline_at"))
        kind = "DEADLINE_CHANGED"
        if before and after:
            kind = "DEADLINE_EXTENDED" if after > before else "DEADLINE_SHORTENED"
        events.append(
            {"type": kind, "field": "deadline_at", "old": old.get("deadline_at"), "new": new.get("deadline_at")}
        )
    if "status" in changed:
        events.append(
            {
                "type": _STATUS_EVENTS.get(str(new.get("status")), "STATUS_CHANGED"),
                "field": "status",
                "old": old.get("status"),
                "new": new.get("status"),
            }
        )
    if "documents" in changed:
        events.append(
            {
                "type": "DOCUMENTS_CHANGED",
                "field": "documents",
                "added": sorted(set(new.get("documents") or []) - set(old.get("documents") or [])),
                "removed": sorted(set(old.get("documents") or []) - set(new.get("documents") or [])),
            }
        )
    for key in sorted(changed - {"deadline_at", "status", "documents"}):
        events.append({"type": "MODIFIED", "field": key, "old": old.get(key), "new": new.get(key)})
    return events
