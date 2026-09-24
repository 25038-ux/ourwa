"""AI inside product features (ADR-014). Every feature is flag-gated, optional and verified.

* ai_explanations — re-words a recommendation in plain language; `validate_rewording` (no new numbers).
* ai_extraction   — proposes requirements the rules missed; the quote must exist verbatim in the document,
                    rows are NEEDS_REVIEW and excluded from gates until a human verifies them.
* ai_decisions    — Jev cross-checks rule-extracted requirement types; disagreement ⇒ NEEDS_REVIEW, never auto-fix.
* ai_triage       — Jev estimates relevance of a match; shown separately, never changes the fit score.
* ai_drafting     — polishes evidence-backed compliance answers; validated against answer + evidence.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from forsa.ai.boundaries import UntrustedBlock, build_prompt, validate_rewording
from forsa.ai.gateway import AIGateway
from forsa.ai.providers.jev import Choice, Noul
from forsa.ai.types import AICall, AITask, Sensitivity
from forsa.db.models import Company, CompanyCapability, Evidence, Match, Opportunity, Requirement
from forsa.kernel.hashing import content_hash
from forsa.matching.render import concept_label, render_match

log = logging.getLogger("forsa.ai_features")

EXTRACTOR_AI = "req-ai-v1"
CATEGORIES = [
    "certification",
    "experience",
    "financial",
    "administrative",
    "personnel",
    "delivery",
    "formatting",
    "technical",
    "other",
]


def _ws(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


# ── ai_explanations ─────────────────────────────────────────────────────────
def ai_summary(session: Session, gateway: AIGateway, org_id: uuid.UUID, match: Match, lang: str) -> dict[str, Any]:
    r = render_match(match.result, lang)
    grounded = " ".join(
        [r["explanation"], *[c["message"] for c in r["conditions"]], *[w["message"] for w in r["why_now"]]]
    )
    task = (
        "Rewrite this procurement recommendation for a busy company owner in "
        f"{'French' if lang == 'fr' else 'English'}: 2-3 short sentences, plain words, keep every number exactly, "
        "add no new facts, keep 'estimate' wording (never promise winning)."
    )
    system, user = build_prompt(task, [UntrustedBlock("recommendation", "forsa", grounded)])
    res = gateway.complete(
        session,
        AICall(
            task=AITask.EXPLAIN_MATCH,
            system=system,
            user=user,
            prompt_version="explain-v1",
            org_id=org_id,
            sensitivity=Sensitivity.INTERNAL,
            max_tokens=300,
        ),
    )
    if not res.ok:
        return {"available": False, "reason": res.error}
    problems = validate_rewording(grounded, res.text)
    if problems:
        return {"available": False, "reason": "rejected", "problems": problems}
    return {
        "available": True,
        "text": res.text.strip(),
        "provider": res.provider,
        "model": res.model,
        "epistemic": "INFERENCE",
        "grounded_on": "structured recommendation",
    }


# ── ai_extraction ───────────────────────────────────────────────────────────
def propose_requirements(
    session: Session, gateway: AIGateway, opp: Opportunity, doc_text: str, document_version_id: uuid.UUID | None
) -> int:
    """LLM proposals, kept only when their quote is found verbatim in the document."""
    if not doc_text.strip():
        return 0
    task = (
        'List the bidder requirements in the document. Return JSON {"requirements": [{"quote": <exact text '
        'copied from the document>, "type": "mandatory"|"scored"|"informational", "category": one of '
        f"{CATEGORIES}}}]}}. Copy quotes exactly; do not paraphrase; omit anything you are unsure about."
    )
    system, user = build_prompt(task, [UntrustedBlock(str(opp.id), "tender_document", doc_text[:20000])])
    res = gateway.complete(
        session,
        AICall(
            task=AITask.EXTRACT_REQUIREMENTS,
            system=system,
            user=user,
            prompt_version=EXTRACTOR_AI,
            json_output=True,
            max_tokens=2000,
            sensitivity=Sensitivity.PUBLIC,
        ),
    )
    if not res.ok:
        return 0
    try:
        items = json.loads(re.search(r"\{.*\}", res.text, re.S).group(0)).get("requirements", [])  # type: ignore[union-attr]
    except (AttributeError, ValueError):
        return 0
    haystack = _ws(doc_text)
    existing = [
        _ws(t) for t in session.scalars(select(Requirement.text).where(Requirement.opportunity_id == opp.id)).all()
    ]
    created = 0
    for item in items[:40]:
        quote = _ws(str(item.get("quote") or ""))
        if len(quote) < 15 or quote not in haystack:
            continue  # hallucination guard: must be a verbatim span of the document
        if any(quote in e or e in quote for e in existing):
            continue  # already extracted by the deterministic rules
        # Offsets into the ORIGINAL text (whitespace-tolerant search) so citations stay exact.
        span = re.search(r"\s+".join(re.escape(w) for w in quote.split(" ")), doc_text)
        start, end = (span.start(), span.end()) if span else (None, None)
        ev = Evidence(
            kind="document" if document_version_id else "source_snapshot",
            quote=quote[:2000],
            char_start=start,
            char_end=end,
            document_version_id=document_version_id,
            extraction_method=f"ai:{res.provider}:{res.model}:{EXTRACTOR_AI}",
        )
        session.add(ev)
        session.flush()
        new = session.execute(
            insert(Requirement)
            .values(
                id=uuid.uuid4(),
                opportunity_id=opp.id,
                document_version_id=document_version_id,
                external_key=f"ai:{content_hash(quote)[:24]}",
                text=quote,
                type=item.get("type") if item.get("type") in ("mandatory", "scored", "informational") else "mandatory",
                category=item.get("category") if item.get("category") in CATEGORIES else "other",
                page=None,
                heading_path=[],
                char_start=start,
                char_end=end,
                params={"ai": True},
                evidence_id=ev.id,
                extraction_method=f"ai:{res.provider}:{res.model}:{EXTRACTOR_AI}",
                confidence="LOW",
                verification="NEEDS_REVIEW",
            )
            .on_conflict_do_nothing(index_elements=["opportunity_id", "external_key"])
            .returning(Requirement.id)
        ).scalar()
        if new is not None:
            existing.append(quote)
            created += 1
    return created


# ── ai_decisions (Jev) ──────────────────────────────────────────────────────
def jev_crosscheck(session: Session, gateway: AIGateway, opp: Opportunity, threshold: float = 0.85) -> int:
    """Ask Jev to classify each rule-extracted clause; strong disagreement sends the clause to human review."""
    reqs = session.scalars(
        select(Requirement)
        .where(Requirement.opportunity_id == opp.id, Requirement.extraction_method.like("rules:%"))
        .limit(20)
    ).all()
    if not reqs:
        return 0
    state = {"notice": opp.title, "clauses": {f"c{i}": r.text[:500] for i, r in enumerate(reqs)}}
    questions: dict[str, Any] = {}
    for i, _ in enumerate(reqs):
        questions[f"mandatory_c{i}"] = Noul(
            f"Is clause c{i} a mandatory condition whose absence disqualifies a "
            "bid (not a scored or informational statement)?"
        )
        questions[f"category_c{i}"] = Choice(
            f"Which category best describes clause c{i}?", {c: None for c in CATEGORIES}
        )
    decision = gateway.decide(session, "requirement_crosscheck", state, questions, sensitivity=Sensitivity.PUBLIC)
    if decision is None:
        return 0
    flagged = 0
    for i, r in enumerate(reqs):
        p_mand = decision.probability(f"mandatory_c{i}")
        label, conf = decision.choice(f"category_c{i}")
        check = {"model": decision.model, "p_mandatory": p_mand, "category": label, "confidence": conf}
        disagrees = (
            p_mand is not None
            and ((r.type == "mandatory" and p_mand < 1 - threshold) or (r.type != "mandatory" and p_mand > threshold))
        ) or (label is not None and conf is not None and conf >= threshold and label != r.category)
        r.params = {**(r.params or {}), "ai_check": {**check, "agrees": not disagrees}}
        if disagrees and r.verification == "UNVERIFIED":
            r.verification = "NEEDS_REVIEW"
            flagged += 1
    return flagged


def jev_triage(session: Session, gateway: AIGateway, match: Match, opp: Opportunity) -> dict[str, Any] | None:
    company = session.scalar(select(Company).where(Company.id == match.company_id))
    if company is None:
        return None
    caps = session.scalars(select(CompanyCapability.concept_id).where(CompanyCapability.company_id == company.id)).all()
    state = {
        "company_capabilities": [concept_label(c, "en") for c in caps],
        "opportunity": {
            "title": opp.title,
            "description": (opp.description or "")[:1500],
            "region": opp.region,
            "category": opp.category,
        },
    }
    decision = gateway.decide(
        session,
        "relevance_triage",
        state,
        {"relevant": Noul("Would this company realistically be interested in and able to deliver this opportunity?")},
        org_id=match.org_id,
        sensitivity=Sensitivity.INTERNAL,
    )
    if decision is None or decision.probability("relevant") is None:
        return None
    triage = {
        "relevant": round(float(decision.probability("relevant") or 0), 3),
        "model": decision.model,
        "epistemic": "FORECAST",
        "note": "Model estimate of relevance — not a win probability, not the fit.",
    }
    match.result = {**match.result, "ai_triage": triage}
    return triage


# ── ai_drafting ─────────────────────────────────────────────────────────────
def polish_section(
    session: Session, gateway: AIGateway, org_id: uuid.UUID, requirement: str, answer: str, evidence: list[str]
) -> str | None:
    grounded = " ".join([answer, *evidence])
    task = (
        "Rewrite the company's answer to this tender requirement in formal French proposal style, 2-4 "
        "sentences. Use only facts from the answer and evidence; keep all numbers; add nothing."
    )
    system, user = build_prompt(
        task,
        [
            UntrustedBlock("requirement", "tender", requirement),
            UntrustedBlock("answer", "company", answer),
            *[UntrustedBlock(f"evidence{i}", "company_document", e) for i, e in enumerate(evidence)],
        ],
    )
    res = gateway.complete(
        session,
        AICall(
            task=AITask.DRAFT_SECTION,
            system=system,
            user=user,
            prompt_version="draft-v1",
            org_id=org_id,
            max_tokens=500,
            sensitivity=Sensitivity.CONFIDENTIAL,
        ),
    )
    if not res.ok or validate_rewording(grounded, res.text, max_ratio=2.5):
        return None
    return res.text.strip()
