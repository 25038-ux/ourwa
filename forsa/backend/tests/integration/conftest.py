from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import create_engine, text

from forsa.cli import _alembic_upgrade
from forsa.db.base import Base
from forsa.db.models import Membership, Organization, User
from forsa.db.session import system_session
from forsa.identity.security import hash_password

PASSWORD = "correct-horse-battery"


@pytest.fixture(scope="session", autouse=True)
def migrated_db():
    url = os.environ["FORSA_DATABASE_URL"]
    eng = create_engine(url)
    with eng.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    eng.dispose()
    _alembic_upgrade(url)
    yield


@pytest.fixture(autouse=True)
def clean_db(migrated_db):
    tables = ", ".join(t.name for t in reversed(Base.metadata.sorted_tables))
    with system_session() as s:
        s.execute(text(f"TRUNCATE {tables} CASCADE"))
    yield


def make_org(slug: str, users: list[tuple[str, str]]) -> tuple[uuid.UUID, dict[str, uuid.UUID]]:
    with system_session() as s:
        org = Organization(name=slug.title(), slug=slug, country="MR")
        s.add(org)
        s.flush()
        ids = {}
        for email, role in users:
            u = User(email=email, full_name=email, password_hash=hash_password(PASSWORD))
            s.add(u)
            s.flush()
            s.add(Membership(org_id=org.id, user_id=u.id, role=role))
            ids[email] = u.id
        return org.id, ids
