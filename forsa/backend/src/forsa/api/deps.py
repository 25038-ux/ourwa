"""Request-scoped dependencies: authentication, tenant context, tenant-scoped DB session."""

from __future__ import annotations

import uuid
from collections.abc import Iterator

from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from forsa.db.models import Membership, User
from forsa.db.session import new_session
from forsa.identity.rbac import Role, TenantContext
from forsa.identity.security import decode_token
from forsa.kernel.errors import Forbidden, ForsaError
from forsa.runtime import Runtime, get_runtime

COOKIE = "forsa_session"


class Unauthorized(ForsaError):
    code = "unauthorized"
    status = 401


def runtime() -> Runtime:
    return get_runtime()


def _token(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.cookies.get(COOKIE)


def current_user(request: Request, rt: Runtime = Depends(runtime)) -> User:
    token = _token(request)
    user_id = decode_token(token, rt.settings.jwt_secret) if token else None
    if user_id is None:
        raise Unauthorized("authentication required")
    with new_session() as s:
        user = s.get(User, user_id)
        if user is None or not user.is_active:
            raise Unauthorized("authentication required")
        s.expunge(user)
    return user


def tenant_context(
    request: Request, user: User = Depends(current_user), x_org_id: str | None = Header(default=None)
) -> TenantContext:
    """Resolve the organisation and role from the database. Client-supplied roles are never trusted."""
    with new_session() as s:
        q = select(Membership).where(Membership.user_id == user.id).order_by(Membership.created_at)
        memberships = s.scalars(q).all()
    if not memberships:
        raise Forbidden("user has no organisation")
    chosen = memberships[0]
    x_org_id = x_org_id or request.query_params.get("org")  # EventSource cannot send headers
    if x_org_id:
        try:
            wanted = uuid.UUID(x_org_id)
        except ValueError as exc:
            raise Forbidden("invalid organisation") from exc
        match = next((m for m in memberships if m.org_id == wanted), None)
        if match is None:
            raise Forbidden("not a member of this organisation")
        chosen = match
    return TenantContext(
        org_id=chosen.org_id,
        user_id=user.id,
        role=Role(chosen.role),
        request_id=getattr(request.state, "request_id", None),
        ip=request.client.host if request.client else None,
    )


def tenant_db(ctx: TenantContext = Depends(tenant_context)) -> Iterator[Session]:
    """A session whose every transaction is pinned to the caller's organisation (RLS)."""
    session = new_session(org_id=ctx.org_id)
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def platform_admin(user: User = Depends(current_user)) -> User:
    if not user.is_platform_admin:
        raise Forbidden("platform administrator only")
    return user
