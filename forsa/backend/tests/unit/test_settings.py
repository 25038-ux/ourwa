import pytest

from forsa.settings import Settings


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("ai_explanations,ai_triage", {"ai_explanations", "ai_triage"}),
        ('["ai_drafting"]', {"ai_drafting"}),
        ("", set()),
    ],
)
def test_features_accept_comma_lists_and_json(monkeypatch: pytest.MonkeyPatch, raw: str, expected: set[str]) -> None:
    monkeypatch.setenv("FORSA_FEATURES", raw)
    assert Settings().features == expected


def test_provider_order_is_preserved(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FORSA_AI_PROVIDERS", "jev, deepseek ,groq")
    assert Settings().ai_providers == ["jev", "deepseek", "groq"]
