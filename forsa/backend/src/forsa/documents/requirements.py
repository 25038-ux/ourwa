"""Rule-based requirement extraction (spec §16) — the deterministic baseline.

Every requirement keeps its citation (page, heading path, char span, quote).
An LLM extractor can later *propose* additional requirements, which enter as
INFERENCE + NEEDS_REVIEW; this baseline is what evals measure against.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from forsa.documents.extract import Page
from forsa.documents.segment import Segment, segment_pages
from forsa.kernel.epistemics import Epistemic, Verification
from forsa.kernel.hashing import content_hash
from forsa.matching.profiles import EvidenceRef, ReqKind, RequirementSpec
from forsa.taxonomy.ontology import Ontology

EXTRACTOR_VERSION = "rules:req-v1"

_MANDATORY = re.compile(
    r"\b(doit|doivent|devra|devront|obligatoire|obligatoires|exige|exigee|exiges|exigees|requis|requise|requises"
    r"|sous peine|a peine de|eliminatoire|est tenu|sont tenus|must|shall|mandatory|required)\b"
    r"|يجب|إلزامي|إلزامية|مطلوب|يتعين|ينبغي",
)
_SCORED = re.compile(
    r"\b(sera notee?|seront notee?s|points|bareme|notation|critere d'evaluation|scored|evaluation criteria)\b"
)
_CATEGORIES: list[tuple[str, re.Pattern[str]]] = [
    (
        "certification",
        re.compile(r"\b(certificat|certification|attestation|agrement|iso|licence|quitus)\b|شهادة|اعتماد"),
    ),
    (
        "experience",
        re.compile(
            r"\b(reference|references|experience|marches similaires|projets similaires|similar"
            r" (contracts|projects))\b|خبرة|مراجع"
        ),
    ),
    (
        "financial",
        re.compile(
            r"\b(chiffre d'affaires|turnover|caution|garantie (de soumission|d'offre|de bonne"
            r" execution|bancaire)|capacite financiere|bilan|etats financiers|financial|bid"
            r" (security|bond))\b|رقم الأعمال|ضمان (العرض|بنكي)"
        ),
    ),
    ("administrative", re.compile(r"\b(registre|nif|cnss|rccm|statuts|immatricul|registration)\b|سجل تجاري")),
    ("personnel", re.compile(r"\b(ingenieur|chef de projet|chef de mission|personnel|cv|expert|staff)\b|مهندس")),
    ("delivery", re.compile(r"\b(delai d'execution|delai de livraison|livraison|delivery|execution period)\b")),
    ("formatting", re.compile(r"\b(exemplaires|sous pli|original|copies|format|signed|signee|paraphee)\b")),
    ("technical", re.compile(r"\b(specifications?|garantie|conforme|normes?|technical|warranty)\b")),
]
_EXPERIENCE_RX = dict(_CATEGORIES)["experience"]
_FINANCIAL_RX = dict(_CATEGORIES)["financial"]
_NUMBER_WORDS = {
    "un": 1,
    "une": 1,
    "one": 1,
    "deux": 2,
    "two": 2,
    "trois": 3,
    "three": 3,
    "quatre": 4,
    "four": 4,
    "cinq": 5,
    "five": 5,
    "six": 6,
    "sept": 7,
    "seven": 7,
    "huit": 8,
    "eight": 8,
    "dix": 10,
    "ten": 10,
}
_COUNT = re.compile(
    r"\b(?:au moins|minimum|at least|moins)?\s*(\d+|" + "|".join(_NUMBER_WORDS) + r")\s*(?:\(\d+\)\s*)?"
    r"(?:(?:similaires?|similar|comparables?)\s+)?(?:marches|references|projets|contrats|contracts|projects)\b"
)
_AMOUNT = re.compile(
    r"(\d{1,3}(?:[   .,]\d{3})+|\d+(?:[.,]\d+)?)\s*(millions?|milliards?|billion)?\s*(?:de\s+|d')?"
    r"(mru|um|ouguiyas?|usd|\$|eur|€|fcfa|xof)\b",
)
_CURRENCY = {
    "mru": "MRU",
    "um": "MRU",
    "ouguiya": "MRU",
    "ouguiyas": "MRU",
    "usd": "USD",
    "$": "USD",
    "eur": "EUR",
    "€": "EUR",
    "fcfa": "XOF",
    "xof": "XOF",
}


def _fold(text: str) -> str:
    """Lower-case + strip Latin accents while keeping string length identical (offsets stay valid)."""
    out = []
    for ch in text.casefold():
        base = unicodedata.normalize("NFKD", ch)
        stripped = "".join(c for c in base if not unicodedata.combining(c))
        out.append(stripped[:1] if len(stripped) >= 1 else ch)
    return "".join(out)


@dataclass(slots=True)
class ExtractedRequirement:
    id: str
    text: str
    type: str  # mandatory | scored | informational
    category: str
    page: int
    heading_path: tuple[str, ...]
    start: int
    end: int
    credential_ids: list[str] = field(default_factory=list)
    min_count: int | None = None
    min_amount: float | None = None
    currency: str | None = None
    notes: list[str] = field(default_factory=list)
    extraction_method: str = EXTRACTOR_VERSION
    confidence: str = "MEDIUM"

    @property
    def locator(self) -> str:
        section = " › ".join(self.heading_path) if self.heading_path else "—"
        return f"p.{self.page} § {section}"

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "text": self.text,
            "type": self.type,
            "category": self.category,
            "page": self.page,
            "heading_path": list(self.heading_path),
            "start": self.start,
            "end": self.end,
            "credential_ids": self.credential_ids,
            "min_count": self.min_count,
            "min_amount": self.min_amount,
            "currency": self.currency,
            "notes": self.notes,
            "extraction_method": self.extraction_method,
            "confidence": self.confidence,
            "locator": self.locator,
        }


def _parse_amount(folded: str) -> tuple[float | None, str | None, list[str]]:
    m = _AMOUNT.search(folded)
    if not m:
        return None, None, []
    raw, scale, cur = m.group(1), m.group(2), m.group(3)
    digits = re.sub(r"[   ]", "", raw)
    if re.fullmatch(r"\d{1,3}(?:[.,]\d{3})+", digits):
        value = float(re.sub(r"[.,]", "", digits))
    else:
        value = float(digits.replace(",", "."))
    if scale:
        value *= 1e9 if scale.startswith(("milliard", "billion")) else 1e6
    notes = ["currency_um_may_be_pre_2018_mro"] if cur == "um" else []
    return value, _CURRENCY.get(cur), notes


def classify(segment: Segment, ontology: Ontology) -> ExtractedRequirement | None:
    folded = _fold(segment.text)
    is_mandatory = bool(_MANDATORY.search(folded) or _MANDATORY.search(segment.text))
    is_scored = bool(_SCORED.search(folded))
    creds = sorted({h.concept_id for h in ontology.find(segment.text, kinds=("credential",))})
    category = next((name for name, rx in _CATEGORIES if rx.search(folded) or rx.search(segment.text)), None)
    if not (is_mandatory or is_scored) or (category is None and not creds):
        return None
    if creds and category is None:
        category = "certification"
    req = ExtractedRequirement(
        id=content_hash([segment.page, segment.start, segment.text])[:16],
        text=segment.text,
        type="mandatory" if is_mandatory else "scored",
        category=category or "other",
        page=segment.page,
        heading_path=segment.heading_path,
        start=segment.start,
        end=segment.end,
        credential_ids=creds,
    )
    # A clause may carry several obligations ("ISO 9001 and five similar contracts"): parse every one we know.
    if _EXPERIENCE_RX.search(folded):
        m = _COUNT.search(folded)
        if m:
            tok = m.group(1)
            req.min_count = int(tok) if tok.isdigit() else _NUMBER_WORDS.get(tok)
    if _FINANCIAL_RX.search(folded) or _FINANCIAL_RX.search(segment.text):
        req.min_amount, req.currency, req.notes = _parse_amount(folded)
    return req


def extract_requirements(pages: list[Page], ontology: Ontology) -> list[ExtractedRequirement]:
    seen: set[str] = set()
    out: list[ExtractedRequirement] = []
    for seg in segment_pages(pages):
        if seg.kind != "clause":
            continue
        req = classify(seg, ontology)
        if req and req.id not in seen:
            seen.add(req.id)
            out.append(req)
    return out


def to_specs(
    req: ExtractedRequirement, evidence_id: str | None = None, verification: Verification = Verification.UNVERIFIED
) -> list[RequirementSpec]:
    """Project an extracted requirement onto the typed gates the matching engine understands."""
    ev = EvidenceRef(Epistemic.FACT, quote=req.text[:300], locator=req.locator, evidence_id=evidence_id)
    mandatory = req.type == "mandatory"
    specs: list[RequirementSpec] = []
    for cred in req.credential_ids:
        specs.append(
            RequirementSpec(
                f"{req.id}:{cred}",
                ReqKind.CREDENTIAL,
                mandatory,
                req.text,
                credential_id=cred,
                evidence=ev,
                verification=verification,
            )
        )
    if req.category == "experience" or req.min_count:
        specs.append(
            RequirementSpec(
                req.id,
                ReqKind.EXPERIENCE,
                mandatory,
                req.text,
                min_count=req.min_count,
                evidence=ev,
                verification=verification,
            )
        )
    if (
        req.category == "financial"
        and req.min_amount
        and re.search(r"chiffre d'affaires|turnover|رقم الأعمال", _fold(req.text))
    ):
        specs.append(
            RequirementSpec(
                req.id,
                ReqKind.FINANCIAL_TURNOVER,
                mandatory,
                req.text,
                min_amount=req.min_amount,
                currency=req.currency,
                evidence=ev,
                verification=verification,
            )
        )
    if not specs:
        specs.append(
            RequirementSpec(req.id, ReqKind.OTHER, mandatory, req.text, evidence=ev, verification=verification)
        )
    return specs
