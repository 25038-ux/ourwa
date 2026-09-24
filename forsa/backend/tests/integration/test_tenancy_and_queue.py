import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from forsa.db.models import Company, Job
from forsa.db.session import new_session, system_session, tenant_session
from forsa.jobs.queue import claim, enqueue, fail

from .conftest import make_org


def test_row_level_security_isolates_tenants():
    a, _ = make_org("alpha", [("a@x.test", "OWNER")])
    b, _ = make_org("beta", [("b@x.test", "OWNER")])
    with system_session() as s:
        s.add_all([Company(org_id=a, legal_name="A"), Company(org_id=b, legal_name="B")])
    with tenant_session(a) as s:
        # No org filter on purpose: the database itself must hide beta's rows.
        assert [c.legal_name for c in s.scalars(select(Company)).all()] == ["A"]
    with new_session() as s:  # no tenant context at all → fail closed
        assert s.scalars(select(Company)).all() == []
    with pytest.raises(DBAPIError), tenant_session(a) as s:
        s.add(Company(org_id=b, legal_name="smuggled"))
        s.flush()


def test_rls_context_does_not_leak_between_transactions():
    a, _ = make_org("alpha", [("a@x.test", "OWNER")])
    with system_session() as s:
        s.add(Company(org_id=a, legal_name="A"))
    s = new_session(org_id=a)
    assert len(s.scalars(select(Company)).all()) == 1
    s.commit()
    s.info["org_id"] = None
    assert s.scalars(select(Company)).all() == []
    assert s.execute(text("select current_setting('forsa.org_id', true)")).scalar() in ("", None)
    s.close()


def test_job_queue_is_idempotent_and_dead_letters():
    with system_session() as s:
        enqueue(s, "noop", {"x": 1}, key="k1", max_attempts=2)
        enqueue(s, "noop", {"x": 2}, key="k1")
    with system_session() as s:
        assert len(s.scalars(select(Job)).all()) == 1
        job = claim(s, "w1")
        assert job is not None and job.attempts == 1
        fail(s, job, "boom")
        assert job.status == "QUEUED" and job.run_after is not None
        job.run_after = job.created_at
    with system_session() as s:
        job = claim(s, "w1")
        fail(s, job, "boom again")
        assert job.status == "DEAD" and "boom again" in job.last_error
