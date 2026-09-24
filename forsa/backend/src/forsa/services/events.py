"""Append-only domain event log (spec §63). Idempotent by key."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from forsa.db.models import AuditEvent, DomainEvent


def emit(
    session: Session,
    event_type: str,
    aggregate_type: str,
    aggregate_id: Any,
    payload: dict[str, Any],
    key: str,
    org_id: uuid.UUID | None = None,
) -> None:
    session.execute(
        insert(DomainEvent)
        .values(
            id=uuid.uuid4(),
            event_type=event_type,
            aggregate_type=aggregate_type,
            aggregate_id=str(aggregate_id),
            org_id=org_id,
            payload=payload,
            idempotency_key=key,
        )
        .on_conflict_do_nothing(index_elements=["idempotency_key"])
    )


def audit(
    session: Session,
    action: str,
    *,
    org_id: uuid.UUID | None = None,
    actor: uuid.UUID | None = None,
    subject_type: str | None = None,
    subject_id: Any = None,
    data: dict[str, Any] | None = None,
    request_id: str | None = None,
    ip: str | None = None,
) -> None:
    session.add(
        AuditEvent(
            org_id=org_id,
            actor_user_id=actor,
            action=action,
            subject_type=subject_type,
            subject_id=str(subject_id) if subject_id is not None else None,
            data=data or {},
            request_id=request_id,
            ip=ip,
        )
    )
