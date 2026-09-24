"""Render stored, structured intelligence into the viewer's language (codes → text at the edge)."""

from __future__ import annotations

from typing import Any

from forsa.matching.messages import headline, render
from forsa.matching.profiles import Recommendation
from forsa.taxonomy import default_ontology


def _reason(r: dict[str, Any], lang: str) -> dict[str, Any]:
    return {**r, "message": render(r["code"], r.get("params"), lang, default_ontology())}


def render_match(result: dict[str, Any], lang: str = "fr") -> dict[str, Any]:
    onto = default_ontology()
    out = dict(result)
    for key in ("recommendation_reasons", "conditions", "why_now"):
        out[key] = [_reason(r, lang) for r in result.get(key, [])]
    out["gates"] = [{**g, "reason": _reason(g["reason"], lang)} for g in result.get("gates", [])]
    out["components"] = [
        {**c, "reasons": [_reason(r, lang) for r in c.get("reasons", [])]} for c in result.get("components", [])
    ]
    out["risks"] = [{**k, "reason": _reason(k["reason"], lang)} for k in result.get("risks", [])]
    rec = Recommendation(result["recommendation"])
    out["headline"] = headline(rec, lang)
    fit, pct = result["fit_score"], round(result["data_completeness"] * 100)
    reasons = " ".join(r["message"] for r in out["recommendation_reasons"][:3])
    if lang == "fr":
        out["explanation"] = (
            f"FORSA estime une adéquation de {fit}/100 sur la base des éléments disponibles "
            f"(complétude : {pct} %). {out['headline']} : {reasons}"
        )
    else:
        out["explanation"] = (
            f"FORSA estimates a {fit}/100 fit based on the available evidence "
            f"(data completeness: {pct}%). {out['headline']}: {reasons}"
        )
    out["unknowns"] = [
        g
        for g in out["gates"]
        if g["outcome"] == "UNKNOWN" or g["truth"] in ("NOT_FOUND", "NEEDS_HUMAN", "CONFLICTING")
    ]
    out["concept_labels"] = {cid: c.label(lang) for cid, c in onto.concepts.items()}
    return out


def concept_label(concept_id: str, lang: str = "fr") -> str:
    c = default_ontology().concepts.get(concept_id)
    return c.label(lang) if c else concept_id
