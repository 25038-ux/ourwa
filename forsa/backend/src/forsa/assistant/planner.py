"""Deterministic planner + composer: the assistant works with no language model at all.

`plan()` maps a FR/EN/AR question to tool calls (natural-language search filters included, spec §42).
`compose()` turns tool results into a short, voice-friendly answer. Only facts from tool results are stated.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from forsa.country import get_pack
from forsa.taxonomy import default_ontology
from forsa.taxonomy.normalize import detect_language

_REF = re.compile(r"\b([A-Z]{2,}(?:-[A-Z0-9]+){2,})\b")
_UUID = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b")


def _fold(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", text.casefold()) if not unicodedata.combining(c))


def _has(folded: str, *words: str) -> bool:
    return any(w in folded for w in words)


def reply_lang(text: str, ui_lang: str) -> str:
    detected = detect_language(text)
    return detected if detected in ("fr", "en") else ("fr" if ui_lang not in ("fr", "en") else ui_lang)


def _max_value(folded: str) -> float | None:
    m = re.search(
        r"(?:moins de|inferieur a|under|below|less than|<)\s*(\d+(?:[.,]\d+)?)\s*(millions?|million|m\b|k)?", folded
    )
    if not m:
        return None
    value = float(m.group(1).replace(",", "."))
    unit = m.group(2) or ""
    return value * (1e6 if unit.startswith("m") else 1e3 if unit == "k" else 1)


def _region(text: str) -> str | None:
    pack = get_pack("MR")
    names = [*pack.get("region_aliases", {}).keys(), *pack["regions"]]
    folded = _fold(text)
    for name in sorted(names, key=len, reverse=True):
        if _fold(name) in folded:
            return name
    return None


def plan(text: str, focus_opportunity_id: str | None = None) -> list[tuple[str, dict[str, Any]]]:
    folded = _fold(text)
    ref_match = _REF.search(text) or _UUID.search(text)
    ref = ref_match.group(0) if ref_match else None
    target = ref or focus_opportunity_id
    opp_args = {"opportunity": ref} if ref else {}

    if _has(folded, "pourquoi", "why", "لماذا", "explique", "explain", "justif"):
        return [("explain_recommendation", opp_args)] if target else [("top_recommendations", {"limit": 3})]
    if _has(folded, "partenaire", "partner", "groupement", "consortium", "شريك", "sous-trait"):
        return [("find_partners", opp_args)] if target else [("top_recommendations", {"limit": 3})]
    if _has(folded, "exigence", "requirement", "pieces", "dossier", "شروط", "critere", "criteria") and target:
        return [("list_requirements", opp_args)]
    if _has(folded, "lance", "commencer", "demarrer", "start bid", "start a bid", "ouvrir un espace", "soumettre pour"):
        return [("propose_action", {"action": "start_bid", **opp_args})] if target else [("top_recommendations", {})]
    onto = default_ontology()
    topic = onto.find(text)
    if not topic and _has(
        folded,
        "echeance",
        "date limite",
        "deadline",
        "clotur",
        "expire",
        "موعد",
        "مواعيد",
        "الموعد النهائي",
        "آخر أجل",
        "closing",
        "ferme",
    ):
        m = re.search(r"(\d+)\s*(jours|days|j\b|يوم)", folded)
        days = int(m.group(1)) if m else (7 if _has(folded, "semaine", "week", "اسبوع") else 14)
        return [("upcoming_deadlines", {"days": days})]
    if _has(
        folded,
        "mon profil",
        "notre profil",
        "my profile",
        "our profile",
        "competence",
        "capabilit",
        "ملف",
        "what can we do",
        "que savons",
    ):
        return [("get_company_profile", {})]
    wants_search = _has(folded, "cherche", "trouve", "search", "find", "show", "montre", "liste")
    wants_detail = _has(folded, "detail", "resume", "summar", "dis-moi", "tell me", "c'est quoi", "what is", "infos")
    if target and wants_detail and not wants_search:
        return [("get_opportunity", opp_args)]

    concepts = sorted(
        {h.concept_id for h in topic if onto.concepts[h.concept_id].parent is not None} or {h.concept_id for h in topic}
    )
    args: dict[str, Any] = {}
    if concepts:
        args["concepts"] = concepts
    region = _region(text)
    if region:
        args["region"] = region
    value = _max_value(folded)
    if value:
        args["max_value"] = value
    m = re.search(r"(\d+)\s*(jours|days|يوم)", folded)
    if m:
        args["max_days_left"] = float(m.group(1))
    for words, cat in (
        (("travaux", "construction", "works", "btp", "أشغال"), "works"),
        (("fourniture", "supply", "goods", "materiel", "توريد"), "goods"),
        (("consultant", "etude", "consulting", "assistance technique", "استشار"), "consulting"),
        (("services courants", "nettoyage", "gardiennage", "cleaning"), "services"),
    ):
        if _has(folded, *words) and not concepts:
            args["category"] = cat
            break
    if _has(
        folded,
        "realiste",
        "realistically",
        "capable",
        "execut",
        "peut faire",
        "can do",
        "can execute",
        "satisfai",
        "eligible",
        "mandatory requirements",
    ):
        args["exclude_no_bid"] = True
    if args:
        return [("search_opportunities", {**args, "limit": 5})]
    if _has(
        folded,
        "bonjour",
        "salut",
        "hello",
        "hi ",
        "مرحبا",
        "السلام",
        "brief",
        "aujourd",
        "today",
        "priorit",
        "quoi faire",
        "what should",
        "cette semaine",
        "this week",
        "bid on",
        "soumissionner",
    ):
        return [("get_briefing", {}), ("top_recommendations", {"limit": 3})]
    return [("top_recommendations", {"limit": 5})]


# ── composer ────────────────────────────────────────────────────────────────
_REC = {
    "fr": {
        "BID": "soumissionner",
        "BID_WITH_CONDITIONS": "soumissionner sous conditions",
        "REVIEW": "à examiner",
        "NO_BID": "ne pas soumissionner",
        None: "non évaluée",
    },
    "en": {
        "BID": "pursue",
        "BID_WITH_CONDITIONS": "pursue with conditions",
        "REVIEW": "review",
        "NO_BID": "do not pursue",
        None: "not assessed",
    },
}


def _item(i: dict[str, Any], lang: str) -> str:
    bits = [i["title"]]
    if i.get("fit") is not None:
        bits.append(f"{'adéquation' if lang == 'fr' else 'fit'} {i['fit']}/100")
    bits.append(_REC[lang].get(i.get("recommendation"), ""))
    if i.get("days_left") is not None:
        bits.append(f"{round(i['days_left'])} {'jours restants' if lang == 'fr' else 'days left'}")
    elif i.get("status") == "PLANNED":
        bits.append("signal précoce" if lang == "fr" else "early signal")
    return " — ".join(b for b in bits if b)


def _list(items: list[dict[str, Any]], lang: str) -> str:
    return " ".join(f"{n}) {_item(i, lang)}." for n, i in enumerate(items, 1))


def compose(results: list[tuple[str, dict[str, Any]]], lang: str) -> str:
    fr = lang == "fr"
    parts: list[str] = []
    mentions_fit = False
    for name, r in results:
        if r.get("error") == "not_found":
            parts.append("Je n'ai pas trouvé cette opportunité." if fr else "I couldn't find that opportunity.")
            continue
        if r.get("error") == "no_profile":
            parts.append(
                "Complétez d'abord le profil de votre entreprise." if fr else "Complete your company profile first."
            )
            continue
        if r.get("error") == "no_match_for_company":
            parts.append(
                f"« {r['title']} » n'a pas encore été évaluée pour votre entreprise."
                if fr
                else f"“{r['title']}” hasn't been assessed for your company yet."
            )
            continue
        if name in ("search_opportunities", "top_recommendations"):
            items = r.get("items", [])
            if not items:
                parts.append(
                    "Aucune opportunité ouverte ne correspond pour l'instant."
                    if fr
                    else "No open opportunity matches right now."
                )
            else:
                mentions_fit = mentions_fit or any(i.get("fit") is not None for i in items)
                head = f"Voici {len(items)} opportunité(s) à regarder :" if fr else f"Here are {len(items)} to look at:"
                if name == "search_opportunities" and r.get("total", 0) > len(items):
                    head = (
                        f"{r['total']} opportunités correspondent ; les meilleures :"
                        if fr
                        else f"{r['total']} match; the best ones:"
                    )
                parts.append(f"{head} {_list(items, lang)}")
        elif name == "upcoming_deadlines":
            items = r.get("items", [])
            parts.append(
                (
                    f"{len(items)} échéance(s) dans les {r['days']} prochains jours. "
                    if fr
                    else f"{len(items)} deadline(s) in the next {r['days']} days. "
                )
                + _list(items, lang)
                if items
                else (
                    f"Aucune échéance pertinente dans les {r['days']} prochains jours."
                    if fr
                    else f"No relevant deadline in the next {r['days']} days."
                )
            )
            mentions_fit = mentions_fit or bool(items)
        elif name == "explain_recommendation":
            mentions_fit = True
            txt = f"{r['headline']} — {r['title']}. " + (
                f"Adéquation {r['fit']}/100 (complétude des données {r['data_completeness']} %). "
                if fr
                else f"Fit {r['fit']}/100 (data completeness {r['data_completeness']}%). "
            )
            txt += " ".join(r["reasons"][:3])
            if r["conditions"]:
                txt += (" Conditions : " if fr else " Conditions: ") + " ".join(r["conditions"][:3])
            parts.append(txt)
        elif name == "get_opportunity":
            txt = _item(r, lang) + "."
            if r.get("why_now"):
                txt += " " + " ".join(r["why_now"][:2])
            if r.get("conditions"):
                txt += (" À faire : " if fr else " To do: ") + " ".join(r["conditions"][:3])
            mentions_fit = mentions_fit or r.get("fit") is not None
            parts.append(txt)
        elif name == "list_requirements":
            items = r.get("items", [])
            mandatory = [i for i in items if i["type"] == "mandatory"]
            txt = (
                f"{len(items)} exigence(s) extraite(s) pour « {r['title']} », dont {len(mandatory)} obligatoire(s). "
                if fr
                else f"{len(items)} requirement(s) extracted for “{r['title']}”, {len(mandatory)} mandatory. "
            )
            txt += " ".join(f"• {i['text']} (p.{i['page']})" for i in mandatory[:4])
            parts.append(txt)
        elif name == "get_company_profile":
            caps = r["capabilities"]
            verified = sum(c["verified"] for c in caps)
            parts.append(
                (
                    f"Votre profil compte {len(caps)} compétence(s), dont {verified} vérifiée(s) : "
                    if fr
                    else f"Your profile lists {len(caps)} capabilities, {verified} verified: "
                )
                + ", ".join(c["label"] for c in caps)
                + ". "
                + (f"{r['projects']} référence(s) de projet." if fr else f"{r['projects']} project reference(s).")
            )
        elif name == "get_briefing":
            c = r["counts"]
            parts.append(
                f"Aujourd'hui : {c['high_fit']} opportunité(s) à forte adéquation, {c['deadlines']} échéance(s) "
                f"sous 7 jours, {c['early_signals']} signal(aux) précoce(s)."
                if fr
                else f"Today: {c['high_fit']} high-fit opportunities, {c['deadlines']} deadline(s) within 7 days, "
                f"{c['early_signals']} early signal(s)."
            )
            if r.get("top_action"):
                t = r["top_action"]
                parts.append(
                    (f"Action prioritaire : {t['title']}" if fr else f"Top action: {t['title']}")
                    + (f" — {t['blocker']}" if t.get("blocker") else "")
                    + "."
                )
        elif name == "find_partners":
            if not r["gaps"]:
                parts.append(
                    "Vos compétences couvrent déjà le périmètre de cette opportunité."
                    if fr
                    else "Your capabilities already cover this opportunity's scope."
                )
            else:
                txt = ("Compétences manquantes : " if fr else "Missing capabilities: ") + ", ".join(r["gaps"]) + ". "
                if r["partners"]:
                    txt += (
                        "Partenaires possibles (ayant accepté la mise en relation) : "
                        if fr
                        else "Possible partners (opted in to matchmaking): "
                    )
                    txt += "; ".join(f"{p['name']} ({', '.join(p['covers'])})" for p in r["partners"]) + "."
                else:
                    txt += (
                        "Aucune entreprise consentante ne couvre encore ces besoins."
                        if fr
                        else "No consenting company covers these needs yet."
                    )
                parts.append(txt)
        elif name == "propose_action" and r.get("action"):
            a = r["action"]
            label = {
                "start_bid": ("ouvrir un espace d'offre", "open a bid workspace"),
                "mark_irrelevant": ("marquer comme non pertinente", "mark it as not relevant"),
                "create_task": ("créer une tâche", "create a task"),
                "open_opportunity": ("ouvrir l'opportunité", "open the opportunity"),
            }[a["type"]][0 if fr else 1]
            parts.append(
                (f"Je peux {label}" if fr else f"I can {label}")
                + (f" pour « {a.get('opportunity_title')} »" if fr and a.get("opportunity_title") else "")
                + (f" for “{a.get('opportunity_title')}”" if not fr and a.get("opportunity_title") else "")
                + (" — confirmez avec le bouton ci-dessous." if fr else " — confirm with the button below.")
            )
    if mentions_fit:
        parts.append(
            "(Estimations d'adéquation fondées sur les preuves disponibles, pas des probabilités de gain.)"
            if fr
            else "(Fit estimates based on available evidence, not win probabilities.)"
        )
    return " ".join(parts).strip()


def speech_text(text: str, limit: int = 420) -> str:
    """Short, markdown-free version for text-to-speech."""
    plain = re.sub(r"[*_#`>\[\]]", "", text)
    plain = re.sub(r"\(Estimations?.*?\)|\(Fit estimates.*?\)", "", plain)
    if len(plain) <= limit:
        return plain.strip()
    cut = plain[:limit]
    return (cut[: cut.rfind(".") + 1] if "." in cut else cut).strip()
