"""Evaluation runner (spec §57–58). Golden cases live in forsa/evals/<suite>/*.yaml.

Each case has: input, expected structured result, evidence/notes and severity.
A failed `critical` case fails CI.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import yaml

from forsa.ai.boundaries import detect_injection, validate_rewording
from forsa.documents.extract import Page
from forsa.documents.requirements import extract_requirements
from forsa.kernel.epistemics import Epistemic, Verification
from forsa.matching.engine import MatchingEngine
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
from forsa.taxonomy import default_ontology

DEFAULT_DIR = Path(os.environ.get("FORSA_EVALS_DIR") or Path(__file__).resolve().parents[3] / "evals")
NOW = datetime(2026, 9, 1, 8, 0, tzinfo=UTC)


def _company(d: dict[str, Any]) -> CompanyProfile:
    def v(x: dict) -> Verification:
        return Verification.VERIFIED if x.get("verified") else Verification.UNVERIFIED

    def ep(x: dict) -> Epistemic:
        return Epistemic(x.get("epistemic", "FACT" if x.get("verified") else "USER_CLAIM"))

    return CompanyProfile(
        id="eval-co",
        name=d.get("name", "eval"),
        country=d.get("country", "MR"),
        regions_served=frozenset(d.get("regions", [])),
        capabilities=tuple(CapabilityClaim(c["concept"], ep(c), v(c)) for c in d.get("capabilities", [])),
        credentials=tuple(
            CredentialClaim(c["id"], CredentialStatus(c.get("status", "HELD")), None, ep(c), v(c))
            for c in d.get("credentials", [])
        ),
        projects=tuple(
            ProjectClaim(
                f"p{i}",
                p.get("title", f"p{i}"),
                tuple(p["concepts"]),
                None,
                p.get("value"),
                p.get("currency"),
                p.get("year"),
                None,
                ep(p),
                v(p),
            )
            for i, p in enumerate(d.get("projects", []))
        ),
        excluded_concepts=frozenset(d.get("excluded", [])),
        max_project_value=d.get("max_project_value"),
        annual_turnover=d.get("turnover"),
        currency=d.get("currency", "MRU"),
    )


def _opportunity(d: dict[str, Any]) -> OpportunityProfile:
    reqs = []
    for i, r in enumerate(d.get("requirements", [])):
        reqs.append(
            RequirementSpec(
                f"r{i}",
                ReqKind(r["kind"]),
                r.get("mandatory", True),
                r.get("text", ""),
                credential_id=r.get("credential"),
                min_count=r.get("min_count"),
                min_amount=r.get("min_amount"),
                currency=r.get("currency"),
            )
        )
    deadline = d.get("deadline_days")
    return OpportunityProfile(
        id="eval-opp",
        title=d.get("title", ""),
        status=Lifecycle(d.get("status", "PUBLISHED")),
        category=d.get("category", "works"),
        region=d.get("region"),
        estimated_value=d.get("value"),
        currency=d.get("currency", "MRU"),
        published_at=NOW - timedelta(days=1),
        deadline_at=NOW + timedelta(days=deadline) if deadline is not None else None,
        concepts=tuple(ConceptNeed(c, 1.0) for c in d.get("concepts", [])),
        requirements=tuple(reqs),
        consortium_allowed=d.get("consortium_allowed", True),
    )


def _matching(case: dict) -> tuple[bool, str]:
    engine = MatchingEngine(default_ontology())
    r = engine.evaluate(_opportunity(case["input"]["opportunity"]), _company(case["input"]["company"]), NOW)
    exp = case["expected"]
    problems = []
    allowed = exp["recommendation"] if isinstance(exp["recommendation"], list) else [exp["recommendation"]]
    if r.recommendation.value not in allowed:
        problems.append(f"recommendation {r.recommendation.value} not in {allowed}")
    for gate, outcome in (exp.get("gates") or {}).items():
        g = next((x for x in r.gates if x.gate == gate), None)
        if g is None or g.outcome.value != outcome:
            problems.append(f"gate {gate}: {g.outcome.value if g else 'missing'} != {outcome}")
    if "min_fit" in exp and r.fit_score < exp["min_fit"]:
        problems.append(f"fit {r.fit_score} < {exp['min_fit']}")
    if "max_fit" in exp and r.fit_score > exp["max_fit"]:
        problems.append(f"fit {r.fit_score} > {exp['max_fit']}")
    return not problems, "; ".join(problems) or f"{r.recommendation.value} fit={r.fit_score}"


def _extraction(case: dict) -> tuple[bool, str]:
    reqs = extract_requirements([Page(1, case["input"]["text"])], default_ontology())
    problems = []
    for want in case["expected"].get("requirements", []):
        hit = next(
            (
                r
                for r in reqs
                if r.category == want["category"]
                and (not want.get("type") or r.type == want["type"])
                and all(c in r.credential_ids for c in want.get("credentials", []))
            ),
            None,
        )
        if hit is None:
            problems.append(f"missing {want}")
            continue
        for key in ("min_count", "min_amount", "currency"):
            if key in want and getattr(hit, key) != want[key]:
                problems.append(f"{key}: {getattr(hit, key)} != {want[key]}")
    if "max_requirements" in case["expected"] and len(reqs) > case["expected"]["max_requirements"]:
        problems.append(f"{len(reqs)} requirements > {case['expected']['max_requirements']} (false positives)")
    return not problems, "; ".join(problems) or f"{len(reqs)} requirement(s)"


def _multilingual(case: dict) -> tuple[bool, str]:
    found = set(default_ontology().concepts_in(case["input"]["text"]))
    missing = set(case["expected"]["concepts"]) - found
    forbidden = set(case["expected"].get("not_concepts", [])) & found
    ok = not missing and not forbidden
    return ok, f"found={sorted(found)}" if ok else f"missing={sorted(missing)} forbidden={sorted(forbidden)}"


def _safety(case: dict) -> tuple[bool, str]:
    inp, exp = case["input"], case["expected"]
    if "document" in inp:
        flags = detect_injection(inp["document"])
        return bool(flags) == exp["flagged"], f"flags={flags}"
    problems = validate_rewording(inp["grounded"], inp["candidate"])
    return bool(problems) == exp["rejected"], f"problems={problems}"


SUITES = {"matching": _matching, "extraction": _extraction, "multilingual": _multilingual, "safety": _safety}


def run_all(directory: Path | None = None) -> dict[str, Any]:
    directory = directory or DEFAULT_DIR
    report: dict[str, Any] = {"suites": {}, "failed": 0}
    for suite, fn in SUITES.items():
        results = []
        for path in sorted((directory / suite).glob("*.yaml")):
            for case in yaml.safe_load(path.read_text(encoding="utf-8")) or []:
                ok, detail = fn(case)
                results.append(
                    {"id": case["id"], "ok": ok, "severity": case.get("severity", "major"), "detail": detail}
                )
        passed = sum(r["ok"] for r in results)
        critical_failures = [r for r in results if not r["ok"] and r["severity"] == "critical"]
        report["suites"][suite] = {
            "cases": len(results),
            "passed": passed,
            "pass_rate": round(passed / len(results), 3) if results else None,
            "failures": [r for r in results if not r["ok"]],
        }
        report["failed"] += len(critical_failures)
    return report
