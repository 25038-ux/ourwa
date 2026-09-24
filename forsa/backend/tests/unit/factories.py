from datetime import UTC, datetime, timedelta

from forsa.kernel.epistemics import Epistemic, Verification
from forsa.matching.profiles import (
    CapabilityClaim,
    CompanyProfile,
    ConceptNeed,
    CredentialClaim,
    CredentialStatus,
    Lifecycle,
    OpportunityProfile,
    ProjectClaim,
    ReqKind,
    RequirementSpec,
)

NOW = datetime(2026, 9, 1, 8, 0, tzinfo=UTC)


def opportunity(**kw) -> OpportunityProfile:
    base = dict(
        id="opp-1",
        title="Installation de kits solaires",
        status=Lifecycle.PUBLISHED,
        category="works",
        country="MR",
        region="Nouakchott",
        estimated_value=15_000_000.0,
        currency="MRU",
        published_at=NOW - timedelta(days=1),
        deadline_at=NOW + timedelta(days=21),
        concepts=(ConceptNeed("energy.solar_pv", 2.0),),
        requirements=(),
        consortium_allowed=True,
    )
    base.update(kw)
    return OpportunityProfile(**base)


def company(**kw) -> CompanyProfile:
    base = dict(
        id="co-1",
        name="Sahel Solar SARL",
        country="MR",
        regions_served=frozenset({"*"}),
        capabilities=(CapabilityClaim("energy.solar_pv", Epistemic.FACT, Verification.VERIFIED, ("ev-1",)),),
        credentials=(CredentialClaim("cred.tax_clearance", CredentialStatus.HELD, verification=Verification.VERIFIED),),
        projects=(
            ProjectClaim(
                "p1",
                "Mini-réseau solaire Rosso",
                ("energy.solar_pv",),
                value=12_000_000,
                currency="MRU",
                year=2025,
                epistemic=Epistemic.FACT,
                verification=Verification.VERIFIED,
            ),
            ProjectClaim(
                "p2",
                "Kits solaires écoles",
                ("energy.solar_pv",),
                value=8_000_000,
                currency="MRU",
                year=2024,
                epistemic=Epistemic.FACT,
                verification=Verification.VERIFIED,
            ),
        ),
        max_project_value=20_000_000,
        annual_turnover=60_000_000,
        currency="MRU",
        max_parallel_bids=4,
        daily_bid_cost=15_000,
        gross_margin_pct=18,
    )
    base.update(kw)
    return CompanyProfile(**base)


def cred_req(cred: str, mandatory: bool = True) -> RequirementSpec:
    return RequirementSpec(id=f"r-{cred}", kind=ReqKind.CREDENTIAL, mandatory=mandatory, text=cred, credential_id=cred)
