"""Notifications (spec §40, ADR-012): one entry point, preferences, instant in-app delivery, optional Web Push.

* `notify()` inserts idempotently. A Postgres trigger (`forsa_notify_live`, migration 0002) announces every
  committed row on channel `forsa_live`; API processes fan it out to open SSE streams in milliseconds.
* If the row was new, a `deliver_notification` job is enqueued in the same transaction (outbox pattern) to
  send Web Push to subscribed devices whose owners enabled push for that category.
"""

from __future__ import annotations

import base64
import json
import logging
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from forsa.db.models import Membership, Notification, PushSubscription
from forsa.jobs.queue import enqueue
from forsa.kernel.clock import utcnow

log = logging.getLogger("forsa.notifications")

CATEGORIES: dict[str, dict[str, Any]] = {
    # category: default channels + default priority
    "high_fit_opportunity": {"push": True, "priority": "high"},
    "tender_change": {"push": True, "priority": "high"},
    "deadline": {"push": True, "priority": "high"},
    "approval_request": {"push": True, "priority": "high"},
    "task_assignment": {"push": True, "priority": "normal"},
    "missing_document": {"push": False, "priority": "normal"},
    "partner_match": {"push": False, "priority": "normal"},
    "early_signal": {"push": False, "priority": "normal"},
    "award": {"push": False, "priority": "normal"},
    "daily_briefing": {"push": False, "priority": "low"},
    "system": {"push": False, "priority": "low"},
}


def effective_prefs(prefs: dict[str, Any] | None) -> dict[str, dict[str, bool]]:
    prefs = prefs or {}
    return {
        cat: {
            "in_app": bool((prefs.get(cat) or {}).get("in_app", True)),
            "push": bool((prefs.get(cat) or {}).get("push", d["push"])),
        }
        for cat, d in CATEGORIES.items()
    }


def notify(
    session: Session,
    org_id: uuid.UUID,
    category: str,
    title: str,
    *,
    key: str,
    body: str | None = None,
    payload: dict[str, Any] | None = None,
    user_id: uuid.UUID | None = None,
    priority: str | None = None,
) -> uuid.UUID | None:
    """Create a notification once per `key`. Returns the new id, or None if it already existed."""
    if category not in CATEGORIES:
        raise ValueError(f"unknown notification category {category}")
    new_id = session.execute(
        insert(Notification)
        .values(
            id=uuid.uuid4(),
            org_id=org_id,
            user_id=user_id,
            category=category,
            title=title[:300],
            body=body,
            payload=payload or {},
            idempotency_key=key,
            priority=priority or CATEGORIES[category]["priority"],
        )
        .on_conflict_do_nothing(index_elements=["idempotency_key"])
        .returning(Notification.id)
    ).scalar()
    if new_id is not None:
        enqueue(
            session,
            "deliver_notification",
            {"notification_id": str(new_id)},
            org_id=org_id,
            key=f"deliver:{new_id}",
            max_attempts=3,
        )
    return new_id


def send_push(subscription: PushSubscription, data: dict[str, Any], private_key: str, subject: str) -> int:
    """Send one Web Push message. Returns the HTTP status (201 = accepted). Requires `forsa[push]`."""
    from pywebpush import WebPushException, webpush

    try:
        resp = webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
            },
            data=json.dumps(data, ensure_ascii=False),
            vapid_private_key=private_key,
            vapid_claims={"sub": subject},
            ttl=3600,
            timeout=10,
        )
        return int(getattr(resp, "status_code", 201))
    except WebPushException as exc:
        return int(exc.response.status_code) if exc.response is not None else 0


def deliver(
    session: Session, notification_id: uuid.UUID, *, private_key: str | None, subject: str, sender: Any = send_push
) -> dict[str, Any]:
    n = session.get(Notification, notification_id)
    if n is None:
        return {"skipped": "missing"}
    if not private_key:
        return {"skipped": "web push not configured (FORSA_VAPID_PRIVATE_KEY)"}
    q = select(PushSubscription).where(PushSubscription.org_id == n.org_id)
    if n.user_id:
        q = q.where(PushSubscription.user_id == n.user_id)
    prefs = {
        m.user_id: effective_prefs(m.notification_prefs)
        for m in session.scalars(select(Membership).where(Membership.org_id == n.org_id)).all()
    }
    sent = removed = 0
    data = {
        "id": str(n.id),
        "title": n.title,
        "body": n.body or "",
        "category": n.category,
        "url": _url_for(n),
        "priority": n.priority,
    }
    for sub in session.scalars(q).all():
        if not prefs.get(sub.user_id, effective_prefs(None)).get(n.category, {}).get("push"):
            continue
        status = sender(sub, data, private_key, subject)
        if status in (404, 410):  # subscription expired or unsubscribed at the push service
            session.delete(sub)
            removed += 1
        elif 200 <= status < 300:
            sub.last_success_at, sub.failures = utcnow(), 0
            sent += 1
        else:
            sub.failures += 1
    n.pushed_at = utcnow() if sent else n.pushed_at
    return {"sent": sent, "removed": removed}


def _url_for(n: Notification) -> str:
    p = n.payload or {}
    if p.get("opportunity_id"):
        return f"/opportunities/{p['opportunity_id']}"
    if p.get("bid_id"):
        return f"/bids/{p['bid_id']}"
    if n.category == "task_assignment":
        return "/tasks"
    return "/notifications"


def generate_vapid_keys() -> dict[str, str]:
    """Generate a VAPID key pair (base64url raw private key + uncompressed public key)."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    key = ec.generate_private_key(ec.SECP256R1())
    raw_private = key.private_numbers().private_value.to_bytes(32, "big")
    public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)

    def b64(b: bytes) -> str:
        return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

    return {"private_key": b64(raw_private), "public_key": b64(public)}
