import json

import httpx

from forsa.ai.catalog import catalog
from forsa.ai.providers.jev import Choice, JevProvider, Noul, Score
from forsa.ai.providers.openai_compat import OpenAICompatibleProvider
from forsa.ai.types import AICall, AITask, ProviderConfig, Sensitivity, ToolSpec

CFG = ProviderConfig(
    id="deepseek",
    name="DeepSeek",
    kind="openai_compatible",
    region="CN",
    base_url="https://api.example.test/v1",
    api_key="sk-test",
    models={"fast": "m-fast"},
    max_sensitivity=Sensitivity.INTERNAL,
    enabled=True,
    priority=0,
)


def test_catalog_has_all_requested_provider_families():
    ids = set(catalog())
    assert {
        "openai",
        "anthropic",
        "deepseek",
        "qwen",
        "moonshot",
        "zhipu",
        "minimax",
        "nvidia",
        "groq",
        "openrouter",
        "gemini",
        "mistral",
        "ollama",
        "jev",
    } <= ids
    assert {e.kind for e in catalog().values()} <= {"openai_compatible", "anthropic", "typesafe_system_one"}
    assert catalog()["ollama"].max_sensitivity == Sensitivity.CONFIDENTIAL
    assert all(e.max_sensitivity != Sensitivity.CONFIDENTIAL for e in catalog().values() if e.region != "local")


def test_openai_compatible_request_and_tool_call_parsing():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "model": "m-fast",
                "choices": [
                    {
                        "finish_reason": "tool_calls",
                        "message": {
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "c1",
                                    "type": "function",
                                    "function": {"name": "search_opportunities", "arguments": '{"query": "solaire"}'},
                                }
                            ],
                        },
                    }
                ],
                "usage": {"prompt_tokens": 12, "completion_tokens": 3},
            },
        )

    tool = ToolSpec("search_opportunities", "Search", {"type": "object", "properties": {"query": {"type": "string"}}})
    call = AICall(task=AITask.ASSISTANT, system="sys", prompt_version="t", user="hi", tools=[tool])
    res = OpenAICompatibleProvider(transport=httpx.MockTransport(handler)).complete(CFG, call, "m-fast")
    assert seen["url"] == "https://api.example.test/v1/chat/completions"
    assert seen["auth"] == "Bearer sk-test"
    assert seen["body"]["messages"][0] == {"role": "system", "content": "sys"}
    assert seen["body"]["tools"][0]["function"]["name"] == "search_opportunities"
    assert res.ok and res.tool_calls[0].arguments == {"query": "solaire"} and res.input_tokens == 12
    # The assistant turn round-trips with JSON-encoded arguments on the next request.
    follow = AICall(
        task=AITask.ASSISTANT,
        system="sys",
        prompt_version="t",
        messages=[
            {"role": "user", "content": "hi"},
            res.assistant_message(),
            {"role": "tool", "tool_call_id": "c1", "content": "[]"},
        ],
    )
    sent = {}

    def handler2(request: httpx.Request) -> httpx.Response:
        sent.update(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "Aucun résultat."}}]})

    out = OpenAICompatibleProvider(transport=httpx.MockTransport(handler2)).complete(CFG, follow, "m-fast")
    assert out.text == "Aucun résultat."
    assert isinstance(sent["messages"][2]["tool_calls"][0]["function"]["arguments"], str)


def test_openai_compatible_http_error_is_a_failed_result_not_an_exception():
    t = httpx.MockTransport(lambda r: httpx.Response(429, text="rate limited"))
    res = OpenAICompatibleProvider(transport=t).complete(
        CFG, AICall(task=AITask.CLASSIFY, system="s", prompt_version="t", user="u"), "m"
    )
    assert not res.ok and "429" in (res.error or "")


def test_jev_wire_format_and_answers():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "model": "jev-latest",
                "usage": {"input_tokens": 40, "output_tokens": 3},
                "answers": {
                    "mandatory": {"type": "noul", "noul": 0.93},
                    "category": {
                        "type": "choice",
                        "choice": "financial",
                        "confidence": 0.88,
                        "probabilities": {"financial": 0.88, "technical": 0.12},
                    },
                    "urgency": {
                        "type": "score",
                        "score": 1.4,
                        "confidence": 0.7,
                        "legend": {"0": "wait", "1": "week", "2": "today"},
                        "probabilities": {"0": 0.1, "1": 0.4, "2": 0.5},
                    },
                },
            },
        )

    cfg = ProviderConfig(
        id="jev",
        name="Jev",
        kind="typesafe_system_one",
        region="US",
        base_url="https://api.typesafe.ai",
        api_key="ts-key",
        models={"decision": "jev-latest"},
        max_sensitivity=Sensitivity.INTERNAL,
        enabled=True,
        priority=0,
    )
    d = JevProvider(transport=httpx.MockTransport(handler)).decide(
        cfg,
        {"clause": "…"},
        {
            "mandatory": Noul("Is this clause mandatory?"),
            "category": Choice("Category?", {"financial": None, "technical": "Specs"}),
            "urgency": Score("How urgent?", ("wait", "week", "today")),
        },
        "jev-latest",
    )
    assert seen["path"] == "/v1/systemone"
    assert seen["body"]["model"] == "jev-latest"
    assert seen["body"]["questions"]["category"] == {
        "type": "choice",
        "instructions": "Category?",
        "criteria": {"financial": None, "technical": "Specs"},
    }
    assert seen["body"]["questions"]["urgency"]["criteria"] == ["wait", "week", "today"]
    assert d.ok and d.probability("mandatory") == 0.93 and d.choice("category") == ("financial", 0.88)
