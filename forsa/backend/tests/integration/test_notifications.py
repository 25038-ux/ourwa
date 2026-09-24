import asyncio
import threading
import time

from fastapi.testclient import TestClient
from sqlalchemy import select

from forsa.api.app import create_app
from forsa.api.live import LiveHub
from forsa.db.models import Job, Membership, Notification, PushSubscription
from forsa.db.session import system_session
from forsa.services.notifications import deliver, effective_prefs, notify
from forsa.settings import get_settings

from .conftest import PASSWORD, make_org

H = {"X-Requested-With": "forsa"}


def test_notify_is_idempotent_and_enqueues_delivery_once():
    org, _ = make_org("a", [("a@x.test", "OWNER")])
    with system_session() as s:
        first = notify(s, org, "high_fit_opportunity", "Kits solaires", key="k1", payload={"opportunity_id": "x"})
        again = notify(s, org, "high_fit_opportunity", "Kits solaires", key="k1")
        assert first is not None and again is None
        assert s.query(Job).filter(Job.kind == "deliver_notification").count() == 1
        assert s.get(Notification, first).priority == "high"


def test_live_hub_delivers_committed_notifications_to_the_right_tenant_only():
    org_a, users_a = make_org("a", [("a@x.test", "OWNER")])
    org_b, users_b = make_org("b", [("b@x.test", "OWNER")])
    live = LiveHub(get_settings().database_url.replace("postgresql+psycopg://", "postgresql://", 1))

    async def scenario():
        sub_a = live.subscribe(org_a, users_a["a@x.test"])
        sub_b = live.subscribe(org_b, users_b["b@x.test"])
        assert await asyncio.to_thread(live.connected.wait, 5)

        def write():
            with system_session() as s:
                notify(s, org_a, "tender_change", "Deadline extended", key="live-1")

        started = time.monotonic()
        await asyncio.to_thread(write)
        event = await asyncio.wait_for(sub_a.queue.get(), timeout=5)
        latency = time.monotonic() - started
        assert event["title"] == "Deadline extended" and event["category"] == "tender_change"
        assert sub_b.queue.empty()
        live.stop()
        return latency

    latency = asyncio.run(scenario())
    assert latency < 2.0


def test_push_delivery_respects_preferences_and_prunes_dead_devices():
    org, users = make_org("a", [("a@x.test", "OWNER"), ("b@x.test", "BID_MANAGER")])
    ua, ub = users["a@x.test"], users["b@x.test"]
    with system_session() as s:
        s.add_all(
            [
                PushSubscription(org_id=org, user_id=ua, endpoint="https://push.test/a", p256dh="p", auth="a"),
                PushSubscription(org_id=org, user_id=ub, endpoint="https://push.test/b", p256dh="p", auth="a"),
                PushSubscription(org_id=org, user_id=ub, endpoint="https://push.test/dead", p256dh="p", auth="a"),
            ]
        )
        m = s.scalar(select(Membership).where(Membership.user_id == ua))
        m.notification_prefs = {"high_fit_opportunity": {"push": False}}
        nid = notify(s, org, "high_fit_opportunity", "Kits solaires", key="p1")
    sent_to = []

    def fake_sender(sub, data, key, subject):
        sent_to.append(sub.endpoint)
        return 410 if sub.endpoint.endswith("dead") else 201

    with system_session() as s:
        assert deliver(s, nid, private_key=None, subject="mailto:x")["skipped"]
        out = deliver(s, nid, private_key="k", subject="mailto:x", sender=fake_sender)
    assert out == {"sent": 1, "removed": 1}
    assert sorted(sent_to) == ["https://push.test/b", "https://push.test/dead"]
    with system_session() as s:
        assert s.query(PushSubscription).count() == 2
    assert effective_prefs(None)["daily_briefing"] == {"in_app": True, "push": False}


def test_prefs_and_unread_api():
    make_org("a", [("a@x.test", "OWNER")])
    c = TestClient(create_app())
    c.post("/api/v1/auth/login", json={"email": "a@x.test", "password": PASSWORD}, headers=H)
    prefs = c.get("/api/v1/me/notification-preferences").json()
    assert prefs["prefs"]["tender_change"]["push"] is True
    put = c.put(
        "/api/v1/me/notification-preferences",
        headers=H,
        json={"prefs": {"tender_change": {"in_app": True, "push": False}}},
    ).json()
    assert put["prefs"]["tender_change"]["push"] is False
    assert c.get("/api/v1/notifications/unread-count").json() == {"unread": 0}


def test_end_to_end_instant_notification_over_real_http():
    """Real uvicorn server + real SSE connection + a notification committed by another process path."""
    import socket

    import httpx
    import uvicorn

    org, _ = make_org("a", [("a@x.test", "OWNER")])
    other, _ = make_org("b", [("b@x.test", "OWNER")])
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    server = uvicorn.Server(uvicorn.Config(create_app(), host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    received: list[tuple[str, float]] = []
    ready = threading.Event()
    with httpx.Client(base_url=base, timeout=15) as client:
        client.post("/api/v1/auth/login", json={"email": "a@x.test", "password": PASSWORD}, headers=H)

        def listen():
            with client.stream("GET", "/api/v1/live") as r:
                event = None
                for line in r.iter_lines():
                    if line.startswith("event: "):
                        event = line[7:]
                        if event == "ready":
                            ready.set()
                    elif line.startswith("data: ") and event == "notification":
                        received.append((line[6:], time.monotonic()))
                        return

        t = threading.Thread(target=listen, daemon=True)
        t.start()
        assert ready.wait(10)
        time.sleep(0.3)  # let the hub's LISTEN connection settle
        with system_session() as s:
            notify(s, other, "tender_change", "Other tenant — must not arrive", key="e2e-other")
        sent_at = time.monotonic()
        with system_session() as s:
            notify(s, org, "high_fit_opportunity", "Kits solaires — 89/100", key="e2e-1")
        t.join(10)
    server.should_exit = True
    assert received, "no live notification received"
    payload, got_at = received[0]
    assert "Kits solaires" in payload and "Other tenant" not in payload
    assert got_at - sent_at < 2.0
