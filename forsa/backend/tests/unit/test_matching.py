from dataclasses import replace
from datetime import timedelta

from forsa.kernel.epistemics import Epistemic, Truth, Verification
from forsa.matching import MatchingEngine
from forsa.matching.messages import explain, known_codes, render
from forsa.matching.profiles import (
    CapabilityClaim,
    ConceptNeed,
    CredentialClaim,
    CredentialStatus,
    GateOutcome,
    Lifecycle,
    Recommendation,
    ReqKind,
    RequirementSpec,
)
from forsa.taxonomy import default_ontology

from .factories import NOW, company, cred_req, opportunity

ENGINE = MatchingEngine(default_ontology())


def gate(result, name):
    return next(g for g in result.gates if g.gate == name)


def test_strong_fit_recommends_bid():
    r = ENGINE.evaluate(opportunity(requirements=(cred_req("cred.tax_clearance"),)), company(), NOW)
    assert r.recommendation == Recommendation.BID
    assert r.fit_score >= 80
    assert r.scoring_version == "fit-v1.1"
    assert r.requires_human_decision is True


def test_missing_evidence_is_unknown_not_negative():
    r = ENGINE.evaluate(opportunity(requirements=(cred_req("cred.iso_9001"),)), company(), NOW)
    g = gate(r, "credential:cred.iso_9001")
    assert g.outcome == GateOutcome.UNKNOWN
    assert g.truth == Truth.NOT_FOUND
    assert r.recommendation == Recommendation.REVIEW


def test_declared_absent_unobtainable_credential_is_no_bid():
    co = company(credentials=(CredentialClaim("cred.iso_9001", CredentialStatus.ABSENT),))
    r = ENGINE.evaluate(opportunity(requirements=(cred_req("cred.iso_9001"),)), co, NOW)
    assert gate(r, "credential:cred.iso_9001").outcome == GateOutcome.FAIL
    assert r.recommendation == Recommendation.NO_BID


def test_absent_but_obtainable_credential_gives_conditions():
    co = company(credentials=(CredentialClaim("cred.tax_clearance", CredentialStatus.ABSENT),))
    r = ENGINE.evaluate(opportunity(requirements=(cred_req("cred.tax_clearance"),)), co, NOW)
    assert gate(r, "credential:cred.tax_clearance").outcome == GateOutcome.GAP
    assert r.recommendation == Recommendation.BID_WITH_CONDITIONS
    assert any(c.code == "condition.obtain" for c in r.conditions)
    assert any(w.code == "why_now.gap_obtainable" for w in r.why_now)


def test_unverified_claim_needs_human_and_conditions():
    co = company(credentials=(CredentialClaim("cred.tax_clearance", CredentialStatus.HELD),))
    r = ENGINE.evaluate(opportunity(requirements=(cred_req("cred.tax_clearance"),)), co, NOW)
    g = gate(r, "credential:cred.tax_clearance")
    assert g.outcome == GateOutcome.PASS and g.truth == Truth.NEEDS_HUMAN
    assert r.recommendation == Recommendation.BID_WITH_CONDITIONS


def test_expired_credential_before_deadline():
    co = company(
        credentials=(
            CredentialClaim(
                "cred.tax_clearance",
                CredentialStatus.HELD,
                valid_until=NOW + timedelta(days=2),
                verification=Verification.VERIFIED,
            ),
        )
    )
    r = ENGINE.evaluate(opportunity(requirements=(cred_req("cred.tax_clearance"),)), co, NOW)
    g = gate(r, "credential:cred.tax_clearance")
    assert g.outcome == GateOutcome.GAP and g.remediation == "renew"


def test_deadline_passed_and_impossible():
    passed = ENGINE.evaluate(opportunity(deadline_at=NOW - timedelta(days=1)), company(), NOW)
    assert passed.recommendation == Recommendation.NO_BID
    tight = ENGINE.evaluate(opportunity(deadline_at=NOW + timedelta(days=1)), company(), NOW)
    assert gate(tight, "deadline").reason.code == "deadline.impossible"


def test_cancelled_notice_is_not_open():
    r = ENGINE.evaluate(opportunity(status=Lifecycle.CANCELLED), company(), NOW)
    assert gate(r, "status").outcome == GateOutcome.FAIL


def test_planned_item_is_early_signal():
    r = ENGINE.evaluate(opportunity(status=Lifecycle.PLANNED, deadline_at=None), company(), NOW)
    assert all(g.gate != "deadline" for g in r.gates)
    assert any(w.code == "why_now.early_signal" for w in r.why_now)


def test_company_exclusion_blocks():
    r = ENGINE.evaluate(opportunity(), company(excluded_concepts=frozenset({"energy"})), NOW)
    assert gate(r, "excluded_service").outcome == GateOutcome.FAIL


def test_irrelevant_capability_is_low_fit():
    co = company(capabilities=(CapabilityClaim("it.software", Epistemic.FACT, Verification.VERIFIED),), projects=())
    r = ENGINE.evaluate(opportunity(), co, NOW)
    assert r.recommendation == Recommendation.NO_BID
    assert r.fit_score < 45


def test_ai_inferred_capability_does_not_count():
    co = company(
        capabilities=(CapabilityClaim("energy.solar_pv", Epistemic.INFERENCE, Verification.UNVERIFIED),), projects=()
    )
    r = ENGINE.evaluate(opportunity(), co, NOW)
    cap = next(c for c in r.components if c.name == "capability")
    assert cap.score == 0.0


def test_experience_gap_suggests_partner():
    req = RequirementSpec("r-exp", ReqKind.EXPERIENCE, True, "3 marchés similaires", min_count=3)
    r = ENGINE.evaluate(opportunity(requirements=(req,)), company(), NOW)
    g = gate(r, "experience")
    assert g.outcome == GateOutcome.GAP and g.remediation == "partner"
    assert r.recommendation == Recommendation.BID_WITH_CONDITIONS


def test_turnover_gate_and_currency_mismatch():
    req = RequirementSpec("r-fin", ReqKind.FINANCIAL_TURNOVER, True, "CA", min_amount=100_000_000, currency="MRU")
    assert (
        gate(ENGINE.evaluate(opportunity(requirements=(req,)), company(), NOW), "financial").outcome == GateOutcome.GAP
    )
    req_usd = replace(req, currency="USD")
    g = gate(ENGINE.evaluate(opportunity(requirements=(req_usd,)), company(), NOW), "financial")
    assert g.outcome == GateOutcome.UNKNOWN and g.truth == Truth.NEEDS_HUMAN


def test_unknown_data_lowers_completeness_not_score_to_zero():
    bare = company(
        capabilities=(),
        projects=(),
        credentials=(),
        max_project_value=None,
        max_parallel_bids=None,
        regions_served=frozenset(),
    )
    r = ENGINE.evaluate(opportunity(), bare, NOW)
    assert r.data_completeness < 0.6
    assert r.recommendation != Recommendation.NO_BID  # unknown ≠ negative


def test_deterministic_and_serialisable():
    a = ENGINE.evaluate(opportunity(), company(), NOW).as_dict()
    b = ENGINE.evaluate(opportunity(), company(), NOW).as_dict()
    assert a == b
    assert set(a["components"][0]) >= {"name", "score", "weight", "known", "reasons"}


def test_economics_are_ranges():
    econ = ENGINE.evaluate(opportunity(), company(), NOW).economics
    assert econ.effort_days.low < econ.effort_days.high
    assert econ.contribution is not None and econ.contribution.low < econ.contribution.high


def test_every_reason_code_has_a_message():
    onto = default_ontology()
    scenarios = [
        opportunity(requirements=(cred_req("cred.iso_9001"),)),
        opportunity(status=Lifecycle.PLANNED, deadline_at=None),
        opportunity(
            deadline_at=NOW + timedelta(days=5), estimated_value=None, concepts=(ConceptNeed("it.software", 1.0),)
        ),
    ]
    codes = known_codes()
    for opp in scenarios:
        r = ENGINE.evaluate(opp, company(), NOW)
        reasons = r.recommendation_reasons + r.conditions + r.why_now + [g.reason for g in r.gates]
        reasons += [x for c in r.components for x in c.reasons] + [k.reason for k in r.risks]
        for reason in reasons:
            assert reason.code in codes, reason.code
            assert "?" not in render(reason.code, reason.params, "fr", onto) or reason.code.startswith("x")
        assert explain(r, "fr", onto).startswith("FORSA estime")


def test_per_bid_instrument_is_obtainable_condition():
    r = ENGINE.evaluate(opportunity(requirements=(cred_req("cred.bid_security"),)), company(), NOW)
    g = gate(r, "credential:cred.bid_security")
    assert g.outcome == GateOutcome.GAP and g.remediation == "obtain"
    assert r.recommendation == Recommendation.BID_WITH_CONDITIONS


def test_planned_item_says_prepare_not_bid():
    r = ENGINE.evaluate(opportunity(status=Lifecycle.PLANNED, deadline_at=None), company(), NOW)
    assert r.recommendation == Recommendation.REVIEW
    assert r.recommendation_reasons[0].code == "recommendation.early_signal"


def test_documents_are_obtained_in_parallel_with_bid_preparation():
    tight = opportunity(deadline_at=NOW + timedelta(days=6.1), requirements=(cred_req("cred.bid_security"),))
    assert gate(ENGINE.evaluate(tight, company(), NOW), "credential:cred.bid_security").outcome == GateOutcome.GAP
    too_late = opportunity(deadline_at=NOW + timedelta(days=5.5), requirements=(cred_req("cred.bid_security"),))
    assert gate(ENGINE.evaluate(too_late, company(), NOW), "credential:cred.bid_security").outcome == GateOutcome.FAIL
