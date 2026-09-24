from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from forsa.api.deps import runtime, tenant_context, tenant_db
from forsa.api.live import SSE_HEADERS, hub
from forsa.db.models import Membership, Notification, PushSubscription
from forsa.identity.rbac import TenantContext
from forsa.kernel.clock import utcnow
from forsa.runtime import Runtime
from forsa.services.notifications import CATEGORIES, effective_prefs

router = APIRouter(tags=["live"])
HEARTBEAT_S = 15.0


@router.get("/live")
async def live(request: Request, ctx: TenantContext = Depends(tenant_context)) -> StreamingResponse:
    """Server-Sent Events: instant notifications for the caller's organisation (and user)."""
    sub = hub().subscribe(ctx.org_id, ctx.user_id)

    async def stream():
        try:
            yield f"event: ready\ndata: {json.dumps({'org_id': str(ctx.org_id)})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(sub.queue.get(), timeout=HEARTBEAT_S)
                except TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield f"event: {event.get('kind', 'message')}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
        finally:
            hub().unsubscribe(sub)

    return StreamingResponse(stream(), media_type="text/event-stream", headers=SSE_HEADERS)


@router.get("/notifications/unread-count")
def unread_count(ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)) -> dict:
    n = db.scalar(
        select(func.count())
        .select_from(Notification)
        .where(
            Notification.org_id == ctx.org_id,
            Notification.read_at.is_(None),
            (Notification.user_id.is_(None)) | (Notification.user_id == ctx.user_id),
        )
    )
    return {"unread": n or 0}


@router.post("/notifications/read-all")
def read_all(ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)) -> dict:
    db.execute(
        update(Notification)
        .where(Notification.org_id == ctx.org_id, Notification.read_at.is_(None))
        .values(read_at=utcnow())
    )
    db.commit()
    return {"ok": True}


class PrefsIn(BaseModel):
    prefs: dict[str, dict[str, bool]]


@router.get("/me/notification-preferences")
def get_prefs(ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)) -> dict:
    m = db.scalar(select(Membership).where(Membership.org_id == ctx.org_id, Membership.user_id == ctx.user_id))
    return {"categories": list(CATEGORIES), "prefs": effective_prefs(m.notification_prefs if m else None)}


@router.put("/me/notification-preferences")
def put_prefs(body: PrefsIn, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)) -> dict:
    m = db.scalar(select(Membership).where(Membership.org_id == ctx.org_id, Membership.user_id == ctx.user_id))
    assert m is not None
    m.notification_prefs = {
        k: {"in_app": bool(v.get("in_app", True)), "push": bool(v.get("push", False))}
        for k, v in body.prefs.items()
        if k in CATEGORIES
    }
    db.commit()
    return {"prefs": effective_prefs(m.notification_prefs)}


@router.get("/push/public-key")
def push_public_key(rt: Runtime = Depends(runtime)) -> dict:
    return {
        "enabled": bool(rt.settings.vapid_public_key and rt.settings.vapid_private_key),
        "public_key": rt.settings.vapid_public_key,
    }


class PushSubIn(BaseModel):
    endpoint: str = Field(max_length=1000, pattern=r"^https://")
    keys: dict[str, str]


@router.post("/push/subscriptions")
def subscribe_push(
    body: PushSubIn, request: Request, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    db.execute(delete(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    db.add(
        PushSubscription(
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            endpoint=body.endpoint,
            p256dh=body.keys.get("p256dh", "")[:200],
            auth=body.keys.get("auth", "")[:100],
            user_agent=(request.headers.get("user-agent") or "")[:300],
        )
    )
    db.commit()
    return {"ok": True}


@router.delete("/push/subscriptions")
def unsubscribe_push(
    body: PushSubIn, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    db.execute(
        delete(PushSubscription).where(
            PushSubscription.endpoint == body.endpoint, PushSubscription.user_id == ctx.user_id
        )
    )
    db.commit()
    return {"ok": True}
