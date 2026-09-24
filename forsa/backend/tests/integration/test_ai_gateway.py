import os

import httpx
import pytest

from forsa.ai.catalog import effective_configs
from forsa.ai.gateway import AIGateway
from forsa.ai.providers.jev import JevProvider, Noul
from forsa.ai.providers.openai_compat import OpenAICompatibleProvider
from forsa.ai.types import AICall, AITask, Sensitivity
from forsa.db.models import AIProviderSetting, AIRequest
from forsa.db.session import system_session


@pytest.fixture
def keys(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "k1")
    monkeypatch.setenv("GROQ_API_KEY", "k2")
    monkeypatch.setenv("TYPESAFE_API_KEY", "k3")
    yield


def _gateway(handler, order=("deepseek", "groq")):
    transport = httpx.MockTransport(handler)
    return AIGateway(
        lambda s: effective_configs(s, list(order)),
        daily_budget_usd=1.0,
        adapters={
            "openai_compatible": OpenAICompatibleProvider(transport=transport),
            "typesafe_system_one": JevProvider(transport=transport),
        },
    )


def test_fallback_records_every_attempt(keys):
    def handler(request):
        if "deepseek" in str(request.url) or "example" in str(request.url):
            return httpx.Response(503, text="down")
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}], "model": "llama"})

    gw = _gateway(handler)
    with system_session() as s:
        res = gw.complete(s, AICall(task=AITask.CLASSIFY, system="s", prompt_version="t", user="u"))
        assert res.ok and res.provider == "groq"
        rows = s.query(AIRequest).order_by(AIRequest.created_at).all()
        assert [(r.provider, r.status) for r in rows] == [("deepseek", "error"), ("groq", "ok")]
        again = gw.complete(s, AICall(task=AITask.CLASSIFY, system="s", prompt_version="t", user="u"))
        assert again.cached


def test_sensitivity_ceiling_blocks_confidential_data(keys):
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    gw = _gateway(handler)
    with system_session() as s:
        res = gw.complete(
            s,
            AICall(
                task=AITask.CLASSIFY,
                system="s",
                prompt_version="t",
                user="secret financials",
                sensitivity=Sensitivity.CONFIDENTIAL,
            ),
        )
        assert not res.ok and res.error == "no_provider_available" and calls == []
        # An admin who reviewed DeepSeek's data terms can raise its ceiling explicitly.
        s.add(
            AIProviderSetting(
                provider_id="deepseek", enabled=True, priority=0, max_sensitivity="confidential", dpa_reviewed=True
            )
        )
        s.flush()
        res = gw.complete(
            s,
            AICall(
                task=AITask.CLASSIFY,
                system="s",
                prompt_version="t2",
                user="secret",
                sensitivity=Sensitivity.CONFIDENTIAL,
            ),
        )
        assert res.ok and res.provider == "deepseek"


def test_admin_pinned_model_and_disabled_without_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with system_session() as s:
        s.add(AIProviderSetting(provider_id="openai", enabled=True, fast_model="pinned-model"))
        s.flush()
        cfg = next(c for c in effective_configs(s, []) if c.id == "openai")
        assert cfg.models["fast"] == "pinned-model" and cfg.enabled is False  # no key ⇒ never enabled
    assert "OPENAI_API_KEY" not in os.environ


def test_decision_model_jev(keys):
    def handler(request):
        return httpx.Response(
            200,
            json={
                "model": "jev-latest",
                "usage": {"input_tokens": 5, "output_tokens": 1},
                "answers": {"relevant": {"type": "noul", "noul": 0.81}},
            },
        )

    gw = _gateway(handler, order=("jev",))
    with system_session() as s:
        d = gw.decide(s, "triage", {"text": "x"}, {"relevant": Noul("Relevant?")})
        assert d is not None and d.probability("relevant") == 0.81
        cached = gw.decide(s, "triage", {"text": "x"}, {"relevant": Noul("Relevant?")})
        assert cached is not None and cached.probability("relevant") == 0.81
        assert s.query(AIRequest).filter(AIRequest.task == "decide:triage").count() == 1
    gw_none = _gateway(handler, order=())
    with system_session() as s:
        assert gw_none.decide(s, "triage", {"text": "y"}, {"relevant": Noul("Relevant?")}) is None
