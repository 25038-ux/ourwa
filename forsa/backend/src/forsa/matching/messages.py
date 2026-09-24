"""Stage G — deterministic explanations (spec §12 G, §70, §115).

Reasons are stored as ``code + params``; text is rendered at the edge in the
viewer's language. Wording follows the product-language rules: never "you are
eligible", always "the available evidence indicates…". An LLM may re-word a
rendered explanation but may not add claims (see forsa.ai.boundaries).
"""

from __future__ import annotations

from typing import Any

from forsa.matching.profiles import MatchResult, Recommendation
from forsa.taxonomy.ontology import Ontology

_M: dict[str, dict[str, str]] = {
    "status.open": {"en": "The notice is open ({status}).", "fr": "L'avis est ouvert ({status})."},
    "status.planned": {"en": "Planned procurement — not yet published.", "fr": "Marché planifié — pas encore publié."},
    "status.not_open": {"en": "The notice is no longer open ({status}).", "fr": "L'avis n'est plus ouvert ({status})."},
    "deadline.unknown": {
        "en": "No submission deadline found in the source.",
        "fr": "Aucune date limite trouvée dans la source.",
    },
    "deadline.passed": {
        "en": "The deadline passed {days} days ago.",
        "fr": "La date limite est dépassée depuis {days} jours.",
    },
    "deadline.impossible": {
        "en": "Only {days} days left — below the {min_days}-day minimum to prepare a bid.",
        "fr": "Seulement {days} jours restants — sous le minimum de {min_days} jours.",
    },
    "deadline.feasible": {"en": "{days} days left to submit.", "fr": "{days} jours pour soumettre."},
    "exclusion.service": {
        "en": "Your profile excludes this type of work.",
        "fr": "Votre profil exclut ce type de prestation.",
    },
    "exclusion.region": {
        "en": "Your profile excludes the region {region}.",
        "fr": "Votre profil exclut la région {region}.",
    },
    "credential.not_found": {
        "en": "Required: {credential_label}. Not found in your profile (unknown, not absent).",
        "fr": "Exigé : {credential_label}. Introuvable dans votre profil (inconnu, pas absent).",
    },
    "credential.held": {
        "en": "Required {credential_label}: verified in your profile.",
        "fr": "{credential_label} exigé(e) : vérifié(e) dans votre profil.",
    },
    "credential.claimed": {
        "en": "Required {credential_label}: declared but not yet backed by a document.",
        "fr": "{credential_label} exigé(e) : déclaré(e) mais sans justificatif.",
    },
    "credential.expires": {
        "en": "Your {credential_label} expires on {valid_until}, before the deadline.",
        "fr": "Votre {credential_label} expire le {valid_until}, avant la date limite.",
    },
    "credential.in_progress": {"en": "{credential_label} is in progress.", "fr": "{credential_label} en cours."},
    "credential.obtainable": {
        "en": "Missing {credential_label}; typically obtainable in ~{days} days (estimate).",
        "fr": "{credential_label} manquant(e) ; obtenable en ~{days} jours (estimation).",
    },
    "credential.per_bid": {
        "en": "Per-bid instrument required: {credential_label} (~{days} days to obtain).",
        "fr": "Instrument à obtenir pour cette offre : {credential_label} (~{days} jours).",
    },
    "credential.absent": {
        "en": "Missing mandatory {credential_label}, not obtainable before the deadline.",
        "fr": "{credential_label} obligatoire manquant(e), non obtenable avant la date limite.",
    },
    "experience.met": {
        "en": "{found} similar references found (required: {needed}).",
        "fr": "{found} références similaires trouvées (exigé : {needed}).",
    },
    "experience.no_projects": {
        "en": "No project references in your profile yet.",
        "fr": "Aucune référence de projet dans votre profil.",
    },
    "experience.short": {
        "en": "{found} of {needed} required similar references found.",
        "fr": "{found} référence(s) similaire(s) sur {needed} exigée(s).",
    },
    "experience.project": {
        "en": "Relevant reference: {project} ({year}).",
        "fr": "Référence pertinente : {project} ({year}).",
    },
    "experience.none_similar": {
        "en": "No similar project in your references.",
        "fr": "Aucun projet similaire dans vos références.",
    },
    "financial.unknown": {
        "en": "Minimum turnover {required} {currency} required; your turnover is not on file.",
        "fr": "CA minimum {required} {currency} exigé ; votre CA n'est pas renseigné.",
    },
    "financial.currency_mismatch": {
        "en": "Turnover requirement in {currency}, profile in {company_currency}.",
        "fr": "Exigence de CA en {currency}, profil en {company_currency}.",
    },
    "financial.met": {
        "en": "Declared turnover meets the {required} {currency} minimum.",
        "fr": "Le CA déclaré atteint le minimum de {required} {currency}.",
    },
    "financial.short": {
        "en": "Declared turnover is below the {required} {currency} minimum.",
        "fr": "Le CA déclaré est inférieur au minimum de {required} {currency}.",
    },
    "registration.unknown": {
        "en": "Registration in {country} required; company country unknown.",
        "fr": "Immatriculation en {country} exigée ; pays inconnu.",
    },
    "registration.met": {"en": "Registered in {country} as required.", "fr": "Immatriculé en {country}."},
    "registration.mismatch": {
        "en": "Registration in {country} required (company: {company_country}).",
        "fr": "Immatriculation en {country} exigée (entreprise : {company_country}).",
    },
    "capability.no_concepts": {"en": "Scope not yet classified.", "fr": "Périmètre non encore classifié."},
    "capability.empty_profile": {
        "en": "Add capabilities to your profile to assess fit.",
        "fr": "Ajoutez vos compétences pour évaluer l'adéquation.",
    },
    "capability.match": {
        "en": "Needs {need_label}; you offer {offered_label}.",
        "fr": "Besoin : {need_label} ; vous proposez : {offered_label}.",
    },
    "capability.missing": {
        "en": "Needs {need_label}; not in your capabilities.",
        "fr": "Besoin : {need_label} ; absent de vos compétences.",
    },
    "evidence.none_used": {"en": "No company evidence used yet.", "fr": "Aucune preuve utilisée."},
    "evidence.verified_share": {
        "en": "{verified} of {total} supporting claims are verified.",
        "fr": "{verified} sur {total} éléments sont vérifiés.",
    },
    "capacity.size_ratio": {
        "en": "Estimated value is {ratio}× your largest project size.",
        "fr": "Valeur estimée = {ratio}× votre taille de projet maximale.",
    },
    "capacity.workload": {
        "en": "{active} active bids of {max} you can run in parallel.",
        "fr": "{active} offres actives sur {max} possibles en parallèle.",
    },
    "capacity.unknown": {"en": "Capacity data not provided.", "fr": "Capacité non renseignée."},
    "geography.unknown": {"en": "Location or service area unknown.", "fr": "Lieu ou zone d'intervention inconnu."},
    "geography.served": {"en": "You serve {region}.", "fr": "Vous intervenez à {region}."},
    "geography.not_served": {
        "en": "{region} is outside your declared service area.",
        "fr": "{region} est hors de votre zone déclarée.",
    },
    "strategic.known_buyer": {
        "en": "You have worked for this buyer before.",
        "fr": "Vous avez déjà travaillé pour cet acheteur.",
    },
    "strategic.focus_area": {"en": "In one of your strategic focus areas.", "fr": "Dans un de vos axes stratégiques."},
    "strategic.unknown": {"en": "No strategic preferences set.", "fr": "Aucune préférence stratégique."},
    "timeline.early_signal": {"en": "Early signal — time to prepare.", "fr": "Signal précoce — temps de préparation."},
    "timeline.days_left": {"en": "{days} days to prepare.", "fr": "{days} jours de préparation."},
    "risk.tight_deadline": {"en": "Tight deadline ({days} days).", "fr": "Délai serré ({days} jours)."},
    "risk.capacity": {
        "en": "Size or workload may exceed your capacity.",
        "fr": "La taille ou la charge peut dépasser votre capacité.",
    },
    "risk.value_unknown": {"en": "Contract value not published.", "fr": "Montant non publié."},
    "why_now.deadline_soon": {"en": "Closes in {days} days.", "fr": "Clôture dans {days} jours."},
    "why_now.new": {"en": "Newly published.", "fr": "Nouvellement publié."},
    "why_now.high_fit": {"en": "High fit ({fit}/100).", "fr": "Forte adéquation ({fit}/100)."},
    "why_now.gap_obtainable": {
        "en": "A missing document can still be obtained in time.",
        "fr": "Un document manquant peut encore être obtenu à temps.",
    },
    "why_now.early_signal": {
        "en": "Procurement plan signal: prepare before competitors.",
        "fr": "Signal du plan de passation : préparez-vous avant vos concurrents.",
    },
    "why_now.known_buyer": {"en": "Recurring buyer relationship.", "fr": "Relation existante avec l'acheteur."},
    "recommendation.low_fit": {
        "en": "Low fit ({fit}/100) with your capabilities.",
        "fr": "Faible adéquation ({fit}/100) avec vos compétences.",
    },
    "recommendation.strong_fit": {
        "en": "Strong fit ({fit}/100) and no blocking gate.",
        "fr": "Forte adéquation ({fit}/100), aucun critère bloquant.",
    },
    "recommendation.early_signal": {
        "en": "Planned procurement ({fit}/100 fit): prepare now, decide at publication.",
        "fr": "Marché planifié (adéquation {fit}/100) : préparez-vous, décidez à la publication.",
    },
    "recommendation.moderate_fit": {
        "en": "Moderate fit ({fit}/100) — worth a closer look.",
        "fr": "Adéquation moyenne ({fit}/100) — à examiner.",
    },
    "condition.obtain": {
        "en": "Obtain {credential_label} before the deadline.",
        "fr": "Obtenir {credential_label} avant la date limite.",
    },
    "condition.renew": {"en": "Renew {credential_label}.", "fr": "Renouveler {credential_label}."},
    "condition.upload_evidence": {"en": "Upload supporting evidence.", "fr": "Téléverser un justificatif."},
    "condition.partner": {
        "en": "Close the gap with a partner / consortium.",
        "fr": "Combler l'écart via un partenaire / groupement.",
    },
    "condition.add_credential": {
        "en": "Confirm whether you hold {credential_label}.",
        "fr": "Confirmez si vous détenez {credential_label}.",
    },
    "condition.add_projects": {"en": "Add similar project references.", "fr": "Ajoutez des références similaires."},
    "condition.add_financials": {"en": "Add your annual turnover.", "fr": "Renseignez votre chiffre d'affaires."},
    "condition.confirm_financials": {
        "en": "Confirm financial capacity with documents.",
        "fr": "Justifiez la capacité financière.",
    },
    "condition.complete_credential": {"en": "Complete {credential_label}.", "fr": "Finaliser {credential_label}."},
    "condition.verify_deadline": {
        "en": "Verify the deadline in the official notice.",
        "fr": "Vérifiez la date limite dans l'avis officiel.",
    },
}

_HEADLINE = {
    Recommendation.BID: {"en": "Pursue", "fr": "Soumissionner"},
    Recommendation.BID_WITH_CONDITIONS: {"en": "Pursue with conditions", "fr": "Soumissionner sous conditions"},
    Recommendation.REVIEW: {"en": "Needs review", "fr": "À examiner"},
    Recommendation.NO_BID: {"en": "Do not pursue", "fr": "Ne pas soumissionner"},
}


class _Safe(dict):
    def __missing__(self, key: str) -> str:
        return "?"


def render(code: str, params: dict[str, Any] | None, lang: str = "en", ontology: Ontology | None = None) -> str:
    template = _M.get(code, {}).get(lang) or _M.get(code, {}).get("en") or code
    values: dict[str, Any] = dict(params or {})
    if ontology is not None:
        for key in ("credential", "need", "offered"):
            cid = values.get(key)
            if isinstance(cid, str) and cid in ontology.concepts:
                values[f"{key}_label"] = ontology.concepts[cid].label(lang)
    for key, value in list(values.items()):
        if isinstance(value, float) and value.is_integer():
            value = int(value)
        if isinstance(value, int) and not isinstance(value, bool) and abs(value) >= 10_000:
            value = f"{value:,}".replace(",", "\u202f" if lang == "fr" else ",")
        values[key] = value
    return template.format_map(_Safe(values))


def explain(result: MatchResult, lang: str = "en", ontology: Ontology | None = None) -> str:
    """Human-readable summary built only from structured signals."""
    strength = {"en": ("strong", "moderate", "weak"), "fr": ("forte", "moyenne", "faible")}.get(
        lang, ("strong", "moderate", "weak")
    )
    level = strength[0] if result.fit_score >= 70 else strength[1] if result.fit_score >= 45 else strength[2]
    pct = round(result.data_completeness * 100)
    if lang == "fr":
        head = (
            f"FORSA estime une adéquation {level} ({result.fit_score}/100) sur la base des éléments "
            f"disponibles (complétude des données : {pct} %)."
        )
    else:
        head = (
            f"FORSA estimates a {level} fit ({result.fit_score}/100) based on the available evidence "
            f"(data completeness: {pct}%)."
        )
    rec = _HEADLINE[result.recommendation].get(lang, _HEADLINE[result.recommendation]["en"])
    reasons = " ".join(render(r.code, r.params, lang, ontology) for r in result.recommendation_reasons[:3])
    return f"{head} {rec}: {reasons}".strip()


def headline(rec: Recommendation, lang: str = "en") -> str:
    return _HEADLINE[rec].get(lang, _HEADLINE[rec]["en"])


def known_codes() -> set[str]:
    return set(_M)
