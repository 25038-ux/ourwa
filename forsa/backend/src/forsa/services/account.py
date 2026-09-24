"""Account deletion (privacy + App Store guideline 5.1.1(v)): the person leaves, the company's records stay.

Personal data is removed or anonymised; organisation records (bids, evidence, decisions) remain available to the
other members because they belong to the organisation. The last owner of an organisation with other members must
hand over ownership first, so no organisation is left without an owner.
"""

from __future__ import annotations

import secrets
import uuid

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from forsa.db.models import (
    AssistantConversation,
    Membership,
    Notification,
    PushSubscription,
    Task,
    User,
)
from forsa.identity.rbac import Role
from forsa.identity.security import hash_password, verify_password
from forsa.kernel.errors import Conflict, Forbidden, NotFound
from forsa.services.events import audit


def delete_account(session: Session, user_id: uuid.UUID, password: str) -> dict:
    """Run in a system session (spans organisations). Irreversible."""
    user = session.get(User, user_id)
    if user is None or not user.is_active:
        raise NotFound("account not found")
    if not verify_password(password, user.password_hash):
        raise Forbidden("password is incorrect")
    memberships = session.scalars(select(Membership).where(Membership.user_id == user.id)).all()
    for m in memberships:
        if m.role != Role.OWNER.value:
            continue
        owners = session.scalar(
            select(func.count())
            .select_from(Membership)
            .where(Membership.org_id == m.org_id, Membership.role == "OWNER")
        )
        others = session.scalar(
            select(func.count())
            .select_from(Membership)
            .where(Membership.org_id == m.org_id, Membership.user_id != user.id)
        )
        if owners == 1 and others:
            raise Conflict("you are the last owner of an organisation: make another member owner first")
    orgs = [m.org_id for m in memberships]
    session.execute(delete(PushSubscription).where(PushSubscription.user_id == user.id))
    session.execute(delete(AssistantConversation).where(AssistantConversation.user_id == user.id))
    session.execute(delete(Notification).where(Notification.user_id == user.id))
    session.execute(update(Task).where(Task.assignee_user_id == user.id).values(assignee_user_id=None))
    session.execute(delete(Membership).where(Membership.user_id == user.id))
    user.email = f"deleted-{user.id}@deleted.invalid"
    user.full_name = "Compte supprimé"
    user.password_hash = hash_password(secrets.token_urlsafe(32))
    user.is_active = False
    user.is_platform_admin = False
    audit(session, "auth.account_deleted", actor=user.id, subject_type="user", subject_id=user.id)
    return {"deleted": True, "organisations_left": len(orgs)}
