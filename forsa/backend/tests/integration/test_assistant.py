import json
import shutil

import httpx
import pytest
from fastapi.testclient import TestClient

from forsa.ai.catalog import effective_configs
from forsa.ai.gateway import AIGateway
from forsa.ai.providers.openai_compat import OpenAICompatibleProvider
from forsa.api.app import create_app
from forsa.assistant.service import run_turn
from forsa.db.models import AssistantMessage, Membership, Organization, User
from forsa.db.session import new_session, system_session
from forsa.identity.rbac import Role, TenantContext
from forsa.ingestion.connectors.fixture import FixtureConnector
from forsa.ingestion.pipeline import IngestionPipeline
from forsa.ingestion.registry import sync_registry
from forsa.jobs.worker import run_until_idle
from forsa.runtime import get_runtime
from forsa.services.companies import set_capability
from forsa.settings import get_settings

from .conftest import PASSWORD, make_org

H = {"X-Requested-With": "forsa"}


@pytest.fixture
def world(tmp_path):
    org, users = make_org("sahel", [("owner@a.test", "OWNER")])
    shutil.copytree(get_settings().fixtures_dir / "demo" / "notices", tmp_path / "in")
    ctx = TenantContext(org_id=org, user_id=users["owner@a.test"], role=Role.OWNER)
    with new_session(org_id=org) as s:
        set_capability(s, ctx, "energy.solar_pv")
        set_capability(s, ctx, "energy.solar_pumping")
        s.commit()
    with system_session() as s:
        sync_registry(s, get_runtime().registry)
        from sqlalchemy import select

        from forsa.db.models import Source

        src = s.scalar(select(Source).where(Source.key == "forsa-demo"))
        IngestionPipeline(s, get_runtime().store).run(
            src, FixtureConnector("forsa-demo", tmp_path / "in", get_settings().demo_anchor), synthetic=True
        )
    run_until_idle()
    return ctx


def _turn(ctx, gateway, text, **kw):
    s = new_session(org_id=ctx.org_id)
    try:
        events = list(run_turn(s, gateway, ctx, text, **kw))
    finally:
        s.close()
    return events


NO_AI = AIGateway(lambda s: effective_configs(s, []), daily_budget_usd=1)


def test_deterministic_assistant_answers_from_tools(world):
    events = _turn(world, NO_AI, "Quelles opportunités solaires dois-je regarder ?")
    assert events[0]["type"] == "meta" and events[0]["mode"] == "deterministic"
    assert [e["name"] for e in events if e["type"] == "tool" and e["status"] == "done"] == ["search_opportunities"]
    final = events[-1]
    assert final["type"] == "final" and "kits solaires" in final["text"].lower()
    assert any(c["href"].startswith("/opportunities/") for c in final["citations"])
    assert "".join(e["text"] for e in events if e["type"] == "delta") == final["text"]
    # Follow-up in the same conversation with an opportunity in focus.
    opp_id = final["citations"][0]["href"].split("/")[-1]
    why = _turn(world, NO_AI, "Pourquoi ?", conversation_id=final["conversation_id"], focus_opportunity_id=opp_id)
    assert why[-1]["tools"][0]["name"] == "explain_recommendation"
    assert "/100" in why[-1]["text"]
    with system_session() as s:
        assert s.query(AssistantMessage).count() == 4


def test_actions_are_proposed_never_executed(world):
    final = _turn(world, NO_AI, "Lance une offre pour DEMO-2026-001")[-1]
    assert final["actions"] and final["actions"][0]["type"] == "start_bid"
    assert final["actions"][0]["requires_confirmation"] is True
    with system_session() as s:
        from forsa.db.models import Bid

        assert s.query(Bid).count() == 0


def _llm_gateway(monkeypatch, replies):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    queue = list(replies)
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json=queue.pop(0))

    gw = AIGateway(
        lambda s: effective_configs(s, ["groq"]),
        daily_budget_usd=1,
        adapters={"openai_compatible": OpenAICompatibleProvider(transport=httpx.MockTransport(handler))},
    )
    return gw, seen


def _tool_reply(name, args):
    return {
        "choices": [
            {
                "finish_reason": "tool_calls",
                "message": {
                    "content": None,
                    "tool_calls": [
                        {"id": "t1", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}
                    ],
                },
            }
        ]
    }


def test_llm_tool_loop_grounded_answer(world, monkeypatch):
    gw, seen = _llm_gateway(
        monkeypatch,
        [
            _tool_reply("top_recommendations", {"limit": 3}),
            {"choices": [{"message": {"content": "Priorité : Fourniture et installation de kits solaires."}}]},
        ],
    )
    events = _turn(world, gw, "What should we bid on?")
    assert events[0]["mode"] == "llm"
    final = events[-1]
    assert final["mode"] == "llm" and final["provider"] == "groq"
    tool_msg = seen[1]["messages"][-1]
    assert tool_msg["role"] == "tool" and '"items"' in tool_msg["content"]
    assert seen[0]["tools"] and seen[0]["messages"][0]["role"] == "system"


def test_llm_invented_numbers_are_rejected(world, monkeypatch):
    gw, _ = _llm_gateway(
        monkeypatch,
        [
            _tool_reply("top_recommendations", {"limit": 3}),
            {"choices": [{"message": {"content": "You have a 97% chance to win 450 million MRU."}}]},
        ],
    )
    final = _turn(world, gw, "What should we bid on?")[-1]
    assert final["mode"] == "llm_rejected"
    assert "97" not in final["text"] and "450" not in final["text"]


def test_assistant_sse_endpoint_and_tenant_isolation(world):
    c = TestClient(create_app())
    c.post("/api/v1/auth/login", json={"email": "owner@a.test", "password": PASSWORD}, headers=H)
    with c.stream("POST", "/api/v1/assistant/messages", json={"text": "échéances ?", "lang": "fr"}, headers=H) as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        body = "".join(r.iter_text())
    assert "event: meta" in body and "event: final" in body
    conv_id = json.loads(body.split("event: final\ndata: ")[1].split("\n")[0])["conversation_id"]
    assert c.get(f"/api/v1/assistant/conversations/{conv_id}").json()["messages"][0]["role"] == "user"
    make_org("other", [("owner@b.test", "OWNER")])
    other = TestClient(create_app())
    other.post("/api/v1/auth/login", json={"email": "owner@b.test", "password": PASSWORD}, headers=H)
    assert other.get(f"/api/v1/assistant/conversations/{conv_id}").status_code == 404
    _ = (Organization, User, Membership)
