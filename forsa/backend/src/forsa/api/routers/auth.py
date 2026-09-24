from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select

from forsa.api.deps import COOKIE, current_user, runtime
from forsa.api.schemas import LoginIn
from forsa.db.models import Membership, Organization, User
from forsa.db.session import new_session
from forsa.identity.rbac import PERMISSIONS, Role
from forsa.identity.security import issue_token, verify_password
from forsa.kernel.errors import ForsaError
from forsa.runtime import Runtime
from forsa.services.events import audit

router = APIRouter(prefix="/auth", tags=["auth"])


class TooManyAttempts(ForsaError):
    code = "rate_limited"
    status = 429


class BadCredentials(ForsaError):
    code = "invalid_credentials"
    status = 401


_attempts: dict[str, deque[float]] = defaultdict(deque)  # per-process; use a shared store when scaling out


def _rate_limit(key: str, per_minute: int) -> None:
    now = time.monotonic()
    window = _attempts[key]
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= per_minute:
        raise TooManyAttempts("too many login attempts; try again in a minute")
    window.append(now)


def _me(user: User) -> dict:
    with new_session() as s:
        rows = s.execute(
            select(Membership, Organization)
            .join(Organization, Organization.id == Membership.org_id)
            .where(Membership.user_id == user.id)
            .order_by(Membership.created_at)
        ).all()
    return {
        "user": {
            "id": str(user.id),
            "email": user.email,
            "full_name": user.full_name,
            "locale": user.locale,
            "is_platform_admin": user.is_platform_admin,
        },
        "memberships": [
            {"org_id": str(o.id), "org_name": o.name, "role": m.role, "permissions": sorted(PERMISSIONS[Role(m.role)])}
            for m, o in rows
        ],
    }


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, rt: Runtime = Depends(runtime)) -> dict:
    ip = request.client.host if request.client else "?"
    _rate_limit(f"{ip}:{body.email.lower()}", rt.settings.login_rate_limit_per_minute)
    with new_session(system=True) as s:  # platform-level audit rows (org_id NULL) are system writes under RLS
        user = s.scalar(select(User).where(User.email == body.email.strip().lower()))
        ok = bool(user and user.is_active and verify_password(body.password, user.password_hash))
        audit(
            s,
            "auth.login" if ok else "auth.login_failed",
            actor=user.id if user and ok else None,
            data={"email": body.email.lower()[:320]},
            ip=ip,
            request_id=getattr(request.state, "request_id", None),
        )
        s.commit()
        if not ok or user is None:
            raise BadCredentials("invalid email or password")
        s.expunge(user)
    token = issue_token(user.id, rt.settings.jwt_secret, rt.settings.jwt_ttl_minutes)
    response.set_cookie(
        COOKIE,
        token,
        httponly=True,
        secure=rt.settings.cookie_secure,
        samesite="lax",
        max_age=rt.settings.jwt_ttl_minutes * 60,
        path="/",
    )
    return {**_me(user), "token": token}


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)) -> dict:
    return _me(user)
