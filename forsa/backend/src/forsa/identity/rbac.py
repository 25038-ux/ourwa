"""Organisation-scoped roles and permissions (spec §38). Enforced server-side only."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from enum import StrEnum

from forsa.kernel.errors import Forbidden


class Role(StrEnum):
    OWNER = "OWNER"
    ADMIN = "ADMIN"
    BID_MANAGER = "BID_MANAGER"
    SALES = "SALES"
    TECHNICAL = "TECHNICAL"
    FINANCE = "FINANCE"
    LEGAL = "LEGAL"
    REVIEWER = "REVIEWER"


READ = {
    "opportunity.read",
    "match.read",
    "company.read",
    "bid.read",
    "briefing.read",
    "notification.read",
    "source.read",
}
PERMISSIONS: dict[Role, frozenset[str]] = {
    Role.OWNER: frozenset(
        READ
        | {
            "company.edit",
            "company.verify",
            "match.recompute",
            "match.update",
            "bid.create",
            "bid.edit",
            "bid.decide",
            "approval.request",
            "approval.decide",
            "bid.submit",
            "bid.outcome",
            "feedback.write",
            "document.upload",
            "org.members",
        }
    ),
    Role.ADMIN: frozenset(
        READ
        | {
            "company.edit",
            "company.verify",
            "match.recompute",
            "match.update",
            "bid.create",
            "bid.edit",
            "bid.decide",
            "approval.request",
            "approval.decide",
            "bid.submit",
            "bid.outcome",
            "feedback.write",
            "document.upload",
            "org.members",
        }
    ),
    Role.BID_MANAGER: frozenset(
        READ
        | {
            "company.edit",
            "match.recompute",
            "match.update",
            "bid.create",
            "bid.edit",
            "bid.decide",
            "approval.request",
            "bid.submit",
            "bid.outcome",
            "feedback.write",
            "document.upload",
        }
    ),
    Role.SALES: frozenset(READ | {"match.update", "bid.create", "feedback.write"}),
    Role.TECHNICAL: frozenset(READ | {"bid.edit", "feedback.write", "document.upload"}),
    Role.FINANCE: frozenset(READ | {"bid.edit", "feedback.write", "document.upload"}),
    Role.LEGAL: frozenset(READ | {"bid.edit", "approval.decide", "feedback.write", "document.upload"}),
    Role.REVIEWER: frozenset(READ | {"feedback.write"}),
}


@dataclass(frozen=True)
class TenantContext:
    """Who is acting, for which organisation. Built from the DB on every request — never from client claims."""

    org_id: uuid.UUID
    user_id: uuid.UUID
    role: Role
    request_id: str | None = None
    ip: str | None = None

    def can(self, permission: str) -> bool:
        return permission in PERMISSIONS[self.role]

    def require(self, permission: str) -> None:
        if not self.can(permission):
            raise Forbidden(f"role {self.role.value} lacks permission {permission}")
