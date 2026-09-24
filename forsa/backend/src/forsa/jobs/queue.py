"""Postgres-backed job queue (ADR-008): FOR UPDATE SKIP LOCKED, idempotency keys, backoff, dead-letter.

Jobs are enqueued in the *same transaction* as the state change that caused
them, so there is no dual-write problem and no separate broker to operate.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from forsa.db.models import Job
from forsa.kernel.clock import utcnow

STALE_LOCK = timedelta(minutes=15)


def enqueue(
    session: Session,
    kind: str,
    payload: dict[str, Any] | None = None,
    *,
    key: str | None = None,
    org_id: uuid.UUID | None = None,
    delay_s: float = 0,
    max_attempts: int = 5,
) -> None:
    """Idempotent: a second enqueue with the same key is a no-op."""
    stmt = (
        insert(Job)
        .values(
            id=uuid.uuid4(),
            kind=kind,
            payload=payload or {},
            org_id=org_id,
            idempotency_key=key,
            status="QUEUED",
            attempts=0,
            max_attempts=max_attempts,
            run_after=utcnow() + timedelta(seconds=delay_s),
        )
        .on_conflict_do_nothing(index_elements=["idempotency_key"])
    )
    session.execute(stmt)


def claim(session: Session, worker_id: str, kinds: list[str] | None = None) -> Job | None:
    now = utcnow()
    # Recover jobs whose worker died mid-flight.
    session.execute(
        update(Job)
        .where(Job.status == "RUNNING", Job.locked_at < now - STALE_LOCK)
        .values(status="QUEUED", locked_by=None, locked_at=None)
    )
    q = select(Job).where(Job.status == "QUEUED", Job.run_after <= now)
    if kinds:
        q = q.where(Job.kind.in_(kinds))
    job = session.scalar(q.order_by(Job.run_after).limit(1).with_for_update(skip_locked=True))
    if job is None:
        return None
    job.status, job.locked_by, job.locked_at = "RUNNING", worker_id, now
    job.attempts += 1
    session.flush()
    return job


def complete(session: Session, job: Job) -> None:
    job.status, job.finished_at, job.locked_by, job.locked_at = "SUCCEEDED", utcnow(), None, None


def fail(session: Session, job: Job, error: str) -> None:
    job.last_error = error[:4000]
    job.locked_by = job.locked_at = None
    if job.attempts >= job.max_attempts:
        job.status, job.finished_at = "DEAD", utcnow()  # dead-letter: visible in admin, never silently dropped
    else:
        job.status = "QUEUED"
        job.run_after = utcnow() + timedelta(seconds=min(30 * 2 ** (job.attempts - 1), 3600))
