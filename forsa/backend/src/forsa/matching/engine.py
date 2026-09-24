"""Opportunity Fit engine — deterministic, explainable, versioned (spec §12–14, §36–37).

Stages
  A  hard gates            → evaluate_gates()
  B  capability match      → ontology similarity over verified/claimed capabilities
  C  evidence quality      → share of used claims that are verified
  D  capacity              → project size & workload
  E  strategic fit         → buyer relationship, strategic focus
  F  bid economics         → ranges, never point estimates
  G  explanation           → forsa.matching.messages (templated; AI may only re-word)

The score is an *Opportunity Fit Score*, never a win probability (spec §13).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from forsa.kernel.epistemics import Epistemic, Truth, Verification, claim_weight
from forsa.matching.profiles import (
    OPEN_STATES,
    CompanyProfile,
    Component,
    CredentialStatus,
    Economics,
    EvidenceRef,
    GateOutcome,
    GateResult,
    Lifecycle,
    MatchResult,
    OpportunityProfile,
    Range,
    Reason,
    Recommendation,
    ReqKind,
    RequirementSpec,
    Risk,
)
from forsa.taxonomy.ontology import Ontology

SCORING_VERSION = "fit-v1.1"  # v1.1: credentials are obtained in parallel with bid preparation

DEFAULT_WEIGHTS: dict[str, float] = {
    "eligibility": 0.30,
    "capability": 0.20,
    "experience": 0.15,
    "evidence": 0.10,
    "capacity": 0.10,
    "geography": 0.05,
    "strategic": 0.05,
    "timeline": 0.05,
}

# Base bid-preparation effort (person-days) by procurement category. ESTIMATES — calibrate with
# real outcome data (Phase 16) before presenting as anything but a range.
BASE_EFFORT_DAYS: dict[str, float] = {"works": 10, "goods": 4, "services": 5, "consulting": 8}


@dataclass(frozen=True)
class ScoringConfig:
    version: str = SCORING_VERSION
    weights: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_WEIGHTS))
    min_prep_days: float = 3.0
    document_margin_days: float = 1.0  # a document obtained in parallel must arrive ≥1 day before the deadline
    comfortable_prep_days: float = 14.0
    bid_threshold: int = 70
    review_threshold: int = 45
    unknown_prior: float = 0.5
    similar_project_threshold: float = 0.6


def _ev(epistemic: Epistemic, quote: str | None = None, locator: str | None = None) -> EvidenceRef:
    return EvidenceRef(epistemic=epistemic, quote=quote, locator=locator)


def _days_left(opp: OpportunityProfile, now: datetime) -> float | None:
    if opp.deadline_at is None:
        return None
    return (opp.deadline_at - now).total_seconds() / 86400


def _claim_evidence(ids: tuple[str, ...], epistemic: Epistemic) -> list[EvidenceRef]:
    if not ids:
        return [EvidenceRef(epistemic=epistemic, locator="company_profile")]
    return [EvidenceRef(epistemic=Epistemic.FACT, evidence_id=i) for i in ids]


class MatchingEngine:
    def __init__(self, ontology: Ontology, config: ScoringConfig | None = None):
        self.ontology = ontology
        self.cfg = config or ScoringConfig()

    # ── Stage A: hard gates ─────────────────────────────────────────────────
    def evaluate_gates(self, opp: OpportunityProfile, co: CompanyProfile, now: datetime) -> list[GateResult]:
        gates: list[GateResult] = []
        days_left = _days_left(opp, now)

        # Lifecycle status
        if opp.status == Lifecycle.PLANNED:
            gates.append(
                GateResult(
                    "status",
                    GateOutcome.PASS,
                    Truth.CONFIRMED,
                    True,
                    Reason(
                        "status.planned",
                        "+",
                        {"status": opp.status.value},
                        [_ev(Epistemic.FACT, locator="opportunity.status")],
                    ),
                )
            )
        elif opp.status not in OPEN_STATES:
            gates.append(
                GateResult(
                    "status",
                    GateOutcome.FAIL,
                    Truth.CONFIRMED,
                    True,
                    Reason(
                        "status.not_open",
                        "-",
                        {"status": opp.status.value},
                        [_ev(Epistemic.FACT, locator="opportunity.status")],
                    ),
                )
            )
        else:
            gates.append(
                GateResult(
                    "status",
                    GateOutcome.PASS,
                    Truth.CONFIRMED,
                    True,
                    Reason(
                        "status.open",
                        "+",
                        {"status": opp.status.value},
                        [_ev(Epistemic.FACT, locator="opportunity.status")],
                    ),
                )
            )

        # Deadline feasibility
        if days_left is None:
            if opp.status != Lifecycle.PLANNED:
                gates.append(
                    GateResult(
                        "deadline",
                        GateOutcome.UNKNOWN,
                        Truth.NOT_FOUND,
                        True,
                        Reason("deadline.unknown", "?"),
                        remediation="verify_deadline",
                    )
                )
        elif days_left < 0:
            gates.append(
                GateResult(
                    "deadline",
                    GateOutcome.FAIL,
                    Truth.CONFIRMED,
                    True,
                    Reason(
                        "deadline.passed",
                        "-",
                        {"days": round(-days_left, 1)},
                        [_ev(Epistemic.FACT, locator="opportunity.deadline_at")],
                    ),
                )
            )
        elif days_left < self.cfg.min_prep_days:
            gates.append(
                GateResult(
                    "deadline",
                    GateOutcome.FAIL,
                    Truth.CONFIRMED,
                    True,
                    Reason(
                        "deadline.impossible",
                        "-",
                        {"days": round(days_left, 1), "min_days": self.cfg.min_prep_days},
                        [_ev(Epistemic.FACT, locator="opportunity.deadline_at")],
                    ),
                )
            )
        else:
            gates.append(
                GateResult(
                    "deadline",
                    GateOutcome.PASS,
                    Truth.CONFIRMED,
                    True,
                    Reason(
                        "deadline.feasible",
                        "+",
                        {"days": round(days_left, 1)},
                        [_ev(Epistemic.FACT, locator="opportunity.deadline_at")],
                    ),
                )
            )

        # Company-declared exclusions (a company statement IS evidence about the company)
        needs = [n for n in opp.concepts if n.weight > 0]
        if needs and co.excluded_concepts:
            excluded = [
                n
                for n in needs
                if any(self.ontology.similarity(n.concept_id, ex) >= 0.6 for ex in co.excluded_concepts)
            ]
            if len(excluded) == len(needs):
                gates.append(
                    GateResult(
                        "excluded_service",
                        GateOutcome.FAIL,
                        Truth.CONFIRMED,
                        True,
                        Reason(
                            "exclusion.service",
                            "-",
                            {"concepts": [n.concept_id for n in excluded]},
                            [_ev(Epistemic.USER_CLAIM, locator="company.constraints")],
                        ),
                    )
                )
        if opp.region and opp.region in co.excluded_regions:
            gates.append(
                GateResult(
                    "excluded_region",
                    GateOutcome.FAIL,
                    Truth.CONFIRMED,
                    True,
                    Reason(
                        "exclusion.region",
                        "-",
                        {"region": opp.region},
                        [_ev(Epistemic.USER_CLAIM, locator="company.constraints")],
                    ),
                )
            )

        for req in opp.requirements:
            if not req.mandatory:
                continue
            gate = self._requirement_gate(req, opp, co, days_left)
            if gate is not None:
                gates.append(gate)
        return gates

    def _requirement_gate(
        self, req: RequirementSpec, opp: OpportunityProfile, co: CompanyProfile, days_left: float | None
    ) -> GateResult | None:
        req_ev = [req.evidence] if req.evidence else []
        truth_src = Truth.CONFIRMED if req.verification == Verification.VERIFIED else Truth.NEEDS_HUMAN

        if req.kind == ReqKind.CREDENTIAL and req.credential_id:
            concept = self.ontology.concepts.get(req.credential_id)
            obtainable = concept.obtainable_days if concept else None
            params: dict[str, Any] = {"credential": req.credential_id}
            claim = co.credential(req.credential_id)
            if claim is None and concept is not None and concept.per_bid:
                # Per-bid instruments (e.g. bank bid security) are obtained for each bid, not held in a profile.
                feasible = (
                    obtainable is None or days_left is None or obtainable + self.cfg.document_margin_days <= days_left
                )
                return GateResult(
                    f"credential:{req.credential_id}",
                    GateOutcome.GAP if feasible else GateOutcome.FAIL,
                    truth_src,
                    True,
                    Reason("credential.per_bid", "?", {**params, "days": obtainable}, req_ev),
                    remediation="obtain" if feasible else None,
                    requirement_id=req.id,
                )
            if claim is None:
                return GateResult(
                    f"credential:{req.credential_id}",
                    GateOutcome.UNKNOWN,
                    Truth.NOT_FOUND,
                    True,
                    Reason("credential.not_found", "?", params, req_ev),
                    remediation="add_credential",
                    requirement_id=req.id,
                )
            if claim.status == CredentialStatus.HELD:
                if claim.valid_until and opp.deadline_at and claim.valid_until < opp.deadline_at:
                    can_renew = (
                        obtainable is not None
                        and days_left is not None
                        and obtainable + self.cfg.document_margin_days <= days_left
                    )
                    return GateResult(
                        f"credential:{req.credential_id}",
                        GateOutcome.GAP if can_renew else GateOutcome.FAIL,
                        Truth.CONFIRMED,
                        True,
                        Reason(
                            "credential.expires",
                            "-",
                            {**params, "valid_until": claim.valid_until.date().isoformat()},
                            req_ev + _claim_evidence(claim.evidence_ids, claim.epistemic),
                        ),
                        remediation="renew" if can_renew else None,
                        requirement_id=req.id,
                    )
                verified = claim.verification == Verification.VERIFIED
                return GateResult(
                    f"credential:{req.credential_id}",
                    GateOutcome.PASS,
                    Truth.CONFIRMED if verified else Truth.NEEDS_HUMAN,
                    True,
                    Reason(
                        "credential.held" if verified else "credential.claimed",
                        "+",
                        params,
                        req_ev + _claim_evidence(claim.evidence_ids, claim.epistemic),
                        Epistemic.FACT if verified else Epistemic.USER_CLAIM,
                    ),
                    remediation=None if verified else "upload_evidence",
                    requirement_id=req.id,
                )
            if claim.status == CredentialStatus.IN_PROGRESS:
                return GateResult(
                    f"credential:{req.credential_id}",
                    GateOutcome.GAP,
                    Truth.CONFIRMED,
                    True,
                    Reason("credential.in_progress", "?", params, req_ev),
                    remediation="complete_credential",
                    requirement_id=req.id,
                )
            # Explicitly declared ABSENT
            if (
                obtainable is not None
                and days_left is not None
                and obtainable + self.cfg.document_margin_days <= days_left
            ):
                return GateResult(
                    f"credential:{req.credential_id}",
                    GateOutcome.GAP,
                    truth_src,
                    True,
                    Reason("credential.obtainable", "?", {**params, "days": obtainable}, req_ev),
                    remediation="obtain",
                    requirement_id=req.id,
                )
            return GateResult(
                f"credential:{req.credential_id}",
                GateOutcome.FAIL,
                truth_src,
                True,
                Reason("credential.absent", "-", params, req_ev),
                requirement_id=req.id,
            )

        if req.kind == ReqKind.EXPERIENCE:
            needed = req.min_count or 1
            wanted = req.concept_ids or tuple(n.concept_id for n in opp.concepts if n.weight > 0)
            relevant = self._relevant_projects(co, wanted)
            count = len(relevant)
            params = {"needed": needed, "found": count}
            ev = req_ev + [e for p, _ in relevant for e in _claim_evidence(p.evidence_ids, p.epistemic)][:5]
            consortium_ok = opp.consortium_allowed is not False
            if count >= needed:
                all_verified = all(p.verification == Verification.VERIFIED for p, _ in relevant[:needed])
                return GateResult(
                    "experience",
                    GateOutcome.PASS,
                    Truth.CONFIRMED if all_verified else Truth.NEEDS_HUMAN,
                    True,
                    Reason("experience.met", "+", params, ev),
                    remediation=None if all_verified else "upload_evidence",
                    requirement_id=req.id,
                )
            if not co.projects:
                return GateResult(
                    "experience",
                    GateOutcome.UNKNOWN,
                    Truth.NOT_FOUND,
                    True,
                    Reason("experience.no_projects", "?", params, req_ev),
                    remediation="add_projects",
                    requirement_id=req.id,
                )
            return GateResult(
                "experience",
                GateOutcome.GAP,
                Truth.NOT_FOUND,
                True,
                Reason("experience.short", "?", params, ev),
                remediation="partner" if consortium_ok else "add_projects",
                requirement_id=req.id,
            )

        if req.kind == ReqKind.FINANCIAL_TURNOVER and req.min_amount is not None:
            params = {"required": req.min_amount, "currency": req.currency}
            if co.annual_turnover is None:
                return GateResult(
                    "financial",
                    GateOutcome.UNKNOWN,
                    Truth.NOT_FOUND,
                    True,
                    Reason("financial.unknown", "?", params, req_ev),
                    remediation="add_financials",
                    requirement_id=req.id,
                )
            if req.currency and co.currency and req.currency != co.currency:
                return GateResult(
                    "financial",
                    GateOutcome.UNKNOWN,
                    Truth.NEEDS_HUMAN,
                    True,
                    Reason("financial.currency_mismatch", "?", {**params, "company_currency": co.currency}, req_ev),
                    remediation="confirm_financials",
                    requirement_id=req.id,
                )
            if co.annual_turnover >= req.min_amount:
                return GateResult(
                    "financial",
                    GateOutcome.PASS,
                    Truth.NEEDS_HUMAN,
                    True,
                    Reason(
                        "financial.met", "+", {**params, "turnover": co.annual_turnover}, req_ev, Epistemic.USER_CLAIM
                    ),
                    remediation="confirm_financials",
                    requirement_id=req.id,
                )
            consortium_ok = opp.consortium_allowed is not False
            return GateResult(
                "financial",
                GateOutcome.GAP if consortium_ok else GateOutcome.FAIL,
                truth_src,
                True,
                Reason("financial.short", "-", {**params, "turnover": co.annual_turnover}, req_ev),
                remediation="partner" if consortium_ok else None,
                requirement_id=req.id,
            )

        if req.kind == ReqKind.REGISTRATION_COUNTRY and req.country:
            params = {"country": req.country}
            if co.country is None:
                return GateResult(
                    "registration",
                    GateOutcome.UNKNOWN,
                    Truth.NOT_FOUND,
                    True,
                    Reason("registration.unknown", "?", params, req_ev),
                    requirement_id=req.id,
                )
            ok = co.country == req.country
            return GateResult(
                "registration",
                GateOutcome.PASS if ok else GateOutcome.FAIL,
                truth_src,
                True,
                Reason(
                    "registration.met" if ok else "registration.mismatch",
                    "+" if ok else "-",
                    {**params, "company_country": co.country},
                    req_ev,
                ),
                requirement_id=req.id,
            )
        # Unclassified mandatory requirements go to the compliance matrix, not the gates.
        return None

    def _relevant_projects(self, co: CompanyProfile, wanted: tuple[str, ...]) -> list[tuple]:
        out = []
        for p in co.projects:
            if claim_weight(p.epistemic, p.verification) <= 0:
                continue
            best = max((self.ontology.similarity(w, pc) for w in wanted for pc in p.concept_ids), default=0.0)
            if best >= self.cfg.similar_project_threshold:
                out.append((p, best))
        out.sort(key=lambda t: (-t[1], -(t[0].year or 0)))
        return out

    # ── Stages B–E: components ──────────────────────────────────────────────
    def _eligibility(self, gates: list[GateResult]) -> Component:
        vals, known = [], 0
        for g in gates:
            if g.outcome == GateOutcome.UNKNOWN:
                vals.append(self.cfg.unknown_prior)
                continue
            known += 1
            vals.append(
                {
                    GateOutcome.PASS: 1.0 if g.truth == Truth.CONFIRMED else 0.85,
                    GateOutcome.GAP: 0.5,
                    GateOutcome.FAIL: 0.0,
                }[g.outcome]
            )
        score = min(vals) if any(v == 0 for v in vals) else (sum(vals) / len(vals) if vals else 0.5)
        reasons = [g.reason for g in gates if g.outcome != GateOutcome.PASS]
        return Component(
            "eligibility", self.cfg.weights["eligibility"], score, known / len(gates) if gates else 0.0, reasons
        )

    def _capability(self, opp: OpportunityProfile, co: CompanyProfile) -> tuple[Component, list]:
        needs = [n for n in opp.concepts if n.weight > 0]
        w = self.cfg.weights["capability"]
        if not needs:
            return Component("capability", w, self.cfg.unknown_prior, 0.0, [Reason("capability.no_concepts", "?")]), []
        if not co.capabilities:
            return Component(
                "capability", w, self.cfg.unknown_prior, 0.0, [Reason("capability.empty_profile", "?")]
            ), []
        total = sum(n.weight for n in needs)
        acc, reasons, used = 0.0, [], []
        for need in needs:
            best, best_cap = 0.0, None
            for cap in co.capabilities:
                s = self.ontology.similarity(need.concept_id, cap.concept_id) * claim_weight(
                    cap.epistemic, cap.verification
                )
                if s > best:
                    best, best_cap = s, cap
            acc += need.weight * best
            need_ev = [need.evidence] if need.evidence else []
            if best_cap is not None and best > 0:
                used.append(best_cap)
                reasons.append(
                    Reason(
                        "capability.match",
                        "+",
                        {"need": need.concept_id, "offered": best_cap.concept_id, "strength": round(best, 2)},
                        need_ev + _claim_evidence(best_cap.evidence_ids, best_cap.epistemic),
                    )
                )
            else:
                reasons.append(Reason("capability.missing", "-", {"need": need.concept_id}, need_ev))
        return Component("capability", w, acc / total, 1.0, reasons), used

    def _experience(self, opp: OpportunityProfile, co: CompanyProfile) -> tuple[Component, list]:
        w = self.cfg.weights["experience"]
        if not co.projects:
            return Component("experience", w, self.cfg.unknown_prior, 0.0, [Reason("experience.no_projects", "?")]), []
        wanted = tuple(n.concept_id for n in opp.concepts if n.weight > 0)
        relevant = self._relevant_projects(co, wanted)
        target = max((r.min_count or 1 for r in opp.requirements if r.kind == ReqKind.EXPERIENCE), default=2)
        eff = sum(s * claim_weight(p.epistemic, p.verification) for p, s in relevant[: target + 1])
        score = min(1.0, eff / target) if target else 0.0
        reasons: list[Reason] = []
        for p, s in relevant[:3]:
            comparable = bool(
                opp.estimated_value and p.value and p.currency == opp.currency and p.value >= 0.5 * opp.estimated_value
            )
            reasons.append(
                Reason(
                    "experience.project",
                    "+",
                    {"project": p.title, "year": p.year, "similarity": round(s, 2), "comparable_size": comparable},
                    _claim_evidence(p.evidence_ids, p.epistemic),
                )
            )
        if not relevant:
            reasons.append(Reason("experience.none_similar", "-"))
        return Component("experience", w, score, 1.0, reasons), [p for p, _ in relevant]

    def _evidence_quality(self, used_caps: list, used_projects: list, gates: list[GateResult]) -> Component:
        w = self.cfg.weights["evidence"]
        items = [c.verification for c in used_caps] + [p.verification for p in used_projects]
        items += [
            Verification.VERIFIED if g.truth == Truth.CONFIRMED else Verification.UNVERIFIED
            for g in gates
            if g.requirement_id and g.outcome == GateOutcome.PASS
        ]
        if not items:
            return Component("evidence", w, self.cfg.unknown_prior, 0.0, [Reason("evidence.none_used", "?")])
        verified = sum(1 for v in items if v == Verification.VERIFIED)
        return Component(
            "evidence",
            w,
            verified / len(items),
            1.0,
            [
                Reason(
                    "evidence.verified_share",
                    "+" if verified == len(items) else "?",
                    {"verified": verified, "total": len(items)},
                )
            ],
        )

    def _capacity(self, opp: OpportunityProfile, co: CompanyProfile) -> Component:
        w = self.cfg.weights["capacity"]
        reasons: list[Reason] = []
        parts: list[float] = []
        if (
            opp.estimated_value
            and co.max_project_value
            and (not opp.currency or not co.currency or opp.currency == co.currency)
        ):
            ratio = opp.estimated_value / co.max_project_value
            parts.append(1.0 if ratio <= 1 else 0.5 if ratio <= 1.5 else 0.2 if ratio <= 3 else 0.0)
            reasons.append(
                Reason(
                    "capacity.size_ratio",
                    "+" if ratio <= 1 else "-",
                    {
                        "ratio": round(ratio, 2),
                        "value": opp.estimated_value,
                        "max": co.max_project_value,
                        "currency": opp.currency,
                    },
                )
            )
        if co.max_parallel_bids:
            load = co.active_bids / co.max_parallel_bids
            parts.append(1.0 if load < 0.75 else 0.6 if load < 1 else 0.2)
            reasons.append(
                Reason(
                    "capacity.workload",
                    "+" if load < 0.75 else "-",
                    {"active": co.active_bids, "max": co.max_parallel_bids},
                )
            )
        if not parts:
            return Component("capacity", w, self.cfg.unknown_prior, 0.0, [Reason("capacity.unknown", "?")])
        return Component("capacity", w, sum(parts) / len(parts), len(parts) / 2, reasons)

    def _geography(self, opp: OpportunityProfile, co: CompanyProfile) -> Component:
        w = self.cfg.weights["geography"]
        if not opp.region or not co.regions_served:
            return Component("geography", w, self.cfg.unknown_prior, 0.0, [Reason("geography.unknown", "?")])
        if "*" in co.regions_served or opp.region in co.regions_served:
            return Component("geography", w, 1.0, 1.0, [Reason("geography.served", "+", {"region": opp.region})])
        return Component("geography", w, 0.4, 1.0, [Reason("geography.not_served", "-", {"region": opp.region})])

    def _strategic(self, opp: OpportunityProfile, co: CompanyProfile) -> Component:
        w = self.cfg.weights["strategic"]
        reasons, score, known = [], 0.3, 0.0
        if opp.buyer_id:
            known += 0.5
            if any(p.buyer_id == opp.buyer_id for p in co.projects):
                score += 0.4
                reasons.append(Reason("strategic.known_buyer", "+"))
        if co.strategic_concepts:
            known += 0.5
            hit = [
                n.concept_id
                for n in opp.concepts
                if any(self.ontology.similarity(n.concept_id, s) >= 0.6 for s in co.strategic_concepts)
            ]
            if hit:
                score += 0.3
                reasons.append(Reason("strategic.focus_area", "+", {"concepts": hit}))
        if known == 0:
            return Component("strategic", w, self.cfg.unknown_prior, 0.0, [Reason("strategic.unknown", "?")])
        return Component("strategic", w, min(1.0, score), known, reasons)

    def _timeline(self, opp: OpportunityProfile, now: datetime) -> Component:
        w = self.cfg.weights["timeline"]
        days_left = _days_left(opp, now)
        if days_left is None:
            if opp.status == Lifecycle.PLANNED:
                return Component("timeline", w, 1.0, 1.0, [Reason("timeline.early_signal", "+")])
            return Component("timeline", w, self.cfg.unknown_prior, 0.0, [Reason("deadline.unknown", "?")])
        c = self.cfg
        score = (
            1.0
            if days_left >= c.comfortable_prep_days
            else 0.7
            if days_left >= 7
            else 0.4
            if days_left >= c.min_prep_days
            else 0.0
        )
        return Component(
            "timeline",
            w,
            score,
            1.0,
            [Reason("timeline.days_left", "+" if score >= 0.7 else "-", {"days": round(days_left, 1)})],
        )

    # ── Stage F: economics ──────────────────────────────────────────────────
    def economics(self, opp: OpportunityProfile, co: CompanyProfile) -> Economics:
        base = BASE_EFFORT_DAYS.get(opp.category or "", 6)
        base += 0.5 * sum(1 for r in opp.requirements if r.mandatory)
        effort = Range(base * 0.7, base * 1.4)
        notes = ["effort.estimate_uncalibrated"]
        currency = opp.currency or co.currency
        bid_cost = None
        if co.daily_bid_cost is not None and (not opp.currency or not co.currency or opp.currency == co.currency):
            bid_cost = Range(effort.low * co.daily_bid_cost, effort.high * co.daily_bid_cost)
        else:
            notes.append("bid_cost.missing_daily_cost")
        value = Range(opp.estimated_value, opp.estimated_value) if opp.estimated_value else None
        if value is None:
            notes.append("value.unknown")
        contribution = None
        if value and co.gross_margin_pct is not None:
            lo_margin, hi_margin = max(0.0, co.gross_margin_pct - 5) / 100, (co.gross_margin_pct + 5) / 100
            cost_hi = bid_cost.high if bid_cost else 0.0
            cost_lo = bid_cost.low if bid_cost else 0.0
            contribution = Range(value.low * lo_margin - cost_hi, value.high * hi_margin - cost_lo)
        elif value:
            notes.append("contribution.missing_margin")
        return Economics(currency, effort, bid_cost, value, contribution, notes)

    # ── Why now? (spec §36) ─────────────────────────────────────────────────
    def why_now(
        self, opp: OpportunityProfile, co: CompanyProfile, now: datetime, fit: int, gates: list[GateResult]
    ) -> list[Reason]:
        out: list[Reason] = []
        days_left = _days_left(opp, now)
        if days_left is not None and 0 <= days_left <= 7:
            out.append(Reason("why_now.deadline_soon", "!", {"days": round(days_left, 1)}))
        if opp.published_at and 0 <= (now - opp.published_at).total_seconds() <= 2 * 86400:
            out.append(Reason("why_now.new", "+"))
        if fit >= 80:
            out.append(Reason("why_now.high_fit", "+", {"fit": fit}))
        for g in gates:
            if g.outcome == GateOutcome.GAP and g.remediation in ("obtain", "renew"):
                out.append(Reason("why_now.gap_obtainable", "!", g.reason.params))
        if opp.status == Lifecycle.PLANNED:
            out.append(Reason("why_now.early_signal", "+"))
        if opp.buyer_id and any(p.buyer_id == opp.buyer_id for p in co.projects):
            out.append(Reason("why_now.known_buyer", "+"))
        return out

    # ── Risks ───────────────────────────────────────────────────────────────
    def risks(
        self, opp: OpportunityProfile, gates: list[GateResult], comps: dict[str, Component], now: datetime
    ) -> list[Risk]:
        out: list[Risk] = []
        for g in gates:
            if g.outcome == GateOutcome.FAIL:
                out.append(Risk("legal" if g.requirement_id else "deadline", "HIGH", g.reason))
            elif g.outcome == GateOutcome.GAP:
                out.append(Risk("documentation" if g.gate.startswith("credential") else "capacity", "MEDIUM", g.reason))
            elif g.outcome == GateOutcome.UNKNOWN:
                out.append(Risk("ambiguity", "MEDIUM", g.reason))
            elif g.truth == Truth.NEEDS_HUMAN:
                out.append(Risk("documentation", "LOW", g.reason))
        days_left = _days_left(opp, now)
        if days_left is not None and self.cfg.min_prep_days <= days_left < 7:
            out.append(Risk("deadline", "HIGH", Reason("risk.tight_deadline", "-", {"days": round(days_left, 1)})))
        cap = comps["capacity"]
        if cap.known and cap.score < 0.5:
            out.append(Risk("capacity", "HIGH", Reason("risk.capacity", "-")))
        if opp.estimated_value is None:
            out.append(Risk("pricing", "LOW", Reason("risk.value_unknown", "?")))
        return out

    # ── Orchestration ───────────────────────────────────────────────────────
    def evaluate(self, opp: OpportunityProfile, co: CompanyProfile, now: datetime) -> MatchResult:
        gates = self.evaluate_gates(opp, co, now)
        capability, used_caps = self._capability(opp, co)
        experience, used_projects = self._experience(opp, co)
        comps = {
            "eligibility": self._eligibility(gates),
            "capability": capability,
            "experience": experience,
            "evidence": self._evidence_quality(used_caps, used_projects, gates),
            "capacity": self._capacity(opp, co),
            "geography": self._geography(opp, co),
            "strategic": self._strategic(opp, co),
            "timeline": self._timeline(opp, now),
        }
        total_w = sum(c.weight for c in comps.values())
        fit = round(100 * sum(c.weight * c.score for c in comps.values()) / total_w)
        completeness = sum(c.weight * c.known for c in comps.values()) / total_w
        # A capability miss caps the score: a perfect admin profile must not look like a fit.
        if capability.known and capability.score < 0.3:
            fit = min(fit, round(100 * capability.score) + 20)

        recommendation, rec_reasons, conditions = self._recommend(gates, fit, capability)
        if opp.status == Lifecycle.PLANNED and recommendation != Recommendation.NO_BID:
            # Not yet published: the actionable advice is "prepare", the bid decision comes at publication.
            recommendation = Recommendation.REVIEW
            rec_reasons = [Reason("recommendation.early_signal", "+", {"fit": fit}), *rec_reasons]
        return MatchResult(
            scoring_version=self.cfg.version,
            fit_score=fit,
            data_completeness=completeness,
            recommendation=recommendation,
            recommendation_reasons=rec_reasons,
            conditions=conditions,
            gates=gates,
            components=list(comps.values()),
            risks=self.risks(opp, gates, comps, now),
            why_now=self.why_now(opp, co, now, fit, gates),
            economics=self.economics(opp, co),
            computed_at=now,
        )

    def _recommend(
        self, gates: list[GateResult], fit: int, capability: Component
    ) -> tuple[Recommendation, list[Reason], list[Reason]]:
        """Explicit decision gates (spec §14). Never irreversible: a human decides."""
        fails = [g for g in gates if g.outcome == GateOutcome.FAIL]
        conditions = [
            Reason(f"condition.{g.remediation}", "?", g.reason.params, g.reason.evidence)
            for g in gates
            if g.remediation and g.outcome in (GateOutcome.GAP, GateOutcome.PASS, GateOutcome.UNKNOWN)
        ]
        if fails:
            return Recommendation.NO_BID, [g.reason for g in fails], []
        if capability.known and fit < self.cfg.review_threshold:
            return Recommendation.NO_BID, [Reason("recommendation.low_fit", "-", {"fit": fit})], conditions
        unclear = [g for g in gates if g.outcome == GateOutcome.UNKNOWN or g.truth == Truth.CONFLICTING]
        if unclear:
            return Recommendation.REVIEW, [g.reason for g in unclear], conditions
        gaps = [g for g in gates if g.outcome == GateOutcome.GAP or g.truth == Truth.NEEDS_HUMAN]
        if gaps:
            return Recommendation.BID_WITH_CONDITIONS, [g.reason for g in gaps], conditions
        if fit >= self.cfg.bid_threshold:
            return Recommendation.BID, [Reason("recommendation.strong_fit", "+", {"fit": fit})], conditions
        return Recommendation.REVIEW, [Reason("recommendation.moderate_fit", "?", {"fit": fit})], conditions
