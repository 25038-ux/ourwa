"""Worker loop. Each job runs in its own transaction together with its completion marker."""

from __future__ import annotations

import logging
import os
import signal
import socket
import time
import traceback

from forsa.db.models import Job
from forsa.db.session import system_session
from forsa.jobs.handlers import HANDLERS, schedule_tick
from forsa.jobs.queue import claim, complete, fail

log = logging.getLogger("forsa.worker")


def run_one(worker_id: str) -> bool:
    """Claim and run a single job. Returns False when the queue is empty."""
    with system_session() as s:
        job = claim(s, worker_id)
        if job is None:
            return False
        job_id, kind, payload = job.id, job.kind, dict(job.payload)
    started = time.monotonic()
    try:
        with system_session() as s:
            handler = HANDLERS.get(kind)
            if handler is None:
                raise RuntimeError(f"no handler for job kind {kind!r}")
            result = handler(s, payload)
            row = s.get(Job, job_id)
            assert row is not None
            complete(s, row)
        log.info("job ok kind=%s id=%s ms=%d result=%s", kind, job_id, (time.monotonic() - started) * 1000, result)
    except Exception as exc:
        log.error("job failed kind=%s id=%s: %s", kind, job_id, exc)
        with system_session() as s:
            row = s.get(Job, job_id)
            if row is not None:
                fail(s, row, f"{type(exc).__name__}: {exc}\n{traceback.format_exc(limit=5)}")
    return True


def run_until_idle(max_jobs: int = 10_000) -> int:
    worker_id = f"inline-{os.getpid()}"
    n = 0
    while n < max_jobs and run_one(worker_id):
        n += 1
    return n


def run_forever(poll_s: float = 2.0, tick_s: float = 60.0) -> None:
    from forsa.db.session import check_role_safety
    from forsa.settings import get_settings

    check_role_safety(get_settings().env)
    worker_id = f"{socket.gethostname()}-{os.getpid()}"
    stopping = False

    def _stop(*_: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    last_tick = 0.0
    log.info("worker %s started", worker_id)
    while not stopping:
        if time.monotonic() - last_tick > tick_s:
            with system_session() as s:
                schedule_tick(s)
            last_tick = time.monotonic()
        if not run_one(worker_id):
            time.sleep(poll_s)
    log.info("worker %s stopped", worker_id)
