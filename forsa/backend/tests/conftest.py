"""Test configuration. Integration tests need PostgreSQL (FORSA_TEST_DATABASE_URL); they are skipped otherwise."""

from __future__ import annotations

import os
import tempfile

os.environ.setdefault("FORSA_ENV", "test")
os.environ["FORSA_DATABASE_URL"] = os.environ.get(
    "FORSA_TEST_DATABASE_URL", "postgresql+psycopg://forsa:forsa@localhost:5432/forsa_test"
)
os.environ.setdefault("FORSA_STORAGE_DIR", tempfile.mkdtemp(prefix="forsa-test-store-"))
os.environ.setdefault("FORSA_JWT_SECRET", "test-secret-not-for-production-use-0123456789")
os.environ["FORSA_ALEMBIC_NO_LOGGING"] = "1"

import pytest
from sqlalchemy import create_engine, text

_DB_OK: bool | None = None


def _db_available() -> bool:
    global _DB_OK
    if _DB_OK is None:
        try:
            with create_engine(os.environ["FORSA_DATABASE_URL"]).connect() as c:
                c.execute(text("select 1"))
            _DB_OK = True
        except Exception:
            _DB_OK = False
    return _DB_OK


def pytest_collection_modifyitems(config, items):  # type: ignore[no-untyped-def]
    if _db_available():
        return
    skip = pytest.mark.skip(reason="PostgreSQL not available (set FORSA_TEST_DATABASE_URL)")
    for item in items:
        if "integration" in str(item.fspath):
            item.add_marker(skip)
