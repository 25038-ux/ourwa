"""Engine/session factory with tenant context enforced at the transaction level (ADR-007).

Every transaction begins with ``set_config('forsa.org_id', …, true)`` (tenant
request) or ``set_config('forsa.system', 'on', true)`` (worker / ingestion).
Postgres row-level security policies read these settings, so a query that
forgets its ``org_id`` filter still cannot see another tenant's rows, and a
session with no context sees *no* tenant rows at all (fail closed).
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from forsa.settings import get_settings


@lru_cache(maxsize=4)
def get_engine(url: str | None = None) -> Engine:
    return create_engine(url or get_settings().database_url, pool_pre_ping=True, future=True)


@lru_cache(maxsize=4)
def _factory(url: str | None = None) -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(url), expire_on_commit=False, future=True)


@event.listens_for(Session, "after_begin")
def _apply_tenant_context(session: Session, transaction, connection) -> None:
    org_id = session.info.get("org_id")
    system = session.info.get("system", False)
    connection.execute(
        text("SELECT set_config('forsa.org_id', :org, true), set_config('forsa.system', :sys, true)"),
        {"org": str(org_id) if org_id else "", "sys": "on" if system else "off"},
    )


def new_session(*, org_id: uuid.UUID | None = None, system: bool = False, url: str | None = None) -> Session:
    if org_id is None and not system:
        # Allowed (e.g. login), but tenant tables will be invisible.
        pass
    session = _factory(url)()
    session.info["org_id"] = org_id
    session.info["system"] = system
    return session


@contextmanager
def tenant_session(org_id: uuid.UUID, url: str | None = None) -> Iterator[Session]:
    session = new_session(org_id=org_id, url=url)
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@contextmanager
def system_session(url: str | None = None) -> Iterator[Session]:
    session = new_session(system=True, url=url)
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
