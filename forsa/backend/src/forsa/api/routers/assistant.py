from __future__ import annotations

import json
import uuid
from collections.abc import Iterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from forsa.ai.types import Sensitivity, Tier
from forsa.api.deps import runtime, tenant_context, tenant_db
from forsa.api.live import SSE_HEADERS
from forsa.assistant.service import run_turn
from forsa.db.models import AssistantConversation, AssistantMessage
from forsa.db.session import new_session
from forsa.identity.rbac import TenantContext
from forsa.kernel.errors import NotFound
from forsa.runtime import Runtime

router = APIRouter(prefix="/assistant", tags=["assistant"])


class AskIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    conversation_id: uuid.UUID | None = None
    lang: str = Field(default="fr", pattern="^(fr|en|ar)$")
    opportunity_id: str | None = Field(default=None, max_length=64)
    stream: bool = True


@router.get("/status")
def status(
    ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db), rt: Runtime = Depends(runtime)
) -> dict:
    ctx.require("opportunity.read")
    cands = rt.gateway.candidates(db, Tier.FAST, Sensitivity.INTERNAL)
    decision = rt.gateway.candidates(db, Tier.DECISION, Sensitivity.INTERNAL)
    return {
        "mode": "llm" if cands else "deterministic",
        "features": sorted(rt.settings.features),
        "decision_model": decision[0][0].name if decision else None,
        "providers": [{"id": c.id, "name": c.name, "model": m, "region": c.region} for c, m in cands[:3]],
        "voice": {"stt": "browser", "tts": "browser"},
    }


@router.post("/messages")
def ask(body: AskIn, ctx: TenantContext = Depends(tenant_context), rt: Runtime = Depends(runtime)):
    """Ask the assistant. Streams Server-Sent Events (meta → tool* → delta* → final) unless stream=false."""
    ctx.require("opportunity.read")

    def events() -> Iterator[dict]:
        session = new_session(org_id=ctx.org_id)
        try:
            yield from run_turn(
                session,
                rt.gateway,
                ctx,
                body.text,
                ui_lang=body.lang,
                conversation_id=body.conversation_id,
                focus_opportunity_id=body.opportunity_id,
            )
        except NotFound as exc:
            yield {"type": "error", "code": exc.code, "message": str(exc)}
        finally:
            session.close()

    if not body.stream:
        final: dict = {}
        for event in events():
            if event["type"] in ("final", "error"):
                final = event
        return final

    def sse() -> Iterator[str]:
        for event in events():
            yield f"event: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream", headers=SSE_HEADERS)


@router.get("/conversations")
def conversations(ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)) -> dict:
    rows = db.scalars(
        select(AssistantConversation)
        .where(AssistantConversation.org_id == ctx.org_id, AssistantConversation.user_id == ctx.user_id)
        .order_by(AssistantConversation.updated_at.desc())
        .limit(30)
    ).all()
    return {"items": [{"id": str(c.id), "title": c.title, "updated_at": c.updated_at} for c in rows]}


@router.get("/conversations/{conversation_id}")
def conversation(
    conversation_id: uuid.UUID, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    conv = db.get(AssistantConversation, conversation_id)
    if conv is None or conv.org_id != ctx.org_id or conv.user_id != ctx.user_id:
        raise NotFound("conversation not found")
    msgs = db.scalars(
        select(AssistantMessage)
        .where(AssistantMessage.conversation_id == conv.id)
        .order_by(AssistantMessage.created_at)
    ).all()
    return {
        "id": str(conv.id),
        "title": conv.title,
        "messages": [
            {
                "id": str(m.id),
                "role": m.role,
                "content": m.content,
                "tools": m.tools,
                "citations": m.citations,
                "actions": m.actions,
                "mode": m.mode,
                "at": m.created_at,
            }
            for m in msgs
        ],
    }


@router.delete("/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: uuid.UUID, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    conv = db.get(AssistantConversation, conversation_id)
    if conv is None or conv.org_id != ctx.org_id or conv.user_id != ctx.user_id:
        raise NotFound("conversation not found")
    db.delete(conv)
    db.commit()
    return {"ok": True}
