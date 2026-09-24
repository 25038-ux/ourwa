from fastapi.testclient import TestClient
from sqlalchemy import select

from forsa.api.app import create_app
from forsa.db.models import Notification, Task, User
from forsa.db.session import system_session

from .conftest import PASSWORD, make_org

H = {"X-Requested-With": "forsa"}


def client(email: str) -> TestClient:
    c = TestClient(create_app())
    r = c.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD}, headers=H)
    assert r.status_code == 200, r.text
    return c


def test_invite_flow_and_role_guards():
    make_org("acme", [("owner@acme.test", "OWNER"), ("admin@acme.test", "ADMIN"), ("rev@acme.test", "REVIEWER")])
    owner, admin, rev = client("owner@acme.test"), client("admin@acme.test"), client("rev@acme.test")
    assert (
        rev.post("/api/v1/team/invites", json={"email": "x@acme.test", "role": "SALES"}, headers=H).status_code == 403
    )
    assert (
        admin.post("/api/v1/team/invites", json={"email": "o2@acme.test", "role": "OWNER"}, headers=H).status_code
        == 403
    )
    inv = admin.post("/api/v1/team/invites", json={"email": "New@Acme.test", "role": "SALES"}, headers=H).json()
    assert inv["path"].startswith("/invite/")
    anon = TestClient(create_app())
    peek = anon.get(f"/api/v1/invites/{inv['token']}").json()
    assert peek == {"email": "new@acme.test", "role": "SALES", "org_name": "Acme", "has_account": False}
    assert anon.post(f"/api/v1/invites/{inv['token']}/accept", json={"password": "short"}, headers=H).status_code == 422
    ok = anon.post(
        f"/api/v1/invites/{inv['token']}/accept",
        json={"password": "a-long-password-1", "full_name": "New Person"},
        headers=H,
    )
    assert ok.status_code == 200 and anon.get("/api/v1/auth/me").json()["memberships"][0]["role"] == "SALES"
    assert anon.get(f"/api/v1/invites/{inv['token']}").status_code == 404  # single use
    team = owner.get("/api/v1/team").json()
    assert len(team["members"]) == 4 and team["can_manage"]
    me = next(m for m in team["members"] if m["is_me"])
    r = owner.patch(f"/api/v1/team/members/{me['membership_id']}", json={"role": "ADMIN"}, headers=H)
    assert r.status_code == 409  # last owner cannot be demoted


def test_tasks_assignment_notifies_assignee_only():
    _, users = make_org("acme", [("owner@acme.test", "OWNER"), ("pm@acme.test", "BID_MANAGER")])
    owner = client("owner@acme.test")
    pm_id = str(users["pm@acme.test"])
    t = owner.post(
        "/api/v1/tasks", json={"title": "Obtenir l'attestation fiscale", "assignee_user_id": pm_id}, headers=H
    ).json()
    items = owner.get("/api/v1/tasks").json()["items"]
    assert items[0]["assignee"] == "pm@acme.test" and items[0]["status"] == "OPEN"
    assert owner.patch(f"/api/v1/tasks/{t['id']}", json={"status": "DONE"}, headers=H).status_code == 200
    with system_session() as s:
        n = s.scalar(select(Notification).where(Notification.category == "task_assignment"))
        assert n is not None and str(n.user_id) == pm_id
    # Targeted notification is invisible to other members.
    assert all(x["category"] != "task_assignment" for x in owner.get("/api/v1/notifications").json()["items"])
    assert any(
        x["category"] == "task_assignment" for x in client("pm@acme.test").get("/api/v1/notifications").json()["items"]
    )
    outsider_org, _ = make_org("other", [("o@other.test", "OWNER")])
    assert (
        owner.post("/api/v1/tasks", json={"title": "x", "assignee_user_id": str(outsider_org)}, headers=H).status_code
        == 400
    )


def test_onboarding_analyze_and_complete():
    make_org("sun", [("owner@sun.test", "OWNER")])
    c = client("owner@sun.test")
    text = (
        "Nous installons des panneaux solaires et des systèmes de pompage solaire à Nouakchott et à Kiffa "
        "(Assaba). Nous avons l'attestation fiscale et l'attestation CNSS."
    )
    out = c.post("/api/v1/onboarding/analyze", json={"text": text}, headers=H).json()
    ids = {x["id"] for x in out["capabilities"]}
    assert {"energy.solar_pv", "energy.solar_pumping"} <= ids and all(x["quote"] for x in out["capabilities"])
    assert {x["id"] for x in out["credentials"]} == {"cred.tax_clearance", "cred.social_security"}
    assert "Assaba" in out["regions"] and "Nouakchott-Ouest" in out["regions"]
    assert out["ai_used"] is False
    done = c.post(
        "/api/v1/onboarding/complete",
        headers=H,
        json={
            "legal_name": "Sun SARL",
            "regions_served": out["regions"],
            "capabilities": sorted(ids),
            "credentials": [{"id": "cred.tax_clearance", "status": "HELD"}],
            "description": text,
            "project": {
                "title": "Pompage Kiffa",
                "concept_ids": ["energy.solar_pumping"],
                "value": 5000000,
                "currency": "MRU",
                "year": 2025,
            },
        },
    ).json()
    assert done["capabilities"] == len(ids)
    company = c.get("/api/v1/companies/me").json()
    assert company["onboarding_completed_at"] and len(company["projects"]) == 1
    assert all(x["verification"] == "UNVERIFIED" for x in company["capabilities"])  # claims, not facts


def test_password_change_and_admin_ai_guard(monkeypatch):
    make_org("acme", [("owner@acme.test", "OWNER")])
    c = client("owner@acme.test")
    assert (
        c.post(
            "/api/v1/me/password", json={"current": "wrong-one-xx", "new": "brand-new-pass-1"}, headers=H
        ).status_code
        == 403
    )
    assert (
        c.post("/api/v1/me/password", json={"current": PASSWORD, "new": "brand-new-pass-1"}, headers=H).status_code
        == 200
    )
    assert c.get("/api/v1/admin/ai/providers").status_code == 403
    with system_session() as s:
        u = s.scalar(select(User).where(User.email == "owner@acme.test"))
        u.is_platform_admin = True
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    items = {p["id"]: p for p in c.get("/api/v1/admin/ai/providers").json()["items"]}
    assert items["jev"]["kind"] == "typesafe_system_one" and items["deepseek"]["key_present"] is False
    upd = c.put(
        "/api/v1/admin/ai/providers/deepseek",
        headers=H,
        json={"enabled": True, "fast_model": "deepseek-chat", "max_sensitivity": "public"},
    ).json()["item"]
    assert upd["requested"] and not upd["enabled"] and upd["max_sensitivity"] == "public"  # no key ⇒ not enabled
    disc = c.post("/api/v1/admin/ai/providers/deepseek/discover", headers=H).json()
    assert disc["ok"] is False and "DEEPSEEK_API_KEY" in disc["error"]
    _ = Task


def test_account_deletion_anonymises_and_protects_last_owner():
    _, users = make_org("acme", [("owner@acme.test", "OWNER"), ("pm@acme.test", "BID_MANAGER")])
    owner, pm = client("owner@acme.test"), client("pm@acme.test")
    t = owner.post(
        "/api/v1/tasks", json={"title": "Attestation CNSS", "assignee_user_id": str(users["pm@acme.test"])}, headers=H
    ).json()
    # The last owner of an organisation with other members must hand over first; a wrong password is refused.
    assert owner.post("/api/v1/me/delete", json={"password": PASSWORD}, headers=H).status_code == 409
    assert pm.post("/api/v1/me/delete", json={"password": "wrong-password"}, headers=H).status_code == 403
    r = pm.post("/api/v1/me/delete", json={"password": PASSWORD}, headers=H)
    assert r.status_code == 200 and r.json() == {"deleted": True, "organisations_left": 1}
    assert pm.get("/api/v1/auth/me").status_code == 401  # cookie cleared
    login = TestClient(create_app()).post(
        "/api/v1/auth/login", json={"email": "pm@acme.test", "password": PASSWORD}, headers=H
    )
    assert login.status_code == 401
    with system_session() as s:
        u = s.get(User, users["pm@acme.test"])
        assert u is not None and not u.is_active and u.email.endswith("@deleted.invalid") and "pm@" not in u.full_name
        task = s.get(Task, t["id"])
        assert task is not None and task.assignee_user_id is None  # the organisation keeps its task
    assert [m["email"] for m in owner.get("/api/v1/team").json()["members"]] == ["owner@acme.test"]
    # Now alone, the owner may leave too.
    assert owner.post("/api/v1/me/delete", json={"password": PASSWORD}, headers=H).status_code == 200


def test_operator_meta_is_public():
    r = TestClient(create_app()).get("/api/v1/meta/operator")
    assert r.status_code == 200 and set(r.json()) == {"name", "privacy_contact"}
