import json
import shutil

import httpx
import pytest
from sqlalchemy import select

from forsa.ai.catalog import effective_configs
from forsa.ai.gateway import AIGateway
from forsa.ai.providers.jev import JevProvider
from forsa.ai.providers.openai_compat import OpenAICompatibleProvider
from forsa.db.models import AIProviderSetting, Match, Opportunity, Requirement, Source
from forsa.db.session import new_session, system_session
from forsa.identity.rbac import Role, TenantContext
from forsa.ingestion.connectors.fixture import FixtureConnector
from forsa.ingestion.pipeline import IngestionPipeline
from forsa.ingestion.registry import sync_registry
from forsa.jobs.worker import run_until_idle
from forsa.runtime import get_runtime
from forsa.services import ai_features
from forsa.services.companies import set_capability
from forsa.services.intelligence import analyze_opportunity
from forsa.services.matching import match_pair
from forsa.services.profiles import gate_requirements, opportunity_profile
from forsa.settings import get_settings

from .conftest import make_org


@pytest.fixture
def ingested(tmp_path):
    shutil.copytree(get_settings().fixtures_dir / "demo" / "notices", tmp_path / "in")
    with system_session() as s:
        sync_registry(s, get_runtime().registry)
        src = s.scalar(select(Source).where(Source.key == "forsa-demo"))
        IngestionPipeline(s, get_runtime().store).run(
            src, FixtureConnector("forsa-demo", tmp_path / "in", get_settings().demo_anchor), synthetic=True
        )
    return tmp_path


def _gw(handler, order):
    t = httpx.MockTransport(handler)
    return AIGateway(
        lambda s: effective_configs(s, list(order)),
        daily_budget_usd=5,
        adapters={
            "openai_compatible": OpenAICompatibleProvider(transport=t),
            "typesafe_system_one": JevProvider(transport=t),
        },
    )


def _llm(content):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}], "model": "m"})


def test_ai_extraction_keeps_only_verbatim_quotes_and_needs_review(ingested, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    proposals = {
        "requirements": [
            {"quote": "Le délai d'exécution est de 120 jours.", "type": "mandatory", "category": "delivery"},
            {
                "quote": "Le soumissionnaire doit être certifié ISO 27001 depuis dix ans.",
                "type": "mandatory",
                "category": "certification",
            },  # hallucinated: not in the document
            {
                "quote": "5.2 Le soumissionnaire doit fournir une attestation CNSS.",
                "type": "mandatory",
                "category": "certification",
            },  # already extracted by rules
        ]
    }
    gw = _gw(lambda r: _llm(json.dumps(proposals, ensure_ascii=False)), ["groq"])
    with system_session() as s:
        opp = s.scalar(select(Opportunity).where(Opportunity.external_ref == "DEMO-2026-002"))
        stats = analyze_opportunity(
            s, get_runtime().store, get_runtime().ontology, opp.id, gw, frozenset({"ai_extraction"})
        )
        assert stats["ai_requirements"] == 1
        ai_rows = s.scalars(
            select(Requirement).where(Requirement.opportunity_id == opp.id, Requirement.extraction_method.like("ai:%"))
        ).all()
        assert len(ai_rows) == 1 and ai_rows[0].verification == "NEEDS_REVIEW"
        assert ai_rows[0].text.startswith("Le délai d'exécution")
        assert ai_rows[0].id not in {r.id for r in gate_requirements(s, opp)}
        ai_rows[0].verification = "VERIFIED"
        s.flush()
        assert ai_rows[0].id in {r.id for r in gate_requirements(s, opp)}
        assert opportunity_profile(s, opp).requirements  # profile still builds


def test_jev_crosscheck_flags_disagreement(ingested, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "k")
    run_until_idle()

    def handler(request):
        body = json.loads(request.content)
        answers = {}
        for name in body["questions"]:
            if name.startswith("mandatory_"):
                answers[name] = {"type": "noul", "noul": 0.02}  # Jev thinks nothing is mandatory
            else:
                answers[name] = {
                    "type": "choice",
                    "choice": "other",
                    "confidence": 0.5,
                    "probabilities": {"other": 0.5},
                }
        return httpx.Response(
            200, json={"model": "jev-latest", "answers": answers, "usage": {"input_tokens": 1, "output_tokens": 1}}
        )

    gw = _gw(handler, ["jev"])
    with system_session() as s:
        opp = s.scalar(select(Opportunity).where(Opportunity.external_ref == "DEMO-2026-002"))
        flagged = ai_features.jev_crosscheck(s, gw, opp)
        rows = s.scalars(
            select(Requirement).where(Requirement.opportunity_id == opp.id, Requirement.type == "mandatory")
        ).all()
        assert flagged == len(rows) and all(r.verification == "NEEDS_REVIEW" for r in rows)
        assert rows[0].params["ai_check"]["agrees"] is False


def test_jev_triage_never_changes_fit(ingested, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "k")
    org, users = make_org("sun", [("o@sun.test", "OWNER")])
    ctx = TenantContext(org, users["o@sun.test"], Role.OWNER)
    with new_session(org_id=org) as s:
        set_capability(s, ctx, "energy.solar_pv")
        s.commit()
    run_until_idle()
    gw = _gw(
        lambda r: httpx.Response(
            200,
            json={
                "model": "jev-latest",
                "usage": {"input_tokens": 1, "output_tokens": 1},
                "answers": {"relevant": {"type": "noul", "noul": 0.9}},
            },
        ),
        ["jev"],
    )
    with system_session() as s:
        m = s.scalar(select(Match).where(Match.org_id == org).limit(1))
        fit = m.fit_score
        opp = s.get(Opportunity, m.opportunity_id)
        triage = ai_features.jev_triage(s, gw, m, opp)
        assert triage["relevant"] == 0.9 and triage["epistemic"] == "FORECAST"
        assert m.fit_score == fit and m.result["ai_triage"]["relevant"] == 0.9


def test_ai_summary_validation_and_confidential_routing(ingested, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    org, users = make_org("sun", [("o@sun.test", "OWNER")])
    ctx = TenantContext(org, users["o@sun.test"], Role.OWNER)
    with new_session(org_id=org) as s:
        set_capability(s, ctx, "energy.solar_pv")
        s.commit()
    run_until_idle()
    with new_session(org_id=org) as s:
        m = s.scalar(select(Match).where(Match.org_id == org).limit(1))
        good = ai_features.ai_summary(
            s, _gw(lambda r: _llm("Bonne piste : adéquation estimée, à confirmer."), ["groq"]), org, m, "fr"
        )
        assert good["available"] and good["epistemic"] == "INFERENCE"
        bad = ai_features.ai_summary(
            s, _gw(lambda r: _llm("You will win 97% of tenders, worth 700 million."), ["groq"]), org, m, "en"
        )
        assert not bad["available"] and bad["reason"] == "rejected"
        # Drafting uses company evidence (CONFIDENTIAL): a cloud provider is refused by default…
        polish = _gw(lambda r: _llm("Nous disposons de l'attestation fiscale valide."), ["groq"])
        assert (
            ai_features.polish_section(
                s, polish, org, "Attestation fiscale", "Nous l'avons.", ["Attestation fiscale valide"]
            )
            is None
        )
    # …until a platform admin raises that provider's ceiling after reviewing its data terms.
    with system_session() as s:
        s.add(AIProviderSetting(provider_id="groq", enabled=True, max_sensitivity="confidential", dpa_reviewed=True))
    with new_session(org_id=org) as s:
        text = ai_features.polish_section(
            s, polish, org, "Attestation fiscale", "Nous l'avons.", ["Attestation fiscale valide"]
        )
        assert text == "Nous disposons de l'attestation fiscale valide."
    _ = match_pair
