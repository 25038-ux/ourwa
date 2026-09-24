"""Live hub: Postgres LISTEN `forsa_live` → per-tenant fan-out to Server-Sent Event streams (ADR-012).

One background thread per API process holds a dedicated connection that LISTENs. NOTIFY payloads are not
subject to row-level security, so the hub filters strictly by organisation (and user when targeted) before
handing an event to a subscriber. Payloads only carry ids and titles; clients re-read details via the API.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
import uuid
from dataclasses import dataclass

import psycopg

from forsa.settings import get_settings

log = logging.getLogger("forsa.live")
CHANNEL = "forsa_live"

# no-transform keeps proxies (including the Next.js rewrite) from compressing/buffering the stream.
SSE_HEADERS = {"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"}


@dataclass(eq=False)
class Subscriber:
    org_id: str
    user_id: str
    queue: asyncio.Queue
    loop: asyncio.AbstractEventLoop


class LiveHub:
    def __init__(self, dsn: str):
        self.dsn = dsn
        self._subs: set[Subscriber] = set()
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.connected = threading.Event()

    def ensure_started(self) -> None:
        with self._lock:
            if self._thread is None or not self._thread.is_alive():
                self._stop.clear()
                self._thread = threading.Thread(target=self._run, name="forsa-live", daemon=True)
                self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def subscribe(self, org_id: uuid.UUID, user_id: uuid.UUID) -> Subscriber:
        self.ensure_started()
        sub = Subscriber(str(org_id), str(user_id), asyncio.Queue(maxsize=200), asyncio.get_running_loop())
        with self._lock:
            self._subs.add(sub)
        return sub

    def unsubscribe(self, sub: Subscriber) -> None:
        with self._lock:
            self._subs.discard(sub)

    def dispatch(self, raw: str) -> int:
        try:
            event = json.loads(raw)
        except ValueError:
            return 0
        delivered = 0
        with self._lock:
            subs = list(self._subs)
        for sub in subs:
            if sub.org_id != str(event.get("org_id")):
                continue
            if event.get("user_id") and str(event["user_id"]) != sub.user_id:
                continue
            sub.loop.call_soon_threadsafe(self._offer, sub.queue, event)
            delivered += 1
        return delivered

    @staticmethod
    def _offer(queue: asyncio.Queue, event: dict) -> None:
        if not queue.full():
            queue.put_nowait(event)

    def _run(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            try:
                with psycopg.connect(self.dsn, autocommit=True) as conn:
                    conn.execute(f"LISTEN {CHANNEL}")
                    self.connected.set()
                    backoff = 1.0
                    while not self._stop.is_set():
                        for note in conn.notifies(timeout=2.0):
                            self.dispatch(note.payload)
            except Exception as exc:  # reconnect with backoff; never kill the API process
                self.connected.clear()
                log.warning("live hub connection lost: %s", exc)
                time.sleep(backoff)
                backoff = min(backoff * 2, 30)


_hub: LiveHub | None = None


def hub() -> LiveHub:
    global _hub
    if _hub is None:
        _hub = LiveHub(get_settings().database_url.replace("postgresql+psycopg://", "postgresql://", 1))
    return _hub
