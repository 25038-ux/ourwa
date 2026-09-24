"""Team, invitations, tasks, onboarding and account settings."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from forsa.api.deps import COOKIE, current_user, runtime, tenant_context, tenant_db
from forsa.db.models import User
from forsa.db.session import new_session, system_session
from forsa.identity.rbac import Role, TenantContext
from forsa.identity.security import hash_password, issue_token, verify_password
from forsa.kernel.errors import Forbidden, ForsaError
from forsa.runtime import Runtime
from forsa.services import onboarding, tasks, team

router = APIRouter(tags=["workspace"])
RoleName = Literal["OWNER", "ADMIN", "BID_MANAGER", "SALES", "TECHNICAL", "FINANCE", "LEGAL", "REVIEWER"]


# ── team ───────────────────────────────────────────────────────────────────
@router.get("/team")
def get_team(ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)) -> dict:
    return {**team.list_members(db, ctx), "can_manage": ctx.can("org.members"), "roles": [r.value for r in Role]}


class InviteIn(BaseModel):
    email: str = Field(min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    role: RoleName = "BID_MANAGER"


@router.post("/team/invites")
def create_invite(
    body: InviteIn, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    out = team.invite(db, ctx, body.email, body.role)
    db.commit()
    return out


@router.delete("/team/invites/{invite_id}")
def revoke(
    invite_id: uuid.UUID, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    team.revoke_invite(db, ctx, invite_id)
    db.commit()
    return {"ok": True}


class RoleIn(BaseModel):
    role: RoleName


@router.patch("/team/members/{membership_id}")
def set_role(
    membership_id: uuid.UUID,
    body: RoleIn,
    ctx: TenantContext = Depends(tenant_context),
    db: Session = Depends(tenant_db),
) -> dict:
    team.change_role(db, ctx, membership_id, body.role)
    db.commit()
    return {"ok": True}


@router.delete("/team/members/{membership_id}")
def remove(
    membership_id: uuid.UUID, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    team.remove_member(db, ctx, membership_id)
    db.commit()
    return {"ok": True}


@router.get("/invites/{token}")
def peek(token: str) -> dict:
    with system_session() as s:
        return team.peek_invite(s, token)


class AcceptIn(BaseModel):
    password: str = Field(min_length=10, max_length=200)
    full_name: str | None = Field(default=None, max_length=200)


@router.post("/invites/{token}/accept")
def accept(token: str, body: AcceptIn, response: Response, rt: Runtime = Depends(runtime)) -> dict:
    with system_session() as s:
        user = team.accept_invite(s, token, body.password, body.full_name)
        s.flush()
        user_id = user.id
    jwt = issue_token(user_id, rt.settings.jwt_secret, rt.settings.jwt_ttl_minutes)
    response.set_cookie(
        COOKIE,
        jwt,
        httponly=True,
        secure=rt.settings.cookie_secure,
        samesite="lax",
        max_age=rt.settings.jwt_ttl_minutes * 60,
        path="/",
    )
    return {"ok": True}


# ── tasks ──────────────────────────────────────────────────────────────────
class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=5000)
    due_at: datetime | None = None
    assignee_user_id: uuid.UUID | None = None
    bid_id: uuid.UUID | None = None
    source: Literal["manual", "ai"] = "manual"


class TaskPatch(BaseModel):
    title: str | None = Field(default=None, max_length=500)
    description: str | None = Field(default=None, max_length=5000)
    status: Literal["OPEN", "IN_PROGRESS", "DONE"] | None = None
    due_at: datetime | None = None
    assignee_user_id: uuid.UUID | None = None


@router.get("/tasks")
def get_tasks(
    mine: bool = False, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    return {"items": tasks.list_tasks(db, ctx, mine)}


@router.post("/tasks")
def post_task(body: TaskIn, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)) -> dict:
    t = tasks.create_task(
        db,
        ctx,
        body.title,
        description=body.description,
        due_at=body.due_at,
        assignee_user_id=body.assignee_user_id,
        bid_id=body.bid_id,
        source=body.source,
    )
    db.commit()
    return {"id": str(t.id)}


@router.patch("/tasks/{task_id}")
def patch_task(
    task_id: uuid.UUID, body: TaskPatch, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    tasks.update_task(db, ctx, task_id, body.model_dump(exclude_unset=True))
    db.commit()
    return {"ok": True}


@router.delete("/tasks/{task_id}")
def del_task(
    task_id: uuid.UUID, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)
) -> dict:
    tasks.delete_task(db, ctx, task_id)
    db.commit()
    return {"ok": True}


# ── onboarding ─────────────────────────────────────────────────────────────
class DescribeIn(BaseModel):
    text: str = Field(min_length=10, max_length=5000)
    lang: str = "fr"


@router.post("/onboarding/analyze")
def analyze(
    body: DescribeIn,
    ctx: TenantContext = Depends(tenant_context),
    db: Session = Depends(tenant_db),
    rt: Runtime = Depends(runtime),
) -> dict:
    ctx.require("company.read")
    out = onboarding.analyze_description(db, rt.gateway, ctx, body.text, body.lang)
    db.commit()
    return out


class CredIn(BaseModel):
    id: str = Field(max_length=80)
    status: Literal["HELD", "IN_PROGRESS", "ABSENT"] = "HELD"


class ProjectMini(BaseModel):
    title: str | None = Field(default=None, max_length=500)
    concept_ids: list[str] = []
    value: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, max_length=3)
    year: int | None = Field(default=None, ge=1950, le=2100)


class CompleteIn(BaseModel):
    legal_name: str = Field(min_length=2, max_length=300)
    country: str = Field(default="MR", min_length=2, max_length=2)
    description: str | None = Field(default=None, max_length=5000)
    regions_served: list[str] = []
    currency: str | None = Field(default="MRU", max_length=3)
    annual_turnover: float | None = Field(default=None, ge=0)
    max_project_value: float | None = Field(default=None, ge=0)
    staff_count: int | None = Field(default=None, ge=0)
    capabilities: list[str] = []
    credentials: list[CredIn] = []
    project: ProjectMini | None = None


@router.post("/onboarding/complete")
def complete(body: CompleteIn, ctx: TenantContext = Depends(tenant_context), db: Session = Depends(tenant_db)) -> dict:
    data = body.model_dump(exclude_none=True)
    data["credentials"] = [c.model_dump() for c in body.credentials]
    out = onboarding.complete(db, ctx, data)
    db.commit()
    return out


# ── account ────────────────────────────────────────────────────────────────
class ProfileIn(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    locale: Literal["fr", "en", "ar"] | None = None


@router.put("/me/profile")
def put_profile(body: ProfileIn, user: User = Depends(current_user)) -> dict:
    with new_session() as s:
        row = s.get(User, user.id)
        assert row is not None
        for k, v in body.model_dump(exclude_none=True).items():
            setattr(row, k, v)
        s.commit()
    return {"ok": True}


class DeleteAccountIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)


@router.post("/me/delete")
def delete_me(body: DeleteAccountIn, response: Response, user: User = Depends(current_user)) -> dict:
    """Delete my account (irreversible). Organisation records stay with the remaining members."""
    from forsa.services.account import delete_account

    with system_session() as s:
        out = delete_account(s, user.id, body.password)
    response.delete_cookie(COOKIE, path="/")
    return out


class PasswordIn(BaseModel):
    current: str = Field(min_length=1, max_length=200)
    new: str = Field(min_length=10, max_length=200)


@router.post("/me/password")
def change_password(body: PasswordIn, user: User = Depends(current_user)) -> dict:
    with system_session() as s:
        row = s.get(User, user.id)
        assert row is not None
        if not verify_password(body.current, row.password_hash):
            raise Forbidden("current password is incorrect")
        if body.current == body.new:
            raise ForsaError("choose a different password")
        row.password_hash = hash_password(body.new)
        from forsa.services.events import audit

        audit(s, "auth.password_changed", actor=row.id)
    return {"ok": True}
