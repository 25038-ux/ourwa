"""Team: members, roles and one-time invitations (spec §38). Authorisation is always server-side."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from forsa.db.models import Invite, Membership, Organization, User
from forsa.identity.rbac import Role, TenantContext
from forsa.identity.security import hash_password, verify_password
from forsa.kernel.clock import utcnow
from forsa.kernel.errors import Conflict, Forbidden, ForsaError, NotFound
from forsa.services.events import audit

INVITE_TTL = timedelta(days=7)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def list_members(session: Session, ctx: TenantContext) -> dict[str, Any]:
    rows = session.execute(
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(Membership.org_id == ctx.org_id)
        .order_by(Membership.created_at)
    ).all()
    invites = session.scalars(
        select(Invite).where(
            Invite.org_id == ctx.org_id,
            Invite.accepted_at.is_(None),
            Invite.revoked_at.is_(None),
            Invite.expires_at > utcnow(),
        )
    ).all()
    return {
        "members": [
            {
                "membership_id": str(m.id),
                "user_id": str(u.id),
                "email": u.email,
                "full_name": u.full_name,
                "role": m.role,
                "is_me": u.id == ctx.user_id,
                "since": m.created_at,
            }
            for m, u in rows
        ],
        "invites": [{"id": str(i.id), "email": i.email, "role": i.role, "expires_at": i.expires_at} for i in invites],
    }


def _owners(session: Session, org_id: uuid.UUID) -> int:
    return (
        session.scalar(
            select(func.count())
            .select_from(Membership)
            .where(Membership.org_id == org_id, Membership.role == Role.OWNER.value)
        )
        or 0
    )


def invite(session: Session, ctx: TenantContext, email: str, role: str) -> dict[str, Any]:
    ctx.require("org.members")
    Role(role)
    if role == Role.OWNER.value and ctx.role != Role.OWNER:
        raise Forbidden("only an owner can invite another owner")
    email = email.strip().lower()
    existing = session.scalar(
        select(Membership)
        .join(User, User.id == Membership.user_id)
        .where(Membership.org_id == ctx.org_id, User.email == email)
    )
    if existing:
        raise Conflict("this person is already a member")
    token = secrets.token_urlsafe(32)
    inv = Invite(
        org_id=ctx.org_id,
        email=email,
        role=role,
        token_hash=_hash(token),
        invited_by=ctx.user_id,
        expires_at=utcnow() + INVITE_TTL,
    )
    session.add(inv)
    session.flush()
    audit(
        session,
        "team.invited",
        org_id=ctx.org_id,
        actor=ctx.user_id,
        subject_type="invite",
        subject_id=inv.id,
        data={"email": email, "role": role},
        request_id=ctx.request_id,
        ip=ctx.ip,
    )
    # The token is returned exactly once; only its hash is stored. Share the link through a trusted channel.
    return {"id": str(inv.id), "token": token, "path": f"/invite/{token}", "expires_at": inv.expires_at}


def revoke_invite(session: Session, ctx: TenantContext, invite_id: uuid.UUID) -> None:
    ctx.require("org.members")
    inv = session.get(Invite, invite_id)
    if inv is None or inv.org_id != ctx.org_id:
        raise NotFound("invite not found")
    inv.revoked_at = utcnow()


def peek_invite(session: Session, token: str) -> dict[str, Any]:
    """Public: what an invite link is for (called with a system session)."""
    inv = session.scalar(select(Invite).where(Invite.token_hash == _hash(token)))
    if inv is None or inv.accepted_at or inv.revoked_at or inv.expires_at < utcnow():
        raise NotFound("invitation not found or expired")
    org = session.get(Organization, inv.org_id)
    has_account = session.scalar(select(User.id).where(User.email == inv.email)) is not None
    return {"email": inv.email, "role": inv.role, "org_name": org.name if org else "", "has_account": has_account}


def accept_invite(session: Session, token: str, password: str, full_name: str | None) -> User:
    """Public: accept an invitation (system session). Existing accounts must prove their password."""
    inv = session.scalar(select(Invite).where(Invite.token_hash == _hash(token)).with_for_update())
    if inv is None or inv.accepted_at or inv.revoked_at or inv.expires_at < utcnow():
        raise NotFound("invitation not found or expired")
    user = session.scalar(select(User).where(User.email == inv.email))
    if user is None:
        if not full_name:
            raise ForsaError("full name required")
        user = User(email=inv.email, full_name=full_name.strip()[:200], password_hash=hash_password(password))
        session.add(user)
        session.flush()
    elif not verify_password(password, user.password_hash):
        raise Forbidden("wrong password for the existing account")
    if not session.scalar(select(Membership).where(Membership.org_id == inv.org_id, Membership.user_id == user.id)):
        session.add(Membership(org_id=inv.org_id, user_id=user.id, role=inv.role))
    inv.accepted_at = utcnow()
    audit(session, "team.invite_accepted", org_id=inv.org_id, actor=user.id, subject_type="invite", subject_id=inv.id)
    return user


def change_role(session: Session, ctx: TenantContext, membership_id: uuid.UUID, role: str) -> Membership:
    ctx.require("org.members")
    Role(role)
    m = session.get(Membership, membership_id)
    if m is None or m.org_id != ctx.org_id:
        raise NotFound("member not found")
    if Role.OWNER.value in (role, m.role) and ctx.role != Role.OWNER:
        raise Forbidden("only an owner can grant or remove the owner role")
    if m.role == Role.OWNER.value and role != Role.OWNER.value and _owners(session, ctx.org_id) <= 1:
        raise Conflict("an organisation must keep at least one owner")
    before, m.role = m.role, role
    audit(
        session,
        "team.role_changed",
        org_id=ctx.org_id,
        actor=ctx.user_id,
        subject_type="membership",
        subject_id=m.id,
        data={"from": before, "to": role},
        request_id=ctx.request_id,
        ip=ctx.ip,
    )
    return m


def remove_member(session: Session, ctx: TenantContext, membership_id: uuid.UUID) -> None:
    ctx.require("org.members")
    m = session.get(Membership, membership_id)
    if m is None or m.org_id != ctx.org_id:
        raise NotFound("member not found")
    if m.role == Role.OWNER.value and (ctx.role != Role.OWNER or _owners(session, ctx.org_id) <= 1):
        raise Conflict("cannot remove this owner")
    session.delete(m)
    audit(
        session,
        "team.member_removed",
        org_id=ctx.org_id,
        actor=ctx.user_id,
        subject_type="membership",
        subject_id=membership_id,
        request_id=ctx.request_id,
        ip=ctx.ip,
    )
